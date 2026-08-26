import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createPaystackTransfer, finalizePaystackTransfer, resendPaystackTransferOtp, verifyPaystackTransfer } from '../_shared/paystack.ts'
import { Sentry } from '../_shared/sentry.ts'
import { createStripeTransfer } from '../_shared/stripe.ts'
import { completeTipPayout, holdTipPayout, type ReleasableTip } from '../_shared/tip-payout.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'release-order-tip'
const Body = z.object({
  tipId: uuid,
  action: z.enum(['RELEASE', 'FINALIZE_PAYSTACK_OTP', 'RESEND_PAYSTACK_OTP']).optional(),
  otp: z.string().trim().min(4).max(12).optional(),
})
const json = (body: unknown, status: number, cors: HeadersInit) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  let tipId: string | null = null
  let payoutId: string | null = null
  let tipRecord: ReleasableTip | null = null
  let requestedAction: 'RELEASE' | 'FINALIZE_PAYSTACK_OTP' | 'RESEND_PAYSTACK_OTP' = 'RELEASE'
  try {
    const unauthorized = await authorizeCronRequest(req, FN, cors)
    if (unauthorized) return unauthorized
    const parsed = parseBody(Body, await req.json().catch(() => ({})))
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400, cors)
    tipId = parsed.data.tipId
    requestedAction = parsed.data.action ?? 'RELEASE'
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const { data: tip, error: tipError } = await supabase.from('order_tips')
      .select('id,order_id,customer_id,tailor_id,amount,currency,status,payment_id,correlation_id,ledger_transaction_id,payout_id,payout_provider_reference')
      .eq('id', tipId).maybeSingle()
    if (tipError) throw tipError
    if (!tip) return json({ ok: false, error: 'Tip was not found.' }, 404, cors)
    tipRecord = tip as ReleasableTip
    if (parsed.data.action === 'FINALIZE_PAYSTACK_OTP' || parsed.data.action === 'RESEND_PAYSTACK_OTP') {
      if ((parsed.data.action === 'FINALIZE_PAYSTACK_OTP' && !parsed.data.otp) || !['PROCESSING', 'PAID_OUT'].includes(tip.status) || !tip.payout_id) {
        return json({ ok: false, error: 'This tip payout is not awaiting Paystack approval.' }, 409, cors)
      }
      const { data: payout, error: payoutError } = await supabase.from('payouts')
        .select('id,provider,status,provider_response')
        .eq('id', tip.payout_id)
        .maybeSingle()
      if (payoutError) throw payoutError
      const providerResponse = payout?.provider_response && typeof payout.provider_response === 'object'
        ? payout.provider_response as Record<string, unknown>
        : {}
      const transfer = providerResponse.transfer && typeof providerResponse.transfer === 'object'
        ? providerResponse.transfer as Record<string, unknown>
        : providerResponse
      let transferCode = typeof transfer.transfer_code === 'string' ? transfer.transfer_code.trim() : ''
      let verifiedTransfer: Record<string, unknown> | null = null
      if ((!transferCode || parsed.data.action === 'RESEND_PAYSTACK_OTP') && tip.payout_provider_reference) {
        verifiedTransfer = await verifyPaystackTransfer(tip.payout_provider_reference) as Record<string, unknown>
        transferCode = typeof verifiedTransfer.transfer_code === 'string' ? verifiedTransfer.transfer_code.trim() : ''
      }
      if (!payout?.id || payout.provider !== 'PAYSTACK' || !['PROCESSING', 'PAID'].includes(payout.status) || !transferCode) {
        return json({ ok: false, error: 'Paystack transfer approval details are unavailable.' }, 409, cors)
      }
      if (parsed.data.action === 'RESEND_PAYSTACK_OTP') {
        const verifiedStatus = String(verifiedTransfer?.status ?? transfer.status ?? '').trim().toLowerCase()
        if (verifiedStatus !== 'otp') {
          return json({ ok: false, error: `This transfer is ${verifiedStatus || 'not awaiting OTP'} and cannot receive another OTP.` }, 409, cors)
        }
        await resendPaystackTransferOtp(transferCode)
        const now = new Date().toISOString()
        await supabase.from('payouts').update({
          status: 'PROCESSING',
          provider_transfer_status: 'PROCESSING',
          bank_settlement_status: 'PENDING',
          provider_response: {
            ...providerResponse,
            ...(verifiedTransfer ? { verified_transfer: verifiedTransfer } : {}),
            otp_resent_at: now,
          },
        }).eq('id', payout.id)
        if (tip.status === 'PAID_OUT') {
          const { data: correctedTip, error: correctionError } = await supabase.from('order_tips').update({
            status: 'PROCESSING',
            paid_out_at: null,
            failure_reason: null,
            updated_at: now,
          }).eq('id', tip.id).eq('status', 'PAID_OUT').select('id').maybeSingle()
          if (correctionError) throw correctionError
          if (correctedTip?.id) {
            await supabase.from('order_tip_events').insert({
              tip_id: tip.id,
              event_type: 'TIP_PAYOUT_STATE_CORRECTED',
              actor_role: 'SYSTEM',
              payload: { payout_id: payout.id, from: 'PAID_OUT', to: 'PROCESSING', reason: 'PROVIDER_OTP_NOT_TERMINAL' },
              correlation_id: tip.correlation_id,
            })
            await audit(supabase, {
              event: 'tip.payout_state_corrected',
              actor_role: 'SYSTEM',
              order_id: tip.order_id,
              severity: 'warn',
              payload: { function: FN, tip_id: tip.id, payout_id: payout.id, provider_status: verifiedStatus, correlation_id: tip.correlation_id },
            })
          }
        }
        return json({ ok: true, pending: true, otpResent: true, tipId: tip.id, payoutId: payout.id }, 202, cors)
      }
      const finalized = await finalizePaystackTransfer({ transferCode, otp: parsed.data.otp! })
      const providerReference = finalized.reference ?? finalized.transfer_code ?? transferCode
      const finalProviderResponse = {
        ...providerResponse,
        ...(verifiedTransfer ? { verified_transfer: verifiedTransfer } : {}),
        transfer: finalized,
        otp_finalized_at: new Date().toISOString(),
      }
      if (finalized.status !== 'success') {
        await supabase.from('payouts').update({
          status: 'PROCESSING',
          provider_transfer_status: 'PROCESSING',
          bank_settlement_status: 'PENDING',
          provider_payout_id: providerReference,
          provider_response: finalProviderResponse,
        }).eq('id', payout.id)
        return json({ ok: true, pending: true, tipId: tip.id, payoutId: payout.id, providerReference, providerStatus: finalized.status ?? 'processing' }, 202, cors)
      }
      const completed = await completeTipPayout(supabase, {
        tip: tipRecord,
        payoutId: payout.id,
        provider: 'PAYSTACK',
        providerReference,
        providerResponse: finalProviderResponse,
      })
      return json({ ok: true, tipId: tip.id, payoutId: payout.id, providerReference, ledgerTransactionId: completed.ledgerTransactionId }, 200, cors)
    }

    if (tip.status === 'PAID_OUT') return json({ ok: true, existing: true, tipId: tip.id, payoutId: tip.payout_id, providerReference: tip.payout_provider_reference }, 200, cors)

    if (tip.status !== 'PAYOUT_PENDING') return json({ ok: false, error: 'Only captured tips can be released.' }, 409, cors)
    const { data: profile } = await supabase.from('tailor_profiles')
      .select('id,payout_account_verified,payout_reverification_required,paystack_recipient_code,stripe_connect_account_id')
      .eq('user_id', tip.tailor_id).maybeSingle()
    if (!profile?.id || profile.payout_account_verified !== true || profile.payout_reverification_required === true) return json({ ok: false, error: 'Tailor payout account is not verified.' }, 409, cors)
    const provider = tip.currency === 'NGN' ? 'PAYSTACK' : 'STRIPE'
    if (provider === 'PAYSTACK' && !profile.paystack_recipient_code) return json({ ok: false, error: 'Paystack recipient is missing.' }, 409, cors)
    if (provider === 'STRIPE' && !profile.stripe_connect_account_id) return json({ ok: false, error: 'Stripe Connect account is missing.' }, 409, cors)
    const { data: payout, error: payoutError } = await supabase.from('payouts').insert({
      tailor_profile_id: profile.id, order_id: tip.order_id, amount: tip.amount, currency: tip.currency,
      provider, status: 'PROCESSING', payout_purpose: 'TIP', source_payment_id: tip.payment_id, provider_response: { function: FN, tip_id: tip.id },
      provider_transfer_status: 'PROCESSING', bank_settlement_status: provider === 'STRIPE' ? 'PENDING' : 'NOT_APPLICABLE',
      provider_destination_id: provider === 'STRIPE' ? profile.stripe_connect_account_id : profile.paystack_recipient_code,
    }).select('id').single()
    if (payoutError) throw payoutError
    payoutId = payout.id
    let providerReference: string
    let providerResponse: Record<string, unknown>
    if (provider === 'PAYSTACK') {
      const transfer = await createPaystackTransfer({ amount: tip.amount, recipientCode: profile.paystack_recipient_code!, reason: 'Drapeon customer tip', reference: `DRAPE-TIP-PAYOUT-${tip.id}`, currency: tip.currency })
      providerReference = transfer.reference ?? transfer.transfer_code ?? `DRAPE-TIP-PAYOUT-${tip.id}`
      providerResponse = { function: FN, tip_id: tip.id, transfer }
      const providerStatus = String(transfer.status ?? '').trim().toLowerCase()
      await supabase.from('payouts').update({
        status: providerStatus === 'success' ? 'PAID' : 'PROCESSING',
        provider_payout_id: providerReference,
        provider_transfer_status: providerStatus === 'success' ? 'PAID_TO_BANK' : 'PROCESSING',
        bank_settlement_status: providerStatus === 'success' ? 'PAID' : 'PENDING',
        provider_response: providerResponse,
      }).eq('id', payout.id)
      if (providerStatus !== 'success') {
        const now = new Date().toISOString()
        await supabase.from('order_tips').update({
          status: 'PROCESSING',
          payout_id: payout.id,
          payout_provider_reference: providerReference,
          updated_at: now,
        }).eq('id', tip.id).eq('status', 'PAYOUT_PENDING')
        await supabase.from('order_tip_events').insert({
          tip_id: tip.id,
          event_type: 'TIP_PAYOUT_PROCESSING',
          actor_role: 'SYSTEM',
          payload: { payout_id: payout.id, provider, provider_reference: providerReference, provider_status: providerStatus || 'processing', requires_otp: providerStatus === 'otp' },
          correlation_id: tip.correlation_id,
        })
        return json({ ok: true, pending: true, requiresOtp: providerStatus === 'otp', tipId: tip.id, payoutId: payout.id, providerReference, providerStatus: providerStatus || 'processing' }, 202, cors)
      }
    } else {
      const transfer = await createStripeTransfer({ amount: tip.amount, currency: tip.currency, destinationAccountId: profile.stripe_connect_account_id!, idempotencyKey: `DRAPE-TIP-PAYOUT-${tip.id}`, transferGroup: `order:${tip.order_id}`, metadata: { order_id: tip.order_id, tip_id: tip.id, payout_id: payout.id } })
      providerReference = transfer.id
      providerResponse = { function: FN, tip_id: tip.id, transfer }
    }
    const completed = await completeTipPayout(supabase, {
      tip: tipRecord,
      payoutId: payout.id,
      provider,
      providerReference,
      providerResponse,
    })
    return json({ ok: true, tipId: tip.id, payoutId: payout.id, providerReference, ledgerTransactionId: completed.ledgerTransactionId }, 200, cors)
  } catch (error) {
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const failure = error instanceof Error ? error.message : String(error)
    if (tipRecord && requestedAction === 'RELEASE') {
      await holdTipPayout(supabase, { tip: tipRecord, payoutId, failure })
    }
    await Sentry.captureMessage('Order tip release failed', { level: 'error', tags: { function: FN, failure_class: 'tip_release' }, extra: { tip_id: tipId, payout_id: payoutId, error: error instanceof Error ? error.message : String(error) } })
    log('error', FN, 'failed', { tip_id: tipId, payout_id: payoutId, error: error instanceof Error ? error.message : String(error) })
    return json({ ok: false, error: error instanceof Error ? error.message : 'Tip payout failed.' }, 500, cors)
  }
})
