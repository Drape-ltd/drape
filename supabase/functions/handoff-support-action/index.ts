import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'
import {
  HANDOFF_ISSUE_TYPES,
  handoffIssueLabel,
  handoffIssueSummary,
  isHandoffStage,
  isPickupIssueType,
  isShippingIssueType,
  type HandoffIssueType,
} from '../_shared/handoff-support.ts'

const FN = 'handoff-support-action'
const OPEN_STATUSES = ['OPEN', 'ESCALATED'] as const

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

const ReportIssueSchema = z.object({
  action: z.literal('report-issue'),
  orderId: uuid,
  issueType: z.enum(HANDOFF_ISSUE_TYPES),
  description: z.string().trim().min(10).max(300).optional().nullable(),
})

const ResolveIssueSchema = z.object({
  action: z.literal('resolve-issue'),
  issueId: uuid,
  note: z.string().trim().min(5).max(240).optional().nullable(),
})

const BodySchema = z.union([ReportIssueSchema, ResolveIssueSchema])

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  const payload =
    typeof body.error === 'string' && typeof body.message !== 'string'
      ? { ...body, message: body.error }
      : body
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

function actorRoleForOrder(callerId: string, order: { customer_id?: string | null; tailor_id?: string | null }) {
  if (order.customer_id?.toString() === callerId) return 'CUSTOMER' as const
  if (order.tailor_id?.toString() === callerId) return 'TAILOR' as const
  return null
}

function counterpartIdForOrder(actorRole: 'CUSTOMER' | 'TAILOR', order: { customer_id?: string | null; tailor_id?: string | null }) {
  return actorRole === 'CUSTOMER' ? order.tailor_id?.toString() ?? null : order.customer_id?.toString() ?? null
}

function validateIssueType(issueType: HandoffIssueType, deliveryMethod: string | null | undefined) {
  if (deliveryMethod === 'LOCAL_COLLECTION' && isShippingIssueType(issueType)) {
    return 'Use pickup help options for local collection orders.'
  }
  if (deliveryMethod !== 'LOCAL_COLLECTION' && isPickupIssueType(issueType)) {
    return 'Use delivery help options for shipped or delivered orders.'
  }
  return null
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return jsonResponse({ error: 'Please sign in again before managing order handoff help.' }, 401, cors)
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return jsonResponse({ error: parsed.error }, 400, cors)
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 20)
    if (!allowed) {
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        severity: 'warn',
        payload: { function: FN },
      })
      return rateLimitExceededResponse(cors)
    }

    const body = parsed.data

    if (body.action === 'report-issue') {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id, reference, stage, delivery_method, customer_id, tailor_id')
        .eq('id', body.orderId)
        .maybeSingle()

      if (orderError) {
        log('error', FN, 'db.error', { actor_id: caller.id, error: orderError.message })
        return jsonResponse({ error: 'We could not load this order right now. Please try again.' }, 500, cors)
      }

      if (!order?.id) {
        return jsonResponse({ error: 'This order could not be found.' }, 404, cors)
      }

      const actorRole = actorRoleForOrder(caller.id, order)
      if (!actorRole) {
        return jsonResponse({ error: 'You do not have access to this order.' }, 403, cors)
      }

      if (!isHandoffStage(order.stage)) {
        return jsonResponse(
          { code: 'HANDOFF_NOT_READY', error: 'Handoff help becomes available once pickup or delivery is actually in progress.' },
          409,
          cors,
        )
      }

      const typeError = validateIssueType(body.issueType, order.delivery_method)
      if (typeError) {
        return jsonResponse({ code: 'ISSUE_TYPE_INVALID', error: typeError }, 400, cors)
      }

      const { data: existingIssue, error: existingIssueError } = await supabase
        .from('order_handoff_issues')
        .select('id, status')
        .eq('order_id', order.id)
        .eq('reporter_id', caller.id)
        .eq('issue_type', body.issueType)
        .in('status', [...OPEN_STATUSES])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingIssueError) {
        log('error', FN, 'db.error', { actor_id: caller.id, error: existingIssueError.message })
        return jsonResponse({ error: 'We could not check existing handoff help right now. Please try again.' }, 500, cors)
      }

      if (existingIssue?.id) {
        return jsonResponse({ ok: true, issueId: existingIssue.id, alreadyOpen: true }, 200, cors)
      }

      const description = body.description?.trim() || null
      const { data: createdIssue, error: createIssueError } = await supabase
        .from('order_handoff_issues')
        .insert({
          order_id: order.id,
          reporter_id: caller.id,
          reporter_role: actorRole,
          issue_type: body.issueType,
          description,
          stage_at_report: order.stage,
          delivery_method: order.delivery_method ?? null,
        })
        .select('id')
        .single()

      if (createIssueError || !createdIssue?.id) {
        log('error', FN, 'db.error', { actor_id: caller.id, error: createIssueError?.message ?? 'create failed' })
        return jsonResponse({ error: 'We could not save this handoff issue right now. Please try again.' }, 500, cors)
      }

      await supabase.from('order_stage_updates').insert({
        order_id: order.id,
        stage: order.stage,
        note: `${actorRole === 'CUSTOMER' ? 'Customer' : 'Tailor'} requested handoff help in Drapeon. Issue: ${handoffIssueLabel(body.issueType)}.`,
      })

      await audit(supabase, {
        event: 'order.handoff_issue_reported',
        actor_id: caller.id,
        actor_role: actorRole,
        order_id: order.id,
        severity: 'warn',
        payload: {
          function: FN,
          issue_id: createdIssue.id,
          issue_type: body.issueType,
          delivery_method: order.delivery_method ?? null,
          stage: order.stage,
        },
      })

      const counterpartId = counterpartIdForOrder(actorRole, order)
      if (counterpartId) {
        EdgeRuntime.waitUntil(
          sendPushToUser(supabase, counterpartId, {
            title: order.delivery_method === 'LOCAL_COLLECTION' ? 'Pickup help requested' : 'Delivery help requested',
            body: actorRole === 'CUSTOMER'
              ? 'Your customer requested handoff help in Drapeon. Open the order and respond there.'
              : 'Your seller requested handoff help in Drapeon. Open the order and respond there.',
            data: { orderId: order.id },
          }),
        )
      }

      EdgeRuntime.waitUntil(
        sendPushToUser(supabase, caller.id, {
          title: 'Handoff help opened',
          body: `${handoffIssueSummary(body.issueType, order.delivery_method)} has been logged in Drapeon.`,
          data: { orderId: order.id },
        }),
      )

      return jsonResponse({ ok: true, issueId: createdIssue.id, alreadyOpen: false }, 200, cors)
    }

    const { data: issue, error: issueError } = await supabase
      .from('order_handoff_issues')
      .select('id, order_id, status, issue_type, delivery_method, orders!inner(id, stage, customer_id, tailor_id)')
      .eq('id', body.issueId)
      .maybeSingle()

    if (issueError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: issueError.message })
      return jsonResponse({ error: 'We could not load this handoff help thread right now. Please try again.' }, 500, cors)
    }

    const linkedOrder = (issue as any)?.orders
    if (!(issue as any)?.id || !linkedOrder?.id) {
      return jsonResponse({ error: 'This handoff help thread could not be found.' }, 404, cors)
    }

    const actorRole = actorRoleForOrder(caller.id, linkedOrder)
    if (!actorRole) {
      return jsonResponse({ error: 'You do not have access to this handoff help thread.' }, 403, cors)
    }

    if ((issue as any).status === 'RESOLVED' || (issue as any).status === 'DISMISSED') {
      return jsonResponse({ ok: true, idempotent: true }, 200, cors)
    }

    const { error: resolveError } = await supabase
      .from('order_handoff_issues')
      .update({
        status: 'RESOLVED',
        resolved_at: new Date().toISOString(),
        resolution_note: body.note?.trim() || null,
      })
      .eq('id', body.issueId)

    if (resolveError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: resolveError.message })
      return jsonResponse({ error: 'We could not update this handoff issue right now. Please try again.' }, 500, cors)
    }

    await supabase.from('order_stage_updates').insert({
      order_id: linkedOrder.id,
      stage: linkedOrder.stage,
      note: `${actorRole === 'CUSTOMER' ? 'Customer' : 'Tailor'} marked the open handoff help thread as resolved in Drapeon.`,
    })

    await audit(supabase, {
      event: 'order.handoff_issue_resolved',
      actor_id: caller.id,
      actor_role: actorRole,
      order_id: linkedOrder.id,
      payload: {
        function: FN,
        issue_id: body.issueId,
        issue_type: (issue as any).issue_type,
      },
    })

    const counterpartId = counterpartIdForOrder(actorRole, linkedOrder)
    if (counterpartId) {
      EdgeRuntime.waitUntil(
        sendPushToUser(supabase, counterpartId, {
          title: 'Handoff help resolved',
          body: 'The open handoff help thread on this order was marked resolved in Drapeon.',
          data: { orderId: linkedOrder.id },
        }),
      )
    }

    return jsonResponse({ ok: true }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonResponse({ error: 'Something went wrong with handoff help. Please try again.' }, 500, cors)
  }
})
