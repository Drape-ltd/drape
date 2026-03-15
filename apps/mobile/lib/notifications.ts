/**
 * Drape push notification setup.
 * Registers the device for Expo push notifications and stores the token
 * in the user's profile row. Also handles foreground notification display.
 */
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import { type Subscription } from 'expo-notifications'
import { useRouter } from 'expo-router'
import { useUserRole } from './auth'
import { supabase } from './supabase'

// How foreground notifications look
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

/**
 * Call this hook once in the root layout (inside AuthProvider).
 * Registers push token, stores it in DB, and sets up tap-to-navigate.
 */
export function usePushNotifications(userId: string | null) {
  const router = useRouter()
  const role = useUserRole()
  const notificationListener = useRef<Subscription>()
  const responseListener = useRef<Subscription>()

  useEffect(() => {
    if (!userId) return

    registerAndStore(userId)

    // Foreground: show notification
    notificationListener.current = Notifications.addNotificationReceivedListener((_notification) => {
      // Already displayed by setNotificationHandler above
    })

    // Tap on notification — navigate to relevant screen by role
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, string>
      if (data?.orderId) {
        const base = role === 'TAILOR' ? '/(tailor)' : '/(customer)'
        router.push(`${base}/orders/${data.orderId}`)
      } else if (data?.screen) {
        router.push(data.screen as any)
      }
    })

    return () => {
      if (notificationListener.current) Notifications.removeNotificationSubscription(notificationListener.current)
      if (responseListener.current) Notifications.removeNotificationSubscription(responseListener.current)
    }
  }, [userId])
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
