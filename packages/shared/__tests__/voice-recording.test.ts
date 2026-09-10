import { VOICE_RECORDING_ERRORS, voiceRecordingErrorMessage } from '../src/voice-recording'

describe('web voice recording failures', () => {
  it.each(['NotAllowedError', 'SecurityError'])('explains blocked microphone access for %s', (name) => {
    expect(voiceRecordingErrorMessage({ name })).toBe(VOICE_RECORDING_ERRORS.permission)
  })

  it('distinguishes missing and busy microphones', () => {
    expect(voiceRecordingErrorMessage({ name: 'NotFoundError' })).toBe(VOICE_RECORDING_ERRORS.missing)
    expect(voiceRecordingErrorMessage({ name: 'NotReadableError' })).toBe(VOICE_RECORDING_ERRORS.busy)
  })

  it('explains cross-platform encoding failures without hiding unknown failures', () => {
    expect(voiceRecordingErrorMessage({ message: 'CROSS_PLATFORM_VOICE_UNSUPPORTED' })).toBe(
      VOICE_RECORDING_ERRORS.format
    )
    expect(voiceRecordingErrorMessage(new Error('unexpected'))).toBe(VOICE_RECORDING_ERRORS.unknown)
  })
})
