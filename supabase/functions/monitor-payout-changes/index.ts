import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { enqueueBackgroundJob } from '../_shared/jobs.ts'
import { resolveOpsIssueByDedupeKey } from '../_shared/ops-issues.ts'

const FN = 'monitor-payout-changes'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

async function notice(supabase: any, input: { userId: string; requestId: string; outcome: 'REMINDER' | 'EXPIRED' | 'ACTIVATED'; destination: Record<string, unknown> }) {
  const activated = input.outcome === 'ACTIVATED'
  const reminder = input.outcome === 'REMINDER'
  const title = activated ? 'New payout account active' : reminder ? 'Confirm your payout change' : 'Payout change expired'
  const body = activated
    ? 'Your confirmed, verified replacement is now your active payout account. Eligible earnings can release without an extra payout-account hold.'
    : reminder
      ? 'Your payout change still needs your confirmation. Confirm it before the 48-hour window ends or Drapeon will cancel the request.'
      : 'The payout change was cancelled because it was not confirmed within 48 hours. Your existing payout account remains active.'
  await Promise.all([
    enqueueBackgroundJob(supabase, {
      eventType: `PAYOUT_CHANGE_${input.outcome}`,
      aggregateType: 'PAYOUT_CHANGE_REQUEST', aggregateId: input.requestId,
      actorId: input.userId, actorRole: 'TAILOR',
      idempotencyKey: `payout-change:${input.requestId}:${input.outcome.toLowerCase()}:push`,
      jobType: 'SEND_PUSH', priority: 35,
      payload: {
        userId: input.userId,
        notification: {
          title,
          body,
          data: { url: '/profile/payout-setup', payoutChangeRequestId: input.requestId },
          preferenceKey: 'paymentReleased',
        },
      },
    }),
    enqueueBackgroundJob(supabase, {
      eventType: `PAYOUT_CHANGE_${input.outcome}`,
      aggregateType: 'PAYOUT_CHANGE_REQUEST', aggregateId: input.requestId,
      actorId: input.userId, actorRole: 'TAILOR',
      idempotencyKey: `payout-change:${input.requestId}:${input.outcome.toLowerCase()}:email`,
      jobType: 'SEND_ACCOUNT_EVENT_EMAIL', priority: 35,
      payload: { userId: input.userId, subject: title, eyebrow: 'Payout account update', headline: title, body, ctaLabel: 'View payout account', webPath: '/account/payout', appUrl: 'drape://profile/payout-setup', details: [] },
    }),
  ])
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const unauthorized = await authorizeCronRequest(req, FN, cors)
  if (unauthorized) return unauthorized
  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
  const now = new Date().toISOString()
  const { data, error } = await supabase.from('payout_change_requests')
    .select('id,tailor_user_id,tailor_profile_id,status,current_destination,requested_destination,metadata')
    .eq('status', 'PENDING')
    .limit(100)
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  let activated = 0
  let expired = 0
  let reminded = 0
  for (const row of data ?? []) {
    const metadata = asRecord(row.metadata)
    const lifecycle = typeof metadata.lifecycle_state === 'string' ? metadata.lifecycle_state : 'AWAITING_CONFIRMATION'
    const confirmationExpiresAt = typeof metadata.confirmation_expires_at === 'string' ? metadata.confirmation_expires_at : null
    const reminderDue = confirmationExpiresAt
      && Date.parse(confirmationExpiresAt) - Date.parse(now) <= 12 * 60 * 60 * 1000
      && Date.parse(confirmationExpiresAt) > Date.parse(now)
      && typeof metadata.confirmation_reminder_sent_at !== 'string'
    if (lifecycle === 'AWAITING_CONFIRMATION' && reminderDue) {
      const reminderUpdate = await supabase.from('payout_change_requests')
        .update({ metadata: { ...metadata, confirmation_reminder_sent_at: now }, updated_at: now })
        .eq('id', row.id)
        .eq('status', 'PENDING')
      if (!reminderUpdate.error) {
        reminded += 1
        await notice(supabase, { userId: row.tailor_user_id, requestId: row.id, outcome: 'REMINDER', destination: asRecord(row.requested_destination) })
      }
    }
    if (lifecycle === 'AWAITING_CONFIRMATION' && confirmationExpiresAt && confirmationExpiresAt <= now) {
      const update = await supabase.from('payout_change_requests').update({ status: 'CANCELLED', reviewed_at: now, updated_at: now, metadata: { ...metadata, lifecycle_state: 'EXPIRED', expired_at: now } }).eq('id', row.id).eq('status', 'PENDING')
      if (!update.error) { expired += 1; await notice(supabase, { userId: row.tailor_user_id, requestId: row.id, outcome: 'EXPIRED', destination: asRecord(row.requested_destination) }) }
      continue
    }
    // Backward-compatible cleanup: legacy low-risk requests used SECURITY_HOLD.
    // The current policy activates them on the next monitor pass without waiting.
    if (lifecycle !== 'SECURITY_HOLD' || metadata.auto_activation_eligible !== true) continue
    const destination = asRecord(row.requested_destination)
    const allowedFields = [
      'payout_currency','payout_provider','payout_account_type','payout_account_verified','payout_reverification_required','payout_bank_name','payout_bank_code','payout_account_name','payout_account_masked','payout_country_code','paystack_recipient_code','paystack_account_id','stripe_connect_account_id','stripe_account_id','manual_bank_entry','manual_bank_name','manual_bank_country_code','manual_bank_country_name','manual_bank_swift_bic','manual_bank_account_number','manual_bank_account_name','manual_bank_verification_status','payout_name_match_status','payout_name_match_checked_at','payout_name_match_metadata',
    ]
    const patch = Object.fromEntries(allowedFields.filter((key) => key in destination).map((key) => [key, destination[key]]))
    Object.assign(patch, { payout_account_verified_at: now, payout_account_last_changed_at: now, payout_account_change_locked_until: new Date(Date.parse(now) + 7 * 86400000).toISOString(), payout_destination_hold_until: null })
    const profileUpdate = await supabase.from('tailor_profiles').update(patch).eq('id', row.tailor_profile_id)
    if (profileUpdate.error) continue
    const requestUpdate = await supabase.from('payout_change_requests').update({ status: 'APPROVED', reviewed_at: now, reviewed_by: null, updated_at: now, metadata: { ...metadata, lifecycle_state: 'ACTIVATED', activated_at: now, activation_source: 'LEGACY_LOW_RISK_MIGRATION', hold_until: null } }).eq('id', row.id).eq('status', 'PENDING')
    if (requestUpdate.error) continue
    activated += 1
    await resolveOpsIssueByDedupeKey(supabase, `payout-change:${row.tailor_profile_id}`, { outcome: 'AUTO_ACTIVATED' })
    await notice(supabase, { userId: row.tailor_user_id, requestId: row.id, outcome: 'ACTIVATED', destination })
  }
  return new Response(JSON.stringify({ ok: true, activated, expired, reminded }), { headers: { ...cors, 'Content-Type': 'application/json' } })
})
