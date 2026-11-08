import { NextResponse } from 'next/server'
import { createClient } from './server'

export async function getFarmerContext() {
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
    return { response: NextResponse.json({ error: 'Esta función está disponible para agricultores.' }, { status: 403 }) }
  }

  return { supabase, user }
}