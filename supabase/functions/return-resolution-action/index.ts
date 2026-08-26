/**
 * Canonical customer/tailor return and resolution actions.
 * Email and chat may mirror these events, but only this authenticated action
 * can open, propose, or decide a resolution.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { rejectIfBlockedContact } from '../_shared/contact-bypass.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from '../_shared/side-effect-jobs.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { Sentry } from '../_shared/sentry.ts'
import { RETURN_REASONS, RESOLUTION_REMEDIES } from '../../../packages/shared/src/returns-resolutions.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'return-resolution-action'
const MAX_MONEY = 999_999_999
const CUSTOMER_RESOLUTION_STAGES = new Set(['DELIVERED', 'COLLECTED', 'COMPLETE'])
const EvidenceSchema = z.object({
  storageBucket: z.string().trim().min(1).max(100),
  storageObjectPath: z.string().trim().min(1).max(1000),
  evidenceType: z.string().trim().min(2).max(80).default('RETURN_EVIDENCE'),
  mimeType: z.string().trim().max(120).optional(),
  contentSha256: z.string().trim().regex(/^[a-fA-F0-9]{64}$/u).optional(),
})
const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open'), orderId: uuid, reason: z.enum(RETURN_REASONS), requestedRemedy: z.enum(RESOLUTION_REMEDIES.filter((value) => value !== 'REJECTED') as [string, ...string[]]), summary: z.string().trim().min(10).max(2000), requestedAmount: z.number().int().positive().max(MAX_MONEY).nullable().optional(), currency: z.string().trim().length(3).nullable().optional(), evidence: z.array(EvidenceSchema).max(10).default([]), idempotencyKey: z.string().trim().min(8).max(200) }),
  z.object({ action: z.literal('propose'), returnRequestId: uuid, remedy: z.enum(RESOLUTION_REMEDIES), amount: z.number().int().positive().max(MAX_MONEY).nullable().optional(), currency: z.string().trim().length(3).nullable().optional(), returnRequired: z.boolean(), shippingResponsibility: z.enum(['CUSTOMER','TAILOR','DRAPEON','UNRESOLVED']).nullable().optional(), note: z.string().trim().min(3).max(1000), idempotencyKey: z.string().trim().min(8).max(200) }),
  z.object({ action: z.literal('decide'), proposalId: uuid, decision: z.enum(['ACCEPTED','DECLINED']), note: z.string().trim().max(1000).optional(), idempotencyKey: z.string().trim().min(8).max(200) }),
])

type OrderRow = { id: string; reference: string | null; customer_id: string; tailor_id: string | null; stage: string }
type ReturnRow = { id: string; reference: string; order_id: string; financial_case_id: string; requester_id: string; requester_role: 'CUSTOMER'|'TAILOR'; counterparty_id: string; status: string; correlation_id: string }

function json(body: Record<string, unknown>, status: number, cors: HeadersInit) { return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } }) }
function fail(cors: HeadersInit, status: number, code: string, message: string) { return json({ error: code, message }, status, cors) }
function roleFor(order: OrderRow, actorId: string): 'CUSTOMER'|'TAILOR'|null { return order.customer_id === actorId ? 'CUSTOMER' : order.tailor_id === actorId ? 'TAILOR' : null }

async function fetchOrder(supabase: any, orderId: string) {
  const { data, error } = await supabase.from('orders').select('id, reference, customer_id, tailor_id, stage').eq('id', orderId).maybeSingle()
  if (error) throw error
  return data as OrderRow | null
}
async function fetchReturn(supabase: any, returnRequestId: string) {
  const { data, error } = await supabase.from('order_return_requests').select('id, reference, order_id, financial_case_id, requester_id, requester_role, counterparty_id, status, correlation_id').eq('id', returnRequestId).maybeSingle()
  if (error) throw error
  return data as ReturnRow | null
}
async function notify(supabase: any, order: OrderRow, recipientId: string | null, recipientAudience: 'CUSTOMER'|'TAILOR', input: { title: string; body: string; key: string; type: string }) {
  if (!recipientId) return
  await enqueuePushJob(supabase, { userId: recipientId, notification: { title: input.title, body: input.body, preferenceKey: 'orderUpdates', data: { orderId: order.id, type: input.type } }, source: FN, idempotencyKey: `${input.key}:push`, orderId: order.id, priority: 25 })
  await enqueueOrderEventEmailJob(supabase, { order, recipientUserId: recipientId, audience: recipientAudience, subject: input.title, headline: input.title, body: input.body, ctaLabel: 'Review resolution', source: FN, idempotencyKey: `${input.key}:email`, priority: 25 })
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail(cors, 405, 'METHOD_NOT_ALLOWED', 'Use POST for this action.')
  const caller = await getAuthUser(req)
  if (!caller) return fail(cors, 401, 'AUTH_REQUIRED', 'Sign in again before updating this resolution.')
  const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
  if (!parsed.ok) return json({ error: 'VALIDATION_FAILED', message: 'Check the resolution details and try again.', details: parsed.error }, 400, cors)
  const supabase: any = createClient(getSupabaseUrl(), getServiceRoleKey())
  try {
    if (!(await checkRateLimit(supabase, `${FN}:${parsed.data.action}:${caller.id}`, 3600, 30))) return rateLimitExceededResponse(cors)
    if (parsed.data.action === 'open') {
      const order = await fetchOrder(supabase, parsed.data.orderId)
      if (!order) return fail(cors, 404, 'ORDER_NOT_FOUND', 'This order could not be found.')
      const role = roleFor(order, caller.id)
      if (!role) return fail(cors, 403, 'ORDER_FORBIDDEN', 'Only the customer or assigned tailor can open a resolution.')
      if (role !== 'CUSTOMER') {
        return fail(
          cors,
          403,
          'CUSTOMER_RESOLUTION_REQUIRED',
          'The customer opens a received-order resolution. The tailor can respond once a case exists.',
        )
      }
      if (!CUSTOMER_RESOLUTION_STAGES.has(order.stage)) {
        return fail(
          cors,
          409,
          'ORDER_NOT_RECEIVED',
          'A received-order resolution becomes available after delivery or collection. Use order or shipping help before handoff.',
        )
      }
      if ((parsed.data.requestedAmount == null) !== (parsed.data.currency == null)) return fail(cors, 400, 'AMOUNT_CURRENCY_REQUIRED', 'Enter the amount and currency together.')
      const blocked = await rejectIfBlockedContact({ supabase, fn: FN, cors, actorId: caller.id, actorRole: role, surface: 'return_resolution.summary', text: parsed.data.summary, message: "Contact details can't be included in a resolution request.", orderId: order.id, extra: { action: 'open' } })
      if (blocked) return blocked
      const { data, error } = await supabase.rpc('create_order_return_request', { p_order_id: order.id, p_actor_id: caller.id, p_reason_code: parsed.data.reason, p_requested_remedy: parsed.data.requestedRemedy, p_summary: parsed.data.summary, p_requested_amount: parsed.data.requestedAmount ?? null, p_currency: parsed.data.currency?.toUpperCase() ?? null, p_idempotency_key: parsed.data.idempotencyKey })
      if (error) return fail(cors, 409, 'RETURN_NOT_OPENED', error.message)
      const opened = await fetchReturn(supabase, data.id)
      if (!opened) throw new Error('Return request was not readable after creation.')
      for (const evidence of parsed.data.evidence ?? []) {
        const { error: evidenceError } = await supabase.rpc('append_financial_case_evidence', { p_case_id: opened.financial_case_id, p_actor_id: caller.id, p_actor_role: role, p_evidence_type: evidence.evidenceType, p_source: 'USER_UPLOAD', p_storage_bucket: evidence.storageBucket, p_storage_object_path: evidence.storageObjectPath, p_content_sha256: evidence.contentSha256 ?? null, p_mime_type: evidence.mimeType ?? null, p_metadata: { return_request_id: opened.id }, p_visibility: 'PARTIES', p_correlation_id: opened.correlation_id })
        if (evidenceError) throw evidenceError
      }
      await createOrRefreshOpsIssue(supabase, { issueType: 'ORDER_REVIEW', severity: data.eligibilityStatus === 'INELIGIBLE' ? 'HIGH' : 'MEDIUM', source: FN, actorId: caller.id, actorRole: role, orderId: order.id, relatedEntityType: 'order_return_request', relatedEntityId: opened.id, stage: order.stage, title: `Resolution request ${opened.reference}`, description: `${parsed.data.reason}: ${parsed.data.requestedRemedy}. Eligibility: ${data.eligibilityStatus}.`, recommendedAction: 'Review evidence, delivery law, counterpart response, return logistics, and any protected-money impact. Do not refund outside Money Desk.', dedupeKey: `return-resolution:${opened.id}`, metadata: { return_request_id: opened.id, financial_case_id: opened.financial_case_id, correlation_id: opened.correlation_id }, notifyOps: data.eligibilityStatus !== 'ELIGIBLE' })
      await notify(supabase, order, opened.counterparty_id, role === 'CUSTOMER' ? 'TAILOR' : 'CUSTOMER', { title: 'Order resolution needs your response', body: `${parsed.data.summary} Review the requested outcome and evidence in Drapeon.`, key: `return:${opened.id}:opened`, type: 'return_resolution_opened' })
      await audit(supabase, { event: 'return_resolution.opened', actor_id: caller.id, actor_role: role, order_id: order.id, severity: 'warn', payload: { return_request_id: opened.id, financial_case_id: opened.financial_case_id, correlation_id: opened.correlation_id } })
      return json({ ok: true, returnRequest: data }, 200, cors)
    }

    if (parsed.data.action === 'propose') {
      const current = await fetchReturn(supabase, parsed.data.returnRequestId)
      if (!current) return fail(cors, 404, 'RETURN_NOT_FOUND', 'This resolution request could not be found.')
      const order = await fetchOrder(supabase, current.order_id)
      const role = order && roleFor(order, caller.id)
      if (!order || !role) return fail(cors, 403, 'ORDER_FORBIDDEN', 'Only the order parties can propose a resolution.')
      if ((parsed.data.amount == null) !== (parsed.data.currency == null)) return fail(cors, 400, 'AMOUNT_CURRENCY_REQUIRED', 'Enter the amount and currency together.')
      const blocked = await rejectIfBlockedContact({ supabase, fn: FN, cors, actorId: caller.id, actorRole: role, surface: 'return_resolution.proposal', text: parsed.data.note, message: "Contact details can't be included in a resolution proposal.", orderId: order.id, extra: { action: 'propose' } })
      if (blocked) return blocked
      const { data, error } = await supabase.rpc('propose_order_resolution', { p_return_request_id: current.id, p_actor_id: caller.id, p_remedy: parsed.data.remedy, p_amount: parsed.data.amount ?? null, p_currency: parsed.data.currency?.toUpperCase() ?? null, p_return_required: parsed.data.returnRequired, p_shipping_responsibility: parsed.data.shippingResponsibility ?? null, p_note: parsed.data.note, p_idempotency_key: parsed.data.idempotencyKey })
      if (error) return fail(cors, 409, 'PROPOSAL_NOT_CREATED', error.message)
      const recipient = role === 'CUSTOMER' ? order.tailor_id : order.customer_id
      await notify(supabase, order, recipient, role === 'CUSTOMER' ? 'TAILOR' : 'CUSTOMER', { title: 'Resolution proposal needs a decision', body: 'Review the remedy, amount, and return responsibility. Accepting records the agreement but does not move money by itself.', key: `return:${current.id}:proposal:${data.id}`, type: 'return_resolution_proposed' })
      await audit(supabase, { event: 'return_resolution.proposed', actor_id: caller.id, actor_role: role, order_id: order.id, severity: 'warn', payload: { return_request_id: current.id, proposal_id: data.id, correlation_id: current.correlation_id } })
      return json({ ok: true, proposal: data }, 200, cors)
    }

    const { data: proposal, error: proposalError } = await supabase.from('order_resolution_proposals').select('id, return_request_id, proposed_by').eq('id', parsed.data.proposalId).maybeSingle()
    if (proposalError || !proposal) return fail(cors, 404, 'PROPOSAL_NOT_FOUND', 'This proposal could not be found.')
    const current = await fetchReturn(supabase, proposal.return_request_id)
    const order = current ? await fetchOrder(supabase, current.order_id) : null
    const role = order && roleFor(order, caller.id)
    if (!current || !order || !role) return fail(cors, 403, 'ORDER_FORBIDDEN', 'Only the proposal counterpart can decide this resolution.')
    const note = parsed.data.note?.trim() ?? ''
    if (note) {
      const blocked = await rejectIfBlockedContact({ supabase, fn: FN, cors, actorId: caller.id, actorRole: role, surface: 'return_resolution.decision', text: note, message: "Contact details can't be included in a resolution decision.", orderId: order.id, extra: { action: 'decide' } })
      if (blocked) return blocked
    }
    const { data, error } = await supabase.rpc('decide_order_resolution', { p_proposal_id: proposal.id, p_actor_id: caller.id, p_decision: parsed.data.decision, p_note: note || null, p_idempotency_key: parsed.data.idempotencyKey })
    if (error) return fail(cors, 409, 'PROPOSAL_NOT_DECIDED', error.message)
    const recipient = role === 'CUSTOMER' ? order.tailor_id : order.customer_id
    await notify(supabase, order, recipient, role === 'CUSTOMER' ? 'TAILOR' : 'CUSTOMER', { title: `Resolution ${parsed.data.decision === 'ACCEPTED' ? 'accepted' : 'declined'}`, body: parsed.data.decision === 'ACCEPTED' ? 'The agreement is recorded. Drapeon will coordinate any required return and Money Desk review before a refund.' : 'The proposal was declined. The case remains open for a new proposal or Ops review.', key: `return:${current.id}:decision:${data.id}`, type: 'return_resolution_decided' })
    await audit(supabase, { event: 'return_resolution.decided', actor_id: caller.id, actor_role: role, order_id: order.id, severity: 'warn', payload: { return_request_id: current.id, proposal_id: proposal.id, decision: parsed.data.decision, correlation_id: current.correlation_id } })
    return json({ ok: true, decision: data }, 200, cors)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('error', FN, 'action.failed', { actor_id: caller.id, action: parsed.data.action, error: message })
    await Sentry.captureMessage('Return resolution action failed', { tags: { function: FN, action: parsed.data.action }, extra: { actorId: caller.id, error: message } })
    return fail(cors, 500, 'RETURN_RESOLUTION_FAILED', 'Drapeon could not safely update this resolution right now.')
  }
})
