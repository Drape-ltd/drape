import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { classifyExpoPushReceipt } from '../_shared/expo-push-receipts.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'

const FN = 'process-push-receipts'
const DEFAULT_LIMIT = 500
const RECEIPT_EXPIRY_MS = 24 * 60 * 60 * 1000

type PushAttemptRow = {
  id: string
  ticket_id: string
  push_token_id: string | null
  status: 'TICKET_ACCEPTED' | 'RECEIPT_PENDING'
  ticket_created_at: string
  receipt_check_count: number
}

function jsonResponse(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function readLimit(req: Request) {
  try {
    const body = await req.clone().json()
    const value = Number(body?.limit)
    return Number.isFinite(value)
      ? Math.max(1, Math.min(1_000, Math.trunc(value)))
      : DEFAULT_LIMIT
  } catch {
    return DEFAULT_LIMIT
  }
}

function nextReceiptCheckAt(checkCount: number) {
  const delayMinutes = checkCount < 2 ? 5 : checkCount < 5 ? 15 : 60
  return new Date(Date.now() + delayMinutes * 60 * 1000).toISOString()
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const unauthorized = await authorizeCronRequest(req, FN, cors)
  if (unauthorized) return unauthorized

  const limit = await readLimit(req)
  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
  const now = new Date()
  const nowIso = now.toISOString()

  const { data, error } = await supabase
    .from('push_delivery_attempts')
    .select('id, ticket_id, push_token_id, status, ticket_created_at, receipt_check_count')
    .in('status', ['TICKET_ACCEPTED', 'RECEIPT_PENDING'])
    .not('ticket_id', 'is', null)
    .lte('next_check_at', nowIso)
    .order('next_check_at', { ascending: true })
    .limit(limit)

  if (error) {
    log('error', FN, 'receipts.load_failed', { error: error.message })
    return jsonResponse({ ok: false, error: 'Could not load due push receipts.' }, 500, cors)
  }

  const attempts = (Array.isArray(data) ? data : []) as PushAttemptRow[]
  if (attempts.length === 0) {
    return jsonResponse({ ok: true, checked: 0, pending: 0, accepted: 0, errors: 0 }, 200, cors)
  }

  let providerResponse: Response
  try {
    providerResponse = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: attempts.map((attempt) => attempt.ticket_id) }),
    })
  } catch (fetchError) {
    log('error', FN, 'provider.request_failed', {
      error: fetchError instanceof Error ? fetchError.message : String(fetchError),
      count: attempts.length,
    })
    return jsonResponse({ ok: false, error: 'Expo receipt request failed.' }, 502, cors)
  }

  if (!providerResponse.ok) {
    const responseBody = (await providerResponse.text().catch(() => '')).slice(0, 500)
    log('error', FN, 'provider.http_error', {
      status: providerResponse.status,
      response: responseBody,
      count: attempts.length,
    })
    return jsonResponse({ ok: false, error: `Expo receipt request returned ${providerResponse.status}.` }, 502, cors)
  }

  const providerJson = await providerResponse.json().catch(() => ({})) as {
    data?: Record<string, unknown>
  }
  const receipts = providerJson.data && typeof providerJson.data === 'object'
    ? providerJson.data
    : {}
  const counts = { pending: 0, accepted: 0, errors: 0, expired: 0, updateFailures: 0 }
  const providerErrorCodes = new Set<string>()

  for (const attempt of attempts) {
    const outcome = classifyExpoPushReceipt(receipts[attempt.ticket_id])
    const receiptCheckCount = Math.max(0, attempt.receipt_check_count ?? 0) + 1
    const ticketAgeMs = now.getTime() - new Date(attempt.ticket_created_at).getTime()

    if (outcome.kind === 'pending') {
      const expired = Number.isFinite(ticketAgeMs) && ticketAgeMs >= RECEIPT_EXPIRY_MS
      const { error: updateError } = await supabase
        .from('push_delivery_attempts')
        .update({
          status: expired ? 'RECEIPT_EXPIRED' : 'RECEIPT_PENDING',
          receipt_check_count: receiptCheckCount,
          receipt_checked_at: nowIso,
          next_check_at: expired ? null : nextReceiptCheckAt(receiptCheckCount),
          error_code: expired ? 'RECEIPT_NOT_AVAILABLE' : null,
          error_message: expired
            ? 'Expo did not return a receipt within the reconciliation window.'
            : null,
          updated_at: nowIso,
        })
        .eq('id', attempt.id)
      if (updateError) {
        counts.updateFailures += 1
        log('error', FN, 'receipt.update_failed', { attempt_id: attempt.id, error: updateError.message })
      } else if (expired) {
        counts.expired += 1
      } else {
        counts.pending += 1
      }
      continue
    }

    if (outcome.kind === 'provider-accepted') {
      const { error: updateError } = await supabase
        .from('push_delivery_attempts')
        .update({
          status: 'PROVIDER_ACCEPTED',
          receipt_check_count: receiptCheckCount,
          receipt_checked_at: nowIso,
          provider_accepted_at: nowIso,
          next_check_at: null,
          error_code: null,
          error_message: null,
          updated_at: nowIso,
        })
        .eq('id', attempt.id)
      if (updateError) {
        counts.updateFailures += 1
        log('error', FN, 'receipt.update_failed', { attempt_id: attempt.id, error: updateError.message })
      } else {
        counts.accepted += 1
      }
      continue
    }

    const { error: updateError } = await supabase
      .from('push_delivery_attempts')
      .update({
        status: 'DELIVERY_ERROR',
        receipt_check_count: receiptCheckCount,
        receipt_checked_at: nowIso,
        next_check_at: null,
        error_code: outcome.errorCode.slice(0, 120),
        error_message: outcome.message.slice(0, 500),
        updated_at: nowIso,
      })
      .eq('id', attempt.id)

    if (updateError) {
      counts.updateFailures += 1
      log('error', FN, 'receipt.update_failed', { attempt_id: attempt.id, error: updateError.message })
      continue
    }

    counts.errors += 1
    if (outcome.errorCode === 'DeviceNotRegistered' && attempt.push_token_id) {
      const { error: deleteError } = await supabase
        .from('push_tokens')
        .delete()
        .eq('id', attempt.push_token_id)
      if (deleteError) {
        log('warn', FN, 'stale_token.delete_failed', {
          push_token_id: attempt.push_token_id,
          error: deleteError.message,
        })
      }
    } else {
      providerErrorCodes.add(outcome.errorCode)
    }
  }

  if (providerErrorCodes.size > 0) {
    const codes = Array.from(providerErrorCodes).sort()
    await createOrRefreshOpsIssue(supabase, {
      issueType: 'SYSTEM_ALERT',
      severity: codes.includes('InvalidCredentials') ? 'CRITICAL' : 'HIGH',
      source: FN,
      provider: 'EXPO',
      stage: 'PUSH_RECEIPT',
      title: 'Push provider rejected beta notification deliveries',
      description: `Expo receipts reported delivery errors: ${codes.join(', ')}.`,
      recommendedAction: 'Inspect push_delivery_attempts, verify APNs/FCM credentials, and resend only after the provider configuration is healthy.',
      dedupeKey: `push-receipt-errors:${nowIso.slice(0, 10)}:${codes.join('|')}`,
      metadata: {
        error_codes: codes,
        checked_count: attempts.length,
        delivery_error_count: counts.errors,
      },
      notifyOps: true,
    })
  }

  log(counts.errors > 0 || counts.updateFailures > 0 ? 'warn' : 'info', FN, 'receipts.reconciled', {
    checked: attempts.length,
    ...counts,
  })

  return jsonResponse({
    ok: counts.updateFailures === 0,
    checked: attempts.length,
    ...counts,
  }, counts.updateFailures === 0 ? 200 : 500, cors)
})
