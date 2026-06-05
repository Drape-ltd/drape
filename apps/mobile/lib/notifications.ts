/**
 * Drapeon push notification setup.
 * Registers the device for Expo push notifications and stores the token
 * in the user's profile row. Also handles foreground notification display.
 */
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import { type NotificationResponse } from 'expo-notifications'
import { useRouter } from 'expo-router'
import type { Href } from 'expo-router'
import { useUserRole } from './auth'
import { Sentry } from './sentry'
import { supabase } from './supabase'

// How foreground notifications look
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

const ALLOWED_SCREENS = new Set([
  '/(customer)/orders',
  '/(customer)/profile/notifications',
  '/(tailor)/orders',
  '/(tailor)/profile/notifications',
])

const EXPO_PROJECT_ID =
  process.env.EXPO_PUBLIC_PROJECT_ID?.trim()
  || '4729d6f8-273a-43a9-abdf-6e4ca31ce83d'

type NotificationSubscription = ReturnType<typeof Notifications.addNotificationReceivedListener>

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function resolveNotificationPath(
  role: 'CUSTOMER' | 'TAILOR',
  data: Record<string, unknown>,
) {
  const base = role === 'TAILOR' ? '/(tailor)' : '/(customer)'
  const target = typeof data.target === 'string' ? data.target : null
  const screen = typeof data.screen === 'string' ? data.screen : null
  const orderId = isUuid(data.orderId) ? data.orderId : null

  if (orderId && target === 'messages') {
    return `${base}/messages/${orderId}`
  }

  if (orderId) {
    return `${base}/orders/${orderId}`
  }

  if (screen && ALLOWED_SCREENS.has(screen)) {
    return screen
  }

  return null
}

/**
 * Call this hook once in the root layout (inside AuthProvider).
 * Registers push token, stores it in DB, and sets up tap-to-navigate.
 */
export function usePushNotifications(userId: string | null) {
  const router = useRouter()
  const role = useUserRole()
  const notificationListener = useRef<NotificationSubscription | null>(null)
  const responseListener = useRef<NotificationSubscription | null>(null)
  const handledResponseIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!userId) return

    void registerAndStore(userId)
  }, [userId])

  useEffect(() => {
    if (!userId || !role) return
    const activeRole = role

    // Foreground: show notification
    notificationListener.current = Notifications.addNotificationReceivedListener(() => {
      // Already displayed by setNotificationHandler above
    })

    function handleNotificationResponse(response: NotificationResponse | null) {
      if (!response) return

      const identifier = response.notification.request.identifier
      if (handledResponseIds.current.has(identifier)) return

      handledResponseIds.current.add(identifier)

      const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>
      const nextPath = resolveNotificationPath(activeRole, data)
      if (nextPath) {
        router.push(nextPath as Href)
      }
    }

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      handleNotificationResponse(response)
    })

    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationResponse(response)
    })

    return () => {
      notificationListener.current?.remove()
      responseListener.current?.remove()
    }
  }, [userId, role, router])
}

async function registerAndStore(userId: string) {
  try {
    Sentry.addBreadcrumb({
      category: 'push',
      message: 'Push registration started',
      level: 'info',
      data: { platform: Platform.OS, projectIdConfigured: !!process.env.EXPO_PUBLIC_PROJECT_ID?.trim() },
    })

    const { status: existing } = await Notifications.getPermissionsAsync()
    let finalStatus = existing

    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }

    if (finalStatus !== 'granted') {
      Sentry.addBreadcrumb({
        category: 'push',
        message: 'Push permission not granted',
        level: 'warning',
        data: { status: finalStatus },
      })
      return
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Drapeon',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      })
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: EXPO_PROJECT_ID,
    })

    const token = tokenData.data

    // Store token in Supabase — upsert so re-installs update cleanly
    const { error } = await supabase.from('push_tokens').upsert(
      { user_id: userId, token, platform: Platform.OS, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )

    if (error) {
      throw new Error(`Could not save push token: ${error.message}`)
    }

    Sentry.addBreadcrumb({
      category: 'push',
      message: 'Push token stored',
      level: 'info',
      data: { platform: Platform.OS },
    })
  } catch (error) {
    if (__DEV__) console.warn('Drapeon push registration failed', error)
    Sentry.captureException(error, {
      extra: {
        context: 'push_token_registration',
        projectIdConfigured: !!process.env.EXPO_PUBLIC_PROJECT_ID?.trim(),
        fallbackProjectIdUsed: !process.env.EXPO_PUBLIC_PROJECT_ID?.trim(),
      },
    })
  }
}

/**
 * Utility: send a local notification (for testing without a push server).
 */
export async function sendLocalNotification(title: string, body: string, data?: Record<string, string>) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: data ?? {} },
    trigger: null, // fire immediately
  })
}
