'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import { resolveAuthenticatedRole } from '@drape/shared/auth-role'
import { IDENTITY_CONSENT_POLICY_VERSION } from '@drape/shared'
import { createClient } from '../lib/supabase'
import {
  bootstrapWebOnboarding,
  persistedWebOnboardingPayload,
  webOnboardingFromUser,
  type WebOnboardingPayload,
} from '../lib/account-bootstrap'
import { markWebSessionScope } from '../lib/web-session-scope'
import {
  cleanupQuarantinedSignupMedia,
  deleteSignupMediaDraft,
  readSignupMediaDraft,
  restoreQuarantinedSignupMedia,
  type SignupMediaDraftDescriptor,
} from '../lib/signup-media-draft'

type EmailOtpType = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email'

const emailOtpTypes = new Set<EmailOtpType>([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
])

function sanitizeNext(value: string | null) {
  return value?.startsWith('/') === true && !value.startsWith('//') ? value : '/account/orders'
}

function normalizeEmailOtpType(value: string | null): EmailOtpType | null {
  return value && emailOtpTypes.has(value as EmailOtpType) ? (value as EmailOtpType) : null
}

function mapCallbackError(message: string | undefined) {
  const normalized = (message ?? '').toLowerCase()
  if (normalized.includes('expired') || normalized.includes('invalid')) {
    return 'This account link has expired or was already used. Request a fresh link and try again.'
  }
  if (normalized.includes('network') || normalized.includes('fetch')) {
    return 'Connection looks weak. Try again when the signal improves.'
  }
  return 'We could not finish this account link. Return to sign in and try again.'
}

async function applySessionFromUrl(
  supabase: ReturnType<typeof createClient>,
  searchParams: { get(name: string): string | null }
) {
  const providerError = searchParams.get('error_description') ?? searchParams.get('error')
  if (providerError) {
    throw new Error(providerError)
  }

  const code = searchParams.get('code')
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) throw error
    return
  }

  const tokenHash = searchParams.get('token_hash')
  const otpType = normalizeEmailOtpType(searchParams.get('type'))
  if (tokenHash && otpType) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    })
    if (error) throw error
    return
  }

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const accessToken = hashParams.get('access_token')
  const refreshToken = hashParams.get('refresh_token')
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })
    if (error) throw error
  }
}

async function syncRoleMirror(role: 'CUSTOMER' | 'TAILOR') {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  const userId = data.user?.id
  if (!userId) return

  const { error } = await supabase
    .from('users')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('id', userId)

  if (error) throw error
}

function readStoredOnboarding() {
  const raw = window.localStorage.getItem('drapeon.web.auth.onboarding')
  if (!raw) return null
  try {
    const payload = JSON.parse(raw) as WebOnboardingPayload
    return payload?.source === 'web' ? payload : null
  } catch {
    return null
  }
}

async function uploadOnboardingAvatar(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  role: 'CUSTOMER' | 'TAILOR',
  avatarDataUrl: string,
) {
  if (!avatarDataUrl.startsWith('data:image/jpeg;base64,')) return
  const blob = await fetch(avatarDataUrl).then((response) => response.blob())
  const path = `${userId}/avatar.jpg`
  const uploaded = await supabase.storage.from('avatars').upload(path, blob, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: true,
  })
  if (uploaded.error) throw uploaded.error
  const publicUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
  const avatarUrl = `${publicUrl}?v=${Date.now()}`
  const result = await supabase.functions.invoke('account-profile-action', {
    body: { action: 'update-avatar', role, avatarUrl },
  })
  if (result.error || (result.data as { error?: unknown } | null)?.error) {
    throw result.error ?? new Error('Profile photo could not be attached to this account.')
  }
}

async function uploadOnboardingAvatarDraft(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  role: 'CUSTOMER' | 'TAILOR',
  draft: SignupMediaDraftDescriptor,
) {
  const blob = await readSignupMediaDraft(draft.key)
  if (!blob) throw new Error('Your saved profile photo is missing from this browser. Return to signup and choose it again.')
  const path = `${userId}/avatar.jpg`
  const uploaded = await supabase.storage.from('avatars').upload(path, blob, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: true,
  })
  if (uploaded.error) throw uploaded.error
  const publicUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
  const result = await supabase.functions.invoke('account-profile-action', {
    body: { action: 'update-avatar', role, avatarUrl: `${publicUrl}?v=${Date.now()}` },
  })
  if (result.error || (result.data as { error?: unknown } | null)?.error) {
    throw result.error ?? new Error('Profile photo could not be attached to this account.')
  }
  await deleteSignupMediaDraft(draft.key).catch(() => undefined)
}

async function uploadOnboardingPortfolio(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  dataUrls: string[],
) {
  const urls: string[] = []
  for (const [index, dataUrl] of dataUrls.slice(0, 4).entries()) {
    if (!dataUrl.startsWith('data:image/jpeg;base64,')) continue
    const blob = await fetch(dataUrl).then((response) => response.blob())
    const path = `portfolio/${userId}/signup-${index + 1}-${Date.now()}.jpg`
    const uploaded = await supabase.storage.from('portfolio-photos').upload(path, blob, {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: false,
    })
    if (uploaded.error) throw uploaded.error
    urls.push(supabase.storage.from('portfolio-photos').getPublicUrl(path).data.publicUrl)
  }
  if (!urls.length) return
  const seeded = await supabase.functions.invoke('portfolio-item-action', {
    body: { action: 'seed-from-setup', photoUrls: urls },
  })
  if (seeded.error || (seeded.data as { error?: unknown } | null)?.error) {
    throw seeded.error ?? new Error('Portfolio photos could not be attached to this account.')
  }
}

async function uploadOnboardingPortfolioImages(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  drafts: SignupMediaDraftDescriptor[],
) {
  const urls: string[] = []
  for (const [index, draft] of drafts.slice(0, 12).entries()) {
    const blob = await readSignupMediaDraft(draft.key)
    if (!blob) throw new Error('A saved portfolio photo is missing from this browser. Return to signup and choose it again.')
    const path = `portfolio/${userId}/signup-${index + 1}-${Date.now()}.jpg`
    const uploaded = await supabase.storage.from('portfolio-photos').upload(path, blob, {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: false,
    })
    if (uploaded.error) throw uploaded.error
    urls.push(supabase.storage.from('portfolio-photos').getPublicUrl(path).data.publicUrl)
  }
  if (!urls.length) return
  const seeded = await supabase.functions.invoke('portfolio-item-action', {
    body: { action: 'seed-from-setup', photoUrls: urls },
  })
  if (seeded.error || (seeded.data as { error?: unknown } | null)?.error) {
    throw seeded.error ?? new Error('Portfolio photos could not be attached to this account.')
  }
  await Promise.all(drafts.map((draft) => deleteSignupMediaDraft(draft.key).catch(() => undefined)))
}

function videoExtension(contentType: string) {
  if (contentType === 'video/quicktime') return 'mov'
  if (contentType === 'video/webm') return 'webm'
  return 'mp4'
}

async function uploadOnboardingPortfolioVideos(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  drafts: SignupMediaDraftDescriptor[],
) {
  const urls: string[] = []
  for (const [index, draft] of drafts.slice(0, 4).entries()) {
    const blob = await readSignupMediaDraft(draft.key)
    if (!blob) throw new Error('A saved portfolio video is missing from this browser. Return to signup and choose it again.')
    const path = `portfolio/${userId}/videos/signup-${index + 1}-${Date.now()}.${videoExtension(draft.contentType)}`
    const uploaded = await supabase.storage.from('portfolio-photos').upload(path, blob, {
      contentType: draft.contentType,
      cacheControl: '31536000',
      upsert: false,
    })
    if (uploaded.error) throw uploaded.error
    urls.push(supabase.storage.from('portfolio-photos').getPublicUrl(path).data.publicUrl)
  }
  if (!urls.length) return
  const updated = await supabase.functions.invoke('tailor-profile-action', {
    body: { action: 'update-portfolio-videos', videoUrls: urls },
  })
  if (updated.error || (updated.data as { error?: unknown } | null)?.error) {
    throw updated.error ?? new Error('Portfolio videos could not be attached to this account.')
  }
  await Promise.all(drafts.map((draft) => deleteSignupMediaDraft(draft.key).catch(() => undefined)))
}

async function submitOnboardingTrustVideo(
  supabase: ReturnType<typeof createClient>,
  onboarding: WebOnboardingPayload,
  deferSubmission: boolean,
) {
  const draft = onboarding.trustVideoDraft
  const challengeId = onboarding.trustChallengeId
  if (!draft || !challengeId || onboarding.trustConsentGranted !== true) return null
  const blob = await readSignupMediaDraft(draft.key)
  if (!blob) throw new Error('Your saved private trust video is missing from this browser. Return to setup and record it again.')

  const created = await supabase.functions.invoke('identity-handoff-action', {
    body: { action: 'create', challengeId },
  })
  const createdData = (created.data ?? {}) as { token?: string; challengeId?: string; error?: string }
  if (created.error || !createdData.token || createdData.challengeId !== challengeId) {
    throw created.error ?? new Error(createdData.error ?? 'The private challenge could not be prepared.')
  }
  const uploadRequest = await supabase.functions.invoke('identity-handoff-action', {
    body: { action: 'create-upload-url', token: createdData.token, contentType: draft.contentType },
  })
  const uploadData = (uploadRequest.data ?? {}) as { path?: string; uploadToken?: string; error?: string }
  if (uploadRequest.error || !uploadData.path || !uploadData.uploadToken) {
    throw uploadRequest.error ?? new Error(uploadData.error ?? 'The private video upload could not start.')
  }
  const uploaded = await supabase.storage.from('trust-verification').uploadToSignedUrl(
    uploadData.path,
    uploadData.uploadToken,
    blob,
    { contentType: draft.contentType, cacheControl: '0' },
  )
  if (uploaded.error) throw uploaded.error
  if (deferSubmission) {
    return {
      token: createdData.token,
      storagePath: uploadData.path,
      draft,
      challengeId,
      challengeText: onboarding.trustChallengeText ?? '',
      consentGranted: true as const,
    }
  }
  const submitted = await supabase.functions.invoke('identity-handoff-action', {
    body: {
      action: 'submit',
      token: createdData.token,
      storagePath: uploadData.path,
      consentGranted: true,
      consentVersion: IDENTITY_CONSENT_POLICY_VERSION,
      consentSource: 'WEB_SETUP',
      locale: navigator.language || 'en',
    },
  })
  const submittedData = (submitted.data ?? {}) as { error?: string }
  if (submitted.error || submittedData.error) {
    throw submitted.error ?? new Error(submittedData.error ?? 'The private trust video could not be submitted.')
  }
  await deleteSignupMediaDraft(draft.key).catch(() => undefined)
  return null
}

function preserveTailorSetupDraft(
  userId: string,
  onboarding: WebOnboardingPayload,
  trustResume?: {
    token: string
    storagePath: string
    draft: SignupMediaDraftDescriptor
    challengeId: string
    challengeText: string
    consentGranted: true
  } | null,
) {
  const tailor = onboarding.tailor
  if (!tailor) return
  window.localStorage.setItem(`drape:tailor-setup-draft:v3:${userId}`, JSON.stringify({
    version: 3,
    displayName: onboarding.displayName,
    location: tailor.location,
    bio: tailor.bio ?? '',
    languages: tailor.languages,
    specialties: tailor.specialties,
    currency: onboarding.defaultCurrency,
    priceMin: tailor.priceRangeMin ? String(tailor.priceRangeMin / 100) : '',
    priceMax: tailor.priceRangeMax ? String(tailor.priceRangeMax / 100) : '',
    availability: tailor.availability ?? 'OPEN',
    sellerType: tailor.sellerType ?? 'TAILOR',
    supportsCustomOrders: tailor.supportsCustomOrders,
    supportsReadyMade: tailor.supportsReadyMade,
    acceptsCustomOrdersNow: tailor.supportsCustomOrders,
    shopPaused: false,
    pickupAvailable: tailor.fulfillment.includes('PICKUP'),
    deliveryAvailable: tailor.fulfillment.includes('DELIVERY'),
    shippingAvailable: tailor.fulfillment.includes('SHIPPING'),
    pickupAddress: tailor.pickupAddress ?? '',
    pickupCity: tailor.pickupCity ?? '',
    pickupRegion: tailor.pickupRegion ?? '',
    pickupPostalCode: tailor.pickupPostalCode ?? '',
    pickupCountryCode: tailor.pickupCountryCode ?? '',
    pickupInstructions: '',
    consultationMode: tailor.consultationMode ?? 'FREE',
    consultationRequirement: tailor.consultationRequirement ?? 'OPTIONAL',
    consultationFee: tailor.consultationFee ?? '',
    consultationDuration: tailor.consultationDuration ?? '30',
    consultationCallType: tailor.consultationCallType ?? 'VIDEO',
    consultationFeeCreditable: tailor.consultationFeeCreditable === true,
    signupTrustVideoDraft: trustResume?.draft ?? null,
    signupTrustChallengeId: trustResume?.challengeId ?? '',
    signupTrustChallengeText: trustResume?.challengeText ?? '',
    signupTrustConsentGranted: trustResume?.consentGranted === true,
    signupTrustHandoffToken: trustResume?.token ?? '',
    signupTrustStoragePath: trustResume?.storagePath ?? '',
  }))
}

export function AuthCallbackClient(): React.JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [message, setMessage] = useState('Finishing sign in...')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true

    async function complete() {
      const supabase = createClient()
      const next = sanitizeNext(searchParams.get('next'))

      try {
        await applySessionFromUrl(supabase, searchParams)

        const roleIntent = window.localStorage.getItem('drapeon.web.auth.roleIntent')
        const { data, error: userError } = await supabase.auth.getUser()
        if (userError || !data.user) {
          throw userError ?? new Error('No authenticated account was found for this link.')
        }

        let onboarding = readStoredOnboarding() ?? webOnboardingFromUser(data.user)
        const mediaClaimToken = typeof data.user.user_metadata?.signup_media_claim_token === 'string'
          ? data.user.user_metadata.signup_media_claim_token
          : ''
        let mediaAccessToken = ''
        if (mediaClaimToken && onboarding) {
          const { data: sessionData } = await supabase.auth.getSession()
          mediaAccessToken = sessionData.session?.access_token ?? ''
          if (mediaAccessToken) {
            const restored = await restoreQuarantinedSignupMedia({
              userId: data.user.id,
              claimToken: mediaClaimToken,
              accessToken: mediaAccessToken,
            })
            const avatarDraft = restored.find((entry) => entry.kind === 'avatar')
            const portfolioImageDrafts = restored.filter((entry) => entry.kind === 'portfolio-image')
            const portfolioVideoDrafts = restored.filter((entry) => entry.kind === 'portfolio-video')
            const trustVideoDraft = restored.find((entry) => entry.kind === 'trust-video')
            onboarding = {
              ...onboarding,
              avatarDraft: avatarDraft ?? onboarding.avatarDraft,
              portfolioImageDrafts: portfolioImageDrafts.length ? portfolioImageDrafts : onboarding.portfolioImageDrafts,
              portfolioVideoDrafts: portfolioVideoDrafts.length ? portfolioVideoDrafts : onboarding.portfolioVideoDrafts,
              trustVideoDraft: trustVideoDraft ?? onboarding.trustVideoDraft,
              trustChallengeId: typeof data.user.user_metadata?.signup_trust_challenge_id === 'string' ? data.user.user_metadata.signup_trust_challenge_id : onboarding.trustChallengeId,
              trustChallengeText: typeof data.user.user_metadata?.signup_trust_challenge_text === 'string' ? data.user.user_metadata.signup_trust_challenge_text : onboarding.trustChallengeText,
              trustConsentGranted: data.user.user_metadata?.signup_trust_consent_granted === true || onboarding.trustConsentGranted,
            }
          }
        }
        const metadataRole = data.user.user_metadata?.role
        const { data: roleMirror } = await supabase
          .from('users')
          .select('role')
          .eq('id', data.user.id)
          .maybeSingle()
        const establishedRole = metadataRole === 'CUSTOMER' || metadataRole === 'TAILOR'
          ? metadataRole
          : roleMirror?.role
        const role = resolveAuthenticatedRole({
          establishedRole,
          onboardingRole: onboarding?.role,
          entryIntent: roleIntent,
        })
        const matchingOnboarding = onboarding?.role === role ? onboarding : null

        if (!role) {
          window.localStorage.removeItem('drapeon.web.auth.roleIntent')
          window.localStorage.removeItem('drapeon.web.auth.onboarding')
          markWebSessionScope(true)
          if (active) {
            setFailed(false)
            setMessage('Choose how you will use Drapeon…')
            router.replace(`/account/choose-role?next=${encodeURIComponent(next)}` as Route)
          }
          return
        }

        if (role) {
          const persistedOnboarding = matchingOnboarding
            ? persistedWebOnboardingPayload(matchingOnboarding)
            : undefined
          const { error: metadataError } = await supabase.auth.updateUser({
            data: {
              role,
              display_name: matchingOnboarding?.displayName,
              phone: matchingOnboarding?.phone,
              web_onboarding: persistedOnboarding,
            },
          })
          if (metadataError) throw metadataError

          if (matchingOnboarding) {
            await bootstrapWebOnboarding(supabase, {
              userId: data.user.id,
              onboarding: matchingOnboarding,
            })
            if (matchingOnboarding.avatarDraft) {
              await uploadOnboardingAvatarDraft(
                supabase,
                data.user.id,
                role,
                matchingOnboarding.avatarDraft,
              )
            } else if (matchingOnboarding.avatarDataUrl) {
              await uploadOnboardingAvatar(
                supabase,
                data.user.id,
                role,
                matchingOnboarding.avatarDataUrl,
              )
            }
            if (role === 'TAILOR') {
              if (matchingOnboarding.portfolioImageDrafts?.length) {
                await uploadOnboardingPortfolioImages(
                  supabase,
                  data.user.id,
                  matchingOnboarding.portfolioImageDrafts,
                )
              } else if (matchingOnboarding.portfolioDataUrls?.length) {
                await uploadOnboardingPortfolio(
                  supabase,
                  data.user.id,
                  matchingOnboarding.portfolioDataUrls,
                )
              }
              if (matchingOnboarding.portfolioVideoDrafts?.length) {
                await uploadOnboardingPortfolioVideos(
                  supabase,
                  data.user.id,
                  matchingOnboarding.portfolioVideoDrafts,
                )
              }
              const sellerType = matchingOnboarding.tailor?.sellerType ?? 'TAILOR'
              const trustResume = await submitOnboardingTrustVideo(
                supabase,
                matchingOnboarding,
                sellerType !== 'TAILOR',
              )
              preserveTailorSetupDraft(data.user.id, matchingOnboarding, trustResume)
            }
            if (mediaClaimToken && mediaAccessToken) {
              await cleanupQuarantinedSignupMedia({ userId: data.user.id, claimToken: mediaClaimToken, accessToken: mediaAccessToken })
            }
          } else {
            await syncRoleMirror(role)
          }
        }

        window.localStorage.removeItem('drapeon.web.auth.roleIntent')
        window.localStorage.removeItem('drapeon.web.auth.onboarding')
        window.localStorage.removeItem('drapeon.web.auth.signup-draft.v1')
        markWebSessionScope(true)

        if (active) {
          setFailed(false)
          setMessage('Account link confirmed. Opening your Drapeon account...')
          router.replace(next as Route)
        }
      } catch (error) {
        if (active) {
          setFailed(true)
          setMessage(mapCallbackError(error instanceof Error ? error.message : undefined))
        }
        return
      }
    }

    void complete()

    return () => {
      active = false
    }
  }, [router, searchParams])

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)] px-5 py-8">
      <section className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-lg place-items-center">
        <div className="w-full rounded-[8px] border border-ink/8 bg-white/88 p-7 text-center shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Drapeon</p>
          <h1 className="mt-3 text-4xl text-ink">Opening your account</h1>
          <p className="mt-4 text-sm leading-7 text-ink/66">{message}</p>
          {failed ? (
            <div className="mt-5 flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-needle px-5 py-2.5 text-sm font-semibold text-white"
              >
                Try again
              </button>
              <Link href="/sign-in" className="text-sm font-semibold text-needle">
                Return to sign in
              </Link>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}
