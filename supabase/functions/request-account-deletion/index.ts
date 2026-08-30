/**
 * request-account-deletion
 *
 * Lets authenticated users initiate account deletion inside the app.
 * The request is recorded for ops review and later processing; this satisfies
 * the "initiate deletion in-app" requirement without forcing immediate hard delete.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { enqueueDomainEvent } from '../_shared/jobs.ts'
import { audit, log } from '../_shared/logger.ts'
import { appleRevocationConfigFromEnv, revokeAppleAuthorizationCode } from '../_shared/apple-token-revocation.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import {
  logPreflightFailure,
  preflightFailureResponse,
  runPreflight,
} from '../_shared/preflight.ts'
import { verifyReauthProof } from '../_shared/reauth-proof.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { optionalNote, parseBody, z } from '../_shared/validate.ts'

const FN = 'request-account-deletion'

const StatusSchema = z.object({
  action: z.literal('STATUS'),
})

const BodySchema = z.object({
  action: z.literal('SUBMIT').optional(),
  source: z.enum(['MOBILE_APP', 'WEB_APP']).optional(),
  reason: optionalNote,
  confirmationText: z.literal('DELETE'),
  reauthProof: z.string().trim().min(20),
  appleAuthorizationCode: z.string().trim().min(8).optional(),
})

type DeletionRequestRow = {
  id: string
  status: string
  requested_at: string
  email: string | null
  role: string
  metadata: Record<string, unknown> | null
}

function numberFromMetadata(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringFromMetadata(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function serializeRequest(request: DeletionRequestRow) {
  return {
    id: request.id,
    status: request.status,
    createdAt: request.requested_at,
    activeOrderCount: numberFromMetadata(request.metadata, 'active_order_count'),
    deletionPath: stringFromMetadata(request.metadata, 'deletion_path'),
    role: request.role,
  }
}

async function ensureAcknowledgement(
  supabase: SupabaseClient,
  caller: { id: string; email?: string | null },
  request: DeletionRequestRow,
) {
  const activeOrderCount = numberFromMetadata(request.metadata, 'active_order_count')
  const isTailor = request.role === 'TAILOR'
  const appPath = isTailor
    ? '/(tailor)/profile/delete-account?returnTo=%2F(tailor)%2Fprofile%2Faccount-settings'
    : '/(customer)/profile/delete-account?returnTo=%2F(customer)%2Fprofile%2Faccount-settings'

  await enqueueDomainEvent(supabase, {
    eventType: 'ACCOUNT_DELETION_ACKNOWLEDGEMENT_REQUIRED',
    aggregateType: 'account_deletion_request',
    aggregateId: request.id,
    actorId: caller.id,
    actorRole: request.role,
    idempotencyKey: `account-deletion-acknowledgement:v2:${request.id}`,
    jobs: ['SEND_ACCOUNT_EVENT_EMAIL', 'SEND_PUSH'],
    payload: {
      userId: caller.id,
      recipientEmail: request.email ?? caller.email ?? null,
      subject: 'We received your Drapeon account deletion request',
      eyebrow: 'Privacy request',
      headline: 'Deletion request received',
      body: activeOrderCount > 0
        ? 'Your request is recorded. Drapeon will resolve active order and payment obligations before deletion or anonymization is completed.'
        : 'Your request is recorded and is moving through privacy review.',
      ctaLabel: 'Review deletion request',
      webPath: '/account?view=settings#delete-account',
      appUrl: 'drape://profile/delete-account',
      details: [
        { label: 'Request ID', value: request.id },
        { label: 'Status', value: request.status },
        { label: 'Submitted', value: request.requested_at },
        { label: 'Active orders', value: String(activeOrderCount) },
      ],
      notification: {
        title: 'Deletion request received',
        body: activeOrderCount > 0
          ? 'Your request is recorded. Active order obligations will be resolved first.'
          : 'Your account deletion request is recorded for privacy review.',
        preferenceKey: 'orderUpdates',
        data: {
          destination: 'ACCOUNT_SETTINGS',
          href: appPath,
          deletionRequestId: request.id,
        },
      },
    },
  })
}

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

async function countActiveOrders(
  supabase: SupabaseClient,
  userId: string,
  tailorProfileId?: string | null
) {
  const [customerOrders, tailorAccountOrders, tailorProfileOrders] = await Promise.all([
    supabase
      .from('orders')
      .select('id')
      .eq('customer_id', userId)
      .in('stage', ACTIVE_ORDER_STAGES),
    supabase
      .from('orders')
      .select('id')
      .eq('tailor_id', userId)
      .in('stage', ACTIVE_ORDER_STAGES),
    tailorProfileId
      ? supabase
          .from('orders')
          .select('id')
          .eq('tailor_profile_id', tailorProfileId)
          .in('stage', ACTIVE_ORDER_STAGES)
      : Promise.resolve({ data: [], error: null }),
  ])

  const customerOrderIds = new Set(
    (customerOrders.data ?? []).map((order) => String(order.id))
  )
  const tailorOrderIds = new Set([
    ...(tailorAccountOrders.data ?? []).map((order) => String(order.id)),
    ...(tailorProfileOrders.data ?? []).map((order) => String(order.id)),
  ])

  const lookupError =
    customerOrders.error?.message ??
    tailorAccountOrders.error?.message ??
    tailorProfileOrders.error?.message ??
    null

  return {
    activeCustomerOrderCount: customerOrderIds.size,
    activeTailorOrderCount: tailorOrderIds.size,
    lookupFailed: !!lookupError,
    lookupError,
  }
}

function jsonResponse(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function jsonError(
  cors: HeadersInit,
  status: number,
  error: string,
  extra?: Record<string, unknown>
) {
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

    const rawBody = await req.json().catch(() => ({}))
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

    if (StatusSchema.safeParse(rawBody).success) {
      const { data: existing, error: existingError } = await supabase
        .from('account_deletion_requests')
        .select('id, status, requested_at, email, role, metadata')
        .eq('user_id', caller.id)
        .in('status', ['PENDING', 'ACKNOWLEDGED', 'BLOCKED', 'READY_FOR_FINALIZATION'])
        .order('requested_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingError) {
        log('error', FN, 'status.db_error', { actor_id: caller.id, error: existingError.message })
        return jsonError(cors, 500, 'We could not load your deletion request status right now.')
      }
      if (!existing) return jsonResponse({ ok: true, request: null }, 200, cors)

      try {
        await ensureAcknowledgement(supabase, caller, existing as DeletionRequestRow)
      } catch (queueError) {
        log('warn', FN, 'acknowledgement.enqueue_failed', {
          request_id: existing.id,
          error: queueError instanceof Error ? queueError.message : String(queueError),
        })
      }
      return jsonResponse({ ok: true, request: serializeRequest(existing as DeletionRequestRow) }, 200, cors)
    }

    const parsed = parseBody(BodySchema, rawBody)
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return jsonError(
        cors,
        400,
        'Type DELETE and confirm your password before submitting this request.'
      )
    }

    const allowed = await checkRateLimit(
      supabase,
      `request-account-deletion:${caller.id}`,
      86400,
      3
    )
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
      const status =
        !proofResult.ok && proofResult.code === 'REAUTH_PROOF_SECRET_MISSING' ? 503 : 401
      return preflightFailureResponse(reauthPreflight, cors, status)
    }

    const { data: existing, error: existingError } = await supabase
      .from('account_deletion_requests')
      .select('id, status, requested_at, email, role, metadata')
      .eq('user_id', caller.id)
      .in('status', ['PENDING', 'ACKNOWLEDGED', 'BLOCKED', 'READY_FOR_FINALIZATION'])
      .maybeSingle()

    if (existingError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: existingError.message })
      return jsonError(cors, 500, 'We could not check your deletion request status right now.')
    }

    if (existing) {
      try {
        await ensureAcknowledgement(supabase, caller, existing as DeletionRequestRow)
      } catch (queueError) {
        log('warn', FN, 'acknowledgement.enqueue_failed', {
          request_id: existing.id,
          error: queueError instanceof Error ? queueError.message : String(queueError),
        })
      }
      return jsonResponse({
        ok: true,
        alreadyPending: true,
        request: serializeRequest(existing as DeletionRequestRow),
      }, 200, cors)
    }

    const [{ data: tailorProfile }, { data: customerProfile }] = await Promise.all([
      supabase.from('tailor_profiles').select('id').eq('user_id', caller.id).maybeSingle(),
      supabase.from('customer_profiles').select('id').eq('user_id', caller.id).maybeSingle(),
    ])

    const role = tailorProfile ? 'TAILOR' : customerProfile ? 'CUSTOMER' : 'UNKNOWN'

    const activeOrders = await countActiveOrders(supabase, caller.id, tailorProfile?.id)
    if (activeOrders.lookupFailed) {
      log('warn', FN, 'active_orders.lookup_failed', {
        actor_id: caller.id,
        error: activeOrders.lookupError,
      })
    }

    const activeOrderCount =
      activeOrders.activeCustomerOrderCount + activeOrders.activeTailorOrderCount
    const deletionPreflight = runPreflight([
      {
        name: 'active_order_lookup_succeeded',
        condition: !activeOrders.lookupFailed,
        errorCode: 'ACTIVE_ORDER_LOOKUP_FAILED',
        message:
          'We could not confirm whether this account has active orders. Try again in a moment.',
        field: 'orders',
        severity: 'BLOCKING',
        actual: { lookupError: activeOrders.lookupError },
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
          source: parsed.data.source ?? 'MOBILE_APP',
          confirmation_text_entered: true,
          reauth_proof_verified: true,
          reauth_proof_issued_at: proofResult.ok
            ? new Date(proofResult.payload.issuedAt).toISOString()
            : null,
          reauth_proof_expires_at: proofResult.ok
            ? new Date(proofResult.payload.expiresAt).toISOString()
            : null,
          deletion_path: deletionPath,
          active_customer_order_count: activeOrders.activeCustomerOrderCount,
          active_tailor_order_count: activeOrders.activeTailorOrderCount,
          active_order_count: activeOrderCount,
          active_order_lookup_failed: activeOrders.lookupFailed,
        },
      })
      .select('id, status, requested_at, email, role, metadata')
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
      description:
        activeOrderCount > 0
          ? `${role.toLowerCase()} requested permanent account deletion with ${activeOrderCount} active order(s).`
          : `${role.toLowerCase()} requested permanent account deletion inside Drapeon.`,
      recommendedAction:
        activeOrderCount > 0
          ? 'Acknowledge the request, restrict new marketplace activity if needed, review active orders/refunds first, then complete deletion/anonymization after transaction obligations are resolved.'
          : 'Acknowledge the request, verify identity if needed, and move the deletion workflow through privacy review to completion.',
      dedupeKey: `account-deletion:${caller.id}`,
      metadata: {
        account_email: caller.email ?? null,
        reason: parsed.data.reason ?? null,
        source: parsed.data.source ?? 'MOBILE_APP',
        deletion_path: deletionPath,
        active_customer_order_count: activeOrders.activeCustomerOrderCount,
        active_tailor_order_count: activeOrders.activeTailorOrderCount,
        active_order_count: activeOrderCount,
      },
    })

    const requestId = (insertedRequest as { id?: string } | null)?.id ?? null
    if (parsed.data.appleAuthorizationCode && requestId) {
      const appleConfig = appleRevocationConfigFromEnv()
      const revocation = appleConfig
        ? await revokeAppleAuthorizationCode(parsed.data.appleAuthorizationCode, appleConfig)
            .catch((error) => ({ ok: false as const, stage: 'request' as const, error: error instanceof Error ? error.message : String(error) }))
        : { ok: false as const, stage: 'configuration' as const, error: 'APPLE_REVOCATION_NOT_CONFIGURED' }
      const revocationAt = new Date().toISOString()
      const currentMetadata = (insertedRequest as DeletionRequestRow).metadata ?? {}
      await supabase.from('account_deletion_requests').update({
        metadata: {
          ...currentMetadata,
          apple_authorization_revocation: {
            status: revocation.ok ? 'SUCCEEDED' : 'FAILED',
            attempted_at: revocationAt,
            stage: revocation.ok ? 'revoke' : revocation.stage,
            error: revocation.ok ? null : revocation.error,
          },
        },
      }).eq('id', requestId)
      await audit(supabase, {
        event: revocation.ok ? 'account_deletion.apple_authorization_revoked' : 'account_deletion.apple_authorization_revocation_failed',
        actor_id: caller.id,
        actor_role: role,
        severity: revocation.ok ? 'info' : 'error',
        payload: { request_id: requestId, stage: revocation.ok ? 'revoke' : revocation.stage },
      })
      if (!revocation.ok) {
        log('error', FN, 'apple_authorization.revocation_failed', {
          actor_id: caller.id,
          request_id: requestId,
          stage: revocation.stage,
          error: revocation.error,
        })
      }
    }
    try {
      await ensureAcknowledgement(supabase, caller, insertedRequest as DeletionRequestRow)
    } catch (emailQueueError) {
      log('warn', FN, 'receipt.enqueue_failed', {
        request_id: requestId,
        error: emailQueueError instanceof Error ? emailQueueError.message : String(emailQueueError),
      })
    }

    log('info', FN, 'account_deletion.requested', { actor_id: caller.id, actor_role: role })

    return new Response(
      JSON.stringify({
        ok: true,
        activeOrderCount,
        deletionPath,
        request: serializeRequest(insertedRequest as DeletionRequestRow),
      }),
      {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonError(cors, 500, 'We could not submit your deletion request right now.')
  }
})
