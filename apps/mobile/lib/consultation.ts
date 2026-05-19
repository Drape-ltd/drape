import { Alert, Linking } from 'react-native'
import { isLikelyConnectivityIssue, isMachineErrorCodeMessage, readFunctionErrorMessage, readFunctionErrorPayload } from '@/lib/function-errors'
import { invokeFunction } from '@/lib/supabase'

type ConsultationAudience = 'customer' | 'tailor' | 'generic'
type ConsultationCallType = 'audio' | 'video'

type ConsultationRoomResponse = {
  url: string
  existing?: boolean
}

function readPayloadString(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key]
  if (typeof value !== 'string' || value.trim().length === 0) return null
  const trimmed = value.trim()
  return key === 'code' || !isMachineErrorCodeMessage(trimmed) ? trimmed : null
}

function callUnavailableMessage(audience: ConsultationAudience) {
  if (audience === 'customer') {
    return 'This consultation link is unavailable right now. Keep the order thread open and ask your tailor to resend the consultation details.'
  }

  if (audience === 'tailor') {
    return 'This consultation link is unavailable right now. Reopen the order and create a fresh consultation room if needed.'
  }

  return 'This call link is unavailable right now.'
}

function callOpenFailedMessage(audience: ConsultationAudience) {
  if (audience === 'customer') {
    return 'Please try again in a moment. If it still fails, ask your tailor for a fresh consultation link in Messages.'
  }

  if (audience === 'tailor') {
    return 'Please try again in a moment. If it still fails, create a fresh consultation room from the order screen.'
  }

  return 'Please try again in a moment.'
}

export async function openConsultationCallUrl(
  url: string,
  audience: ConsultationAudience = 'generic',
) {
  const supported = await Linking.canOpenURL(url)
  if (!supported) {
    Alert.alert('Unable to open call', callUnavailableMessage(audience))
    return false
  }

  try {
    await Linking.openURL(url)
    return true
  } catch {
    Alert.alert('Unable to open call', callOpenFailedMessage(audience))
    return false
  }
}

export async function createConsultationRoom(
  orderId: string,
  callType: ConsultationCallType,
) {
  const { data, error } = await invokeFunction<ConsultationRoomResponse>('create-consultation-room', {
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
  const payloadMessage = readPayloadString(payload, 'message') ?? readPayloadString(payload, 'error')
  const message = await readFunctionErrorMessage(error, 'Could not start the consultation call right now.')

  if (/session expired/i.test(message)) {
    Alert.alert('Session expired', 'Please sign in again before starting a consultation call.')
    return null
  }

  if (isLikelyConnectivityIssue(error)) {
    Alert.alert(
      'Call unavailable',
      'Connection looks weak. Keep using the order thread and retry starting the consultation when the signal improves.',
    )
    return null
  }

  switch (code) {
    case 'DAILY_NOT_CONFIGURED':
      Alert.alert('Consultation unavailable', payloadMessage ?? 'Consultation calling is not configured in this environment yet.')
      return null
    case 'CONSULTATION_NOT_READY':
    case 'CONSULTATION_NOT_APPROVED':
    case 'CONSULTATION_PAYMENT_REQUIRED':
    case 'CONSULTATION_NOT_OPEN_YET':
      Alert.alert('Consultation not ready', payloadMessage ?? 'This order is no longer in the consultation stage. Refresh the order first.')
      return null
    case 'ORDER_NOT_FOUND':
    case 'FORBIDDEN':
      Alert.alert('Call unavailable', payloadMessage ?? 'This consultation room is no longer available from this account.')
      return null
    case 'DAILY_UNAVAILABLE':
      Alert.alert('Call unavailable', payloadMessage ?? 'Consultation calls are temporarily unavailable. Keep using messages and try again shortly.')
      return null
    case 'ROOM_PERSIST_FAILED':
      Alert.alert('Call unavailable', payloadMessage ?? 'The consultation room could not be attached to this order cleanly. Refresh and try again.')
      return null
    case 'RATE_LIMITED':
      Alert.alert('Too many attempts', payloadMessage ?? 'Please wait a moment before trying to start another consultation call.')
      return null
    case 'UNAUTHORIZED':
      Alert.alert('Session expired', payloadMessage ?? 'Please sign in again before starting a consultation call.')
      return null
    default:
      Alert.alert('Call unavailable', message)
      return null
  }
}
