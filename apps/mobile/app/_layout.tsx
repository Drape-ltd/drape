import { useEffect, useRef, useState } from 'react'
import { AppState, AppStateStatus, Modal, View, ActivityIndicator, StyleSheet, Alert } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'

// Keep the native splash screen visible until RouteGuard has resolved auth + role + profile.
// This prevents any JS route from flashing through on app start / reload.
SplashScreen.preventAutoHideAsync()
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth, useUserRole } from '@/lib/auth'
import { CustomerProfileProvider } from '@/lib/customerProfile'
import { TailorProfileProvider } from '@/lib/tailorProfile'
import { usePushNotifications } from '@/lib/notifications'
import { getStripePublishableKey } from '@/lib/payments'
import { OptionalStripeProvider } from '@/lib/stripe-runtime'
import { supabase } from '@/lib/supabase'
import { initSentry } from '@/lib/sentry'
import { identify, setAnalyticsConsent } from '@/lib/analytics'
import { isBiometricEnabled, authenticate } from '@/lib/biometric'
import { queryClient } from '@/lib/queryClient'
import { Colors } from '@/constants/theme'
import { validatePhoneForProfile } from '@drape/shared/phone'

const LOCK_AFTER_MS = 5 * 60 * 1000 // lock after 5 minutes in background

function hasUsablePhone(value: unknown): boolean {
  return typeof value === 'string' && validatePhoneForProfile(value) === null
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
    authenticate('Verify your identity to continue using Drape').then(async (ok) => {
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
  }, [locked])

  return (
    <Modal visible={locked} transparent animationType="fade">
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

function RouteGuard() {
  const { session, loading, user } = useAuth()
  const role = useUserRole()
  usePushNotifications(user?.id ?? null)
  const segments = useSegments()
  const router = useRouter()
  const [tailorProfileChecked, setTailorProfileChecked] = useState(false)
  const [tailorHasProfile, setTailorHasProfile] = useState(false)
  const [tailorProfileCompleted, setTailorProfileCompleted] = useState(false)
  const [customerProfileChecked, setCustomerProfileChecked] = useState(false)
  const [customerProfileComplete, setCustomerProfileComplete] = useState(false)
  const customerCheckInProgress = useRef(false)
  const tailorCheckInProgress = useRef(false)
  const analyticsSharing =
    user?.user_metadata?.privacy_prefs?.analyticsSharing === true

  // Reset profile flags whenever the user changes (sign-out → sign-in as same or different user).
  // RouteGuard never unmounts, so stale `customerProfileComplete = true` from a previous session
  // would otherwise prevent the profile check from re-running for the new user.
  useEffect(() => {
    setCustomerProfileChecked(false)
    setCustomerProfileComplete(false)
    setTailorProfileChecked(false)
    setTailorHasProfile(false)
    setTailorProfileCompleted(false)
  }, [user?.id, role])

  // Optional product analytics stay off until we know the user's preference.
  useEffect(() => {
    if (loading) return
    setAnalyticsConsent(!!user?.id && analyticsSharing)
  }, [loading, user?.id, analyticsSharing])

  // Identify only after optional analytics is explicitly enabled for this user.
  useEffect(() => {
    if (user?.id && analyticsSharing) {
      identify(user.id, {
        role: role ?? undefined,
        email: user.email,
      })
    }
  }, [user?.id, user?.email, role, analyticsSharing])

  // When a customer signs in (or leaves auth screens), check whether their profile exists.
  // Using `id` — any row means setup is done. Re-checks on segment change so the guard
  // picks up the newly-created row immediately after customer-setup completes.
  useEffect(() => {
    if (role !== 'CUSTOMER' || !user?.id) return
    if (customerProfileComplete) return // already confirmed — no need to re-query
    customerCheckInProgress.current = true
    setCustomerProfileChecked(false)
    supabase
      .from('customer_profiles')
      .select('id, display_name, phone, unit_preference, garment_context, measurements')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        customerCheckInProgress.current = false
        if (error) {
          // Network/DB error — don't update profile state; unblock so splash can hide.
          // The customer's profile screens have their own error handling.
          setCustomerProfileChecked(true)
          return
        }
        const measurements = (data as any)?.measurements ?? {}
        const hasDisplayName = typeof (data as any)?.display_name === 'string' && (data as any).display_name.trim().length > 0
        const hasPhone = hasUsablePhone((data as any)?.phone) || hasUsablePhone(user?.user_metadata?.phone)
        const hasUnit =
          typeof (data as any)?.unit_preference === 'string' ||
          typeof measurements?.unit === 'string'
        const hasGarmentContext =
          typeof (data as any)?.garment_context === 'string' ||
          typeof measurements?.garmentContext === 'string'

        setCustomerProfileComplete(hasDisplayName && hasPhone && hasUnit && hasGarmentContext)
        setCustomerProfileChecked(true)
      })
  }, [role, user?.id, segments[0]])

  // When a tailor signs in or navigates within the tailor section, check whether they've completed setup.
  // segments[2] is included so the check re-fires when leaving the setup screen (segments[2] goes from
  // 'setup' → undefined), allowing the guard to pick up profile_completed=true before routing fires.
  useEffect(() => {
    if (role !== 'TAILOR' || !user?.id) return
    // Once the profile is confirmed complete, never re-query — prevents redirect loop after submit
    if (tailorProfileChecked && tailorProfileCompleted) return
    tailorCheckInProgress.current = true
    setTailorProfileChecked(false)
    supabase
      .from('tailor_profiles')
      .select('id, profile_completed')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        tailorCheckInProgress.current = false
        if (error) {
          // Network/DB error — don't update profile state; unblock so splash can hide.
          setTailorProfileChecked(true)
          return
        }
        setTailorHasProfile(!!data)
        setTailorProfileCompleted(!!(data as any)?.profile_completed)
        setTailorProfileChecked(true)
      })
  }, [role, user?.id, segments[0], segments[1], segments[2], tailorProfileCompleted])

  useEffect(() => {
    if (loading) return

    const inAuth = segments[0] === '(auth)'
    const inCustomer = segments[0] === '(customer)'
    const inTailor = segments[0] === '(tailor)'
    const onResetPassword = inAuth && segments[1] === 'reset-password'
    // Passport claim links are public deep links — allow unauthenticated access
    // so customers who aren't signed in can still see the preview before logging in.
    const inPassport = segments[0] === 'passport'

    if (!session) {
      if (!inAuth && !inPassport) router.replace('/(auth)/welcome')
      return
    }

    // OAuth sign-in with no role yet — pick role before proceeding
    if (!role) {
      const onRoleSelect = segments[0] === '(auth)' && segments[1] === 'role-select'
      if (!onRoleSelect) router.replace('/(auth)/role-select')
      return
    }

    if (onResetPassword) {
      return
    }

    if (role === 'CUSTOMER') {
      if (!customerProfileChecked || customerCheckInProgress.current) return
      if (!customerProfileComplete) {
        // New customer — send to profile setup unless already there
        const onSetup = inAuth && segments[1] === 'customer-setup'
        if (!onSetup) router.replace('/(auth)/customer-setup')
        return
      }
      if (!inCustomer) router.replace('/(customer)')
    } else if (role === 'TAILOR') {
      if (!tailorProfileChecked || tailorCheckInProgress.current) return
      if (!tailorHasProfile || !tailorProfileCompleted) {
        // No profile row yet, or profile submitted but not yet completed — send to setup
        const onSetup = inTailor && segments[1] === 'profile' && segments[2] === 'setup'
        if (!onSetup) router.replace('/(tailor)/profile/setup')
        return
      }
      // Profile is complete — never redirect to setup again
      if (!inTailor) router.replace('/(tailor)')
    }
  }, [session, loading, role, segments, tailorProfileChecked, tailorHasProfile, tailorProfileCompleted, customerProfileChecked, customerProfileComplete])

  // Hide the native splash screen only once we know where to send the user.
  // Until then, preventAutoHideAsync() (called at module level) keeps it up —
  // so no JS route can flash through on app start or reload.
  const resolving =
    loading ||
    (!!session && role === 'CUSTOMER' && (!customerProfileChecked || customerCheckInProgress.current)) ||
    (!!session && role === 'TAILOR'    && (!tailorProfileChecked   || tailorCheckInProgress.current))

  useEffect(() => {
    if (!resolving) {
      SplashScreen.hideAsync()
    }
  }, [resolving])

  return null
}

export default function RootLayout() {
  return (
    <OptionalStripeProvider
      publishableKey={getStripePublishableKey()}
      urlScheme="drape"
      setReturnUrlSchemeOnAndroid
    >
      <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CustomerProfileProvider>
        <TailorProfileProvider>
        <RouteGuard />
        <BiometricGate />
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: Colors.bone },
            headerTintColor: Colors.ink,
            headerTitleStyle: { fontWeight: '600', color: Colors.ink },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: Colors.bone },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(customer)" options={{ headerShown: false }} />
          <Stack.Screen name="(tailor)" options={{ headerShown: false }} />
          <Stack.Screen name="passport" options={{ headerShown: false }} />
        </Stack>
        </TailorProfileProvider>
        </CustomerProfileProvider>
      </AuthProvider>
      </QueryClientProvider>
    </OptionalStripeProvider>
  )
}
