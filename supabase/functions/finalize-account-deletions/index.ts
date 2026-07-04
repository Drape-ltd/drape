/**
 * finalize-account-deletions
 *
 * Cron-only account deletion finalizer. Ops must first move a deletion request
 * to COMPLETED; this worker then re-checks active order state, removes obvious
 * user/order storage prefixes, and deletes the Supabase Auth user only when no
 * shared marketplace order history must be retained.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'

const FN = 'finalize-account-deletions'
const BATCH_SIZE = 10
const STORAGE_BUCKETS = [
  'avatars',
  'portfolio-photos',
  'id-documents',
  'seller-item-media',
  'order-photos',
  'message-media',
] as const
const ACTIVE_ORDER_STAGES = [
  'DRAFT',
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'READY_FOR_COLLECTION',
  'DELIVERED',
  'COLLECTED',
  'IN_DISPUTE',
] as const

type DeletionRequest = {
  id: string
  user_id: string
  role: string | null
  metadata: Record<string, unknown> | null
}

type StorageEntry = {
  name: string
  id?: string | null
  metadata?: Record<string, unknown> | null
}

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

function compactUniqueIds(rows: Array<{ id?: string | null }>) {
  return Array.from(new Set(
    rows
      .map((row) => row.id)
      .filter((id: string | null | undefined): id is string => typeof id === 'string' && id.length > 0),
  ))
}

async function readTailorProfileIdsForUser(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from('tailor_profiles')
    .select('id')
    .eq('user_id', userId)

  if (error) throw error
  return compactUniqueIds((data ?? []) as Array<{ id?: string | null }>)
}

async function readOrderIdsForUser(supabase: SupabaseClient, userId: string, stages?: readonly string[]) {
  let directOrderQuery = supabase
    .from('orders')
    .select('id')
    .or(`customer_id.eq.${userId},tailor_id.eq.${userId}`)

  if (stages) directOrderQuery = directOrderQuery.in('stage', stages)

  const { data: directOrders, error: directError } = await directOrderQuery
  if (directError) throw directError

  const orderIds = compactUniqueIds((directOrders ?? []) as Array<{ id?: string | null }>)
  const tailorProfileIds = await readTailorProfileIdsForUser(supabase, userId)
  if (tailorProfileIds.length === 0) return orderIds

  let profileOrderQuery = supabase
    .from('orders')
    .select('id')
    .in('tailor_profile_id', tailorProfileIds)

  if (stages) profileOrderQuery = profileOrderQuery.in('stage', stages)

  const { data: profileOrders, error: profileError } = await profileOrderQuery
  if (profileError) throw profileError

  return Array.from(new Set([
    ...orderIds,
    ...compactUniqueIds((profileOrders ?? []) as Array<{ id?: string | null }>),
  ]))
}

async function countActiveOrders(supabase: SupabaseClient, userId: string) {
  return (await readOrderIdsForUser(supabase, userId, ACTIVE_ORDER_STAGES)).length
}

function isStorageFolder(entry: StorageEntry) {
  return !entry.id && (!entry.metadata || Object.keys(entry.metadata).length === 0)
}

async function listStoragePaths(supabase: SupabaseClient, bucket: string, prefix = '', depth = 0): Promise<string[]> {
  const normalizedPrefix = prefix.replace(/^\/+|\/+$/gu, '')
  const { data, error } = await supabase.storage.from(bucket).list(normalizedPrefix, { limit: 1000 })
  if (error || !Array.isArray(data)) return []

  const paths: string[] = []
  for (const entry of data as StorageEntry[]) {
    if (!entry.name || entry.name === '.emptyFolderPlaceholder') continue
    const path = normalizedPrefix ? `${normalizedPrefix}/${entry.name}` : entry.name
    if (isStorageFolder(entry) && depth < 5) {
      paths.push(...await listStoragePaths(supabase, bucket, path, depth + 1))
    } else {
      paths.push(path)
    }
  }

  return paths
}

async function removeStoragePrefix(supabase: SupabaseClient, bucket: string, prefix: string) {
  const paths = await listStoragePaths(supabase, bucket, prefix)
  let removed = 0

  for (let index = 0; index < paths.length; index += 100) {
    const chunk = paths.slice(index, index + 100)
    if (chunk.length === 0) continue
    const { error } = await supabase.storage.from(bucket).remove(chunk)
    if (error) {
      log('warn', FN, 'storage.remove_failed', { bucket, prefix, error: error.message })
      continue
    }
    removed += chunk.length
  }

  return removed
}

async function removeUserStorage(supabase: SupabaseClient, userId: string, orderIds: string[]) {
  const prefixes: Array<{ bucket: typeof STORAGE_BUCKETS[number]; prefix: string }> = [
    { bucket: 'avatars', prefix: `${userId}` },
    { bucket: 'portfolio-photos', prefix: `portfolio/${userId}` },
    { bucket: 'id-documents', prefix: `id-verification/${userId}` },
    { bucket: 'seller-item-media', prefix: `shop/${userId}` },
    { bucket: 'order-photos', prefix: `briefs/${userId}` },
    { bucket: 'order-photos', prefix: `fabric-receipts/${userId}` },
    { bucket: 'order-photos', prefix: `vision-qc/${userId}` },
  ]

  for (const orderId of orderIds) {
    prefixes.push(
      { bucket: 'order-photos', prefix: `receipts/${orderId}` },
      { bucket: 'order-photos', prefix: `progress/${orderId}` },
      { bucket: 'order-photos', prefix: `material-advances/${orderId}` },
      { bucket: 'message-media', prefix: `messages/${orderId}` },
    )
  }

  const summary: Record<string, number> = {}
  for (const { bucket, prefix } of prefixes) {
    const removed = await removeStoragePrefix(supabase, bucket, prefix)
    summary[bucket] = (summary[bucket] ?? 0) + removed
  }

  return summary
}

async function markFinalizationFailed(supabase: SupabaseClient, request: DeletionRequest, error: string) {
  await supabase
    .from('account_deletion_requests')
    .update({
      status: 'ACKNOWLEDGED',
      metadata: {
        ...(request.metadata ?? {}),
        finalization_error: error,
        finalization_failed_at: new Date().toISOString(),
      },
    })
    .eq('id', request.id)
}

async function markRestrictedRetention(
  supabase: SupabaseClient,
  request: DeletionRequest,
  orderCount: number,
  storageRemoved: Record<string, number>,
) {
  await supabase
    .from('account_deletion_requests')
    .update({
      status: 'ACKNOWLEDGED',
      metadata: {
        ...(request.metadata ?? {}),
        finalization_state: 'restricted_retention',
        restricted_retention_at: new Date().toISOString(),
        retained_order_count: orderCount,
        storage_removed: storageRemoved,
      },
    })
    .eq('id', request.id)
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const unauthorized = await authorizeCronRequest(req, FN, cors)
    if (unauthorized) return unauthorized

    const supabase: SupabaseClient = createClient(getSupabaseUrl(), getServiceRoleKey())
    const { data: requests, error } = await supabase
      .from('account_deletion_requests')
      .select('id, user_id, role, metadata')
      .eq('status', 'COMPLETED')
      .not('processed_at', 'is', null)
      .order('processed_at', { ascending: true })
      .limit(BATCH_SIZE)

    if (error) {
      log('error', FN, 'db.lookup_failed', { error: error.message })
      return jsonResponse({ error: 'Could not load deletion requests.' }, 500, cors)
    }

    let finalized = 0
    let skipped = 0
    let retained = 0

    for (const request of (requests ?? []) as DeletionRequest[]) {
      try {
        const activeOrderCount = await countActiveOrders(supabase, request.user_id)
        if (activeOrderCount > 0) {
          skipped += 1
          await markFinalizationFailed(supabase, request, `Active orders present: ${activeOrderCount}`)
          await audit(supabase, {
            event: 'account_deletion.finalization_blocked',
            actor_id: request.user_id,
            actor_role: request.role ?? 'UNKNOWN',
            severity: 'warn',
            payload: { request_id: request.id, active_order_count: activeOrderCount },
          })
          continue
        }

        const orderIds = await readOrderIdsForUser(supabase, request.user_id)
        if (orderIds.length > 0) {
          const storageRemoved = await removeUserStorage(supabase, request.user_id, [])
          retained += 1
          await markRestrictedRetention(supabase, request, orderIds.length, storageRemoved)
          await audit(supabase, {
            event: 'account_deletion.restricted_retention',
            actor_id: request.user_id,
            actor_role: request.role ?? 'UNKNOWN',
            severity: 'warn',
            payload: { request_id: request.id, order_count: orderIds.length, storage_removed: storageRemoved },
          })
          continue
        }

        const storageRemoved = await removeUserStorage(supabase, request.user_id, orderIds)
        await audit(supabase, {
          event: 'account_deletion.finalizing',
          actor_id: request.user_id,
          actor_role: request.role ?? 'UNKNOWN',
          payload: { request_id: request.id, order_count: orderIds.length, storage_removed: storageRemoved },
        })

        const { error: deleteError } = await supabase.auth.admin.deleteUser(request.user_id)
        if (deleteError) {
          skipped += 1
          await markFinalizationFailed(supabase, request, deleteError.message)
          log('error', FN, 'auth.delete_failed', { request_id: request.id, user_id: request.user_id, error: deleteError.message })
          continue
        }

        finalized += 1
        await audit(supabase, {
          event: 'account_deletion.finalized',
          actor_id: request.user_id,
          actor_role: request.role ?? 'UNKNOWN',
          payload: { request_id: request.id, order_count: orderIds.length, storage_removed: storageRemoved },
        })
      } catch (error) {
        skipped += 1
        const message = error instanceof Error ? error.message : String(error)
        await markFinalizationFailed(supabase, request, message)
        log('error', FN, 'request.finalization_failed', { request_id: request.id, user_id: request.user_id, error: message })
      }
    }

    return jsonResponse({ ok: true, processed: (requests ?? []).length, finalized, skipped, retained }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonResponse({ error: 'Could not finalize account deletions right now.' }, 500, cors)
  }
})
