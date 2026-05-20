import AsyncStorage from '@react-native-async-storage/async-storage'
import type { StorageImageBucket } from '@/lib/image-url'

export type RecentlyViewedTailor = {
  id: string
  displayName: string
  location: string
  sellerType: 'TAILOR' | 'BOUTIQUE' | 'TAILOR_SHOP'
  specialtyTags: string[]
  avgRating: number
  totalReviews: number
  tier: string
  priceRangeMin: number | null
  priceRangeMax: number | null
  avatarUrl: string | null
  portfolioPhoto: string | null
  exploreImageBucket: StorageImageBucket | null
  availability: string
  supportsCustomOrders: boolean
  supportsReadyMade: boolean
  avgResponseHours?: number | null
  rankingScore: number
}

const RECENTLY_VIEWED_KEY = 'drape_recently_viewed_tailors'
const MAX_RECENTLY_VIEWED = 10

function storageKey(userId: string | undefined) {
  return `${RECENTLY_VIEWED_KEY}:${userId ?? 'guest'}`
}

export async function saveRecentlyViewedTailor<T extends RecentlyViewedTailor>(
  userId: string | undefined,
  tailor: T
) {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId))
    const existing: T[] = raw ? JSON.parse(raw) : []
    const updated = [tailor, ...existing.filter((item) => item.id !== tailor.id)].slice(
      0,
      MAX_RECENTLY_VIEWED
    )
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(updated))
  } catch {
    // Recently viewed is a local convenience cache; never block navigation on it.
  }
}

export async function loadRecentlyViewedTailors<T extends RecentlyViewedTailor = RecentlyViewedTailor>(
  userId: string | undefined
): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}
