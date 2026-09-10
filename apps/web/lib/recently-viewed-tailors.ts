export type RecentlyViewedTailor = {
  id: string
  displayName: string
  location: string
  photo: string | null
  viewedAt: string
}

const key = (userId: string) => `drape_recently_viewed_tailors:${userId}`

export function loadRecentlyViewedTailors(userId: string): RecentlyViewedTailor[] {
  try {
    const raw = window.localStorage.getItem(key(userId))
    if (!raw) return []
    const value = JSON.parse(raw) as RecentlyViewedTailor[]
    return Array.isArray(value) ? value.slice(0, 8) : []
  } catch {
    return []
  }
}

export function recordRecentlyViewedTailor(
  userId: string,
  tailor: Omit<RecentlyViewedTailor, 'viewedAt'>
) {
  const next = [
    { ...tailor, viewedAt: new Date().toISOString() },
    ...loadRecentlyViewedTailors(userId).filter(({ id }) => id !== tailor.id),
  ].slice(0, 8)
  window.localStorage.setItem(key(userId), JSON.stringify(next))
}
