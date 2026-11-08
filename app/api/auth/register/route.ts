import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/service'
import { createAuditLog } from '@/lib/audit'
import { readBoundedJson } from '@/lib/http/read-bounded-json'

const registerSchema = z.object({
  email: z.string().trim().email('Invalid email address').max(254),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  full_name: z.string().trim().min(1, 'Full name is required').max(120).optional(),
})

// Only administrators can create new farmer accounts (secure admin provisioning).
// The whole handler is wrapped in try/catch so every outcome — including an
// unexpected throw from the Supabase SDK or network layer — responds with a
// valid JSON body instead of a bare error page the UI cannot parse.
export async function POST(request: Request) {
  try {
    return await registerFarmer(request)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function registerFarmer(request: Request) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll().map(({ name, value }) => ({ name, value }))
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set({ name, value, ...options })
          })
        },
      },
    }
  )
  const serviceClient = createServiceClient()

  // Verify the requesting user is an administrator
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check admin role via profiles table
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'administrator') {
    return NextResponse.json({ error: 'Forbidden: administrator only' }, { status: 403 })
  }

  // Defense in depth: ensure at least one administrator exists in the system.
  // The requesting user was verified as an administrator above, but this check
  // guards against inconsistent state where admin provisioning may have failed.
  const { data: adminProfiles } = await serviceClient
    .from('profiles')
    .select('id')
    .eq('role', 'administrator');

  if (!adminProfiles || adminProfiles.length === 0) {
    return NextResponse.json(
      { error: 'No administrators available' },
      { status: 500 }
    );
  }

  let validated: z.infer<typeof registerSchema>
  const body = await readBoundedJson(request)
  if (!body.ok) {
    if (body.reason === 'too-large') {
      return NextResponse.json({ error: 'La solicitud supera el tamaño permitido.' }, { status: 413 })
    }
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  try {
    validated = registerSchema.parse(body.value)
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { data: newUserData, error: createError } = await serviceClient.auth.admin.createUser({
    email: validated.email,
    password: validated.password,
    email_confirm: true,
    user_metadata: {
      full_name: validated.full_name,
      role: 'farmer',
    },
  })

  if (createError || !newUserData?.user) {
    return NextResponse.json({ error: 'Failed to create account' }, { status: 400 })
  }

  const newUserId = newUserData.user.id
  const { error: profileError } = await serviceClient.from('profiles').insert({
    id: newUserId,
    email: validated.email,
    full_name: validated.full_name,
    role: 'farmer',
  })

  if (profileError) {
    const { error: cleanupError } = await serviceClient.auth.admin.deleteUser(newUserId)
    if (cleanupError) {
      console.error('Failed to roll back farmer account after profile creation failed')
      return NextResponse.json(
        {
          error: 'Could not complete farmer account setup',
          warning: 'No se pudo revertir el acceso temporal. Informe al responsable del sistema para completar la limpieza.',
        },
        { status: 500 },
      )
    }
    return NextResponse.json({ error: 'Could not complete farmer account setup' }, { status: 500 })
  }

  try {
    await createAuditLog(serviceClient, user.id, 'admin_created_farmer', 'profiles', newUserId, {
      farmer_email: validated.email,
    })
  } catch {
    const { error: cleanupError } = await serviceClient.auth.admin.deleteUser(newUserId)
    if (cleanupError) {
      console.error('Failed to roll back farmer account after audit logging failed')
      return NextResponse.json(
        {
          error: 'Could not complete farmer account setup',
          warning: 'No se pudo revertir el acceso temporal. Informe al responsable del sistema para completar la limpieza.',
        },
        { status: 500 },
      )
    }
    return NextResponse.json({ error: 'Could not complete farmer account setup' }, { status: 500 })
  }

  return NextResponse.json({ success: true, userId: newUserId }, { status: 201 })
}


