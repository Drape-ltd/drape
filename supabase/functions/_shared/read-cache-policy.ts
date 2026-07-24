export type ReadCacheAction =
  | 'tailor-shop'
  | 'seller-item'
  | 'explore-tailors'
  | 'tailor-profile'

export const PUBLIC_READ_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=120'
export const PRIVATE_READ_CACHE_CONTROL = 'private, no-store'

export function cacheControlForReadAction(action: ReadCacheAction) {
  return action === 'tailor-profile'
    ? PRIVATE_READ_CACHE_CONTROL
    : PUBLIC_READ_CACHE_CONTROL
}
