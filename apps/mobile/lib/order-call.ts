import { Alert, Linking } from 'react-native'
import { invokeFunction } from './supabase'
import { isLikelyConnectivityIssue, readFunctionErrorPayload } from './function-errors'

type OrderCallType = 'audio' | 'video'

type OrderCallRoomResponse = {
  url: string
  existing?: boolean
}

function readPayloadString(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export async function openDrapeCallUrl(url: string) {
  const supported = await Linking.canOpenURL(url)
  if (!supported) {
    Alert.alert('Unable to open call', 'This Drape call link is unavailable right now.')
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

  const payload = error ? await readFunctionErrorPayload(error) : null
  const code = readPayloadString(payload, 'code')
  const payloadMessage = readPayloadString(payload, 'error')

  if (isLikelyConnectivityIssue(error)) {
    Alert.alert('Call unavailable', 'Connection looks weak. Keep using messages and retry the Drape call when the signal improves.')
    return null
  }

  switch (code) {
    case 'DAILY_NOT_CONFIGURED':
      Alert.alert('Call unavailable', payloadMessage ?? 'Drape calling is not configured in this environment yet.')
      return null
    case 'ORDER_CALL_NOT_READY':
      Alert.alert('Call unavailable', payloadMessage ?? 'Drape calling opens once pickup or delivery is actively in progress.')
      return null
    case 'ORDER_NOT_FOUND':
    case 'FORBIDDEN':
      Alert.alert('Call unavailable', payloadMessage ?? 'This Drape call is no longer available from this account.')
      return null
    case 'DAILY_UNAVAILABLE':
      Alert.alert('Call unavailable', payloadMessage ?? 'Drape calls are temporarily unavailable. Keep using messages and try again shortly.')
      return null
    case 'ROOM_PERSIST_FAILED':
      Alert.alert('Call unavailable', payloadMessage ?? 'The Drape call could not be attached to this order cleanly. Refresh and try again.')
      return null
    case 'RATE_LIMITED':
      Alert.alert('Too many attempts', payloadMessage ?? 'Please wait a moment before trying another Drape call.')
      return null
    case 'UNAUTHORIZED':
      Alert.alert('Session expired', payloadMessage ?? 'Please sign in again before starting a Drape call.')
      return null
    default:
      Alert.alert('Call unavailable', payloadMessage ?? 'Could not start the Drape call right now.')
      return null
  }
}
