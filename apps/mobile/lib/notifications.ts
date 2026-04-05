/**
 * Drape push notification setup.
 * Registers the device for Expo push notifications and stores the token
 * in the user's profile row. Also handles foreground notification display.
 */
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import { type NotificationResponse } from 'expo-notifications'
import { useRouter } from 'expo-router'
import { useUserRole } from './auth'
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
    notificationListener.current = Notifications.addNotificationReceivedListener((_notification) => {
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
        router.push(nextPath as any)
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
    const { status: existing } = await Notifications.getPermissionsAsync()
    let finalStatus = existing

    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }

    if (finalStatus !== 'granted') return // User declined — don't store

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
    })

    const token = tokenData.data

    // Android: set notification channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Drape',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      })
    }

    // Store token in Supabase — upsert so re-installs update cleanly
    await supabase.from('push_tokens').upsert(
      { user_id: userId, token, platform: Platform.OS, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
  } catch {
    // Non-fatal — app works without push
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
