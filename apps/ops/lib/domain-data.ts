import 'server-only'

import { invokeOpsReadBroker, requiresOpsEdgeBroker } from '../../web/lib/ops-edge-broker'
import { createServiceRoleClient } from '../../web/lib/server-supabase'

export type TrustCaseContext = {
  profileId: string
  userId: string
  displayName: string
  email: string | null
  location: string | null
  specialties: string[]
  challengeId: string | null
  challengeText: string | null
  hasChallengeVideo: boolean
  submittedAt: string | null
  reviewStatus: string
  avatarUrl: string | null
  portfolioPhotoUrls: string[]
  portfolioVideoUrls: string[]
  proofItems: Array<{
    id: string
    title: string
    category: string | null
    mediaUrls: string[]
  }>
  payoutAccountVerified: boolean
  payoutProvider: string | null
  payoutCurrency: string | null
}

export type SupportCaseContext = {
  userId: string | null
  requesterName: string | null
  requesterEmail: string | null
  order: null | {
    id: string
    reference: string | null
    stage: string | null
    kind: string | null
    deliveryMethod: string | null
    paymentProvider: string | null
    customerName: string | null
    tailorName: string | null
  }
}

export type MediaSafetyCaseContext = {
  assets: Array<{
    id: string
    kind: string
    publicUrl: string
    posterUrl: string | null
    purpose: string
    status: string
    moderationStatus: string
    riskLevel: string
    reasons: string[]
    createdAt: string
  }>
}

export type PayoutChangeCaseContext = {
  requestId: string
  status: string
  submittedAt: string | null
  lifecycleState: string | null
  confirmationStatus: string | null
  confirmedAt: string | null
  currentDestination: PayoutDestinationContext | null
  requestedDestination: PayoutDestinationContext | null
  accountHolderMatch: boolean | null
  riskSignals: string[]
  moneyRequest: null | {
    id: string
    reference: string
    status: string
    requesterEmail: string
  }
}

type PayoutDestinationContext = {
  provider: string | null
  currency: string | null
  bankName: string | null
  accountName: string | null
  accountMasked: string | null
  countryCode: string | null
  accountVerified: boolean
}

function cleanUrls(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && /^https?:\/\//iu.test(entry.trim())).map((entry) => entry.trim()))].slice(0, 24)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function payoutDestination(value: unknown): PayoutDestinationContext | null {
  const destination = record(value)
  if (Object.keys(destination).length === 0) return null
  return {
    provider: stringValue(destination.payout_provider),
    currency: stringValue(destination.payout_currency),
    bankName: stringValue(destination.payout_bank_name),
    accountName: stringValue(destination.payout_account_name),
    accountMasked: stringValue(destination.payout_account_masked),
    countryCode: stringValue(destination.payout_country_code),
    accountVerified: destination.payout_account_verified === true,
  }
}

function normalizedName(value: string | null) {
  return value?.trim().replace(/\s+/gu, ' ').toUpperCase() ?? ''
}

export async function loadMediaSafetyCaseContext(input: {
  issueId: string
  relatedEntityType: string | null
  relatedEntityId: string | null
  metadata: Record<string, unknown> | null
}): Promise<MediaSafetyCaseContext | null> {
  const client = createServiceRoleClient()
  if (!client) return null
  const metadataIds = Array.isArray(input.metadata?.media_asset_ids)
    ? input.metadata.media_asset_ids.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : []
  const assetIds = [...new Set([
    ...metadataIds,
    input.relatedEntityType === 'media_asset' ? input.relatedEntityId : null,
  ].filter((value): value is string => Boolean(value)))]
  if (assetIds.length === 0) return { assets: [] }

  const { data, error } = await client
    .from('media_assets')
    .select('id,media_kind,public_url,poster_url,purpose,status,moderation_status,moderation_risk_level,moderation_reasons,created_at')
    .in('id', assetIds)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Media safety context is unavailable: ${error.message}`)

  return {
    assets: (data ?? []).flatMap((asset) => {
      const publicUrl = stringValue(asset.public_url)
      if (!publicUrl) return []
      return [{
        id: String(asset.id),
        kind: String(asset.media_kind ?? 'UNKNOWN'),
        publicUrl,
        posterUrl: stringValue(asset.poster_url),
        purpose: String(asset.purpose ?? 'PUBLIC_MEDIA'),
        status: String(asset.status ?? 'UNKNOWN'),
        moderationStatus: String(asset.moderation_status ?? 'PENDING_REVIEW'),
        riskLevel: String(asset.moderation_risk_level ?? 'UNKNOWN'),
        reasons: Array.isArray(asset.moderation_reasons) ? asset.moderation_reasons.map(String) : [],
        createdAt: String(asset.created_at),
      }]
    }),
  }
}

export async function loadPayoutChangeCaseContext(requestId: string): Promise<PayoutChangeCaseContext | null> {
  const client = createServiceRoleClient()
  if (!client || !requestId) return null
  const [changeResult, moneyResult] = await Promise.all([
    client
      .from('payout_change_requests')
      .select('id,status,current_destination,requested_destination,metadata,submitted_at,updated_at')
      .eq('id', requestId)
      .maybeSingle(),
    client
      .from('money_desk_requests')
      .select('id,reference,status,requester_email')
      .eq('action_type', 'PAYOUT_DESTINATION_CHANGE')
      .eq('target_type', 'PAYOUT_CHANGE_REQUEST')
      .eq('target_id', requestId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (changeResult.error) throw new Error(`Payout change context is unavailable: ${changeResult.error.message}`)
  if (moneyResult.error) throw new Error(`Money Desk context is unavailable: ${moneyResult.error.message}`)
  const change = changeResult.data
  if (!change?.id) return null
  const current = payoutDestination(change.current_destination)
  const requested = payoutDestination(change.requested_destination)
  const currentName = normalizedName(current?.accountName ?? null)
  const requestedName = normalizedName(requested?.accountName ?? null)
  const accountHolderMatch = currentName && requestedName ? currentName === requestedName : null
  const riskSignals: string[] = []
  if (current?.provider !== requested?.provider) riskSignals.push('Provider changed')
  if (current?.currency !== requested?.currency) riskSignals.push('Currency changed')
  if (current?.bankName !== requested?.bankName) riskSignals.push('Bank changed')
  if (current?.accountMasked !== requested?.accountMasked) riskSignals.push('Account changed')
  if (accountHolderMatch === false) riskSignals.push('Account holder name changed')
  if (requested?.accountVerified !== true) riskSignals.push('Provider verification incomplete')
  const metadata = record(change.metadata)
  const moneyRequest = moneyResult.data

  return {
    requestId: String(change.id),
    status: String(change.status),
    submittedAt: stringValue(change.submitted_at) ?? stringValue(change.updated_at),
    lifecycleState: stringValue(metadata.lifecycle_state),
    confirmationStatus: stringValue(metadata.confirmation_status),
    confirmedAt: stringValue(metadata.confirmed_at),
    currentDestination: current,
    requestedDestination: requested,
    accountHolderMatch,
    riskSignals,
    moneyRequest: moneyRequest?.id ? {
      id: String(moneyRequest.id),
      reference: String(moneyRequest.reference),
      status: String(moneyRequest.status),
      requesterEmail: String(moneyRequest.requester_email),
    } : null,
  }
}

export async function loadTrustCaseContext(input: { tailorProfileId: string | null; userId: string | null }): Promise<TrustCaseContext | null> {
  if (requiresOpsEdgeBroker()) return invokeOpsReadBroker<TrustCaseContext | null>('trust-case', input)
  const client = createServiceRoleClient()
  if (!client || (!input.tailorProfileId && !input.userId)) return null

  let query = client
    .from('tailor_profiles')
    .select('id,user_id,display_name,location,specialty_tags,trust_verification_video_path,trust_verification_challenge_id,trust_verification_challenge_text,avatar_url,portfolio_photo_urls,portfolio_video_urls,id_verification_status,id_verification_submitted_at,payout_account_verified,payout_provider,payout_currency')
  query = input.tailorProfileId ? query.eq('id', input.tailorProfileId) : query.eq('user_id', input.userId as string)
  const { data: profile, error: profileError } = await query.maybeSingle()
  if (profileError) throw new Error(`Trust profile context is unavailable: ${profileError.message}`)
  if (!profile?.id || !profile.user_id) return null

  const [userResult, proofResult] = await Promise.all([
    client.from('users').select('id,email,display_name').eq('id', profile.user_id).maybeSingle(),
    client
      .from('seller_items')
      .select('id,title,category,photo_urls')
      .eq('tailor_profile_id', profile.id)
      .eq('is_live', false)
      .order('updated_at', { ascending: false })
      .limit(8),
  ])
  if (userResult.error) throw new Error(`Trust account context is unavailable: ${userResult.error.message}`)
  if (proofResult.error) throw new Error(`Trust proof context is unavailable: ${proofResult.error.message}`)

  return {
    profileId: String(profile.id),
    userId: String(profile.user_id),
    displayName: String(profile.display_name ?? userResult.data?.display_name ?? 'Tailor'),
    email: typeof userResult.data?.email === 'string' ? userResult.data.email : null,
    location: typeof profile.location === 'string' ? profile.location : null,
    specialties: Array.isArray(profile.specialty_tags) ? profile.specialty_tags.map(String) : [],
    challengeId: typeof profile.trust_verification_challenge_id === 'string' ? profile.trust_verification_challenge_id : null,
    challengeText: typeof profile.trust_verification_challenge_text === 'string' ? profile.trust_verification_challenge_text : null,
    hasChallengeVideo: typeof profile.trust_verification_video_path === 'string' && profile.trust_verification_video_path.trim().length > 0,
    submittedAt: typeof profile.id_verification_submitted_at === 'string' ? profile.id_verification_submitted_at : null,
    reviewStatus: String(profile.id_verification_status ?? 'NOT_SUBMITTED'),
    avatarUrl: typeof profile.avatar_url === 'string' ? profile.avatar_url : null,
    portfolioPhotoUrls: cleanUrls(profile.portfolio_photo_urls),
    portfolioVideoUrls: cleanUrls(profile.portfolio_video_urls),
    proofItems: (proofResult.data ?? []).map((item) => ({
      id: String(item.id),
      title: String(item.title ?? 'Portfolio proof'),
      category: typeof item.category === 'string' ? item.category : null,
      mediaUrls: cleanUrls(item.photo_urls),
    })),
    payoutAccountVerified: profile.payout_account_verified === true,
    payoutProvider: typeof profile.payout_provider === 'string' ? profile.payout_provider : null,
    payoutCurrency: typeof profile.payout_currency === 'string' ? profile.payout_currency : null,
  }
}

export async function loadSupportCaseContext(input: { userId: string | null; orderId: string | null }): Promise<SupportCaseContext | null> {
  if (requiresOpsEdgeBroker()) return invokeOpsReadBroker<SupportCaseContext | null>('support-case', input)
  const client = createServiceRoleClient()
  if (!client || (!input.userId && !input.orderId)) return null

  const orderResult = input.orderId
    ? await client
      .from('orders')
      .select('id,reference,stage,order_kind,delivery_method,payment_provider,customer_id,tailor_id')
      .eq('id', input.orderId)
      .maybeSingle()
    : { data: null, error: null }
  if (orderResult.error) throw new Error(`Support order context is unavailable: ${orderResult.error.message}`)

  const relatedUserIds = [...new Set([
    input.userId,
    orderResult.data?.customer_id,
    orderResult.data?.tailor_id,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0))]
  const userResult = relatedUserIds.length > 0
    ? await client.from('users').select('id,email,display_name').in('id', relatedUserIds)
    : { data: [], error: null }
  if (userResult.error) throw new Error(`Support participant context is unavailable: ${userResult.error.message}`)
  const users = new Map((userResult.data ?? []).map((user) => [String(user.id), user]))
  const requester = input.userId ? users.get(input.userId) : null
  const customer = orderResult.data?.customer_id ? users.get(String(orderResult.data.customer_id)) : null
  const tailor = orderResult.data?.tailor_id ? users.get(String(orderResult.data.tailor_id)) : null

  return {
    userId: input.userId,
    requesterName: typeof requester?.display_name === 'string' ? requester.display_name : null,
    requesterEmail: typeof requester?.email === 'string' ? requester.email : null,
    order: orderResult.data ? {
      id: String(orderResult.data.id),
      reference: typeof orderResult.data.reference === 'string' ? orderResult.data.reference : null,
      stage: typeof orderResult.data.stage === 'string' ? orderResult.data.stage : null,
      kind: typeof orderResult.data.order_kind === 'string' ? orderResult.data.order_kind : null,
      deliveryMethod: typeof orderResult.data.delivery_method === 'string' ? orderResult.data.delivery_method : null,
      paymentProvider: typeof orderResult.data.payment_provider === 'string' ? orderResult.data.payment_provider : null,
      customerName: typeof customer?.display_name === 'string' ? customer.display_name : null,
      tailorName: typeof tailor?.display_name === 'string' ? tailor.display_name : null,
    } : null,
  }
}
