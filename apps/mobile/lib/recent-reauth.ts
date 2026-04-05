import AsyncStorage from '@react-native-async-storage/async-storage'

const RECENT_REAUTH_KEY = 'drape.recent_reauth'

export const RECENT_REAUTH_WINDOW_MINUTES = 10
export const RECENT_REAUTH_WINDOW_MS = RECENT_REAUTH_WINDOW_MINUTES * 60 * 1000

type RecentReauthRecord = {
  userId: string
  at: number
}

async function readRecentReauth(): Promise<RecentReauthRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_REAUTH_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<RecentReauthRecord>
    if (typeof parsed.userId !== 'string' || typeof parsed.at !== 'number') {
      return null
    }

    return { userId: parsed.userId, at: parsed.at }
  } catch {
    return null
  }
}

export async function markRecentReauth(userId: string | null | undefined): Promise<void> {
  if (!userId) return

  try {
    await AsyncStorage.setItem(
      RECENT_REAUTH_KEY,
      JSON.stringify({ userId, at: Date.now() } satisfies RecentReauthRecord),
    )
  } catch {
    // Best effort only.
  }
}

export async function hasRecentReauth(
  userId: string | null | undefined,
  maxAgeMs = RECENT_REAUTH_WINDOW_MS,
): Promise<boolean> {
  if (!userId) return false

  const record = await readRecentReauth()
  if (!record || record.userId !== userId) return false

  return Date.now() - record.at <= maxAgeMs
}

export async function clearRecentReauth(userId?: string | null): Promise<void> {
  try {
    if (!userId) {
      await AsyncStorage.removeItem(RECENT_REAUTH_KEY)
      return
    }

    const record = await readRecentReauth()
    if (record?.userId === userId) {
      await AsyncStorage.removeItem(RECENT_REAUTH_KEY)
    }
  } catch {
    // Best effort only.
  }
}
