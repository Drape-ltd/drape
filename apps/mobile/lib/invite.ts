/**
 * Drapeon invite / referral utilities
 *
 * Customer referral: https://drape.app/join?ref={userId}
 * Tailor profile share: https://drape.app/tailor/{tailorProfileId}
 */
import { Share, Alert } from 'react-native'
import { invokeFunction } from './supabase'

const BASE_URL = 'https://drape.app'

async function openShareSheet(message: string, title: string) {
  try {
    await Share.share({ message, title })
  } catch {
    Alert.alert('Unable to share', 'Sharing is unavailable right now. Retry in a moment, or come back to this screen later and try again.')
  }
}

function ensureValue(value: string, fallbackMessage: string) {
  if (!value.trim()) {
    Alert.alert('Unable to share', fallbackMessage)
    return false
  }
  return true
}

/**
 * Customer invites another person to join Drapeon.
 * The referral code is the customer's user ID.
 */
export async function shareCustomerReferral(userId: string, displayName: string) {
  if (!ensureValue(userId, 'Your referral link is not ready yet. Retry from Profile in a moment.')) return
  let link = `${BASE_URL}/join?ref=${userId}`
  try {
    const { data, error } = await invokeFunction<{ referralCode?: string }>('referral-action', {
      body: { action: 'create-link', source: 'CUSTOMER_PROFILE' },
    })
    if (!error && data?.referralCode) {
      link = `${BASE_URL}/referral/${data.referralCode}`
    }
  } catch {
    // Fall back to the legacy referral link so sharing never dead-ends.
  }
  const intro = displayName.trim() ? `${displayName.trim()} invited you to Drapeon.` : 'I found Drapeon and thought you might like it.'
  const message = `${intro}\n\nGet bespoke clothes made, tailored to your measurements and delivered to you. Join here:\n\n${link}`
  await openShareSheet(message, 'Join me on Drapeon')
}

/**
 * Tailor shares their public profile link with a potential customer.
 */
export async function shareTailorProfile(tailorProfileId: string, tailorName: string) {
  if (!ensureValue(tailorProfileId, 'This profile is not ready to share yet. Refresh your storefront and try again.')) return
  const link = `${BASE_URL}/tailor/${tailorProfileId}`
  const message = `Check out ${tailorName} on Drapeon, a marketplace for bespoke tailoring. Book a custom garment here:\n\n${link}`
  await openShareSheet(message, `${tailorName || 'Tailor'} on Drapeon`)
}

/**
 * Customer refers another customer to a specific tailor they've worked with.
 */
export async function referToTailor(tailorProfileId: string, tailorName: string, referrerId: string) {
  if (!ensureValue(tailorProfileId, 'This tailor link is not ready yet. Retry from the tailor profile in a moment.')) return
  if (!ensureValue(referrerId, 'Your referral link is not ready yet. Retry from Profile in a moment.')) return
  const link = `${BASE_URL}/tailor/${tailorProfileId}?ref=${referrerId}`
  const message = `I've had great work done by ${tailorName} on Drapeon. If you're looking for a tailor, check them out here:\n\n${link}`
  await openShareSheet(message, `Refer ${tailorName || 'tailor'}`)
}

/**
 * Customer shares a general "discover tailors" link — for recommending tailors to someone
 * without needing to pick a specific tailor.
 */
export async function shareDiscoverTailors(userId: string) {
  if (!ensureValue(userId, 'Your referral link is not ready yet. Retry from Profile in a moment.')) return
  let link = `${BASE_URL}/explore?ref=${userId}`
  try {
    const { data, error } = await invokeFunction<{ referralCode?: string }>('referral-action', {
      body: { action: 'create-link', source: 'EXPLORE_SHARE' },
    })
    if (!error && data?.referralCode) {
      link = `${BASE_URL}/referral/${data.referralCode}`
    }
  } catch {
    // Fall back to the legacy referral link so discovery sharing still works.
  }
  const message = `I've been finding amazing tailors on Drapeon, with bespoke garments made to your exact measurements. Check them out:\n\n${link}`
  await openShareSheet(message, 'Find a tailor on Drapeon')
}

export async function shareGroupOrderInvite(inviteCode: string, memberName: string, orderReference: string) {
  if (!ensureValue(inviteCode, 'This group invite is not ready yet. Reopen the order and try again.')) return
  const link = `${BASE_URL}/group-invite/${inviteCode}`
  const message = `You've been added to a Drapeon group order${orderReference ? ` #${orderReference}` : ''}${memberName ? ` as ${memberName}` : ''}.\n\nAccept the invite and attach your measurement profile here:\n\n${link}`
  await openShareSheet(message, 'Drapeon group order invite')
}

/**
 * Tailor invites a fellow tailor to join Drapeon.
 */
export async function inviteTailorColleague(tailorId: string, tailorName: string) {
  if (!ensureValue(tailorId, 'Your invite link is not ready yet. Retry from Profile in a moment.')) return
  const link = `${BASE_URL}/join/tailor?ref=${tailorId}`
  const message = `Hey! I've been using Drapeon for my tailoring business. It connects tailors with customers looking for bespoke pieces. Worth checking out:\n\n${link}`
  await openShareSheet(message, `Join ${tailorName || 'me'} on Drapeon`)
}

/**
 * Tailor invites an offline client to claim their Client Passport.
 * The passport contains measurements the tailor has already saved.
 */
export async function sharePassportInvite(passportId: string, clientName: string, tailorName: string) {
  if (!ensureValue(passportId, 'This passport invite is not ready yet. Open the client passport again and retry in a moment.')) return
  const link = `${BASE_URL}/passport/claim/${passportId}`
  const message = `Hi ${clientName}, your measurements are already saved with ${tailorName} on Drapeon. Claim your measurement passport to manage your outfits and place orders online:\n\n${link}`
  await openShareSheet(message, 'Your measurements are ready on Drapeon')
}

/**
 * Tailor invites a potential customer by sharing their profile.
 */
export async function inviteCustomerFromTailor(tailorProfileId: string, tailorName: string) {
  if (!ensureValue(tailorProfileId, 'Your profile is not ready to share yet. Refresh your storefront and try again.')) return
  const link = `${BASE_URL}/tailor/${tailorProfileId}`
  const message = `I make bespoke garments through Drapeon. If you're looking for a tailor, you can book me here:\n\n${link}`
  await openShareSheet(message, `Book ${tailorName || 'this tailor'} on Drapeon`)
}
