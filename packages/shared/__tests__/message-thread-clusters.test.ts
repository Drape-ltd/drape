import {
  clusterPositionForMessage,
  conversationClusterPositionForMessage,
  groupMessageMediaClusters,
  mediaClusterBoundsForMessage,
} from '../src/message-thread-clusters'

type TestMessage = {
  id: string
  sender_id: string
  created_at: string
  type: 'TEXT' | 'PHOTO' | 'VOICE'
  photo_url: string | null
  reply_to_id: string | null
  is_deleted: boolean
}

function photo(id: string, minute: number, extra?: Partial<TestMessage>): TestMessage {
  return {
    id,
    sender_id: 'sender-a',
    created_at: `2026-07-17T15:${String(minute).padStart(2, '0')}:00.000Z`,
    type: 'PHOTO',
    photo_url: `messages/order/${id}.jpg`,
    reply_to_id: null,
    is_deleted: false,
    ...extra,
  }
}

function text(id: string, minute: number, extra?: Partial<TestMessage>): TestMessage {
  return {
    id,
    sender_id: 'sender-a',
    created_at: `2026-07-17T15:${String(minute).padStart(2, '0')}:00.000Z`,
    type: 'TEXT',
    photo_url: null,
    reply_to_id: null,
    is_deleted: false,
    ...extra,
  }
}

describe('message thread media clustering', () => {
  it('marks a consecutive media run as start, middle, and end', () => {
    const messages = [
      photo('m1', 10),
      photo('m2', 10, { created_at: '2026-07-17T15:10:20.000Z' }),
      photo('m3', 10, { created_at: '2026-07-17T15:10:40.000Z' }),
    ]

    expect(clusterPositionForMessage(messages, 0)).toBe('start')
    expect(clusterPositionForMessage(messages, 1)).toBe('middle')
    expect(clusterPositionForMessage(messages, 2)).toBe('end')
  })

  it('treats a single media message as isolated', () => {
    const messages = [photo('solo', 12)]

    expect(clusterPositionForMessage(messages, 0)).toBe('isolated')
  })

  it('breaks the cluster when a text message interrupts the run', () => {
    const messages = [
      photo('m1', 14),
      text('t1', 14, { created_at: '2026-07-17T15:14:10.000Z' }),
      photo('m2', 14, { created_at: '2026-07-17T15:14:20.000Z' }),
    ]

    expect(clusterPositionForMessage(messages, 0)).toBe('isolated')
    expect(clusterPositionForMessage(messages, 2)).toBe('isolated')
  })

  it('breaks the cluster when sender changes or timestamps drift too far apart', () => {
    const messages = [
      photo('m1', 16),
      photo('m2', 16, { sender_id: 'sender-b', created_at: '2026-07-17T15:16:20.000Z' }),
      photo('m3', 19),
    ]

    expect(clusterPositionForMessage(messages, 0)).toBe('isolated')
    expect(clusterPositionForMessage(messages, 1)).toBe('isolated')
    expect(clusterPositionForMessage(messages, 2)).toBe('isolated')
  })

  it('keeps reply groups separated so different reply targets do not merge visually', () => {
    const messages = [
      photo('m1', 20, { reply_to_id: 'reply-a' }),
      photo('m2', 20, { created_at: '2026-07-17T15:20:20.000Z', reply_to_id: 'reply-b' }),
    ]

    expect(clusterPositionForMessage(messages, 0)).toBe('isolated')
    expect(clusterPositionForMessage(messages, 1)).toBe('isolated')
  })

  it('returns the complete media batch for each clustered message', () => {
    const messages = [
      photo('m1', 22),
      photo('m2', 22, { created_at: '2026-07-17T15:22:20.000Z' }),
      photo('m3', 22, { created_at: '2026-07-17T15:22:40.000Z' }),
    ]

    expect(mediaClusterBoundsForMessage(messages, 0)).toEqual({ start: 0, end: 2 })
    expect(mediaClusterBoundsForMessage(messages, 1)).toEqual({ start: 0, end: 2 })
    expect(mediaClusterBoundsForMessage(messages, 2)).toEqual({ start: 0, end: 2 })
  })

  it('keeps cluster bounds isolated across sender and time boundaries', () => {
    const messages = [
      photo('m1', 24),
      photo('m2', 24, { sender_id: 'sender-b', created_at: '2026-07-17T15:24:20.000Z' }),
      photo('m3', 27),
    ]

    expect(mediaClusterBoundsForMessage(messages, 0)).toEqual({ start: 0, end: 0 })
    expect(mediaClusterBoundsForMessage(messages, 1)).toEqual({ start: 1, end: 1 })
    expect(mediaClusterBoundsForMessage(messages, 2)).toEqual({ start: 2, end: 2 })
  })

  it('collapses a media batch into one display group without merging surrounding text', () => {
    const messages = [
      text('before', 28),
      photo('m1', 29),
      photo('m2', 29, { created_at: '2026-07-17T15:29:20.000Z' }),
      photo('m3', 29, { created_at: '2026-07-17T15:29:40.000Z' }),
      text('after', 30),
    ]

    expect(groupMessageMediaClusters(messages).map((group) => group.map((message) => message.id))).toEqual([
      ['before'],
      ['m1', 'm2', 'm3'],
      ['after'],
    ])
  })
})

describe('conversation bubble clustering', () => {
  it('clusters consecutive messages from the same sender across message types', () => {
    const messages = [
      text('first', 10),
      photo('second', 11),
      text('third', 12),
    ]

    expect(conversationClusterPositionForMessage(messages, 0)).toBe('start')
    expect(conversationClusterPositionForMessage(messages, 1)).toBe('middle')
    expect(conversationClusterPositionForMessage(messages, 2)).toBe('end')
  })

  it('breaks a cluster when the sender changes, time elapses, or a message is deleted', () => {
    const messages = [
      text('first', 10),
      text('other', 11, { sender_id: 'sender-b' }),
      text('later', 20),
      text('deleted', 21, { is_deleted: true }),
    ]

    expect(messages.map((_, index) => conversationClusterPositionForMessage(messages, index))).toEqual([
      'isolated',
      'isolated',
      'isolated',
      'isolated',
    ])
  })
})
