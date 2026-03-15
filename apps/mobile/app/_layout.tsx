import { useEffect, useState } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { AuthProvider, useAuth, useUserRole } from '@/lib/auth'
import { usePushNotifications } from '@/lib/notifications'
import { supabase } from '@/lib/supabase'
import { initSentry } from '@/lib/sentry'
import { initAnalytics, identify, reset } from '@/lib/analytics'
import { Colors } from '@/constants/theme'

initSentry()
initAnalytics()

function RouteGuard() {
  const { session, loading, user } = useAuth()
  const role = useUserRole()
  usePushNotifications(user?.id ?? null)
  const segments = useSegments()
  const router = useRouter()
  const [tailorProfileChecked, setTailorProfileChecked] = useState(false)
  const [tailorHasProfile, setTailorHasProfile] = useState(false)

  // Identify user in analytics when session starts; reset on sign-out
  useEffect(() => {
    if (user?.id) {
      identify(user.id, {
        role: role ?? undefined,
        email: user.email,
      })
    } else if (!loading) {
      reset()
    }
  }, [user?.id, loading])

  // When a tailor signs in, check whether they've completed setup
  useEffect(() => {
    if (role !== 'TAILOR' || !user?.id) return
    setTailorProfileChecked(false)
    supabase
      .from('tailor_profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setTailorHasProfile(!!data)
        setTailorProfileChecked(true)
      })
  }, [role, user?.id])

  useEffect(() => {
    if (loading) return

    const inAuth = segments[0] === '(auth)'
    const inCustomer = segments[0] === '(customer)'
    const inTailor = segments[0] === '(tailor)'

    if (!session) {
      if (!inAuth) router.replace('/(auth)/welcome')
      return
    }

    // OAuth sign-in with no role yet — pick role before proceeding
    if (!role) {
      const onRoleSelect = segments[0] === '(auth)' && segments[1] === 'role-select'
      if (!onRoleSelect) router.replace('/(auth)/role-select')
      return
    }

    if (role === 'CUSTOMER' && !inCustomer) {
      router.replace('/(customer)')
    } else if (role === 'TAILOR') {
      if (!inTailor) {
        router.replace('/(tailor)')
      } else if (tailorProfileChecked && !tailorHasProfile) {
        // New tailor — send to setup unless already there
        const onSetup = segments[1] === 'profile' && segments[2] === 'setup'
        if (!onSetup) router.replace('/(tailor)/profile/setup')
      }
    }
  }, [session, loading, role, segments, tailorProfileChecked, tailorHasProfile])

  return null
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RouteGuard />
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
      </Stack>
    </AuthProvider>
  )
}
