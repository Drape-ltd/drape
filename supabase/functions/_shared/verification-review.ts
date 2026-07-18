import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isLiveTailorVerificationStatus } from '../../../packages/shared/src/verification-review.ts'

export function isApprovedTailorProfile(profile: { id_verification_status?: string | null; is_live?: boolean | null } | null | undefined) {
  return profile?.is_live === true || isLiveTailorVerificationStatus(profile?.id_verification_status)
}

function cleanObject(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  )
}

function mergePortfolioItemUpserts(baseValue: unknown, nextValue: unknown) {
  if (!Array.isArray(baseValue) || !Array.isArray(nextValue)) return nextValue
  const merged = [...baseValue]
  for (const item of nextValue) {
    if (!item || typeof item !== 'object') continue
    const itemRecord = item as Record<string, unknown>
    const itemId = typeof itemRecord.id === 'string' ? itemRecord.id : null
    const imageUrl = typeof itemRecord.image_url === 'string' ? itemRecord.image_url : null
    const existingIndex = merged.findIndex((candidate) => {
      if (!candidate || typeof candidate !== 'object') return false
      const candidateRecord = candidate as Record<string, unknown>
      if (itemId && candidateRecord.id === itemId) return true
      return !itemId && imageUrl && candidateRecord.image_url === imageUrl
    })
    if (existingIndex >= 0) merged[existingIndex] = item
    else merged.push(item)
  }
  return merged
}

function mergeJsonObjects(left: unknown, right: Record<string, unknown>) {
  const base = left && typeof left === 'object' && !Array.isArray(left)
    ? left as Record<string, unknown>
    : {}
  const merged = cleanObject({ ...base, ...right })
  if ('portfolio_item_upserts' in right) {
    merged.portfolio_item_upserts = mergePortfolioItemUpserts(base.portfolio_item_upserts, right.portfolio_item_upserts)
  }
  return merged
}

export async function stageProfileChangeRequest(
  supabase: SupabaseClient,
  input: {
    tailorUserId: string
    tailorProfileId: string
    changes: Record<string, unknown>
    metadata?: Record<string, unknown>
  },
) {
  const changes = cleanObject(input.changes)
  if (Object.keys(changes).length === 0) return null

  const { data: existing, error: existingError } = await supabase
    .from('profile_change_requests')
    .select('id, requested_changes, metadata')
    .eq('tailor_user_id', input.tailorUserId)
    .eq('status', 'PENDING')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingError) throw existingError

  const now = new Date().toISOString()
  if (existing?.id) {
    const { data, error } = await supabase
      .from('profile_change_requests')
      .update({
        requested_changes: mergeJsonObjects(existing.requested_changes, changes),
        metadata: mergeJsonObjects(existing.metadata, input.metadata ?? {}),
        field_statuses: {},
        rejection_code: null,
        rejection_reason: null,
        submitted_at: now,
        updated_at: now,
      })
      .eq('id', existing.id)
      .select('id')
      .single()
    if (error) throw error
    return data as { id: string }
  }

  const { data, error } = await supabase
    .from('profile_change_requests')
    .insert({
      tailor_user_id: input.tailorUserId,
      tailor_profile_id: input.tailorProfileId,
      requested_changes: changes,
      metadata: input.metadata ?? {},
      submitted_at: now,
    })
    .select('id')
    .single()

  if (error) throw error
  return data as { id: string }
}

export async function stagePayoutChangeRequest(
  supabase: SupabaseClient,
  input: {
    tailorUserId: string
    tailorProfileId: string
    currentDestination: Record<string, unknown>
    requestedDestination: Record<string, unknown>
    metadata?: Record<string, unknown>
  },
) {
  const requestedDestination = cleanObject(input.requestedDestination)
  if (Object.keys(requestedDestination).length === 0) return null

  const { data: existing, error: existingError } = await supabase
    .from('payout_change_requests')
    .select('id, requested_destination, current_destination, metadata')
    .eq('tailor_user_id', input.tailorUserId)
    .eq('status', 'PENDING')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingError) throw existingError

  const now = new Date().toISOString()
  if (existing?.id) {
    const { data, error } = await supabase
      .from('payout_change_requests')
      .update({
        current_destination: mergeJsonObjects(existing.current_destination, input.currentDestination),
        requested_destination: mergeJsonObjects(existing.requested_destination, requestedDestination),
        metadata: mergeJsonObjects(existing.metadata, input.metadata ?? {}),
        rejection_code: null,
        rejection_reason: null,
        submitted_at: now,
        updated_at: now,
      })
      .eq('id', existing.id)
      .select('id')
      .single()
    if (error) throw error
    return data as { id: string }
  }

  const { data, error } = await supabase
    .from('payout_change_requests')
    .insert({
      tailor_user_id: input.tailorUserId,
      tailor_profile_id: input.tailorProfileId,
      current_destination: input.currentDestination,
      requested_destination: requestedDestination,
      metadata: input.metadata ?? {},
      submitted_at: now,
    })
    .select('id')
    .single()

  if (error) throw error
  return data as { id: string }
}
