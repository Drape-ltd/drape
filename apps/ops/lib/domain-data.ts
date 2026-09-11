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

function cleanUrls(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && /^https?:\/\//iu.test(entry.trim())).map((entry) => entry.trim()))].slice(0, 24)
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
