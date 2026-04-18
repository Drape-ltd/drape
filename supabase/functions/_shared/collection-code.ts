export const MAX_COLLECTION_CODE_ATTEMPTS = 5
export const COLLECTION_CODE_RESET_WINDOW_MS = 24 * 60 * 60 * 1000

type CollectionCodeState = {
  attempts?: number | null
  lastAttemptAt?: string | null
  updatedAt?: string | null
}

function parseTimestamp(value: string | null | undefined) {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function readCollectionCodeAttempts(state: CollectionCodeState) {
  return Math.max(0, state.attempts ?? 0)
}

export function readCollectionCodeLastAttemptAt(state: CollectionCodeState) {
  return parseTimestamp(state.lastAttemptAt) ?? parseTimestamp(state.updatedAt)
}

export function shouldResetCollectionCodeAttempts(
  state: CollectionCodeState,
  now = Date.now(),
) {
  const attempts = readCollectionCodeAttempts(state)
  if (attempts === 0) return false
  const lastAttemptAt = readCollectionCodeLastAttemptAt(state)
  if (lastAttemptAt == null) return false
  return now - lastAttemptAt >= COLLECTION_CODE_RESET_WINDOW_MS
}
