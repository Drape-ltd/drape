import { Alert, Linking } from 'react-native'
import { invokeFunction } from './supabase'
import { isLikelyConnectivityIssue, isMachineErrorCodeMessage, readFunctionErrorPayload } from './function-errors'

type OrderCallType = 'audio' | 'video'

type OrderCallRoomResponse = {
  url?: string | null
  existing?: boolean
  fallback?: 'MESSAGES'
  message?: string
}

function readPayloadString(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key]
  if (typeof value !== 'string' || value.trim().length === 0) return null
  const trimmed = value.trim()
  return key === 'code' || !isMachineErrorCodeMessage(trimmed) ? trimmed : null
}

export async function openDrapeCallUrl(url: string) {
  const supported = await Linking.canOpenURL(url)
  if (!supported) {
    Alert.alert('Unable to open call', 'This Drapeon call link is unavailable right now.')
    return false
  }

  try {
    await Linking.openURL(url)
    return true
  } catch {
    Alert.alert('Unable to open call', 'Please try again in a moment.')
    return false
  }
}

export async function createOrderCallRoom(orderId: string, callType: OrderCallType) {
  const { data, error } = await invokeFunction<OrderCallRoomResponse>('create-order-call-room', {
    body: { orderId, callType },
  })

  if (!error && data?.url) {
    return {
      url: data.url,
      existing: data.existing === true,
    }
  }

  if (!error && data?.fallback === 'MESSAGES') {
    const message =
      typeof data.message === 'string' && data.message.trim().length > 0
        ? data.message.trim()
        : 'Drapeon calling is unavailable right now. Continue inside Messages so the order record stays complete.'
    Alert.alert('Use order messages', message)
    return {
      fallback: 'MESSAGES' as const,
      message,
    }
  }

  const payload = error ? await readFunctionErrorPayload(error) : null
  const code = readPayloadString(payload, 'code')
  const payloadMessage = readPayloadString(payload, 'message') ?? readPayloadString(payload, 'error')

  if (isLikelyConnectivityIssue(error)) {
    Alert.alert('Call unavailable', 'Connection looks weak. Keep using messages and retry the Drapeon call when the signal improves.')
    return null
  }

  switch (code) {
    case 'DAILY_NOT_CONFIGURED':
      Alert.alert('Call unavailable', payloadMessage ?? 'Drapeon calling is not configured in this environment yet.')
      return null
    case 'ORDER_CALL_NOT_READY':
      Alert.alert('Call unavailable', payloadMessage ?? 'Drapeon calling opens once pickup or delivery is actively in progress.')
      return null
    case 'ORDER_CALL_NOT_SCHEDULED':
      Alert.alert('Schedule the call first', payloadMessage ?? 'Schedule this ready-made order call from Messages first.')
      return null
    case 'ORDER_CALL_TOO_EARLY':
      Alert.alert('Call not open yet', payloadMessage ?? 'This ready-made order call opens around the scheduled time.')
      return null
    case 'ORDER_CALL_EXPIRED':
    case 'ORDER_CALL_INVALID_TIME':
      Alert.alert('Schedule a new call', payloadMessage ?? 'This ready-made order call needs a new scheduled time.')
      return null
    case 'ORDER_NOT_FOUND':
    case 'FORBIDDEN':
      Alert.alert('Call unavailable', payloadMessage ?? 'This Drapeon call is no longer available from this account.')
      return null
    case 'DAILY_UNAVAILABLE':
      Alert.alert('Call unavailable', payloadMessage ?? 'Drapeon calls are temporarily unavailable. Keep using messages and try again shortly.')
      return null
    case 'ROOM_PERSIST_FAILED':
      Alert.alert('Call unavailable', payloadMessage ?? 'The Drapeon call could not be attached to this order cleanly. Refresh and try again.')
      return null
    case 'RATE_LIMITED':
      Alert.alert('Too many attempts', payloadMessage ?? 'Please wait a moment before trying another Drapeon call.')
      return null
    case 'UNAUTHORIZED':
      Alert.alert('Session expired', payloadMessage ?? 'Please sign in again before starting a Drapeon call.')
      return null
    default:
      Alert.alert('Call unavailable', payloadMessage ?? 'Could not start the Drapeon call right now.')
      return null
  }
}
