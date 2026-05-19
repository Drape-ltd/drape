/**
 * request-account-deletion
 *
 * Lets authenticated users initiate account deletion inside the app.
 * The request is recorded for ops review and later processing; this satisfies
 * the "initiate deletion in-app" requirement without forcing immediate hard delete.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { logPreflightFailure, preflightFailureResponse, runPreflight } from '../_shared/preflight.ts'
import { verifyReauthProof } from '../_shared/reauth-proof.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { optionalNote, parseBody, z } from '../_shared/validate.ts'

const FN = 'request-account-deletion'
const RESEND_API = 'https://api.resend.com/emails'

const BodySchema = z.object({
  reason: optionalNote,
  confirmationText: z.literal('DELETE'),
  reauthProof: z.string().trim().min(20),
})

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

function getSiteUrl() {
  return (
    Deno.env.get('SITE_URL') ??
    Deno.env.get('NEXT_PUBLIC_SITE_URL') ??
    'https://drapeon.co'
  ).replace(/\/+$/u, '')
}

function getResendFrom() {
  return Deno.env.get('RESEND_FROM') ?? 'Drape Privacy <privacy@drapeon.co>'
}

function getResendApiKey() {
  return Deno.env.get('RESEND_API_KEY')?.trim() ?? ''
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

async function sendDeletionReceiptEmail(input: {
  to: string | null | undefined
  role: string
  activeOrderCount: number
  requestId: string | null
}) {
  const to = input.to?.trim()
  if (!to) return

  const apiKey = getResendApiKey()
  if (!apiKey) {
    log('warn', FN, 'resend.missing_api_key')
    return
  }

  const appUrl = getSiteUrl()
  const hasActiveOrders = input.activeOrderCount > 0
  const subject = 'We received your Drape account deletion request'
  const nextStep = hasActiveOrders
    ? 'Because this account has active orders, payouts, disputes, or transaction obligations, Drape will review those first, then complete deletion or anonymization where permitted.'
    : 'Drape will move this through privacy review and complete deletion or anonymization where permitted.'

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'drape-account-deletion/1.0',
    },
    body: JSON.stringify({
      from: getResendFrom(),
      to: [to],
      subject,
      html: `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1f2937">
  <h1 style="font-size:24px;margin:0 0 12px">Deletion request received</h1>
  <p style="line-height:1.6;margin:0 0 16px">Drape received your account deletion request.</p>
  <p style="line-height:1.6;margin:0 0 16px">${escapeHtml(nextStep)}</p>
  <table style="width:100%;border-collapse:collapse;margin:24px 0">
    <tr><td style="padding:8px 0;color:#6b7280">Account type</td><td style="padding:8px 0;font-weight:600">${escapeHtml(input.role)}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280">Active orders found</td><td style="padding:8px 0;font-weight:600">${input.activeOrderCount}</td></tr>
    ${input.requestId ? `<tr><td style="padding:8px 0;color:#6b7280">Request ID</td><td style="padding:8px 0;font-weight:600">${escapeHtml(input.requestId)}</td></tr>` : ''}
  </table>
  <p style="line-height:1.6;margin:0 0 16px">If this was not you, contact privacy@drapeon.co immediately from this email address.</p>
  <a href="${appUrl}/account-deletion" style="display:inline-block;padding:12px 20px;background:#2f6844;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600">Account deletion information</a>
</div>`,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    log('warn', FN, 'resend.send_failed', { to, status: response.status, body })
  }
}

async function countActiveOrders(supabase: any, userId: string) {
  const [customerOrders, tailorOrders] = await Promise.all([
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', userId)
      .in('stage', ACTIVE_ORDER_STAGES),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('tailor_id', userId)
      .in('stage', ACTIVE_ORDER_STAGES),
  ])

  return {
    activeCustomerOrderCount: customerOrders.count ?? 0,
    activeTailorOrderCount: tailorOrders.count ?? 0,
    lookupFailed: !!customerOrders.error || !!tailorOrders.error,
    lookupError:
      customerOrders.error?.message ??
      tailorOrders.error?.message ??
      null,
  }
}

function jsonResponse(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function jsonError(cors: HeadersInit, status: number, error: string, extra?: Record<string, unknown>) {
  return jsonResponse({ error, message: error, ...(extra ?? {}) }, status, cors)
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return jsonError(cors, 401, 'Please sign in again before requesting account deletion.')
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return jsonError(cors, 400, 'Type DELETE and confirm your password before submitting this request.')
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

    const allowed = await checkRateLimit(supabase, `request-account-deletion:${caller.id}`, 86400, 3)
    if (!allowed) {
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        severity: 'warn',
        payload: { function: FN },
      })
      return rateLimitExceededResponse(cors)
    }

    const proofResult = await verifyReauthProof(parsed.data.reauthProof, {
      userId: caller.id,
      purpose: 'ACCOUNT_DELETION',
    })
    const reauthPreflight = runPreflight([
      {
        name: 'password_confirmed_within_five_minutes',
        condition: proofResult.ok,
        errorCode: proofResult.ok ? 'REAUTH_OK' : proofResult.code,
        message: proofResult.ok ? 'Password confirmation is current.' : proofResult.message,
        field: 'reauthProof',
        severity: 'BLOCKING',
        actual: proofResult.ok
          ? {
            issuedAt: new Date(proofResult.payload.issuedAt).toISOString(),
            expiresAt: new Date(proofResult.payload.expiresAt).toISOString(),
            purpose: proofResult.payload.purpose,
          }
          : proofResult.actual,
      },
    ])

    if (!reauthPreflight.passed) {
      await logPreflightFailure(supabase, reauthPreflight, {
        operation: 'request_account_deletion_reauth',
        entityType: 'user',
        entityId: caller.id,
        actorId: caller.id,
        userId: caller.id,
        source: FN,
        metadata: {
          reason: proofResult.ok ? null : proofResult.code,
        },
      })
      const status = !proofResult.ok && proofResult.code === 'REAUTH_PROOF_SECRET_MISSING' ? 503 : 401
      return preflightFailureResponse(reauthPreflight, cors, status)
    }

    const { data: existing, error: existingError } = await supabase
      .from('account_deletion_requests')
      .select('id')
      .eq('user_id', caller.id)
      .eq('status', 'PENDING')
      .maybeSingle()

    if (existingError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: existingError.message })
      return jsonError(cors, 500, 'We could not check your deletion request status right now.')
    }

    if (existing) {
      return new Response(JSON.stringify({ ok: true, alreadyPending: true }), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const [{ data: tailorProfile }, { data: customerProfile }] = await Promise.all([
      supabase.from('tailor_profiles').select('id').eq('user_id', caller.id).maybeSingle(),
      supabase.from('customer_profiles').select('id').eq('user_id', caller.id).maybeSingle(),
    ])

    const role = tailorProfile ? 'TAILOR' : customerProfile ? 'CUSTOMER' : 'UNKNOWN'

    const activeOrders = await countActiveOrders(supabase, caller.id)
    if (activeOrders.lookupFailed) {
      log('warn', FN, 'active_orders.lookup_failed', {
        actor_id: caller.id,
        error: activeOrders.lookupError,
      })
    }

    const activeOrderCount = activeOrders.activeCustomerOrderCount + activeOrders.activeTailorOrderCount
    const deletionPreflight = runPreflight([
      {
        name: 'active_order_lookup_succeeded',
        condition: !activeOrders.lookupFailed,
        errorCode: 'ACTIVE_ORDER_LOOKUP_FAILED',
        message: 'We could not confirm whether this account has active orders. Try again in a moment.',
        field: 'orders',
        severity: 'BLOCKING',
        actual: { lookupError: activeOrders.lookupError },
      },
      {
        name: 'no_active_orders',
        condition: activeOrderCount === 0,
        errorCode: 'ACTIVE_ORDERS_PRESENT',
        message: 'You have active orders. Wait for them to complete or cancel them before deleting your account.',
        field: 'orders',
        severity: 'BLOCKING',
        actual: {
          activeCustomerOrderCount: activeOrders.activeCustomerOrderCount,
          activeTailorOrderCount: activeOrders.activeTailorOrderCount,
          activeOrderCount,
        },
      },
    ])

    if (!deletionPreflight.passed) {
      await logPreflightFailure(supabase, deletionPreflight, {
        operation: 'request_account_deletion',
        entityType: 'user',
        entityId: caller.id,
        actorId: caller.id,
        actorRole: role,
        userId: caller.id,
        source: FN,
        metadata: {
          active_customer_order_count: activeOrders.activeCustomerOrderCount,
          active_tailor_order_count: activeOrders.activeTailorOrderCount,
          active_order_count: activeOrderCount,
        },
      })
      return preflightFailureResponse(deletionPreflight, cors, 409)
    }

    const deletionPath = activeOrderCount > 0 ? 'OPS_REVIEW_ACTIVE_ORDERS' : 'OPS_REVIEW_STANDARD'

    const { data: insertedRequest, error: insertError } = await supabase
      .from('account_deletion_requests')
      .insert({
        user_id: caller.id,
        email: caller.email ?? null,
        role,
        reason: parsed.data.reason ?? null,
        metadata: {
          source: 'MOBILE_APP',
          confirmation_text_entered: true,
          reauth_proof_verified: true,
          reauth_proof_issued_at: proofResult.ok ? new Date(proofResult.payload.issuedAt).toISOString() : null,
          reauth_proof_expires_at: proofResult.ok ? new Date(proofResult.payload.expiresAt).toISOString() : null,
          deletion_path: deletionPath,
          active_customer_order_count: activeOrders.activeCustomerOrderCount,
          active_tailor_order_count: activeOrders.activeTailorOrderCount,
          active_order_count: activeOrderCount,
          active_order_lookup_failed: activeOrders.lookupFailed,
        },
      })
      .select('id')
      .single()

    if (insertError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: insertError.message })
      return jsonError(cors, 500, 'We could not submit your deletion request right now.')
    }

    await audit(supabase, {
      event: 'account_deletion.requested',
      actor_id: caller.id,
      actor_role: role,
      payload: { function: FN },
    })

    await createOrRefreshOpsIssue(supabase, {
      issueType: 'ACCOUNT_DELETION_REQUEST',
      severity: 'HIGH',
      source: FN,
      actorId: caller.id,
      actorRole: role,
      userId: caller.id,
      relatedEntityType: 'account_deletion_request',
      relatedEntityId: (insertedRequest as { id?: string } | null)?.id ?? null,
      title: 'Account deletion request',
      description: activeOrderCount > 0
        ? `${role.toLowerCase()} requested permanent account deletion with ${activeOrderCount} active order(s).`
        : `${role.toLowerCase()} requested permanent account deletion inside Drape.`,
      recommendedAction: activeOrderCount > 0
        ? 'Acknowledge the request, restrict new marketplace activity if needed, review active orders/refunds first, then complete deletion/anonymization after transaction obligations are resolved.'
        : 'Acknowledge the request, verify identity if needed, and move the deletion workflow through privacy review to completion.',
      dedupeKey: `account-deletion:${caller.id}`,
      metadata: {
        account_email: caller.email ?? null,
        reason: parsed.data.reason ?? null,
        source: 'MOBILE_APP',
        deletion_path: deletionPath,
        active_customer_order_count: activeOrders.activeCustomerOrderCount,
        active_tailor_order_count: activeOrders.activeTailorOrderCount,
        active_order_count: activeOrderCount,
      },
    })

    await sendDeletionReceiptEmail({
      to: caller.email,
      role,
      activeOrderCount,
      requestId: (insertedRequest as { id?: string } | null)?.id ?? null,
    })

    log('info', FN, 'account_deletion.requested', { actor_id: caller.id, actor_role: role })

    return new Response(JSON.stringify({
      ok: true,
      activeOrderCount,
      deletionPath,
    }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonError(cors, 500, 'We could not submit your deletion request right now.')
  }
})
