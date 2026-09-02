export type MarketplaceMediaKind = 'IMAGE' | 'VIDEO'

export type MarketplaceMedia = {
  id: string
  kind: MarketplaceMediaKind
  url: string
  posterUrl: string | null
  width: number | null
  height: number | null
  focalX: number
  focalY: number
  altText: string | null
  isPrimary: boolean
  position: number
}

export function normalizeFocalPoint(value: unknown, fallback = 0.5): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

export function marketplaceMediaObjectPosition(media: Pick<MarketplaceMedia, 'focalX' | 'focalY'>): string {
  return `${normalizeFocalPoint(media.focalX) * 100}% ${normalizeFocalPoint(media.focalY) * 100}%`
}
