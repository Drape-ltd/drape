import {
  IDENTITY_CONSENT_COPY,
  IDENTITY_CONSENT_POLICY_VERSION,
  TAILOR_TRUST_VIDEO_CHALLENGES,
  TAILOR_TRUST_VIDEO_MAX_SECONDS,
  TAILOR_TRUST_VIDEO_MIN_SECONDS,
} from '../src/identity-trust'

describe('tailor trust video policy', () => {
  it('uses a versioned consent statement for private marketplace trust review', () => {
    expect(IDENTITY_CONSENT_POLICY_VERSION).toBe('tailor-trust-video-v1')
    expect(IDENTITY_CONSENT_COPY).toContain('challenge video')
    expect(IDENTITY_CONSENT_COPY).toContain('stays private')
  })

  it('keeps the capture short and provides distinct randomized challenges', () => {
    expect(TAILOR_TRUST_VIDEO_MIN_SECONDS).toBe(8)
    expect(TAILOR_TRUST_VIDEO_MAX_SECONDS).toBe(15)
    expect(TAILOR_TRUST_VIDEO_CHALLENGES.length).toBeGreaterThanOrEqual(3)
    expect(new Set(TAILOR_TRUST_VIDEO_CHALLENGES.map((challenge) => challenge.id)).size)
      .toBe(TAILOR_TRUST_VIDEO_CHALLENGES.length)
  })
})
