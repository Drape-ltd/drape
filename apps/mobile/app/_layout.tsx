import { Component, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { AppState, AppStateStatus, Modal, View, ActivityIndicator, StyleSheet, Alert, Text, ScrollView, useColorScheme } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { useFonts } from 'expo-font'
import {
  Fraunces_600SemiBold,
  Fraunces_700Bold,
} from '@expo-google-fonts/fraunces'
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter'

// Keep the native splash screen visible until RouteGuard has resolved auth + role + profile.
// This prevents any JS route from flashing through on app start / reload.
SplashScreen.setOptions({ duration: 450, fade: true })
SplashScreen.preventAutoHideAsync().catch(() => {})
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth, useUserRole } from '@/lib/auth'
import { CustomerProfileProvider } from '@/lib/customerProfile'
import { TailorProfileProvider } from '@/lib/tailorProfile'
import { usePushNotifications } from '@/lib/notifications'
import { getStripePublishableKey } from '@/lib/payments'
import { OptionalStripeProvider } from '@/lib/stripe-runtime'
import { supabase } from '@/lib/supabase'
import { initSentry, Sentry } from '@/lib/sentry'
import { identify, setAnalyticsConsent } from '@/lib/analytics'
import { isBiometricEnabled, authenticate } from '@/lib/biometric'
import { queryClient } from '@/lib/queryClient'
import { hydratePersistedQueryCache, installQueryCachePersistence } from '@/lib/queryPersistence'
import { Colors, FontSize, FontWeight, Fonts, Spacing } from '@/constants/theme'
import { validatePhoneForProfile } from '@drape/shared/phone'

const LOCK_AFTER_MS = 5 * 60 * 1000 // lock after 5 minutes in background
const SPLASH_FAILSAFE_MS = __DEV__ ? 2500 : 8000
const ROUTE_GUARD_QUERY_TIMEOUT_MS = 5_000

function hideNativeSplash(reason: string) {
  if (__DEV__) console.log(`Hiding Drapeon splash: ${reason}`)
  SplashScreen.hideAsync().catch((error) => {
    console.warn('Unable to hide Drapeon splash screen', error)
  })
}

function hasUsablePhone(value: unknown): boolean {
  return typeof value === 'string' && validatePhoneForProfile(value) === null
}

function isAuthFailure(error: unknown): boolean {
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown } | null
  const status = typeof candidate?.status === 'number' ? candidate.status : null
  const code = typeof candidate?.code === 'string' ? candidate.code.toUpperCase() : ''
  const message = typeof candidate?.message === 'string' ? candidate.message.toLowerCase() : ''

  return (
    status === 401 ||
    code === 'PGRST301' ||
    message.includes('jwt') ||
    message.includes('invalid api key') ||
    message.includes('unauthorized')
  )
}

async function withRouteGuardTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} timed out`))
        }, ROUTE_GUARD_QUERY_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

type CustomerProfileGuardRow = {
  id: string
  display_name: string | null
  phone: string | null
  unit_preference: string | null
  garment_context: string | null
  measurements: Record<string, unknown> | null
}

function isTailorProfileCompleteFromRow(row: unknown): boolean {
  const data = row as {
    profile_completed?: boolean | null
    display_name?: string | null
    location?: string | null
    id_verification_status?: string | null
  } | null
  if (!data) return false
  if (data.profile_completed === true) return true

  const hasName = typeof data.display_name === 'string' && data.display_name.trim().length > 0
  const hasLocation = typeof data.location === 'string' && data.location.trim().length > 0
  const verificationStatus = (data.id_verification_status ?? '').trim().toUpperCase()
  const hasSubmittedVerification =
    verificationStatus === 'PENDING' ||
    verificationStatus === 'VERIFIED' ||
    verificationStatus === 'APPROVED'

  return hasName && hasLocation && hasSubmittedVerification
}

// ─── BiometricGate ────────────────────────────────────────────────────────────

function BiometricGate() {
  const { session, signOut } = useAuth()
  const [locked, setLocked] = useState(false)
  const backgroundAt = useRef<number | null>(null)
  const prompting = useRef(false)

  useEffect(() => {
    if (!session) return

    const handleChange = async (nextState: AppStateStatus) => {
      if (nextState === 'background' || nextState === 'inactive') {
        backgroundAt.current = Date.now()
      } else if (nextState === 'active' && backgroundAt.current) {
        const elapsed = Date.now() - backgroundAt.current
        backgroundAt.current = null
        if (elapsed >= LOCK_AFTER_MS && !prompting.current) {
          const enabled = await isBiometricEnabled()
          if (enabled) setLocked(true)
        }
      }
    }

    const sub = AppState.addEventListener('change', handleChange)
    return () => sub.remove()
  }, [session])

  useEffect(() => {
    if (!locked || prompting.current) return
    prompting.current = true
    authenticate('Verify your identity to continue using Drapeon').then(async (ok) => {
      prompting.current = false
      if (ok) {
        setLocked(false)
      } else {
        try {
          await signOut()
        } catch {
          Alert.alert('Unable to sign out', 'Please close and reopen the app, then try again.')
        }
        setLocked(false)
      }
    })
  }, [locked, signOut])

  return (
    <Modal visible={locked} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={gateStyles.overlay}>
        <ActivityIndicator size="large" color={Colors.needleGreen} />
      </View>
    </Modal>
  )
}

const gateStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: Colors.bone,
    alignItems: 'center', justifyContent: 'center',
  },
})

initSentry()

class StartupErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; info: ErrorInfo | null }
> {
  state: { error: Error | null; info: ErrorInfo | null } = { error: null, info: null }
  private splashFailsafe: ReturnType<typeof setTimeout> | null = null

  componentDidMount() {
    this.splashFailsafe = setTimeout(() => {
      hideNativeSplash('root startup failsafe')
    }, SPLASH_FAILSAFE_MS)
  }

  componentWillUnmount() {
    if (this.splashFailsafe) clearTimeout(this.splashFailsafe)
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info })
    hideNativeSplash('startup error boundary')
    Sentry.captureException(error, {
      contexts: {
        react: {
          componentStack: info.componentStack,
        },
      },
    })
    console.error('Drapeon startup render failed:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <ScrollView style={startupErrorStyles.screen} contentContainerStyle={startupErrorStyles.content}>
        <Text style={startupErrorStyles.eyebrow}>Drapeon needs a quick restart</Text>
        <Text style={startupErrorStyles.title}>We couldn’t finish opening the app.</Text>
        <Text style={startupErrorStyles.message}>
          Close Drapeon fully and open it again. If this keeps happening, contact support@drapeon.co and mention startup recovery.
        </Text>
        {__DEV__ && (
          <>
            <Text selectable style={startupErrorStyles.devTitle}>
              {this.state.error.name || 'Error'}: {this.state.error.message}
            </Text>
            {!!this.state.error.stack && (
              <Text selectable style={startupErrorStyles.stack}>{this.state.error.stack}</Text>
            )}
            {!!this.state.info?.componentStack && (
              <Text selectable style={startupErrorStyles.stack}>{this.state.info.componentStack}</Text>
            )}
          </>
        )}
      </ScrollView>
    )
  }
}

const startupErrorStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.bone,
  },
  content: {
    padding: Spacing.xl,
    paddingTop: Spacing.xxxl,
    gap: Spacing.md,
  },
  eyebrow: {
    color: Colors.error,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    textTransform: 'uppercase',
  },
  title: {
    color: Colors.ink,
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
  },
  message: {
    color: Colors.ink,
    fontSize: FontSize.md,
    lineHeight: 22,
  },
  devTitle: {
    color: Colors.ink,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    marginTop: Spacing.md,
  },
  stack: {
    color: Colors.inkLight,
    fontSize: FontSize.xs,
    lineHeight: 18,
  },
})

function RouteGuard({ appReady }: { appReady: boolean }) {
  const { session, loading, user, signOut } = useAuth()
  const role = useUserRole()
  const userId = user?.id ?? null
  const userEmail = user?.email ?? null
  const userPhone =
    typeof user?.user_metadata?.phone === 'string' ? user.user_metadata.phone : null
  usePushNotifications(userId)
  const segments = useSegments()
  const rootSegment = segments[0] as string | undefined
  const secondSegment = segments[1] as string | undefined
  const thirdSegment = segments[2] as string | undefined
  const router = useRouter()
  const splashHidden = useRef(false)
  const authRecoveryInFlight = useRef(false)
  const [tailorProfileChecked, setTailorProfileChecked] = useState(false)
  const [tailorHasProfile, setTailorHasProfile] = useState(false)
  const [tailorProfileCompleted, setTailorProfileCompleted] = useState(false)
  const [tailorProfileCheckFailed, setTailorProfileCheckFailed] = useState(false)
  const [tailorProfileChecking, setTailorProfileChecking] = useState(false)
  const [customerProfileChecked, setCustomerProfileChecked] = useState(false)
  const [customerProfileComplete, setCustomerProfileComplete] = useState(false)
  const [customerProfileCheckFailed, setCustomerProfileCheckFailed] = useState(false)
  const [customerProfileChecking, setCustomerProfileChecking] = useState(false)
  const analyticsSharing =
    user?.user_metadata?.privacy_prefs?.analyticsSharing === true

  const recoverFromAuthFailure = useCallback((context: string, error: unknown) => {
    if (authRecoveryInFlight.current) return
    authRecoveryInFlight.current = true
    console.warn(`${context} returned an auth error; clearing the local session.`, error)
    signOut()
      .catch((signOutError) => {
        console.warn('Unable to clear invalid auth session from route guard.', signOutError)
      })
      .finally(() => {
        authRecoveryInFlight.current = false
      })
  }, [signOut])

  // Reset profile flags whenever the user changes (sign-out → sign-in as same or different user).
  // RouteGuard never unmounts, so stale `customerProfileComplete = true` from a previous session
  // would otherwise prevent the profile check from re-running for the new user.
  useEffect(() => {
    const timer = setTimeout(() => {
      setCustomerProfileChecked(false)
      setCustomerProfileComplete(false)
      setCustomerProfileCheckFailed(false)
      setCustomerProfileChecking(false)
      setTailorProfileChecked(false)
      setTailorHasProfile(false)
      setTailorProfileCompleted(false)
      setTailorProfileCheckFailed(false)
      setTailorProfileChecking(false)
    }, 0)
    return () => clearTimeout(timer)
  }, [userId, role])

  // Optional product analytics stay off until we know the user's preference.
  useEffect(() => {
    if (loading) return
    setAnalyticsConsent(!!userId && analyticsSharing)
  }, [loading, userId, analyticsSharing])

  // Identify only after optional analytics is explicitly enabled for this user.
  useEffect(() => {
    if (userId && analyticsSharing) {
      identify(userId, {
        role: role ?? undefined,
        email: userEmail ?? undefined,
      })
    }
  }, [userId, userEmail, role, analyticsSharing])

  useEffect(() => {
    if (loading) return
    if (userId) {
      Sentry.setUser({
        id: userId,
        email: userEmail ?? undefined,
        role: role ?? undefined,
      })
    } else {
      Sentry.setUser(null)
    }
  }, [loading, userId, userEmail, role])

  // When a customer signs in (or leaves auth screens), check whether their profile exists.
  // Using `id` — any row means setup is done. Re-checks on segment change so the guard
  // picks up the newly-created row immediately after customer-setup completes.
  useEffect(() => {
    if (role !== 'CUSTOMER' || !userId) return
    if (customerProfileComplete) return // already confirmed — no need to re-query
    let cancelled = false
    const timer = setTimeout(() => {
      setCustomerProfileChecking(true)
      setCustomerProfileChecked(false)
      withRouteGuardTimeout(
        supabase
          .from('customer_profiles')
          .select('id, display_name, phone, unit_preference, garment_context, measurements')
          .eq('user_id', userId)
          .maybeSingle(),
        'Customer profile guard lookup'
      )
        .then(({ data, error }) => {
          if (cancelled) return
          setCustomerProfileChecking(false)
          if (error) {
            if (isAuthFailure(error)) {
              recoverFromAuthFailure('Customer profile guard lookup', error)
              return
            }
            // Network/DB error — don't update profile state; unblock so splash can hide.
            // The customer's profile screens have their own error handling.
            setCustomerProfileCheckFailed(true)
            setCustomerProfileChecked(true)
            return
          }
          const profile = data as CustomerProfileGuardRow | null
          const measurements = profile?.measurements ?? {}
          const hasDisplayName =
            typeof profile?.display_name === 'string' && profile.display_name.trim().length > 0
          const hasPhone = hasUsablePhone(profile?.phone) || hasUsablePhone(userPhone)
          const hasUnit =
            typeof profile?.unit_preference === 'string' ||
            typeof measurements?.unit === 'string'
          const hasGarmentContext =
            typeof profile?.garment_context === 'string' ||
            typeof measurements?.garmentContext === 'string'

          setCustomerProfileComplete(hasDisplayName && hasPhone && hasUnit && hasGarmentContext)
          setCustomerProfileCheckFailed(false)
          setCustomerProfileChecked(true)
        }, (error: unknown) => {
          if (cancelled) return
          if (isAuthFailure(error)) {
            setCustomerProfileChecking(false)
            recoverFromAuthFailure('Customer profile guard lookup', error)
            return
          }
          console.warn('Customer profile guard lookup failed; keeping customer out of setup redirects.', error)
          setCustomerProfileChecking(false)
          setCustomerProfileCheckFailed(true)
          setCustomerProfileChecked(true)
        })
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [customerProfileComplete, recoverFromAuthFailure, role, rootSegment, userId, userPhone])

  // When a tailor signs in or navigates within the tailor section, check whether they've completed setup.
  // segments[2] is included so the check re-fires when leaving the setup screen (segments[2] goes from
  // 'setup' → undefined), allowing the guard to pick up profile_completed=true before routing fires.
  useEffect(() => {
    if (role !== 'TAILOR' || !userId) return
    // Once the profile is confirmed complete, never re-query — prevents redirect loop after submit
    if (tailorProfileChecked && tailorProfileCompleted) return
    let cancelled = false
    const timer = setTimeout(() => {
      setTailorProfileChecking(true)
      setTailorProfileChecked(false)
      withRouteGuardTimeout(
        supabase
          .from('tailor_profiles')
          .select('id, profile_completed, display_name, location, id_verification_status')
          .eq('user_id', userId)
          .maybeSingle(),
        'Tailor profile guard lookup'
      )
        .then(({ data, error }) => {
          if (cancelled) return
          setTailorProfileChecking(false)
          if (error) {
            if (isAuthFailure(error)) {
              recoverFromAuthFailure('Tailor profile guard lookup', error)
              return
            }
            // Network/DB error — don't update profile state; unblock so splash can hide.
            setTailorProfileCheckFailed(true)
            setTailorProfileChecked(true)
            return
          }
          setTailorProfileCheckFailed(false)
          setTailorHasProfile(!!data)
          setTailorProfileCompleted(isTailorProfileCompleteFromRow(data))
          setTailorProfileChecked(true)
        }, (error: unknown) => {
          if (cancelled) return
          if (isAuthFailure(error)) {
            setTailorProfileChecking(false)
            recoverFromAuthFailure('Tailor profile guard lookup', error)
            return
          }
          console.warn('Tailor profile guard lookup failed; keeping tailor out of setup redirects.', error)
          setTailorProfileChecking(false)
          setTailorProfileCheckFailed(true)
          setTailorProfileChecked(true)
        })
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    role,
    recoverFromAuthFailure,
    rootSegment,
    secondSegment,
    tailorProfileChecked,
    tailorProfileCompleted,
    thirdSegment,
    userId,
  ])

  useEffect(() => {
    if (loading) return

    const inAuth = rootSegment === '(auth)'
    const inCustomer = rootSegment === '(customer)'
    const inTailor = rootSegment === '(tailor)'
    const inVision = rootSegment === 'vision'
    const inPaymentReturn = rootSegment === 'paystack-redirect' || rootSegment === 'stripe-redirect'
    const onResetPassword = inAuth && secondSegment === 'reset-password'
    // Passport claim links are public deep links — allow unauthenticated access
    // so customers who aren't signed in can still see the preview before logging in.
    const inPassport = rootSegment === 'passport'

    if (!session) {
      if (!inAuth && !inPassport) router.replace('/(auth)/welcome')
      return
    }

    // OAuth sign-in with no role yet — pick role before proceeding
    if (!role) {
      const onRoleSelect = rootSegment === '(auth)' && secondSegment === 'role-select'
      if (!onRoleSelect) router.replace('/(auth)/role-select')
      return
    }

    if (onResetPassword) {
      return
    }

    if (role === 'CUSTOMER') {
      if (!customerProfileChecked || customerProfileChecking) return
      if (customerProfileCheckFailed) {
        // A transient network failure should not send an existing customer into setup.
        if (!inCustomer && !inVision && !inPaymentReturn) router.replace('/(customer)')
        return
      }
      if (!customerProfileComplete) {
        // New customer — send to profile setup unless already there
        const onSetup = inAuth && secondSegment === 'customer-setup'
        if (!onSetup) router.replace('/(auth)/customer-setup')
        return
      }
      if (!inCustomer && !inVision && !inPaymentReturn) router.replace('/(customer)')
    } else if (role === 'TAILOR') {
      if (!tailorProfileChecked || tailorProfileChecking) return
      if (tailorProfileCheckFailed) {
        // Do not shove a signed-in tailor into setup because a transient profile
        // lookup failed. Individual screens can show their own retry states.
        if (!inTailor && !inVision && !inPaymentReturn) router.replace('/(tailor)')
        return
      }
      if (!tailorHasProfile || !tailorProfileCompleted) {
        // No profile row yet, or profile submitted but not yet completed — send to setup
        const onSetup = inTailor && secondSegment === 'profile' && thirdSegment === 'setup'
        if (!onSetup) router.replace('/(tailor)/profile/setup')
        return
      }
      // Profile is complete — never redirect to setup again
      if (!inTailor && !inVision && !inPaymentReturn) router.replace('/(tailor)')
    }
  }, [
    customerProfileChecked,
    customerProfileCheckFailed,
    customerProfileChecking,
    customerProfileComplete,
    loading,
    role,
    rootSegment,
    router,
    secondSegment,
    session,
    tailorHasProfile,
    tailorProfileChecked,
    tailorProfileCheckFailed,
    tailorProfileChecking,
    tailorProfileCompleted,
    thirdSegment,
  ])

  // Hide the native splash screen only once we know where to send the user.
  // Until then, preventAutoHideAsync() (called at module level) keeps it up —
  // so no JS route can flash through on app start or reload.
  const resolving =
    !appReady ||
    loading ||
    (!!session && role === 'CUSTOMER' && (!customerProfileChecked || customerProfileChecking)) ||
    (!!session && role === 'TAILOR'    && (!tailorProfileChecked   || tailorProfileChecking))

  function hideSplashOnce(reason: string) {
    if (splashHidden.current) return
    splashHidden.current = true
    hideNativeSplash(reason)
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      hideSplashOnce('startup failsafe')
    }, SPLASH_FAILSAFE_MS)

    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!resolving) {
      hideSplashOnce('route guard resolved')
    }
  }, [resolving])

  return null
}

export default function RootLayout() {
  const colorScheme = useColorScheme()
  const statusBarStyle = colorScheme === 'dark' ? 'light' : 'dark'
  const [fontsLoaded, fontError] = useFonts({
    DrapeDisplay: Fraunces_600SemiBold,
    DrapeDisplayBold: Fraunces_700Bold,
    DrapeText: Inter_400Regular,
    DrapeTextMedium: Inter_500Medium,
    DrapeTextSemiBold: Inter_600SemiBold,
    DrapeTextBold: Inter_700Bold,
  })
  const appReady = fontsLoaded || !!fontError

  useEffect(() => {
    if (fontError) {
      Sentry.captureException(fontError, {
        tags: { area: 'font_loading' },
      })
    }
  }, [fontError])

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    hydratePersistedQueryCache(queryClient)
      .catch((error) => {
        Sentry.captureException(error, { tags: { area: 'query_cache_hydration' } })
      })
      .finally(() => {
        unsubscribe = installQueryCachePersistence(queryClient)
      })

    return () => {
      unsubscribe?.()
    }
  }, [])

  return (
    <StartupErrorBoundary>
      <OptionalStripeProvider
        publishableKey={getStripePublishableKey()}
        urlScheme="drape"
        setReturnUrlSchemeOnAndroid
      >
        <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CustomerProfileProvider>
          <TailorProfileProvider>
          <RouteGuard appReady={appReady} />
          <BiometricGate />
          <StatusBar style={statusBarStyle} />
          <Stack
            key={colorScheme ?? 'light'}
            screenOptions={{
              headerStyle: { backgroundColor: Colors.bone },
              headerTintColor: Colors.ink,
              headerTitleStyle: { fontFamily: Fonts.bodySemiBold, fontWeight: '600', color: Colors.ink },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: Colors.bone },
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            <Stack.Screen name="(customer)" options={{ headerShown: false }} />
            <Stack.Screen name="(tailor)" options={{ headerShown: false }} />
            <Stack.Screen name="passport" options={{ headerShown: false }} />
            <Stack.Screen name="group-invite/[code]" options={{ headerShown: false }} />
            <Stack.Screen name="referral/[code]" options={{ headerShown: false }} />
            <Stack.Screen name="vision" options={{ headerShown: false }} />
            <Stack.Screen name="paystack-redirect" options={{ headerShown: false }} />
          </Stack>
          </TailorProfileProvider>
          </CustomerProfileProvider>
        </AuthProvider>
        </QueryClientProvider>
      </OptionalStripeProvider>
    </StartupErrorBoundary>
  )
}
