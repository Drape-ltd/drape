import { supabase } from '@/lib/supabase'

export async function fetchReadGateway<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('read-gateway', { body })
  if (error) throw error

  const payload = data as { ok?: boolean; data?: unknown; message?: string } | null
  if (!payload?.ok) {
    throw new Error(payload?.message ?? 'Could not load this data right now.')
  }

  return payload.data as T
}
