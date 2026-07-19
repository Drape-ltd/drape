export type ClusterPosition = 'isolated' | 'start' | 'middle' | 'end'

export type ClusterableMessage = {
  sender_id: string
  created_at: string | null | undefined
  type: string | null | undefined
  photo_url: string | null | undefined
  reply_to_id?: string | null | undefined
  is_deleted?: boolean | null | undefined
}

const CLUSTER_WINDOW_MS = 90 * 1000

function parseTimestamp(value: string | null | undefined) {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function isMediaCandidate(message: ClusterableMessage | undefined) {
  return !!message &&
    message.type === 'PHOTO' &&
    !!message.photo_url &&
    message.is_deleted !== true
}

function canClusterTogether(a: ClusterableMessage | undefined, b: ClusterableMessage | undefined) {
  if (!a || !b) return false
  if (!isMediaCandidate(a) || !isMediaCandidate(b)) return false
  if (a.sender_id !== b.sender_id) return false
  if ((a.reply_to_id ?? null) !== (b.reply_to_id ?? null)) return false

  const aTime = parseTimestamp(a.created_at)
  const bTime = parseTimestamp(b.created_at)
  if (aTime == null || bTime == null) return false

  return Math.abs(aTime - bTime) <= CLUSTER_WINDOW_MS
}

export function clusterPositionForMessage(
  messages: ClusterableMessage[],
  index: number,
): ClusterPosition {
  const current = messages[index]
  if (!isMediaCandidate(current)) return 'isolated'

  const beforeMatches = canClusterTogether(messages[index - 1], current)
  const afterMatches = canClusterTogether(current, messages[index + 1])

  if (beforeMatches && afterMatches) return 'middle'
  if (beforeMatches) return 'end'
  if (afterMatches) return 'start'
  return 'isolated'
}

export function mediaClusterBoundsForMessage(
  messages: ClusterableMessage[],
  index: number,
): { start: number; end: number } {
  const current = messages[index]
  if (!isMediaCandidate(current)) return { start: index, end: index }

  let start = index
  let end = index

  while (start > 0 && canClusterTogether(messages[start - 1], messages[start])) {
    start -= 1
  }
  while (end < messages.length - 1 && canClusterTogether(messages[end], messages[end + 1])) {
    end += 1
  }

  return { start, end }
}

export function groupMessageMediaClusters<T extends ClusterableMessage>(messages: T[]): T[][] {
  const groups: T[][] = []
  let index = 0

  while (index < messages.length) {
    const bounds = mediaClusterBoundsForMessage(messages, index)
    const end = Math.max(index, bounds.end)
    groups.push(messages.slice(index, end + 1))
    index = end + 1
  }

  return groups
}
