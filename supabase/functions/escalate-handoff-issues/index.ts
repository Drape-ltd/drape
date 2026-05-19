import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import {
  getClientIp,
  RATE_LIMITS,
  rateLimit,
  rateLimitExceededResponse,
} from '../_shared/rateLimit.ts'
import {
  escalationWindowMinutes,
  handoffEscalationSummary,
  handoffIssueLabel,
  type HandoffIssueType,
} from '../_shared/handoff-support.ts'

const FN = 'escalate-handoff-issues'

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

type IssueRow = {
  id: string
  order_id: string
  reporter_id: string | null
  reporter_role: 'CUSTOMER' | 'TAILOR'
  issue_type: HandoffIssueType
  delivery_method: string | null
  created_at: string
  status: string
  orders: Array<{
    id: string
    stage: string
    customer_id: string | null
    tailor_id: string | null
  }>
}

function counterpartId(issue: IssueRow) {
  const order = issue.orders[0]
  if (!order) return null
  return issue.reporter_role === 'CUSTOMER'
    ? order.tailor_id?.toString() ?? null
    : order.customer_id?.toString() ?? null
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const unauthorized = await authorizeCronRequest(req, FN, cors)
    if (unauthorized) return unauthorized

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const clientIp = getClientIp(req)
    const limit = await rateLimit(
      supabase,
      clientIp,
      FN,
      RATE_LIMITS.authenticated.limit,
      RATE_LIMITS.authenticated.windowMs,
      { ip: clientIp, userAgent: req.headers.get('user-agent') },
    )
    if (!limit.allowed) return rateLimitExceededResponse(cors, limit.retryAfter)

    const now = Date.now()

    const { data, error } = await supabase
      .from('order_handoff_issues')
      .select('id, order_id, reporter_id, reporter_role, issue_type, delivery_method, created_at, status, orders!inner(id, stage, customer_id, tailor_id)')
      .in('status', ['OPEN'])
      .order('created_at', { ascending: true })

    if (error) {
      log('error', FN, 'db.error', { error: error.message })
      return new Response(
        JSON.stringify({
          error: 'Handoff escalation check failed.',
          code: 'HANDOFF_ESCALATION_LOOKUP_FAILED',
        }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
      )
    }

    let escalated = 0
    let skipped = 0

    for (const issue of (data ?? []) as IssueRow[]) {
      const thresholdMs = escalationWindowMinutes(issue.issue_type, issue.delivery_method) * 60 * 1000
      const issueAgeMs = now - new Date(issue.created_at).getTime()
      if (issueAgeMs < thresholdMs) continue

      try {
        const { data: updated, error: updateError } = await supabase
          .from('order_handoff_issues')
          .update({
            status: 'ESCALATED',
            escalated_at: new Date().toISOString(),
          })
          .eq('id', issue.id)
          .eq('status', 'OPEN')
          .select('id')
          .maybeSingle()

        if (updateError) throw new Error(updateError.message)
        if (!updated?.id) continue

        escalated += 1

        const linkedOrder = issue.orders[0]
        if (linkedOrder?.id) {
          await supabase.from('order_stage_updates').insert({
            order_id: linkedOrder.id,
            stage: linkedOrder.stage,
            note: handoffEscalationSummary(issue.issue_type, issue.delivery_method),
          })
        }

        await audit(supabase, {
          event: 'order.handoff_issue_escalated',
          actor_role: 'SYSTEM',
          order_id: issue.order_id,
          severity: 'warn',
          payload: {
            function: FN,
            issue_id: issue.id,
            issue_type: issue.issue_type,
            delivery_method: issue.delivery_method ?? null,
            escalation_after_minutes: escalationWindowMinutes(issue.issue_type, issue.delivery_method),
          },
        })

        const title = issue.delivery_method === 'LOCAL_COLLECTION' ? 'Pickup help escalated' : 'Delivery help escalated'
        const body = `Drape support flagged this ${handoffIssueLabel(issue.issue_type).toLowerCase()} issue for follow-up. Keep all updates inside the order thread.`

        if (issue.reporter_id) {
          EdgeRuntime.waitUntil(sendPushToUser(supabase, issue.reporter_id, { title, body, data: { orderId: issue.order_id } }))
        }

        const otherUser = counterpartId(issue)
        if (otherUser) {
          EdgeRuntime.waitUntil(sendPushToUser(supabase, otherUser, { title, body, data: { orderId: issue.order_id } }))
        }
      } catch (issueError) {
        skipped += 1
        log('error', FN, 'issue.escalate_failed', {
          issue_id: issue.id,
          error: issueError instanceof Error ? issueError.message : String(issueError),
        })
      }
    }

    return new Response(JSON.stringify({ ok: true, escalated, skipped }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
