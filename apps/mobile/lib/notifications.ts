/**
 * Drapeon push notification setup.
 * Registers the device for Expo push notifications and stores the token
 * in the user's profile row. Also handles foreground notification display.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import { type NotificationResponse } from 'expo-notifications'
import { useRouter } from 'expo-router'
import type { Href } from 'expo-router'
import { useUserRole } from './auth'
import { registerPushInstallation } from './push-registration'
import { Sentry } from './sentry'
import { supabase } from './supabase'

function isCallJoinData(data: Record<string, unknown>) {
  return isUuid(data.orderId) && data.target === 'call-join'
}

// How foreground notifications look. Call invitations still use the in-app
// surface below, but the system banner and sound must remain visible as backup.
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

const CALL_NOTIFICATION_CHANNEL_ID = 'calls'
const CALL_START_NOTIFICATION_KEY_PREFIX = 'drapeon:call-start-notification'

const EXPO_PROJECT_ID =
  process.env.EXPO_PUBLIC_PROJECT_ID?.trim()
  || '4729d6f8-273a-43a9-abdf-6e4ca31ce83d'

type NotificationSubscription = ReturnType<typeof Notifications.addNotificationReceivedListener>
const pushRegistrationByUser = new Map<string, Promise<void>>()

export type ForegroundCallInvite = {
  notificationId: string
  orderId: string
  callKind: 'consultation' | 'ready-made'
  callType: 'audio' | 'video'
  title: string
  body: string
}

export type ForegroundNotificationNotice = {
  notificationId: string
  title: string
  body: string
  path: string | null
}

let currentForegroundCallInvite: ForegroundCallInvite | null = null
const foregroundCallInviteListeners = new Set<(invite: ForegroundCallInvite | null) => void>()
let currentForegroundNotificationNotice: ForegroundNotificationNotice | null = null
const foregroundNotificationListeners =
  new Set<(notice: ForegroundNotificationNotice | null) => void>()

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function readForegroundCallInvite(
  notification: Notifications.Notification,
): ForegroundCallInvite | null {
  const content = notification.request.content
  const data = (content.data ?? {}) as Record<string, unknown>
  if (!isCallJoinData(data)) return null

  return {
    notificationId: notification.request.identifier,
    orderId: data.orderId as string,
    callKind: data.callKind === 'consultation' ? 'consultation' : 'ready-made',
    callType: data.callType === 'audio' ? 'audio' : 'video',
    title: content.title?.trim() || 'Drapeon call ready',
    body: content.body?.trim() || 'Your protected order call is ready. Join when you are available.',
  }
}

function publishForegroundCallInvite(invite: ForegroundCallInvite | null) {
  currentForegroundCallInvite = invite
  foregroundCallInviteListeners.forEach((listener) => listener(invite))
}

export function useForegroundCallInvite() {
  const [invite, setInvite] = useState(currentForegroundCallInvite)

  useEffect(() => {
    foregroundCallInviteListeners.add(setInvite)
    return () => {
      foregroundCallInviteListeners.delete(setInvite)
    }
  }, [])

  const dismiss = useCallback(() => {
    publishForegroundCallInvite(null)
  }, [])

  return { invite, dismiss }
}

function publishForegroundNotificationNotice(notice: ForegroundNotificationNotice | null) {
  currentForegroundNotificationNotice = notice
  foregroundNotificationListeners.forEach((listener) => listener(notice))
}

export function useForegroundNotificationNotice() {
  const [notice, setNotice] = useState(currentForegroundNotificationNotice)

  useEffect(() => {
    foregroundNotificationListeners.add(setNotice)
    return () => {
      foregroundNotificationListeners.delete(setNotice)
    }
  }, [])

  const dismiss = useCallback(() => {
    publishForegroundNotificationNotice(null)
  }, [])

  return { notice, dismiss }
}

function resolveNotificationPath(
  role: 'CUSTOMER' | 'TAILOR',
  data: Record<string, unknown>,
) {
  const base = role === 'TAILOR' ? '/(tailor)' : '/(customer)'
  const target = typeof data.target === 'string' ? data.target : null
  const destination = typeof data.destination === 'string' ? data.destination : null
  const screen = typeof data.screen === 'string' ? data.screen : null
  const orderId = isUuid(data.orderId) ? data.orderId : null
  const eventId = isUuid(data.eventId) ? data.eventId : null
  const messageId = isUuid(data.messageId) ? data.messageId : null
  const rawCallKind = typeof data.callKind === 'string' ? data.callKind : null
  const rawCallType = typeof data.callType === 'string' ? data.callType : null
  const callKind = rawCallKind === 'consultation' || rawCallKind === 'ready-made' ? rawCallKind : null
  const callType = rawCallType === 'audio' ? 'audio' : 'video'
  const notificationType = typeof data.type === 'string' ? data.type : null

  if (orderId && target === 'call-join') {
    const params = new URLSearchParams({
      orderId,
      callKind: callKind ?? 'ready-made',
      callType,
    })
    return `/call-join?${params.toString()}`
  }

  if (orderId && (target === 'messages' || destination === 'messages')) {
    const focusParams = new URLSearchParams()
    if (eventId) focusParams.set('eventId', eventId)
    if (messageId) focusParams.set('messageId', messageId)
    const query = focusParams.toString()
    return `${base}/messages/${orderId}${query ? `?${query}` : ''}`
  }

  if (orderId) {
    return `${base}/orders/${orderId}`
  }

  if (role === 'TAILOR' && notificationType === 'tailor_verification_decision') {
    return '/(tailor)/profile'
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

    const syncRegistration = () => {
      void syncPushRegistration(userId)
    }

    syncRegistration()
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncRegistration()
    })

    return () => appStateSubscription.remove()
  }, [userId])

  useEffect(() => {
    if (!userId || !role) return
    const activeRole = role

    // Foreground: show notification
    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      const callInvite = readForegroundCallInvite(notification)
      if (callInvite) {
        publishForegroundCallInvite(callInvite)
        return
      }

      const content = notification.request.content
      const data = (content.data ?? {}) as Record<string, unknown>
      publishForegroundNotificationNotice({
        notificationId: notification.request.identifier,
        title: content.title?.trim() || 'Drapeon update',
        body: content.body?.trim() || 'There is a new update waiting for you.',
        path: resolveNotificationPath(activeRole, data),
      })
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

export function syncPushRegistration(userId: string) {
  const activeRegistration = pushRegistrationByUser.get(userId)
  if (activeRegistration) return activeRegistration

  const registration = registerAndStore(userId).finally(() => {
    pushRegistrationByUser.delete(userId)
  })
  pushRegistrationByUser.set(userId, registration)
  return registration
}

async function registerAndStore(userId: string) {
  try {
    Sentry.addBreadcrumb({
      category: 'push',
      message: 'Push registration started',
      level: 'info',
      data: { platform: Platform.OS, projectIdConfigured: !!process.env.EXPO_PUBLIC_PROJECT_ID?.trim() },
    })

    const existingPermission = await Notifications.getPermissionsAsync()
    let finalStatus = existingPermission.status

    if (finalStatus !== 'granted' && existingPermission.canAskAgain) {
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
      await Notifications.setNotificationChannelAsync(CALL_NOTIFICATION_CHANNEL_ID, {
        name: 'Drapeon calls',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 450, 160, 450, 160, 450],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        sound: 'default',
      })
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: EXPO_PROJECT_ID,
    })

    const token = tokenData.data

    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || authData.user?.id !== userId) {
      Sentry.addBreadcrumb({
        category: 'push',
        message: 'Push token storage skipped because the session is no longer valid',
        level: 'warning',
        data: {
          expectedUserId: userId,
          authenticatedUserId: authData.user?.id ?? null,
          authStatus: authError?.status ?? null,
        },
      })
      return
    }

    await registerPushInstallation(token)

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
    content: { title, body, data: data ?? {}, sound: 'default' },
    trigger: null, // fire immediately
  })
}

export async function scheduleCallStartLocalNotification({
  orderId,
  callKind,
  scheduledStartAt,
  counterpartName,
}: {
  orderId: string
  callKind: 'consultation' | 'ready-made'
  scheduledStartAt: Date | string
  counterpartName?: string | null
}) {
  const date = scheduledStartAt instanceof Date ? scheduledStartAt : new Date(scheduledStartAt)
  const storageKey = `${CALL_START_NOTIFICATION_KEY_PREFIX}:${callKind}:${orderId}`
  const previousNotificationId = await AsyncStorage.getItem(storageKey).catch(() => null)
  if (previousNotificationId) {
    await Notifications.cancelScheduledNotificationAsync(previousNotificationId).catch(() => {})
    await AsyncStorage.removeItem(storageKey).catch(() => {})
  }

  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) return null

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: callKind === 'consultation' ? 'Consultation starting now' : 'Order call starting now',
      body: counterpartName?.trim()
        ? `Your call with ${counterpartName.trim()} is starting now. Tap to join.`
        : 'Your Drapeon call is starting now. Tap to join.',
      data: {
        orderId,
        target: 'call-join',
        callKind,
        callType: 'video',
      },
      sound: 'default',
      interruptionLevel: 'timeSensitive',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date,
      channelId: CALL_NOTIFICATION_CHANNEL_ID,
    },
  })
  await AsyncStorage.setItem(storageKey, notificationId).catch(() => {})
  return notificationId
}
