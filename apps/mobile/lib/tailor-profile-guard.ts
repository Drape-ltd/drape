import { supabase } from './supabase'

const inFlightGuards = new Map<string, Promise<{ data: TailorProfileGuardRow | null; error: unknown }>>()
const failedGuards = new Map<string, { result: { data: TailorProfileGuardRow | null; error: unknown }; retryAt: number }>()
const PROFILE_GUARD_COOLDOWN_MS = 60_000

export type TailorProfileGuardRow = {
  id: string
  profile_completed: boolean | null
  display_name: string | null
  location: string | null
  id_verification_status: string | null
  avatar_url: string | null
}

export async function fetchOwnTailorProfileGuard(userId = 'current') {
  const pending = inFlightGuards.get(userId)
  if (pending) return pending
  const failed = failedGuards.get(userId)
  if (failed && failed.retryAt > Date.now()) return failed.result
  if (failed) failedGuards.delete(userId)

  const request = Promise.resolve(supabase.rpc('get_my_tailor_profile_guard')).then(({ data, error }) => {
    const row = Array.isArray(data) ? data[0] : null
    const result = {
      data: (row ?? null) as TailorProfileGuardRow | null,
      error,
    }
    if (error) failedGuards.set(userId, { result, retryAt: Date.now() + PROFILE_GUARD_COOLDOWN_MS })
    else failedGuards.delete(userId)
    return result
  }).finally(() => {
    inFlightGuards.delete(userId)
  })

  inFlightGuards.set(userId, request)
  return request
}

export async function fetchOwnTailorSetupProfile<T>() {
  const { data, error } = await supabase.rpc('get_my_tailor_setup_profile')

  return {
    data: (data ?? null) as T | null,
    error,
  }
}
