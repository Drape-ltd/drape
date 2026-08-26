import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { normalizeAccountCurrency, resolvePaymentProviderForCurrency } from '../../../packages/shared/src/currency-config.ts'
import { createPaystackTransfer } from './paystack.ts'
import { createStripeTransfer } from './stripe.ts'
import { createOrRefreshOpsIssue, resolveOpsIssueByDedupeKey } from './ops-issues.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from './side-effect-jobs.ts'
import { Sentry } from './sentry.ts'

const SOURCE = 'fabric-release-v2'

function releaseReference(candidateId: string) {
  return `DRAPE-FABRIC-V2-${candidateId}`
}

export async function enqueueFabricReleaseOutcomeSideEffects(
  supabase: SupabaseClient,
  input: {
    candidateId: string
    outcome: 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS'
    blockerCode?: string | null
  },
) {
  const candidateResult = await supabase.from('order_fabric_candidates')
    .select('id,order_id,tailor_id,customer_id,component_code,customer_media')
    .eq('id', input.candidateId).single()
  if (candidateResult.error) throw candidateResult.error
  const candidate = candidateResult.data
  const orderResult = await supabase.from('orders')
    .select('id,reference,stage,customer_id,tailor_id')
    .eq('id', candidate.order_id).single()
  if (orderResult.error) throw orderResult.error
  const order = orderResult.data
  const succeeded = input.outcome === 'SUCCEEDED'
  const ambiguous = input.outcome === 'AMBIGUOUS'
  const component = String(candidate.component_code).toLowerCase().replaceAll('_', ' ')
  const title = succeeded ? 'Fabric funds released' : ambiguous ? 'Fabric release needs review' : 'Fabric release could not complete'
  const tailorBody = succeeded
    ? `Buy the approved ${component}, then upload the supplier receipt and acquired-material proof.`
    : ambiguous
      ? `Drapeon is verifying the ${component} provider outcome. Do not submit another release.`
      : `The ${component} release is blocked${input.blockerCode ? `: ${input.blockerCode.toLowerCase().replaceAll('_', ' ')}` : ''}. Follow the recovery step in the order.`
  const customerBody = succeeded
    ? `The exact approved ${component} amount was released. The receipt and final material proof are still required.`
    : ambiguous
      ? `Drapeon is verifying the ${component} provider outcome. You will not be charged or released twice.`
      : `The approved ${component} release did not complete. The order shows the next recovery step.`
  const deepLink = `/orders/${order.id}?section=fabric&candidateId=${candidate.id}`
  const evidenceArtifact = Array.isArray(candidate.customer_media) ? candidate.customer_media[0] : null
  const evidencePath = evidenceArtifact?.mediaType === 'VIDEO'
    ? evidenceArtifact?.posterStoragePath ?? null
    : evidenceArtifact?.displayStoragePath ?? evidenceArtifact?.originalStoragePath ?? null
  const event = `FABRIC_RELEASE_${input.outcome}`
  await Promise.all([
    enqueuePushJob(supabase, { userId: candidate.tailor_id, orderId: order.id, source: SOURCE,
      idempotencyKey: `${event}:tailor:${candidate.id}`, priority: succeeded ? 20 : 10,
      notification: { title, body: tailorBody, data: { destination: 'ORDER', orderId: order.id, candidateId: candidate.id, href: deepLink } } }),
    enqueuePushJob(supabase, { userId: candidate.customer_id, orderId: order.id, source: SOURCE,
      idempotencyKey: `${event}:customer:${candidate.id}`, priority: succeeded ? 20 : 10,
      notification: { title, body: customerBody, data: { destination: 'ORDER', orderId: order.id, candidateId: candidate.id, href: deepLink } } }),
    enqueueOrderEventEmailJob(supabase, { order, recipientUserId: candidate.tailor_id, audience: 'TAILOR', source: SOURCE,
      idempotencyKey: `${event}:tailor:${candidate.id}`, priority: succeeded ? 20 : 10,
      subject: title, headline: title, body: tailorBody, ctaLabel: 'Open fabric task', action: event,
      evidenceImageUrl: evidencePath, evidenceStorageBucket: evidencePath ? 'commercial-evidence' : null }),
    enqueueOrderEventEmailJob(supabase, { order, recipientUserId: candidate.customer_id, audience: 'CUSTOMER', source: SOURCE,
      idempotencyKey: `${event}:customer:${candidate.id}`, priority: succeeded ? 20 : 10,
      subject: title, headline: title, body: customerBody, ctaLabel: 'View fabric status', action: event,
      evidenceImageUrl: evidencePath, evidenceStorageBucket: evidencePath ? 'commercial-evidence' : null }),
  ])
}

export async function processFabricCandidateRelease(
  supabase: SupabaseClient,
  candidateId: string,
) {
  const candidateResult = await supabase.from('order_fabric_candidates')
    .select('id,order_id,tailor_id,customer_id,component_code,supplier_cost_amount,currency,status,provider_status,correlation_id,payout_id,customer_media')
    .eq('id', candidateId).maybeSingle()
  if (candidateResult.error) throw candidateResult.error
  const candidate = candidateResult.data
  if (!candidate) throw new Error('FABRIC_CANDIDATE_NOT_FOUND')
  if (candidate.provider_status === 'SUCCEEDED') return { duplicate: true, candidate }
  if (!['RELEASE_QUEUED', 'RELEASE_PROCESSING', 'RELEASE_BLOCKED'].includes(candidate.status)) {
    throw new Error('FABRIC_RELEASE_NOT_READY')
  }

  const [orderResult, profileResult] = await Promise.all([
    supabase.from('orders').select('id,reference,stage,customer_id,tailor_id').eq('id', candidate.order_id).single(),
    supabase.from('tailor_profiles')
      .select('id,user_id,payout_account_verified,payout_reverification_required,paystack_recipient_code,stripe_connect_account_id')
      .eq('user_id', candidate.tailor_id).maybeSingle(),
  ])
  if (orderResult.error) throw orderResult.error
  if (profileResult.error) throw profileResult.error
  const order = orderResult.data
  const profile = profileResult.data
  const currency = normalizeAccountCurrency(candidate.currency)
  const provider = currency ? resolvePaymentProviderForCurrency(currency) : null
  const destination = provider === 'PAYSTACK'
    ? profile?.paystack_recipient_code?.trim()
    : profile?.stripe_connect_account_id?.trim()
  const preflightCode = !profile?.payout_account_verified || profile.payout_reverification_required
    ? 'TAILOR_PAYOUT_NOT_VERIFIED'
    : !provider || !destination ? 'PAYOUT_DESTINATION_MISSING' : null

  if (preflightCode) {
    await supabase.rpc('record_fabric_candidate_release_outcome_v2', {
      p_candidate_id: candidate.id,
      p_payout_id: candidate.payout_id ?? `blocked:${candidate.id}`,
      p_provider: provider ?? 'UNKNOWN',
      p_provider_reference: releaseReference(candidate.id),
      p_outcome: 'FAILED',
      p_provider_response: { code: preflightCode },
    })
    await createOrRefreshOpsIssue(supabase, {
      issueType: 'PAYOUT_BLOCKED', severity: 'HIGH', source: SOURCE,
      actorId: candidate.tailor_id, actorRole: 'TAILOR', orderId: order.id,
      userId: candidate.tailor_id, tailorProfileId: profile?.id ?? null,
      relatedEntityType: 'FABRIC_CANDIDATE', relatedEntityId: candidate.id,
      provider, stage: order.stage, title: 'Fabric-fund release is blocked',
      description: `The exact ${candidate.component_code.toLowerCase()} release could not start: ${preflightCode}.`,
      recommendedAction: 'Restore the verified payout destination, then safely retry this exact candidate release.',
      dedupeKey: `fabric-candidate:release:${candidate.id}`,
      metadata: { candidateId: candidate.id, correlationId: candidate.correlation_id, blockerCode: preflightCode },
    })
    await enqueueFabricReleaseOutcomeSideEffects(supabase, {
      candidateId: candidate.id,
      outcome: 'FAILED',
      blockerCode: preflightCode,
    })
    throw new Error(preflightCode)
  }

  await supabase.from('order_fabric_candidates').update({ status: 'RELEASE_PROCESSING' }).eq('id', candidate.id)
  let payoutResult = await supabase.from('payouts').select('id,status,provider_payout_id')
    .eq('fabric_candidate_id', candidate.id).maybeSingle()
  if (payoutResult.error) throw payoutResult.error
  let payout = payoutResult.data
  if (!payout) {
    const inserted = await supabase.from('payouts').insert({
      tailor_profile_id: profile!.id, order_id: order.id, fabric_candidate_id: candidate.id,
      amount: candidate.supplier_cost_amount, currency, provider, status: 'PROCESSING', payout_purpose: 'FABRIC_RELEASE',
      provider_payout_id: provider === 'PAYSTACK' ? releaseReference(candidate.id) : null,
      provider_response: { source: SOURCE, policyVersion: 'fabric-funding-2026-08-21-v2', correlationId: candidate.correlation_id },
    }).select('id,status,provider_payout_id').single()
    if (inserted.error) throw inserted.error
    payout = inserted.data
  }

  try {
    let providerReference = payout.provider_payout_id || releaseReference(candidate.id)
    let providerResponse: Record<string, unknown>
    let terminal = false
    if (provider === 'PAYSTACK') {
      const transfer = await createPaystackTransfer({
        amount: candidate.supplier_cost_amount, recipientCode: destination!, currency: currency!,
        reason: `Drapeon approved fabric ${order.reference ?? order.id}`,
        reference: releaseReference(candidate.id),
      })
      providerReference = transfer.reference ?? transfer.transfer_code ?? providerReference
      providerResponse = transfer as unknown as Record<string, unknown>
      terminal = String(transfer.status ?? '').toLowerCase() === 'success'
    } else {
      const transfer = await createStripeTransfer({
        amount: candidate.supplier_cost_amount, currency: currency!, destinationAccountId: destination!,
        idempotencyKey: releaseReference(candidate.id), transferGroup: `order:${order.id}`,
        metadata: { order_id: order.id, fabric_candidate_id: candidate.id, payout_id: payout.id },
      })
      providerReference = transfer.id
      providerResponse = transfer as unknown as Record<string, unknown>
      terminal = true
    }

    await supabase.from('payouts').update({
      provider_payout_id: providerReference, provider_response: providerResponse,
      provider_destination_id: destination,
      provider_transfer_status: terminal ? (provider === 'PAYSTACK' ? 'PAID_TO_BANK' : 'AVAILABLE_IN_PROVIDER_BALANCE') : 'PROCESSING',
      bank_settlement_status: terminal && provider === 'PAYSTACK' ? 'PAID' : 'PENDING',
      status: terminal && provider === 'PAYSTACK' ? 'PAID' : 'PROCESSING',
      completed_at: terminal && provider === 'PAYSTACK' ? new Date().toISOString() : null,
    }).eq('id', payout.id)

    if (!terminal) return { pending: true, candidateId: candidate.id, payoutId: payout.id, providerReference }
    const released = await supabase.rpc('record_fabric_candidate_release_outcome_v2', {
      p_candidate_id: candidate.id, p_payout_id: payout.id, p_provider: provider,
      p_provider_reference: providerReference, p_outcome: 'SUCCEEDED', p_provider_response: providerResponse,
    })
    if (released.error) throw released.error
    await resolveOpsIssueByDedupeKey(supabase, `fabric-candidate:release:${candidate.id}`, { providerReference })
    await enqueueFabricReleaseOutcomeSideEffects(supabase, { candidateId: candidate.id, outcome: 'SUCCEEDED' })
    return { pending: false, candidate: released.data, payoutId: payout.id, providerReference }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await supabase.rpc('record_fabric_candidate_release_outcome_v2', {
      p_candidate_id: candidate.id, p_payout_id: payout.id, p_provider: provider,
      p_provider_reference: payout.provider_payout_id ?? releaseReference(candidate.id),
      p_outcome: 'AMBIGUOUS', p_provider_response: { error: message },
    })
    await createOrRefreshOpsIssue(supabase, {
      issueType: 'PAYOUT_FAILED', severity: 'CRITICAL', source: SOURCE,
      actorId: candidate.tailor_id, actorRole: 'SYSTEM', orderId: order.id, userId: candidate.tailor_id,
      tailorProfileId: profile!.id, relatedEntityType: 'FABRIC_CANDIDATE', relatedEntityId: candidate.id,
      provider, stage: order.stage, title: 'Fabric-fund provider outcome is unresolved',
      description: 'Drapeon could not prove the exact fabric release reached a terminal successful outcome.',
      recommendedAction: 'Reconcile this provider reference before retrying. Never create a second release blindly.',
      dedupeKey: `fabric-candidate:release:${candidate.id}`,
      metadata: { candidateId: candidate.id, payoutId: payout.id, correlationId: candidate.correlation_id, error: message },
    })
    await enqueueFabricReleaseOutcomeSideEffects(supabase, { candidateId: candidate.id, outcome: 'AMBIGUOUS' })
    await Sentry.captureMessage('Fabric release requires recovery', { level: 'error', tags: { source: SOURCE, provider: provider! }, extra: { orderId: order.id, candidateId: candidate.id, payoutId: payout.id, correlationId: candidate.correlation_id, error: message } })
    throw error
  }
}
