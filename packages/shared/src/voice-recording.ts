export const VOICE_RECORDING_ERRORS = {
  unsupported: 'Voice recording requires a secure browser connection with microphone support.',
  permission: 'Microphone access is blocked. Allow microphone access in your browser settings and try again.',
  missing: 'No microphone was found on this device.',
  busy: 'Your microphone is busy in another app or browser tab.',
  format: 'This browser cannot create a cross-platform voice note. Update Chrome or Safari and try again.',
  unknown: 'Voice recording could not start. Please try again.',
} as const

export function voiceRecordingErrorMessage(error: unknown) {
  const name = typeof error === 'object' && error !== null && 'name' in error
    ? String(error.name)
    : ''
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : ''

  if (name === 'NotAllowedError' || name === 'SecurityError') return VOICE_RECORDING_ERRORS.permission
  if (name === 'NotFoundError') return VOICE_RECORDING_ERRORS.missing
  if (name === 'NotReadableError') return VOICE_RECORDING_ERRORS.busy
  if (message === 'CROSS_PLATFORM_VOICE_UNSUPPORTED') return VOICE_RECORDING_ERRORS.format
  return VOICE_RECORDING_ERRORS.unknown
}
