import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { readBoundedJson } from '@/lib/http/read-bounded-json'

const createPlantSchema = z.object({
  name: z.string().trim().min(1).max(80),
  crop_id: z.string().uuid(),
})

const updatePlantSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
})

async function requireFarmer() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { response: NextResponse.json({ error: 'No autorizado.' }, { status: 401 }) }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) {
    return { response: NextResponse.json({ error: 'No se pudo verificar la cuenta.' }, { status: 500 }) }
  }
  if (profile?.role !== 'farmer') {
    return { response: NextResponse.json({ error: 'Esta acción está disponible para agricultores.' }, { status: 403 }) }
  }

  return { supabase, user }
}

export async function GET() {
  const auth = await requireFarmer()
  if ('response' in auth) return auth.response

  const [cropResult, plantResult] = await Promise.all([
    auth.supabase
      .from('crops')
      .select('id, name, scientific_name')
      .eq('is_active', true)
      .order('name'),
    auth.supabase
      .from('plants')
      .select('id, name, crop_id, created_at')
      .order('created_at', { ascending: false }),
  ])

  if (cropResult.error || plantResult.error) {
    return NextResponse.json({ error: 'No se pudo cargar la información de las plantas.' }, { status: 500 })
  }

  const crops = cropResult.data ?? []
  const cropById = new Map(crops.map((crop) => [crop.id, crop]))
  const plants = (plantResult.data ?? []).map((plant) => ({
    ...plant,
    crop: cropById.get(plant.crop_id) ?? null,
  }))

  return NextResponse.json({ crops, plants })
}

export async function POST(request: Request) {
  const auth = await requireFarmer()
  if ('response' in auth) return auth.response

  const body = await readBoundedJson(request)
  if (!body.ok) {
    return NextResponse.json(
      { error: body.reason === 'too-large' ? 'La solicitud supera el tamaño permitido.' : 'La solicitud no tiene un formato válido.' },
      { status: body.reason === 'too-large' ? 413 : 400 },
    )
  }
  const parsed = createPlantSchema.safeParse(body.value)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Revisa el nombre y el cultivo seleccionado.' }, { status: 400 })
  }

  try {
    const { data: crop, error: cropError } = await auth.supabase
      .from('crops')
      .select('id, name, scientific_name')
      .eq('id', parsed.data.crop_id)
      .eq('is_active', true)
      .maybeSingle()

    if (cropError) return NextResponse.json({ error: 'No se pudo verificar el cultivo.' }, { status: 500 })
    if (!crop) return NextResponse.json({ error: 'El cultivo seleccionado no está disponible.' }, { status: 400 })

    // PostgREST executes a plain INSERT here (supabase-js sends
    // `Prefer: return=minimal` when `.select()` is not chained), i.e. no
    // RETURNING clause. Investigation showed the plants_insert_own WITH CHECK
    // policy's correlated subplan mis-evaluates at execution time whenever the
    // statement carries RETURNING (deterministic SQLSTATE 42501), so the row is
    // generated client-side and read back with a separate SELECT that stays
    // under the plants_select_own RLS policy.
    const plantId = crypto.randomUUID()
    const { error: insertError } = await auth.supabase
      .from('plants')
      .insert({ id: plantId, farmer_id: auth.user.id, crop_id: crop.id, name: parsed.data.name })

    if (insertError) {
      // Server-side diagnostic: the PostgREST error carries database metadata
      // (SQLSTATE code, message, details, hint) that the generic 500 above
      // would otherwise discard. Log only those four fields — never the
      // request's JWT, cookies, or personal data — and keep the user-facing
      // response unchanged.
      console.error('[plants] insert rejected', {
        code: insertError.code ?? null,
        message: insertError.message,
        details: insertError.details ?? null,
        hint: insertError.hint ?? null,
      })
      return NextResponse.json({ error: 'No se pudo registrar la planta.' }, { status: 500 })
    }

    // Read back the row that was just created. Scoped to the authenticated
    // farmer's id; still evaluated under plants_select_own RLS. No service-role
    // client and no second INSERT on failure.
    const { data: plant, error: readError } = await auth.supabase
      .from('plants')
      .select('id, name, crop_id, created_at')
      .eq('id', plantId)
      .eq('farmer_id', auth.user.id)
      .maybeSingle()

    if (readError || !plant) {
      if (readError) {
        console.error('[plants] post-insert read failed', {
          code: readError.code ?? null,
          message: readError.message,
          details: readError.details ?? null,
          hint: readError.hint ?? null,
        })
      }
      // Distinct server-side failure: the row was created, but the response
      // cannot include it. The insert is never retried here.
      return NextResponse.json(
        { error: 'La planta se registró, pero no se pudo cargar su información.' },
        { status: 500 },
      )
    }

    return NextResponse.json({ plant: { ...plant, crop } }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'La solicitud no tiene un formato válido.' }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  const auth = await requireFarmer()
  if ('response' in auth) return auth.response

  const body = await readBoundedJson(request)
  if (!body.ok) {
    return NextResponse.json(
      { error: body.reason === 'too-large' ? 'La solicitud supera el tamaño permitido.' : 'La solicitud no tiene un formato válido.' },
      { status: body.reason === 'too-large' ? 413 : 400 },
    )
  }
  const parsed = updatePlantSchema.safeParse(body.value)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Revisa el nombre de la planta.' }, { status: 400 })
  }

  try {
    const { data: plant, error } = await auth.supabase
      .from('plants')
      .update({ name: parsed.data.name })
      .eq('id', parsed.data.id)
      .eq('farmer_id', auth.user.id)
      .select('id, name, crop_id, created_at')
      .maybeSingle()

    if (error) return NextResponse.json({ error: 'No se pudo actualizar la planta.' }, { status: 500 })
    if (!plant) return NextResponse.json({ error: 'No se encontró esa planta en tu cuenta.' }, { status: 404 })

    return NextResponse.json({ plant })
  } catch {
    return NextResponse.json({ error: 'La solicitud no tiene un formato válido.' }, { status: 400 })
  }
}
