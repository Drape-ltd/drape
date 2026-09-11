export type ReadCacheAction =
  | 'tailor-shop'
  | 'seller-item'
  | 'explore-tailors'
  | 'tailor-profile'

// Marketplace visibility can change for trust, fraud, legal, or inventory reasons.
// Cross-request caching stays disabled until every reader consumes authoritative
// safety tombstones and one shared invalidation contract.
export const PUBLIC_READ_CACHE_CONTROL = 'no-store, max-age=0'
export const PRIVATE_READ_CACHE_CONTROL = 'private, no-store'

export function cacheControlForReadAction(action: ReadCacheAction) {
  return action === 'tailor-profile'
    ? PRIVATE_READ_CACHE_CONTROL
    : PUBLIC_READ_CACHE_CONTROL
}
