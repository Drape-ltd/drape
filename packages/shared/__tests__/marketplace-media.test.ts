import { marketplaceMediaObjectPosition, normalizeFocalPoint } from '../src/marketplace-media'

describe('marketplace media presentation', () => {
  it('keeps valid normalized focal coordinates', () => {
    expect(normalizeFocalPoint(0.28)).toBe(0.28)
  })

  it('bounds invalid presentation coordinates', () => {
    expect(normalizeFocalPoint(-2)).toBe(0)
    expect(normalizeFocalPoint(3)).toBe(1)
    expect(normalizeFocalPoint(Number.NaN)).toBe(0.5)
  })

  it('creates a CSS object position from canonical media', () => {
    expect(marketplaceMediaObjectPosition({ focalX: 0.25, focalY: 0.7 })).toBe('25% 70%')
  })
})
