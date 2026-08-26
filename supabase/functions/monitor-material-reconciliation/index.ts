import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue, resolveOpsIssueByDedupeKey } from '../_shared/ops-issues.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from '../_shared/side-effect-jobs.ts'
import { Sentry } from '../_shared/sentry.ts'
import { materialFundingDestinationData } from '../../../packages/shared/src/material-advances.ts'

const FN = 'monitor-material-reconciliation'
const HOUR_MS = 3_600_000
const REMINDER_HOURS = 24
const OVERDUE_HOURS = 48

const json = (body: Record<string, unknown>, status: number, cors: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function queueRoleNotice(
  supabase: SupabaseClient,
  input: {
    order: Record<string, unknown> & { id: string }
    advanceId: string
    userId: string | null
    audience: 'CUSTOMER' | 'TAILOR'
    title: string
    body: string
    event: 'RECEIPT_REMINDER' | 'RECEIPT_OVERDUE'
    key: string
  },
) {
  const data = materialFundingDestinationData(input.order.id, input.advanceId, input.event)
  const pushQueued = await enqueuePushJob(supabase, {
    userId: input.userId,
    orderId: input.order.id,
    source: FN,
    idempotencyKey: `${input.key}:${input.audience}:push`,
    priority: input.event === 'RECEIPT_OVERDUE' ? 8 : 18,
    notification: { title: input.title, body: input.body, preferenceKey: 'orderUpdates', data },
  })
  const emailQueued = await enqueueOrderEventEmailJob(supabase, {
    order: input.order,
    recipientUserId: input.userId,
    audience: input.audience,
    subject: input.title,
    headline: input.title,
    body: input.body,
    ctaLabel: 'Open fabric reconciliation',
    materialAdvanceId: input.advanceId,
    action: input.event,
    source: FN,
    idempotencyKey: `${input.key}:${input.audience}:email`,
    priority: input.event === 'RECEIPT_OVERDUE' ? 8 : 18,
  })
  return { pushQueued, emailQueued }
}

async function queueCandidateNotice(
  supabase: SupabaseClient,
  input: {
    order: Record<string, unknown> & { id: string }
    candidateId: string
    userId: string | null
    audience: 'CUSTOMER' | 'TAILOR'
    title: string
    body: string
    event: 'RECEIPT_REMINDER' | 'RECEIPT_OVERDUE'
    key: string
  },
) {
  const data = { destination: 'ORDER', orderId: input.order.id, section: 'fabric', candidateId: input.candidateId, event: input.event }
  const [pushQueued, emailQueued] = await Promise.all([
    enqueuePushJob(supabase, {
      userId: input.userId,
      orderId: input.order.id,
      source: FN,
      idempotencyKey: `${input.key}:${input.audience}:push`,
      priority: input.event === 'RECEIPT_OVERDUE' ? 8 : 18,
      notification: { title: input.title, body: input.body, preferenceKey: 'orderUpdates', data },
    }),
    enqueueOrderEventEmailJob(supabase, {
      order: input.order,
      recipientUserId: input.userId,
      audience: input.audience,
      subject: input.title,
      headline: input.title,
      body: input.body,
      ctaLabel: 'Open fabric status',
      action: input.event,
      source: FN,
      idempotencyKey: `${input.key}:${input.audience}:email`,
      priority: input.event === 'RECEIPT_OVERDUE' ? 8 : 18,
    }),
  ])
  return { pushQueued, emailQueued }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const unauthorized = await authorizeCronRequest(req, FN, cors)
    if (unauthorized) return unauthorized
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const cutoff = new Date(Date.now() - REMINDER_HOURS * HOUR_MS).toISOString()
    const { data: advances, error } = await supabase
      .from('order_material_advances')
      .select('id,order_id,customer_id,tailor_id,title,amount,currency,released_at,correlation_id,payment_provider,receipt_storage_path,reconciled_at,reconciliation_status')
      .eq('funding_source', 'FUNDED_FABRIC_ALLOWANCE')
      .eq('release_status', 'RELEASED')
      .is('reconciled_at', null)
      .is('receipt_storage_path', null)
      .lt('released_at', cutoff)
      .order('released_at', { ascending: true })
      .limit(500)
    if (error) throw error

    let reminded = 0
    let overdue = 0
    for (const advance of advances ?? []) {
      const releasedAt = Date.parse(advance.released_at ?? '')
      if (!Number.isFinite(releasedAt)) continue
      const waitingHours = Math.floor((Date.now() - releasedAt) / HOUR_MS)
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id,reference,stage,customer_id,tailor_id,fabric_funding_policy_version')
        .eq('id', advance.order_id)
        .maybeSingle()
      if (orderError) {
        log('error', FN, 'order_load_failed', { order_id: advance.order_id, advance_id: advance.id, error: orderError.message })
        continue
      }
      if (!order?.id) continue

      if (waitingHours < OVERDUE_HOURS) {
        reminded += 1
        await queueRoleNotice(supabase, {
          order,
          advanceId: advance.id,
          userId: advance.tailor_id,
          audience: 'TAILOR',
          title: 'Fabric receipt and proof are due',
          body: 'Upload the final supplier receipt and a separate photo of the acquired fabric. Cutting stays blocked until both are recorded.',
          event: 'RECEIPT_REMINDER',
          key: `material-receipt-reminder:${advance.id}:${REMINDER_HOURS}h`,
        })
        continue
      }

      overdue += 1
      await createOrRefreshOpsIssue(supabase, {
        issueType: 'ORDER_REVIEW',
        severity: waitingHours >= 72 ? 'CRITICAL' : 'HIGH',
        source: FN,
        actorRole: 'SYSTEM',
        orderId: order.id,
        userId: advance.tailor_id,
        provider: advance.payment_provider ?? null,
        title: 'Funded fabric receipt overdue',
        description: `Provider-confirmed fabric funds have been released for ${waitingHours} hours without the final receipt and acquired-fabric proof.`,
        recommendedAction: 'Contact the tailor, verify whether the approved fabric was acquired, keep cutting and future advances blocked, and reconcile the provider outcome before closing the issue.',
        dedupeKey: `material-advance:receipt_overdue:${advance.id}`,
        relatedEntityType: 'order_material_advance',
        relatedEntityId: advance.id,
        notifyOps: true,
        metadata: { advance_id: advance.id, released_at: advance.released_at, waiting_hours: waitingHours, amount: advance.amount, currency: advance.currency, correlation_id: advance.correlation_id, policy_version: order.fabric_funding_policy_version, provider: advance.payment_provider },
      })
      await Promise.all([
        queueRoleNotice(supabase, {
          order,
          advanceId: advance.id,
          userId: advance.tailor_id,
          audience: 'TAILOR',
          title: 'Fabric proof is overdue',
          body: 'Drapeon has not received the final receipt and acquired-fabric proof. Cutting and future fabric releases remain blocked until you upload both.',
          event: 'RECEIPT_OVERDUE',
          key: `material-receipt-overdue:${advance.id}:${OVERDUE_HOURS}h`,
        }),
        queueRoleNotice(supabase, {
          order,
          advanceId: advance.id,
          userId: advance.customer_id,
          audience: 'CUSTOMER',
          title: 'Drapeon is following up on fabric proof',
          body: 'The final supplier receipt and acquired-fabric proof are overdue. Drapeon has paused the next protected step and is following up with the tailor.',
          event: 'RECEIPT_OVERDUE',
          key: `material-receipt-overdue:${advance.id}:${OVERDUE_HOURS}h`,
        }),
      ])
    }

    const { data: candidates, error: candidateLoadError } = await supabase
      .from('order_fabric_candidates')
      .select('id,order_id,customer_id,tailor_id,component_code,supplier_cost_amount,currency,provider,provider_reference,correlation_id,release_confirmed_at,receipt_storage_path,acquired_media,reconciliation_status,status')
      .eq('policy_version', 'fabric-funding-2026-08-21-v2')
      .eq('provider_status', 'SUCCEEDED')
      .in('status', ['AWAITING_RECEIPT', 'EXCEPTION'])
      .lt('release_confirmed_at', cutoff)
      .order('release_confirmed_at', { ascending: true })
      .limit(500)
    if (candidateLoadError) throw candidateLoadError

    let candidateReminded = 0
    let candidateOverdue = 0
    for (const candidate of candidates ?? []) {
      const releasedAt = Date.parse(candidate.release_confirmed_at ?? '')
      if (!Number.isFinite(releasedAt)) continue
      const waitingHours = Math.floor((Date.now() - releasedAt) / HOUR_MS)
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id,reference,stage,customer_id,tailor_id,fabric_funding_policy_version')
        .eq('id', candidate.order_id)
        .maybeSingle()
      if (orderError || !order?.id) {
        log('error', FN, 'v2_order_load_failed', { order_id: candidate.order_id, candidate_id: candidate.id, error: orderError?.message ?? 'ORDER_NOT_FOUND' })
        continue
      }
      const hasReceipt = typeof candidate.receipt_storage_path === 'string' && candidate.receipt_storage_path.length >= 3
      const hasAcquiredProof = Array.isArray(candidate.acquired_media) && candidate.acquired_media.length > 0
      const isReconciliationException = candidate.status === 'EXCEPTION'
      if (waitingHours < OVERDUE_HOURS && !isReconciliationException) {
        candidateReminded += 1
        await queueCandidateNotice(supabase, {
          order,
          candidateId: candidate.id,
          userId: candidate.tailor_id,
          audience: 'TAILOR',
          title: 'Fabric receipt and proof are due',
          body: 'Upload the final supplier receipt and fresh proof of the acquired material. Cutting stays blocked until both are reconciled.',
          event: 'RECEIPT_REMINDER',
          key: `fabric-candidate-receipt-reminder:${candidate.id}:${REMINDER_HOURS}h`,
        })
        continue
      }

      candidateOverdue += 1
      const dedupeKey = isReconciliationException
        ? `fabric-candidate:reconciliation:${candidate.id}`
        : `fabric-candidate:receipt_overdue:${candidate.id}`
      const issue = await createOrRefreshOpsIssue(supabase, {
        issueType: 'ORDER_REVIEW',
        severity: waitingHours >= 72 || isReconciliationException ? 'HIGH' : 'MEDIUM',
        source: FN,
        actorRole: 'SYSTEM',
        orderId: order.id,
        userId: candidate.tailor_id,
        provider: candidate.provider ?? null,
        stage: order.stage ?? null,
        title: isReconciliationException ? 'Fabric reconciliation remains unresolved' : 'Fabric receipt or acquired proof is overdue',
        description: isReconciliationException
          ? 'The final recorded spend differs from the customer-authorized fabric amount and has not reached a terminal resolution.'
          : `The exact fabric funds reached the tailor ${waitingHours} hours ago, but ${!hasReceipt && !hasAcquiredProof ? 'the receipt and acquired-material proof are' : !hasReceipt ? 'the supplier receipt is' : 'the acquired-material proof is'} still missing.`,
        recommendedAction: isReconciliationException
          ? 'Open the exact candidate, compare the private receipt and acquired-material proof with the provider release and balanced ledger entries, then choose the established unused-value or overage recovery.'
          : 'Contact the tailor, keep Cutting and future material releases blocked, and verify the private receipt and acquired-material proof before resolving this case.',
        dedupeKey,
        relatedEntityType: 'order_fabric_candidate',
        relatedEntityId: candidate.id,
        notifyOps: true,
        metadata: {
          candidate_id: candidate.id,
          component_code: candidate.component_code,
          approved_amount: candidate.supplier_cost_amount,
          currency: candidate.currency,
          released_at: candidate.release_confirmed_at,
          waiting_hours: waitingHours,
          receipt_present: hasReceipt,
          acquired_proof_count: Array.isArray(candidate.acquired_media) ? candidate.acquired_media.length : 0,
          reconciliation_status: candidate.reconciliation_status,
          provider_reference: candidate.provider_reference,
          correlation_id: candidate.correlation_id,
          recovery_action: isReconciliationException ? 'RESOLVE_RECONCILIATION' : 'UPLOAD_RECEIPT_AND_ACQUIRED_PROOF',
        },
      })
      if (issue?.id) await supabase.from('order_fabric_candidates').update({ ops_issue_id: issue.id }).eq('id', candidate.id)
      if (!isReconciliationException) {
        await Promise.all([
          queueCandidateNotice(supabase, {
            order,
            candidateId: candidate.id,
            userId: candidate.tailor_id,
            audience: 'TAILOR',
            title: 'Fabric proof is overdue',
            body: 'Upload the final supplier receipt and acquired-material proof now. Cutting and future fabric releases remain blocked.',
            event: 'RECEIPT_OVERDUE',
            key: `fabric-candidate-receipt-overdue:${candidate.id}:${OVERDUE_HOURS}h`,
          }),
          queueCandidateNotice(supabase, {
            order,
            candidateId: candidate.id,
            userId: candidate.customer_id,
            audience: 'CUSTOMER',
            title: 'Drapeon is following up on fabric proof',
            body: 'The final supplier receipt or acquired-material proof is overdue. Drapeon has paused Cutting and is following up with the tailor.',
            event: 'RECEIPT_OVERDUE',
            key: `fabric-candidate-receipt-overdue:${candidate.id}:${OVERDUE_HOURS}h`,
          }),
        ])
      }
    }

    const { data: pendingFinalizations, error: finalizationLoadError } = await supabase
      .from('order_material_advances')
      .select('id,order_id,customer_id,tailor_id,title,amount,currency,correlation_id,payment_provider,reconciliation_money_desk_request_id')
      .eq('reconciliation_outcome', 'UNUSED_VALUE')
      .is('reconciliation_resolution', null)
      .not('refund_provider_completed_at', 'is', null)
      .not('reconciliation_money_desk_request_id', 'is', null)
      .limit(100)
    if (finalizationLoadError) throw finalizationLoadError
    let recoveredFinalizations = 0
    for (const advance of pendingFinalizations ?? []) {
      const response = await fetch(`${getSupabaseUrl().replace(/\/+$/u, '')}/functions/v1/material-advance-action`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getServiceRoleKey()}`, apikey: getServiceRoleKey(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'finalize-unused-refund', advanceId: advance.id, moneyDeskRequestId: advance.reconciliation_money_desk_request_id, actorRef: FN }),
      })
      const payload = await response.json().catch(() => null) as { ok?: boolean; message?: string; error?: string } | null
      if (response.ok && payload?.ok) {
        recoveredFinalizations += 1
        await resolveOpsIssueByDedupeKey(supabase, `material-advance:refund_finalization:${advance.id}`, { recoveredBy: FN })
        continue
      }
      await createOrRefreshOpsIssue(supabase, {
        issueType: 'SYSTEM_ALERT',
        severity: 'CRITICAL',
        source: FN,
        actorRole: 'SYSTEM',
        orderId: advance.order_id,
        userId: advance.customer_id,
        provider: advance.payment_provider ?? null,
        title: 'Provider refund needs reconciliation finalization',
        description: 'The provider refund completed, but the protected fabric allocation and financial case have not reached their terminal recorded state.',
        recommendedAction: 'Verify the Money Desk request is SUCCEEDED, then retry the idempotent material refund finalization. Do not send another provider refund.',
        dedupeKey: `material-advance:refund_finalization:${advance.id}`,
        relatedEntityType: 'order_material_advance',
        relatedEntityId: advance.id,
        notifyOps: true,
        metadata: { advance_id: advance.id, money_desk_request_id: advance.reconciliation_money_desk_request_id, correlation_id: advance.correlation_id, provider: advance.payment_provider, safe_error: payload?.message ?? payload?.error ?? `HTTP ${response.status}` },
      })
    }
    await audit(supabase, { event: 'material_advance.reconciliation_monitor_completed', actor_role: 'SYSTEM', payload: { function: FN, scanned: advances?.length ?? 0, reminded, overdue, v2_candidates_scanned: candidates?.length ?? 0, v2_candidates_reminded: candidateReminded, v2_candidates_overdue: candidateOverdue, pending_finalizations: pendingFinalizations?.length ?? 0, recovered_finalizations: recoveredFinalizations } })
    return json({ ok: true, scanned: advances?.length ?? 0, reminded, overdue, candidateScanned: candidates?.length ?? 0, candidateReminded, candidateOverdue, recoveredFinalizations }, 200, cors)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('error', FN, 'failed', { error: message })
    await Sentry.captureMessage('Material reconciliation monitor failed', { level: 'error', tags: { function: FN }, extra: { error: message } })
    return json({ ok: false, error: 'Material reconciliation monitor failed.' }, 500, cors)
  }
})
