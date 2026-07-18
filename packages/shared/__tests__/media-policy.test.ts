import { videoPosterFrameUrl } from '../src/media-policy'

describe('media policy helpers', () => {
  it('adds a first-frame fragment to video URLs while preserving query params', () => {
    expect(videoPosterFrameUrl('https://cdn.drape.test/item.mov?token=abc')).toBe(
      'https://cdn.drape.test/item.mov?token=abc#t=0.001',
    )
  })

  it('replaces stale media fragments with the first-frame fragment', () => {
    expect(videoPosterFrameUrl('https://cdn.drape.test/item.mp4#t=2')).toBe(
      'https://cdn.drape.test/item.mp4#t=0.001',
    )
  })
})
