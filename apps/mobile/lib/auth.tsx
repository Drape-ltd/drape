import React, { createContext, useContext, useEffect, useState } from 'react'
import { Platform } from 'react-native'
import { type Session, type User } from '@supabase/supabase-js'
import * as WebBrowser from 'expo-web-browser'
import { supabase, setCurrentAccessToken } from './supabase'

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    async function bootstrap() {
      const { data: { session } } = await supabase.auth.getSession()

      if (!mounted) return

      if (!session) {
        setSession(null)
        setCurrentAccessToken(null)
        setLoading(false)
        return
      }

      const { data, error } = await supabase.auth.getUser()
      if (!mounted) return

      if (error || !data.user) {
        await supabase.auth.signOut().catch(() => {})
        if (!mounted) return
        setSession(null)
        setCurrentAccessToken(null)
        setLoading(false)
        return
      }

      setSession(session)
      setCurrentAccessToken(session.access_token)
      setLoading(false)
    }

    void bootstrap()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      setSession(session)
      setCurrentAccessToken(session?.access_token ?? null)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

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
    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: { display_name: displayName, role },
      },
    })
    return {
      error: error?.message ?? null,
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
      error:
        error?.message === 'Invalid login credentials'
          ? 'That email/password combo did not match. If you pasted the password, try again once, then use Reset password if needed.'
          : error?.message ?? null,
    }
  }

  async function signInWithGoogle(): Promise<{ error: string | null }> {
    try {
      const redirectUrl = 'drape:///(auth)/callback'
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectUrl, skipBrowserRedirect: true },
      })
      if (error || !data.url) return { error: error?.message ?? 'Could not start Google sign-in' }

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
        return { error: sessionError.message }
      }

      return { error: null }
    } catch (e: unknown) {
      return { error: (e as Error).message ?? 'Google sign-in failed' }
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
      return { error: error?.message ?? null }
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string }
      if (err.code === 'ERR_REQUEST_CANCELED') return { error: null } // user cancelled
      return { error: err.message ?? 'Apple sign-in failed' }
    }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) {
      throw error
    }
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
