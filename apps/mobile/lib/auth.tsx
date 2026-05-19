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

// Required for expo-web-browser OAuth redirect handling on Android
WebBrowser.maybeCompleteAuthSession()

interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  signUp: (
    email: string,
    password: string,
    displayName: string,
    role: 'CUSTOMER' | 'TAILOR'
  ) => Promise<{ error: string | null; requiresEmailConfirmation: boolean }>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signInWithGoogle: () => Promise<{ error: string | null }>
  signInWithApple: () => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
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
    return 'This email is already associated with a Drape account. Sign in or reset your password.'
  }
  if (normalized.includes('email not confirmed') || normalized.includes('confirm your email')) {
    return 'Check your email and confirm your Drape account before signing in.'
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

async function signInWithPasswordResilient(email: string, password: string) {
  const normalizedEmail = normalizeEmail(email)
  const firstAttempt = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  })

  const trimmedPassword = password.trim()
  const shouldRetryWithTrimmedPassword =
    !!firstAttempt.error &&
    isInvalidCredentialError(firstAttempt.error.message) &&
    trimmedPassword.length > 0 &&
    trimmedPassword !== password

  if (!shouldRetryWithTrimmedPassword) {
    return firstAttempt
  }

  return supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password: trimmedPassword,
  })
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
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
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

      const tokens = parseAuthTokensFromUrl(url)
      if (!tokens) return

      lastHandledUrl = url

      const { error } = await supabase.auth.setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      })

      if (error) {
        console.warn('Unable to exchange auth deep link session', {
          type: tokens.type ?? 'unknown',
          message: error.message,
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
    }

    lastSessionUserIdRef.current = nextUserId
  }, [loading, session?.user?.id])

  async function signUp(
    email: string,
    password: string,
    displayName: string,
    role: 'CUSTOMER' | 'TAILOR'
  ) {
    const normalizedEmail = normalizeEmail(email)
    if (!isValidEmail(normalizedEmail)) {
      return {
        error: 'Enter a valid email address.',
        requiresEmailConfirmation: false,
      }
    }
    if (role !== 'CUSTOMER' && role !== 'TAILOR') {
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
        data: { display_name: displayName, role },
      },
    })
    return {
      error: error ? mapAuthErrorMessage(error.message, 'We could not create your account right now. Please try again in a moment.') : null,
      requiresEmailConfirmation: !error && !data.session,
    }
  }

  async function signIn(email: string, password: string) {
    const normalizedEmail = normalizeEmail(email)
    if (!isValidEmail(normalizedEmail)) {
      return { error: 'Enter a valid email address.' }
    }
    const { error } = await signInWithPasswordResilient(normalizedEmail, password)
    return {
      error: error ? mapAuthErrorMessage(error.message, 'We could not sign you in right now. Please try again in a moment.') : null,
    }
  }

  async function signInWithGoogle(): Promise<{ error: string | null }> {
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

      // Supabase returns tokens in the URL fragment (#access_token=...&refresh_token=...)
      const fragment = result.url.split('#')[1] ?? result.url.split('?')[1] ?? ''
      const params = new URLSearchParams(fragment)
      const accessToken = params.get('access_token')
      const refreshToken = params.get('refresh_token')

      if (!accessToken || !refreshToken) {
        return { error: 'Google sign-in completed, but the session could not be created. Please try again.' }
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })
      if (sessionError) {
        return { error: mapAuthErrorMessage(sessionError.message, 'Google sign-in completed, but Drape could not open your session. Please try again.') }
      }

      return { error: null }
    } catch (e: unknown) {
      return { error: mapAuthErrorMessage((e as Error).message, 'Google sign-in failed. Please try again in a moment.') }
    }
  }

  async function signInWithApple(): Promise<{ error: string | null }> {
    if (Platform.OS !== 'ios') return { error: 'Apple sign-in is only available on iOS' }
    try {
      // Dynamic import so Android doesn't crash on missing native module
      const AppleAuthentication = await import('expo-apple-authentication')
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      })
      if (!credential.identityToken) return { error: 'Apple did not return an identity token' }

      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      })
      return { error: error ? mapAuthErrorMessage(error.message, 'Apple sign-in completed, but Drape could not open your session. Please try again.') : null }
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string }
      if (err.code === 'ERR_REQUEST_CANCELED') return { error: null } // user cancelled
      return { error: mapAuthErrorMessage(err.message, 'Apple sign-in failed. Please try again in a moment.') }
    }
  }

  async function signOut() {
    const currentUserId = session?.user?.id ?? null
    const { error } = await supabase.auth.signOut({ scope: 'global' })
    if (error) {
      console.warn('Global sign-out failed; clearing local session on this device.', error.message)
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
    }
    queryClient.clear()
    await clearUserScopedLocalState(currentUserId)
    setSession(null)
  }

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signUp, signIn, signInWithGoogle, signInWithApple, signOut }}>
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
export function useUserRole(): 'CUSTOMER' | 'TAILOR' | null {
  const { user } = useAuth()
  return (user?.user_metadata?.role as 'CUSTOMER' | 'TAILOR') ?? null
}

export { signInWithPasswordResilient }
