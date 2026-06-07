import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { OpsIssueSeverity, OpsIssueType } from '../../../packages/shared/src/ops-issues.ts'
import { getAuthUser } from '../_shared/auth.ts'
import { rejectIfBlockedContact } from '../_shared/contact-bypass.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'account-support-action'

const SUPPORT_CATEGORIES = [
  'PAYMENT',
  'FIT',
  'DELIVERY_HANDOFF',
  'ACCOUNT_SECURITY',
  'TAILOR_PAYOUT',
  'GENERAL',
] as const

type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]

const BodySchema = z.object({
  action: z.literal('submit-support'),
  category: z.enum(SUPPORT_CATEGORIES),
  orderId: uuid.optional().nullable(),
  subject: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(1500),
})

type OrderRow = {
  id: string
  reference: string | null
  stage: string | null
  delivery_method: string | null
  payment_provider: string | null
  customer_id: string | null
  tailor_id: string | null
  tailor_profile_id: string | null
}

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

function actorRoleForOrder(callerId: string, order: OrderRow | null) {
  if (!order) return 'CUSTOMER'
  if (order.customer_id?.toString() === callerId) return 'CUSTOMER'
  if (order.tailor_id?.toString() === callerId) return 'TAILOR'
  return null
}

function categoryLabel(category: SupportCategory) {
  switch (category) {
    case 'PAYMENT':
      return 'Payment issue'
    case 'FIT':
      return 'Fit or alteration issue'
    case 'DELIVERY_HANDOFF':
      return 'Delivery or handoff issue'
    case 'ACCOUNT_SECURITY':
      return 'Account or security issue'
    case 'TAILOR_PAYOUT':
      return 'Tailor payout or setup issue'
    default:
      return 'Support request'
  }
}

function issueTypeForCategory(category: SupportCategory): OpsIssueType {
  switch (category) {
    case 'PAYMENT':
      return 'PAYMENT_BLOCKED'
    case 'FIT':
      return 'AFTERCARE_REQUEST'
    case 'DELIVERY_HANDOFF':
      return 'DELIVERY_REVIEW'
    case 'ACCOUNT_SECURITY':
      return 'SYSTEM_ALERT'
    case 'TAILOR_PAYOUT':
      return 'PAYOUT_BLOCKED'
    default:
      return 'ORDER_REVIEW'
  }
}

function severityForCategory(category: SupportCategory): OpsIssueSeverity {
  switch (category) {
    case 'ACCOUNT_SECURITY':
    case 'PAYMENT':
    case 'TAILOR_PAYOUT':
      return 'HIGH'
    case 'FIT':
    case 'DELIVERY_HANDOFF':
      return 'MEDIUM'
    default:
      return 'LOW'
  }
}

function recommendedActionForCategory(category: SupportCategory) {
  switch (category) {
    case 'PAYMENT':
      return 'Review payment records, provider status, duplicate charge risk, and whether the customer needs a retry, confirmation, or refund.'
    case 'FIT':
      return 'Review the order brief, measurement profile, stage proof, and whether this belongs in aftercare, alteration, refund, or dispute handling.'
    case 'DELIVERY_HANDOFF':
      return 'Review handoff status, courier or pickup proof, receipt confirmation, and whether delivery review or customer confirmation is needed.'
    case 'ACCOUNT_SECURITY':
      return 'Verify the account, session, login, and data-access risk before replying. Escalate if identity or access looks suspicious.'
    case 'TAILOR_PAYOUT':
      return 'Review payout setup, provider readiness, blocked release reason, and whether ops needs a manual payout decision.'
    default:
      return 'Review the request, attach it to the right order or account workflow, and respond through the protected support route.'
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return jsonResponse({ error: 'Please sign in again before opening support.' }, 401, cors)
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return jsonResponse({ error: parsed.error }, 400, cors)
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 15)
    if (!allowed) return rateLimitExceededResponse(cors)

    const body = parsed.data
    let order: OrderRow | null = null

    if (body.orderId) {
      const { data, error } = await supabase
        .from('orders')
        .select('id, reference, stage, delivery_method, payment_provider, customer_id, tailor_id, tailor_profile_id')
        .eq('id', body.orderId)
        .maybeSingle()

      if (error) {
        log('error', FN, 'order.lookup_failed', { actor_id: caller.id, order_id: body.orderId, error: error.message })
        return jsonResponse({ error: 'We could not load this order right now. Please try again.' }, 500, cors)
      }
      if (!data?.id) return jsonResponse({ error: 'This order could not be found.' }, 404, cors)
      order = data as OrderRow
    }

    const actorRole = actorRoleForOrder(caller.id, order)
    if (!actorRole) {
      return jsonResponse({ error: 'You do not have access to this order.' }, 403, cors)
    }

    const blockedContact = await rejectIfBlockedContact({
      supabase,
      fn: FN,
      cors,
      actorId: caller.id,
      actorRole,
      surface: 'account_support',
      text: `${body.subject}\n${body.description}`,
      message: 'Keep phone numbers, emails, social handles, and off-platform contact details out of support requests.',
      orderId: order?.id ?? null,
      extra: { category: body.category },
    })
    if (blockedContact) return blockedContact

    const label = categoryLabel(body.category)
    const issue = await createOrRefreshOpsIssue(supabase, {
      issueType: issueTypeForCategory(body.category),
      severity: severityForCategory(body.category),
      source: FN,
      actorId: caller.id,
      actorRole,
      orderId: order?.id ?? null,
      userId: caller.id,
      tailorProfileId: order?.tailor_profile_id ?? null,
      provider: order?.payment_provider ?? null,
      stage: order?.stage ?? null,
      title: `${label}: ${body.subject}`,
      description: body.description,
      recommendedAction: recommendedActionForCategory(body.category),
      dedupeKey: `account-support:${caller.id}:${order?.id ?? 'no-order'}:${body.category}:${body.subject.toLowerCase().slice(0, 64)}`,
      metadata: {
        category: body.category,
        support_subject: body.subject,
        order_reference: order?.reference ?? null,
        delivery_method: order?.delivery_method ?? null,
      },
    })

    if (!issue?.id) {
      return jsonResponse({ error: 'Support could not be opened right now. Please try again.' }, 500, cors)
    }

    await audit(supabase, {
      event: 'account.support_submitted',
      actor_id: caller.id,
      actor_role: actorRole,
      order_id: order?.id ?? null,
      severity: body.category === 'ACCOUNT_SECURITY' ? 'warn' : 'info',
      payload: {
        function: FN,
        issue_id: issue.id,
        issue_number: issue.issue_number,
        category: body.category,
      },
    })

    return jsonResponse({ ok: true, issueId: issue.id, issueNumber: issue.issue_number }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonResponse({ error: 'Support could not be opened right now. Please try again.' }, 500, getCorsHeaders(req))
  }
})
