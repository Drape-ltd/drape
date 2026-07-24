import { supabase } from './supabase'

export type TailorProfileGuardRow = {
  id: string
  profile_completed: boolean | null
  display_name: string | null
  location: string | null
  id_verification_status: string | null
  avatar_url: string | null
}

export async function fetchOwnTailorProfileGuard() {
  const { data, error } = await supabase.rpc('get_my_tailor_profile_guard')
  const row = Array.isArray(data) ? data[0] : null

  return {
    data: (row ?? null) as TailorProfileGuardRow | null,
    error,
  }
}

export async function fetchOwnTailorSetupProfile<T>() {
  const { data, error } = await supabase.rpc('get_my_tailor_setup_profile')

  return {
    data: (data ?? null) as T | null,
    error,
  }
}
