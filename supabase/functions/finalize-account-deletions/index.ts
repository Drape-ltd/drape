/**
 * finalize-account-deletions
 *
 * Cron-only terminal deletion worker. Ops may approve finalization but cannot
 * mark a request complete. This worker re-checks commercial obligations,
 * anonymizes product data, revokes Auth sessions, and records completion.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { enqueueDomainEvent } from '../_shared/jobs.ts'
import { audit, log } from '../_shared/logger.ts'

const FN = 'finalize-account-deletions'
const BATCH_SIZE = 10
const ACTIVE_ORDER_STAGES = [
  'DRAFT', 'PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING',
  'PAYMENT_FAILED', 'CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING',
  'FINISHING', 'READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED',
  'READY_FOR_COLLECTION', 'DELIVERED', 'COLLECTED', 'IN_DISPUTE',
] as const
const UNRESOLVED_PAYOUT_STATUSES = ['PENDING', 'PROCESSING', 'BLOCKED'] as const

type DeletionRequest = {
  id: string
  user_id: string
  email: string | null
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

function describeError(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const parts = [record.message, record.details, record.hint, record.code]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    if (parts.length > 0) return parts.join(' · ')
  }
  return String(error)
}

function compactIds(rows: Array<{ id?: string | null }>) {
  return Array.from(new Set(rows.map((row) => row.id).filter((id): id is string => !!id)))
}

async function tailorProfileIds(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase.from('tailor_profiles').select('id').eq('user_id', userId)
  if (error) throw error
  return compactIds(data ?? [])
}

async function orderIdsForUser(supabase: SupabaseClient, userId: string, stages?: readonly string[]) {
  let direct = supabase.from('orders').select('id').or(`customer_id.eq.${userId},tailor_id.eq.${userId}`)
  if (stages) direct = direct.in('stage', stages)
  const { data: directRows, error: directError } = await direct
  if (directError) throw directError

  const profileIds = await tailorProfileIds(supabase, userId)
  if (profileIds.length === 0) return compactIds(directRows ?? [])
  let byProfile = supabase.from('orders').select('id').in('tailor_profile_id', profileIds)
  if (stages) byProfile = byProfile.in('stage', stages)
  const { data: profileRows, error: profileError } = await byProfile
  if (profileError) throw profileError
  return Array.from(new Set([...compactIds(directRows ?? []), ...compactIds(profileRows ?? [])]))
}

function isFolder(entry: StorageEntry) {
  return !entry.id && (!entry.metadata || Object.keys(entry.metadata).length === 0)
}

async function listPaths(supabase: SupabaseClient, bucket: string, prefix: string, depth = 0): Promise<string[]> {
  const normalized = prefix.replace(/^\/+|\/+$/gu, '')
  const { data, error } = await supabase.storage.from(bucket).list(normalized, { limit: 1000 })
  if (error || !Array.isArray(data)) return []
  const paths: string[] = []
  for (const entry of data as StorageEntry[]) {
    if (!entry.name || entry.name === '.emptyFolderPlaceholder') continue
    const path = normalized ? `${normalized}/${entry.name}` : entry.name
    if (isFolder(entry) && depth < 5) paths.push(...await listPaths(supabase, bucket, path, depth + 1))
    else paths.push(path)
  }
  return paths
}

async function removePrefix(supabase: SupabaseClient, bucket: string, prefix: string) {
  const paths = await listPaths(supabase, bucket, prefix)
  let removed = 0
  for (let index = 0; index < paths.length; index += 100) {
    const chunk = paths.slice(index, index + 100)
    const { error } = await supabase.storage.from(bucket).remove(chunk)
    if (error) {
      log('warn', FN, 'storage.remove_failed', { bucket, prefix, error: error.message })
      continue
    }
    removed += chunk.length
  }
  return removed
}

async function removePersonalStorage(supabase: SupabaseClient, userId: string) {
  // Shared order evidence is intentionally retained for counterpart, commercial,
  // safety, and dispute records. Only user-owned public/private identity media goes.
  const prefixes = [
    ['avatars', userId],
    ['portfolio-photos', `portfolio/${userId}`],
    ['id-documents', `id-verification/${userId}`],
    ['id-documents', `verification-video/${userId}`],
    ['seller-item-media', `shop/${userId}`],
    ['order-photos', `briefs/${userId}`],
    ['order-photos', `fabric-receipts/${userId}`],
    ['order-photos', `vision-qc/${userId}`],
  ] as const
  const summary: Record<string, number> = {}
  for (const [bucket, prefix] of prefixes) {
    summary[bucket] = (summary[bucket] ?? 0) + await removePrefix(supabase, bucket, prefix)
  }
  return summary
}

async function markBlocked(
  supabase: SupabaseClient,
  request: DeletionRequest,
  blockerCode: string,
  blockerCount: number,
  detail?: string,
) {
  const now = new Date().toISOString()
  const { error } = await supabase.from('account_deletion_requests').update({
    status: 'BLOCKED',
    finalization_approved_at: null,
    processed_at: null,
    metadata: {
      ...(request.metadata ?? {}),
      finalization_state: 'blocked',
      blocker_code: blockerCode,
      blocker_count: blockerCount,
      blocker_detail: detail ?? null,
      blocked_at: now,
    },
  }).eq('id', request.id)
  if (error) throw error

  // Delivery failure must not replace the authoritative blocker with a generic
  // finalization error. The durable status remains visible in-app and Ops can
  // retry notification delivery independently.
  try {
    await enqueueDomainEvent(supabase, {
      eventType: 'ACCOUNT_DELETION_STATUS_CHANGED',
      aggregateType: 'account_deletion_request',
      aggregateId: request.id,
      actorId: request.user_id,
      actorRole: request.role ?? 'UNKNOWN',
      idempotencyKey: `account-deletion-status:v1:${request.id}:blocked:${blockerCode.toLowerCase()}`,
      jobs: ['SEND_ACCOUNT_EVENT_EMAIL', 'SEND_PUSH'],
      priority: 18,
      payload: {
        userId: request.user_id,
        recipientEmail: request.email,
        subject: 'Your Drapeon deletion request needs an obligation resolved',
        eyebrow: 'Privacy request',
        headline: 'Your deletion request is temporarily blocked',
        body: 'Drapeon could not finish deletion because an active order, payment, dispute, payout, or another required record still needs a terminal outcome. Open the request to review the current status.',
        ctaLabel: 'Review deletion request',
        webPath: '/account?view=settings#delete-account',
        appUrl: 'drape://profile/delete-account',
        details: [
          { label: 'Request ID', value: request.id },
          { label: 'Blocker', value: blockerCode.replaceAll('_', ' ') },
          { label: 'Affected records', value: String(blockerCount) },
        ],
        notification: {
          title: 'Deletion request needs attention',
          body: 'Drapeon could not finish deletion because an active obligation still needs a terminal outcome.',
          preferenceKey: 'orderUpdates',
          data: {
            destination: 'ACCOUNT_SETTINGS',
            href: request.role?.toUpperCase() === 'TAILOR'
              ? '/(tailor)/profile/delete-account?returnTo=%2F(tailor)%2Fprofile%2Faccount-settings'
              : '/(customer)/profile/delete-account?returnTo=%2F(customer)%2Fprofile%2Faccount-settings',
            deletionRequestId: request.id,
            deletionStatus: 'BLOCKED',
          },
        },
      },
    })
  } catch (deliveryError) {
    log('error', FN, 'blocked_notification.enqueue_failed', {
      request_id: request.id,
      blocker_code: blockerCode,
      error: describeError(deliveryError),
    })
  }
}

async function unresolvedObligations(
  supabase: SupabaseClient,
  userId: string,
  role: string | null,
  orderIds: string[],
) {
  const profileIds = await tailorProfileIds(supabase, userId)
  const disputes = orderIds.length > 0
    ? await supabase.from('disputes').select('id', { count: 'exact', head: true }).in('order_id', orderIds).in('status', ['OPEN', 'UNDER_REVIEW'])
    : { count: 0, error: null }

  // A customer is not the beneficiary of the tailor payout attached to their
  // completed order. Blocking customer deletion on that payout leaks the
  // counterparty's settlement state into the customer's privacy workflow.
  // Tailor deletion remains blocked until every payout owed to that tailor is
  // terminal, regardless of whether it was linked through the auth user or the
  // tailor profile compatibility key.
  let payoutCount = 0
  if (role?.toUpperCase() === 'TAILOR' && profileIds.length > 0) {
    const byTailor = await supabase.from('payouts').select('id', { count: 'exact', head: true }).in('tailor_profile_id', profileIds).in('status', UNRESOLVED_PAYOUT_STATUSES)
    if (byTailor.error) throw byTailor.error
    payoutCount += byTailor.count ?? 0
  }
  if (disputes.error) throw disputes.error
  return { disputeCount: disputes.count ?? 0, payoutCount }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const unauthorized = await authorizeCronRequest(req, FN, cors)
    if (unauthorized) return unauthorized
    const supabase: SupabaseClient = createClient(getSupabaseUrl(), getServiceRoleKey())
    const body = await req.json().catch(() => ({})) as { requestId?: unknown }
    const requestId = typeof body.requestId === 'string' && body.requestId.trim()
      ? body.requestId.trim()
      : null
    let candidateQuery = supabase
      .from('account_deletion_requests')
      .select('id, user_id, email, role, metadata')
      .eq('status', 'READY_FOR_FINALIZATION')
      .not('finalization_approved_at', 'is', null)
      .order('finalization_approved_at', { ascending: true })
      .limit(BATCH_SIZE)
    if (requestId) candidateQuery = candidateQuery.eq('id', requestId)
    const { data, error } = await candidateQuery
    if (error) return jsonResponse({ error: 'Could not load deletion requests.' }, 500, cors)

    // This endpoint is destructive by design. The dry-run mode is used by DEV
    // smoke checks to prove the worker can authenticate and read its queue
    // without anonymizing an account or revoking any sessions.
    if (new URL(req.url).searchParams.get('dryRun') === 'true') {
      return jsonResponse({
        ok: true,
        dryRun: true,
        candidateCount: (data ?? []).length,
      }, 200, cors)
    }

    let completed = 0
    let blocked = 0
    let failed = 0
    for (const request of (data ?? []) as DeletionRequest[]) {
      try {
        const activeOrderIds = await orderIdsForUser(supabase, request.user_id, ACTIVE_ORDER_STAGES)
        if (activeOrderIds.length > 0) {
          blocked += 1
          await markBlocked(supabase, request, 'ACTIVE_ORDERS', activeOrderIds.length)
          continue
        }

        const allOrderIds = await orderIdsForUser(supabase, request.user_id)
        const obligations = await unresolvedObligations(supabase, request.user_id, request.role, allOrderIds)
        if (obligations.disputeCount > 0 || obligations.payoutCount > 0) {
          blocked += 1
          await markBlocked(
            supabase,
            request,
            obligations.disputeCount > 0 ? 'UNRESOLVED_DISPUTES' : 'UNRESOLVED_PAYOUTS',
            obligations.disputeCount + obligations.payoutCount,
          )
          continue
        }

        const recipientEmail = request.email?.trim() || null
        const storageRemoved = await removePersonalStorage(supabase, request.user_id)
        const { data: anonymization, error: anonymizationError } = await supabase.rpc('anonymize_account_for_deletion', { p_user_id: request.user_id })
        if (anonymizationError) throw anonymizationError

        // Soft deletion revokes sessions and prevents future sign-in while keeping
        // the Auth row required by retained marketplace/audit foreign keys.
        const { error: authError } = await supabase.auth.admin.deleteUser(request.user_id, true)
        if (authError) throw authError

        const now = new Date().toISOString()
        const { error: completionError } = await supabase.from('account_deletion_requests').update({
          status: 'COMPLETED',
          email: null,
          processed_at: now,
          completed_at: now,
          metadata: {
            ...(request.metadata ?? {}),
            finalization_state: 'completed',
            completed_at: now,
            retained_order_count: allOrderIds.length,
            storage_removed: storageRemoved,
            anonymization,
          },
        }).eq('id', request.id)
        if (completionError) throw completionError

        await supabase.from('ops_issues').update({ status: 'RESOLVED', updated_at: now }).eq('issue_type', 'ACCOUNT_DELETION_REQUEST').eq('related_entity_id', request.id)

        completed += 1
        await audit(supabase, {
          event: 'account_deletion.completed',
          actor_id: request.user_id,
          actor_role: request.role ?? 'UNKNOWN',
          payload: { request_id: request.id, retained_order_count: allOrderIds.length, storage_removed: storageRemoved },
        })

        // Delivery is durable and retriable, but it must never roll a completed
        // deletion back to BLOCKED after identity data and Auth access are gone.
        if (recipientEmail) {
          try {
            await enqueueDomainEvent(supabase, {
              eventType: 'ACCOUNT_DELETION_COMPLETED',
              aggregateType: 'account_deletion_request',
              aggregateId: request.id,
              actorId: request.user_id,
              actorRole: request.role ?? 'UNKNOWN',
              idempotencyKey: `account-deletion-completed:${request.id}`,
              jobs: ['SEND_ACCOUNT_EVENT_EMAIL'],
              payload: {
                userId: request.user_id,
                recipientEmail,
                subject: 'Your Drapeon account deletion is complete',
                eyebrow: 'Privacy request complete',
                headline: 'Your account has been deleted',
                body: 'Your sign-in access and public profile have been removed. Records Drapeon must retain for payments, safety, disputes, or counterpart order history are anonymized and access-restricted.',
                ctaLabel: 'Privacy information',
                webPath: '/privacy',
                details: [{ label: 'Request ID', value: request.id }],
              },
            })
          } catch (deliveryError) {
            log('error', FN, 'completion_email.enqueue_failed', {
              request_id: request.id,
              error: deliveryError instanceof Error ? deliveryError.message : String(deliveryError),
            })
          }
        }
      } catch (requestError) {
        failed += 1
        const message = describeError(requestError)
        await markBlocked(supabase, request, 'FINALIZATION_ERROR', 1, message).catch(() => undefined)
        log('error', FN, 'request.finalization_failed', { request_id: request.id, error: message })
      }
    }

    return jsonResponse({ ok: true, processed: (data ?? []).length, completed, blocked, failed }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: describeError(error) })
    return jsonResponse({ error: 'Could not finalize account deletions right now.' }, 500, cors)
  }
})
