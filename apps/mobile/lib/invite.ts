/**
 * Drape invite / referral utilities
 *
 * Customer referral: https://drape.app/join?ref={userId}
 * Tailor profile share: https://drape.app/tailor/{tailorProfileId}
 */
import { Share, Alert } from 'react-native'

const BASE_URL = 'https://drape.app'

/**
 * Customer invites another person to join Drape.
 * The referral code is the customer's user ID.
 */
export async function shareCustomerReferral(userId: string, displayName: string) {
  const link = `${BASE_URL}/join?ref=${userId}`
  const message = `Hey! I've been using Drape to get bespoke clothes made — tailored to your measurements, delivered to you. Join here and let's both get a discount on our next order:\n\n${link}`

  try {
    await Share.share({ message, title: 'Join me on Drape' })
  } catch {
    // User dismissed — do nothing
  }
}

/**
 * Tailor shares their public profile link with a potential customer.
 */
export async function shareTailorProfile(tailorProfileId: string, tailorName: string) {
  const link = `${BASE_URL}/tailor/${tailorProfileId}`
  const message = `Check out ${tailorName} on Drape — a marketplace for bespoke tailoring. Book a custom garment here:\n\n${link}`

  try {
    await Share.share({ message, title: `${tailorName} on Drape` })
  } catch {
    // User dismissed — do nothing
  }
}

/**
 * Customer refers another customer to a specific tailor they've worked with.
 */
export async function referToTailor(tailorProfileId: string, tailorName: string, referrerId: string) {
  const link = `${BASE_URL}/tailor/${tailorProfileId}?ref=${referrerId}`
  const message = `I've had great work done by ${tailorName} on Drape. If you're looking for a tailor, check them out here:\n\n${link}`

  try {
    await Share.share({ message, title: `Refer ${tailorName}` })
  } catch {
    // User dismissed — do nothing
  }
}

/**
 * Customer shares a general "discover tailors" link — for recommending tailors to someone
 * without needing to pick a specific tailor.
 */
export async function shareDiscoverTailors(userId: string) {
  const link = `${BASE_URL}/explore?ref=${userId}`
  const message = `I've been finding amazing tailors on Drape — bespoke garments made to your exact measurements. Check them out:\n\n${link}`

  try {
    await Share.share({ message, title: 'Find a tailor on Drape' })
  } catch {
    // User dismissed — do nothing
  }
}

/**
 * Tailor invites a fellow tailor to join Drape.
 */
export async function inviteTailorColleague(tailorId: string, tailorName: string) {
  const link = `${BASE_URL}/join/tailor?ref=${tailorId}`
  const message = `Hey! I've been using Drape for my tailoring business — it connects tailors with customers looking for bespoke pieces. Worth checking out:\n\n${link}`

  try {
    await Share.share({ message, title: 'Join me on Drape' })
  } catch {
    // User dismissed — do nothing
  }
}

/**
 * Tailor invites an offline client to claim their Client Passport.
 * The passport contains measurements the tailor has already saved.
 */
export async function sharePassportInvite(passportId: string, clientName: string, tailorName: string) {
  const link = `${BASE_URL}/passport/claim/${passportId}`
  const message = `Hi ${clientName}, your measurements are already saved with ${tailorName} on Drape. Claim your measurement passport to manage your outfits and place orders online:\n\n${link}`

  try {
    await Share.share({ message, title: 'Your measurements are ready on Drape' })
  } catch {
    // User dismissed — do nothing
  }
}

/**
 * Tailor invites a potential customer by sharing their profile.
 */
export async function inviteCustomerFromTailor(tailorProfileId: string, tailorName: string) {
  const link = `${BASE_URL}/tailor/${tailorProfileId}`
  const message = `I make bespoke garments through Drape. If you're looking for a tailor, you can book me here:\n\n${link}`

  try {
    await Share.share({ message, title: `Book ${tailorName} on Drape` })
  } catch {
    // User dismissed — do nothing
  }
}
