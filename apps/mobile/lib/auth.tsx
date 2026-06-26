import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { type Session, type User } from '@supabase/supabase-js'
import * as ExpoLinking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { validateDisplayName } from '@drape/shared/contact-filter'
import { validatePasswordStrength } from '@drape/shared/auth-security'
import { supabase } from './supabase'
import { clearRecentReauth } from './recent-reauth'
import { queryClient } from './queryClient'
import { clearPersistedQueryCache } from './queryPersistence'
import { syncUserRow } from './syncUserRow'

// Required for expo-web-browser OAuth redirect handling on Android
WebBrowser.maybeCompleteAuthSession()

type DrapeRole = 'CUSTOMER' | 'TAILOR'

interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  signUp: (
    email: string,
    password: string,
    displayName: string,
    role: DrapeRole
  ) => Promise<{ error: string | null; requiresEmailConfirmation: boolean }>
  signIn: (email: string, password: string, roleIntent?: DrapeRole | null) => Promise<{ error: string | null }>
  signInWithGoogle: (roleIntent?: DrapeRole | null) => Promise<{ error: string | null }>
  signInWithApple: (roleIntent?: DrapeRole | null) => Promise<{ error: string | null }>
  switchRole: (role: DrapeRole) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isDrapeRole(value: unknown): value is DrapeRole {
  return value === 'CUSTOMER' || value === 'TAILOR'
}

function getHostedAuthCallbackUrl(nextPath = '/account/dashboard') {
  const siteUrl = (process.env.EXPO_PUBLIC_SITE_URL ?? 'https://drapeon.co').replace(/\/+$/, '')
  const url = new URL('/auth/callback', siteUrl)
  url.searchParams.set('next', nextPath)
  return url.toString()
}

function displayNameFromMetadata(metadata: User['user_metadata']) {
  if (typeof metadata?.display_name === 'string' && metadata.display_name.trim().length > 0) {
    return metadata.display_name.trim()
  }
  if (typeof metadata?.full_name === 'string' && metadata.full_name.trim().length > 0) {
    return metadata.full_name.trim()
  }
  if (typeof metadata?.name === 'string' && metadata.name.trim().length > 0) {
    return metadata.name.trim()
  }
  return null
}

function isInvalidCredentialError(message: string | null | undefined) {
  const normalized = (message ?? '').toLowerCase()
  return normalized.includes('invalid login credentials') || normalized.includes('invalid credentials')
}

function mapAuthErrorMessage(message: string | null | undefined, fallback = 'We could not complete this auth step right now. Please try again in a moment.') {
  const normalized = (message ?? '').trim().toLowerCase()
  if (!normalized) return fallback

  if (isInvalidCredentialError(normalized)) {
    return 'Incorrect password. Try again.'
  }
  if (normalized.includes('user already registered') || normalized.includes('already registered') || normalized.includes('already exists')) {
    return 'This email is already associated with a Drapeon account. Sign in or reset your password.'
  }
  if (normalized.includes('email not confirmed') || normalized.includes('confirm your email')) {
    return 'Check your email and confirm your Drapeon account before signing in.'
  }
  if (normalized.includes('rate limit') || normalized.includes('too many') || normalized.includes('over_email_send_rate_limit')) {
    return 'Please wait a minute before trying again.'
  }
  if (
    normalized.includes('network request failed') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('timed out') ||
    normalized.includes('offline')
  ) {
    return 'Connection looks weak. Please try again when the signal improves.'
  }

  return fallback
}

function parseAuthTokensFromUrl(url: string) {
  try {
    const parsedUrl = new URL(url)
    const hashParams = new URLSearchParams(parsedUrl.hash.replace(/^#/, ''))
    const searchParams = parsedUrl.searchParams
    const accessToken = hashParams.get('access_token') ?? searchParams.get('access_token')
    const refreshToken = hashParams.get('refresh_token') ?? searchParams.get('refresh_token')

    if (!accessToken || !refreshToken) return null

    return {
      accessToken,
      refreshToken,
      type: hashParams.get('type') ?? searchParams.get('type'),
    }
  } catch {
    return null
  }
}

async function applyAuthSessionFromUrl(url: string) {
  const parsedUrl = new URL(url)
  const code = parsedUrl.searchParams.get('code')
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) throw error
    return
  }

  const tokens = parseAuthTokensFromUrl(url)
  if (!tokens) {
    throw new Error('No auth session was returned.')
  }

  const { error } = await supabase.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  })
  if (error) throw error
}

function createOAuthNonce(byteLength = 32) {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._'
  const randomBytes = new Uint8Array(byteLength)
  const webCrypto = globalThis.crypto

  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    webCrypto.getRandomValues(randomBytes)
  } else {
    for (let index = 0; index < byteLength; index += 1) {
      randomBytes[index] = Math.floor(Math.random() * 256)
    }
  }

  return Array.from(randomBytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

function rightRotate(value: number, amount: number) {
  return (value >>> amount) | (value << (32 - amount))
}

function sha256Hex(input: string) {
  const bytes = new TextEncoder().encode(input)
  const bitLength = bytes.length * 8
  const withOne = bytes.length + 1
  const paddedLength = Math.ceil((withOne + 8) / 64) * 64
  const buffer = new Uint8Array(paddedLength)
  buffer.set(bytes)
  buffer[bytes.length] = 0x80

  const view = new DataView(buffer.buffer)
  view.setUint32(paddedLength - 4, bitLength, false)

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]

  for (let chunk = 0; chunk < paddedLength; chunk += 64) {
    const words = new Array<number>(64)
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(chunk + index * 4, false)
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rightRotate(words[index - 15], 7) ^ rightRotate(words[index - 15], 18) ^ (words[index - 15] >>> 3)
      const s1 = rightRotate(words[index - 2], 17) ^ rightRotate(words[index - 2], 19) ^ (words[index - 2] >>> 10)
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0
    }

    let [a, b, c, d, e, f, g, h] = hash
    for (let index = 0; index < 64; index += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + s1 + ch + constants[index] + words[index]) >>> 0
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    hash[0] = (hash[0] + a) >>> 0
    hash[1] = (hash[1] + b) >>> 0
    hash[2] = (hash[2] + c) >>> 0
    hash[3] = (hash[3] + d) >>> 0
    hash[4] = (hash[4] + e) >>> 0
    hash[5] = (hash[5] + f) >>> 0
    hash[6] = (hash[6] + g) >>> 0
    hash[7] = (hash[7] + h) >>> 0
  }

  return hash.map((value) => value.toString(16).padStart(8, '0')).join('')
}

async function signInWithPasswordResilient(email: string, password: string) {
  const normalizedEmail = normalizeEmail(email)
  const firstAttempt = await withAuthBootstrapTimeout(
    supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    }),
    'Password sign in'
  )

  const trimmedPassword = password.trim()
  const shouldRetryWithTrimmedPassword =
    !!firstAttempt.error &&
    isInvalidCredentialError(firstAttempt.error.message) &&
    trimmedPassword.length > 0 &&
    trimmedPassword !== password

  if (!shouldRetryWithTrimmedPassword) {
    return firstAttempt
  }

  return withAuthBootstrapTimeout(
    supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password: trimmedPassword,
    }),
    'Password sign in'
  )
}

const AUTH_BOOTSTRAP_TIMEOUT_MS = 8000

function withAuthBootstrapTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(`${label} timed out`))
      }, AUTH_BOOTSTRAP_TIMEOUT_MS)
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
}

async function clearStoredAuthSession() {
  await withAuthBootstrapTimeout(
    supabase.auth.signOut({ scope: 'local' }),
    'Local auth cleanup',
  ).catch(() => {})
}

async function clearUserScopedLocalState(userId: string | null | undefined) {
  if (!userId) {
    await clearRecentReauth()
    return
  }

  try {
    const keys = await AsyncStorage.getAllKeys()
    const userScopedKeys = keys.filter((key) => key.endsWith(`:${userId}`))

    if (userScopedKeys.length > 0) {
      await AsyncStorage.multiRemove(userScopedKeys)
    }
  } catch {
    // Best effort only. Query/auth state still clears below.
  }

  await clearRecentReauth(userId)
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const lastSessionUserIdRef = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    let mounted = true

    async function bootstrap() {
      try {
        const { data: { session }, error: sessionError } = await withAuthBootstrapTimeout(
          supabase.auth.getSession(),
          'Supabase session restore',
        )

        if (!mounted) return

        if (sessionError || !session) {
          if (sessionError) {
            console.warn('Unable to restore auth session; clearing local auth state.', sessionError.message)
            await clearStoredAuthSession()
            if (!mounted) return
          }
          setSession(null)
          setLoading(false)
          return
        }

        const { data, error } = await withAuthBootstrapTimeout(
          supabase.auth.getUser(),
          'Supabase user validation',
        )
        if (!mounted) return

        if (error || !data.user) {
          if (error) {
            console.warn('Stored auth session is no longer valid; signing out locally.', error.message)
          }
          await clearStoredAuthSession()
          if (!mounted) return
          setSession(null)
          setLoading(false)
          return
        }

        setSession(session)
        setLoading(false)
      } catch (error) {
        console.warn('Auth bootstrap failed; continuing signed out.', error)
        await clearStoredAuthSession()
        if (!mounted) return
        setSession(null)
        setLoading(false)
      }
    }

    void bootstrap()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      setSession(session)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    let active = true
    let lastHandledUrl: string | null = null

    async function handleAuthDeepLink(url: string | null) {
      if (!active || !url || url === lastHandledUrl) return

      const hasAuthPayload =
        url.includes('code=') ||
        url.includes('access_token=') ||
        url.includes('refresh_token=')
      if (!hasAuthPayload) return

      lastHandledUrl = url

      try {
        await applyAuthSessionFromUrl(url)
      } catch (error) {
        console.warn('Unable to exchange auth deep link session', {
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    ExpoLinking.getInitialURL().then((url) => {
      void handleAuthDeepLink(url)
    })

    const subscription = ExpoLinking.addEventListener('url', ({ url }) => {
      void handleAuthDeepLink(url)
    })

    return () => {
      active = false
      subscription.remove()
    }
  }, [])

  useEffect(() => {
    if (loading) return

    const nextUserId = session?.user?.id ?? null
    if (
      lastSessionUserIdRef.current !== undefined &&
      lastSessionUserIdRef.current !== nextUserId
    ) {
      queryClient.clear()
      clearPersistedQueryCache().catch(() => {})
    }

    lastSessionUserIdRef.current = nextUserId
  }, [loading, session?.user?.id])

  async function applyRoleIntent(roleIntent?: DrapeRole | null): Promise<string | null> {
    if (!roleIntent) return null
    if (!isDrapeRole(roleIntent)) return 'Choose a valid Drapeon mode.'

    const { data: sessionData, error: sessionError } = await withAuthBootstrapTimeout(
      supabase.auth.getSession(),
      'Drapeon mode session lookup',
    )
    const currentSession = sessionData.session
    if (sessionError || !currentSession?.user?.id) {
      return 'Sign in completed, but Drapeon could not choose your mode. Sign in again if the app does not move.'
    }

    if (currentSession.user.user_metadata?.role === roleIntent) {
      return null
    }

    const { error } = await supabase.auth.updateUser({ data: { role: roleIntent } })
    if (error) {
      return mapAuthErrorMessage(
        error.message,
        'Sign in completed, but Drapeon could not choose your mode. Try again in a moment.',
      )
    }

    try {
      await syncUserRow({
        userId: currentSession.user.id,
        role: roleIntent,
        displayName: displayNameFromMetadata(currentSession.user.user_metadata),
      })
    } catch (error) {
      console.warn('Unable to sync role intent into users row.', error)
    }

    const { data, error: refreshError } = await supabase.auth.refreshSession()
    if (refreshError) {
      return mapAuthErrorMessage(
        refreshError.message,
        'Drapeon mode changed, but your session did not refresh cleanly. Sign out and back in if the app does not move.',
      )
    }

    setSession(data.session)
    return null
  }

  async function signUp(
    email: string,
    password: string,
    displayName: string,
    role: DrapeRole
  ) {
    const normalizedEmail = normalizeEmail(email)
    if (!isValidEmail(normalizedEmail)) {
      return {
        error: 'Enter a valid email address.',
        requiresEmailConfirmation: false,
      }
    }
    if (!isDrapeRole(role)) {
      return {
        error: 'Choose whether you are signing up as a customer or tailor.',
        requiresEmailConfirmation: false,
      }
    }
    const displayNameError = validateDisplayName(displayName)
    if (displayNameError) {
      return {
        error: displayNameError,
        requiresEmailConfirmation: false,
      }
    }
    const passwordError = validatePasswordStrength(password, {
      forbiddenValues: [normalizedEmail, displayName],
    })
    if (passwordError) {
      return {
        error: passwordError,
        requiresEmailConfirmation: false,
      }
    }
    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: getHostedAuthCallbackUrl('/account/dashboard'),
        data: { display_name: displayName, role },
      },
    })
    return {
      error: error ? mapAuthErrorMessage(error.message, 'We could not create your account right now. Please try again in a moment.') : null,
      requiresEmailConfirmation: !error && !data.session,
    }
  }

  async function signIn(email: string, password: string, roleIntent?: DrapeRole | null) {
    const normalizedEmail = normalizeEmail(email)
    if (!isValidEmail(normalizedEmail)) {
      return { error: 'Enter a valid email address.' }
    }
    try {
      const { error } = await signInWithPasswordResilient(normalizedEmail, password)
      if (!error) {
        const roleError = await applyRoleIntent(roleIntent)
        if (roleError) return { error: roleError }
      }
      return {
        error: error ? mapAuthErrorMessage(error.message, 'We could not sign you in right now. Please try again in a moment.') : null,
      }
    } catch (error) {
      return {
        error: mapAuthErrorMessage(
          error instanceof Error ? error.message : String(error),
          'We could not sign you in right now. Please try again in a moment.'
        ),
      }
    }
  }

  async function signInWithGoogle(roleIntent?: DrapeRole | null): Promise<{ error: string | null }> {
    try {
      const redirectUrl = ExpoLinking.createURL('/callback')
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectUrl, skipBrowserRedirect: true },
      })
      if (error || !data.url) {
        return { error: error ? mapAuthErrorMessage(error.message, 'We could not start Google sign-in right now.') : 'We could not start Google sign-in right now.' }
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl)
      if (result.type !== 'success') return { error: null } // user cancelled

      try {
        await applyAuthSessionFromUrl(result.url)
      } catch (sessionError) {
        return {
          error: mapAuthErrorMessage(
            sessionError instanceof Error ? sessionError.message : String(sessionError),
            'Google sign-in completed, but Drapeon could not open your session. Please try again.'
          ),
        }
      }

      const roleError = await applyRoleIntent(roleIntent)
      if (roleError) return { error: roleError }

      return { error: null }
    } catch (e: unknown) {
      return { error: mapAuthErrorMessage((e as Error).message, 'Google sign-in failed. Please try again in a moment.') }
    }
  }

  async function signInWithApple(roleIntent?: DrapeRole | null): Promise<{ error: string | null }> {
    if (Platform.OS !== 'ios') return { error: 'Apple sign-in is only available on iOS' }
    try {
      // Dynamic import so Android doesn't crash on missing native module
      const AppleAuthentication = await import('expo-apple-authentication')
      const rawNonce = createOAuthNonce()
      const hashedNonce = sha256Hex(rawNonce)
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      })
      if (!credential.identityToken) return { error: 'Apple did not return an identity token' }

      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
        nonce: rawNonce,
      })
      if (error) {
        return { error: mapAuthErrorMessage(error.message, 'Apple sign-in completed, but Drapeon could not open your session. Please try again.') }
      }
      const roleError = await applyRoleIntent(roleIntent)
      return { error: roleError }
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string }
      if (err.code === 'ERR_REQUEST_CANCELED') return { error: null } // user cancelled
      return { error: mapAuthErrorMessage(err.message, 'Apple sign-in failed. Please try again in a moment.') }
    }
  }

  async function switchRole(role: DrapeRole): Promise<{ error: string | null }> {
    if (!session?.user?.id) {
      return { error: 'Sign in again before switching Drapeon modes.' }
    }
    if (!isDrapeRole(role)) {
      return { error: 'Choose a valid Drapeon mode.' }
    }

    const displayName = displayNameFromMetadata(session.user.user_metadata)

    const { error } = await supabase.auth.updateUser({ data: { role } })
    if (error) {
      return {
        error: mapAuthErrorMessage(
          error.message,
          'We could not switch Drapeon modes right now. Please try again in a moment.'
        ),
      }
    }

    await syncUserRow({ userId: session.user.id, role, displayName })

    const { data, error: refreshError } = await supabase.auth.refreshSession()
    if (refreshError) {
      return {
        error: mapAuthErrorMessage(
          refreshError.message,
          'Drapeon mode changed, but your session did not refresh cleanly. Sign out and back in if the app does not move.'
        ),
      }
    }

    queryClient.clear()
    await clearPersistedQueryCache()
    setSession(data.session)
    return { error: null }
  }

  async function signOut() {
    const currentUserId = session?.user?.id ?? null
    const { error } = await supabase.auth.signOut({ scope: 'global' })
    if (error) {
      console.warn('Global sign-out failed; clearing local session on this device.', error.message)
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
    }
    queryClient.clear()
    await clearPersistedQueryCache()
    await clearUserScopedLocalState(currentUserId)
    setSession(null)
  }

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signUp, signIn, signInWithGoogle, signInWithApple, switchRole, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

// Convenience: get current user role from JWT metadata
export function useUserRole(): DrapeRole | null {
  const { user } = useAuth()
  const role = user?.user_metadata?.role
  return isDrapeRole(role) ? role : null
}

export { signInWithPasswordResilient }
