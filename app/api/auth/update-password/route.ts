import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { passwordUpdateSchema } from '@/lib/auth/password'
import { createClient } from '@/lib/supabase/server'
import { readBoundedJson } from '@/lib/http/read-bounded-json'

export async function POST(request: Request) {
  const cookieStore = await cookies()
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'La sesión de recuperación expiró. Solicita un nuevo enlace.' }, { status: 401 })
  if (cookieStore.get('agritech-password-recovery')?.value !== '1') {
    return NextResponse.json({ error: 'Solicita un enlace de recuperación antes de cambiar la contraseña.' }, { status: 403 })
  }

  const body = await readBoundedJson(request)
  if (!body.ok) {
    if (body.reason === 'too-large') {
      return NextResponse.json({ error: 'La solicitud supera el tamaño permitido.' }, { status: 413 })
    }
    return NextResponse.json({ error: 'La nueva contraseña no es válida.' }, { status: 400 })
  }
  const parsed = passwordUpdateSchema.safeParse(body.value)
  if (!parsed.success) return NextResponse.json({ error: 'Usa una contraseña de al menos 12 caracteres.' }, { status: 400 })

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) return NextResponse.json({ error: 'No se pudo actualizar la contraseña. Solicita un nuevo enlace.' }, { status: 400 })
  const response = NextResponse.json({ success: true })
  response.cookies.set('agritech-password-recovery', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth/update-password',
    maxAge: 0,
  })
  return response
}
