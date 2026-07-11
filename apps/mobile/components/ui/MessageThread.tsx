/**
 * Shared messaging thread component.
 * Used by both customer and tailor — pass senderId and the orderId.
 * Supports text, camera/library photo, and voice note messages.
 * Contact filter applied inline before send.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Keyboard,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { Audio } from 'expo-av'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase, invokeFunction } from '@/lib/supabase'
import { stripExif } from '@/lib/stripExif'
import { createValidatedUploadPayload } from '@/lib/storage-upload'
import { readFunctionErrorMessage, readFunctionErrorPayload } from '@/lib/function-errors'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { decodeDisplayText } from '@drape/shared/display-text'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { AvatarImage } from '@/components/ui/AvatarImage'
import { RemoteImage } from '@/components/ui/RemoteImage'

type MessageType = 'TEXT' | 'PHOTO' | 'VOICE'
type MessagePhotoSource = 'camera' | 'library'
type ThreadNotice = { tone: 'warning' | 'error'; text: string }

type Message = {
  id: string
  order_id: string
  sender_id: string
  sender_role: 'CUSTOMER' | 'TAILOR'
  sender_name: string
  type: MessageType
  body: string | null
  photo_url: string | null
  voice_url: string | null
  created_at: string
  read_at: string | null
}

type MessageReaction = {
  id: string
  message_id: string
  order_id: string
  user_id: string
  emoji: string
  created_at: string | null
}

interface Props {
  orderId: string
  currentUserId: string
  currentUserRole: 'CUSTOMER' | 'TAILOR'
  tailorName: string
  tailorAvatarUrl?: string | null
  customerName: string
  customerAvatarUrl?: string | null
  locked?: boolean
  lockedMessage?: string
  callAvailable?: boolean
  callLoading?: boolean
  onPressCall?: () => void
  callAccessibilityLabel?: string
}

// Rate limit: max 8 sends in 30 seconds
const RATE_LIMIT_COUNT = 8
const RATE_LIMIT_WINDOW_MS = 30_000

const MSG_PAGE_SIZE = 50
const MESSAGE_REACTION_OPTIONS = ['👍', '❤️', '😂', '😮', '🙏'] as const
const CONNECTIVITY_PATTERNS = [
  'network request failed',
  'failed to fetch',
  'fetch failed',
  'networkerror',
  'timed out',
  'connection lost',
  'offline',
  'internet connection appears to be offline',
]

function isAbsoluteMediaUrl(value: string) {
  return /^(https?:|file:|blob:|data:)/i.test(value)
}

function messageMediaPath(value: string) {
  return value.trim().replace(/^\/+/, '').replace(/^message-media\//, '')
}

function useMessageMediaUrl(value: string | null | undefined) {
  const immediateUrl = useMemo(() => {
    const raw = value?.trim()
    return raw && isAbsoluteMediaUrl(raw) ? raw : null
  }, [value])
  const storagePath = useMemo(() => {
    const raw = value?.trim()
    if (!raw || immediateUrl) return null
    return messageMediaPath(raw)
  }, [immediateUrl, value])
  const [signedUrl, setSignedUrl] = useState<{ path: string; url: string | null } | null>(null)

  useEffect(() => {
    if (!storagePath) return undefined
    let cancelled = false
    supabase.storage
      .from('message-media')
      .createSignedUrl(storagePath, 60 * 60)
      .then(({ data, error }) => {
        if (cancelled) return
        setSignedUrl({ path: storagePath, url: error ? null : data?.signedUrl ?? null })
      })

    return () => {
      cancelled = true
    }
  }, [storagePath])

  if (immediateUrl) return immediateUrl
  if (!storagePath) return null
  return signedUrl?.path === storagePath ? signedUrl.url : null
}

function parseDateValue(value: string | null | undefined) {
  if (!value) return null
  const normalized = /\dT\d/.test(value) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? `${value}Z` : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

function readErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage.trim()
    }
  }
  return null
}

function readPayloadString(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isLikelyConnectivityIssue(error: unknown) {
  const message = readErrorMessage(error)?.toLowerCase() ?? ''
  return CONNECTIVITY_PATTERNS.some((pattern) => message.includes(pattern))
}

async function resolveMessageSendFailure(error: Error | null, fallback: string) {
  const payload = error ? await readFunctionErrorPayload(error) : null
  const code = readPayloadString(payload, 'code')
  const payloadMessage = readPayloadString(payload, 'error')
  const rawMessage = payloadMessage ?? readErrorMessage(error) ?? fallback

  if (code === 'UNAUTHORIZED' || /session expired/i.test(rawMessage)) {
    return {
      title: 'Session expired',
      message: 'Please sign in again before sending messages.',
    }
  }

  if (code === 'BLOCKED_CONTACT') {
    return {
      title: 'Keep it on Drapeon',
      message: payloadMessage ?? "Contact details can't be shared in messages.",
      inlineMessage: payloadMessage ?? "Contact details can't be shared in messages.",
      showAlert: false,
    }
  }

  if (code === 'THREATENING_LANGUAGE') {
    return {
      title: 'Message blocked',
      message: payloadMessage ?? "That message can't be sent. Keep communication respectful.",
      inlineMessage: payloadMessage ?? "That message can't be sent. Keep communication respectful.",
      showAlert: false,
    }
  }

  if (code === 'CONVERSATION_BLOCKED') {
    return {
      title: 'Conversation paused',
      message: payloadMessage ?? 'This conversation is paused while Drapeon reviews a safety concern.',
      inlineMessage: payloadMessage ?? 'This conversation is paused while Drapeon reviews a safety concern.',
      showAlert: false,
    }
  }

  if (code === 'RATE_LIMITED') {
    return {
      title: 'Too many attempts',
      message: payloadMessage ?? 'You are sending messages too quickly. Please wait a moment before trying again.',
      rateLimited: true,
    }
  }

  if (code === 'ORDER_NOT_FOUND' || code === 'FORBIDDEN') {
    return {
      title: 'Thread unavailable',
      message: payloadMessage ?? 'This conversation is not available right now. Refresh the order and try again.',
    }
  }

  if (isLikelyConnectivityIssue(error)) {
    return {
      title: 'Message not sent',
      message: 'Your connection looks weak. We kept your draft here so you can retry when the signal stabilizes.',
      connectivity: true,
    }
  }

  return {
    title: 'Message not sent',
    message: await readFunctionErrorMessage(error, fallback),
  }
}

function resolveThreadLoadError(error: unknown, hasCachedMessages: boolean) {
  if (isLikelyConnectivityIssue(error)) {
    return hasCachedMessages
      ? 'Connection is weak. Existing messages stay visible. Refresh this thread when the signal improves.'
      : 'Connection is weak. We could not load this thread yet. Retry when the signal improves.'
  }

  if (hasCachedMessages) {
    return 'We could not refresh this conversation just now. Existing messages stay visible while you retry.'
  }

  return 'Could not load this conversation right now. Refresh the thread or reopen the order.'
}

function resolveMediaFailure(kind: 'photo' | 'voice', error: unknown) {
  if (isLikelyConnectivityIssue(error)) {
    return {
      title: kind === 'photo' ? 'Photo not sent' : 'Voice note not sent',
      message:
        kind === 'photo'
          ? 'Your connection looks weak. Retry this upload when the signal improves.'
          : 'Your connection looks weak. Retry this voice note when the signal improves.',
      connectivity: true,
    }
  }

  return {
    title: kind === 'photo' ? 'Photo not sent' : 'Voice note not sent',
    message:
      kind === 'photo'
        ? 'Could not send this photo right now. Please try again in a moment.'
        : 'Could not send this voice note right now. Please try again in a moment.',
    connectivity: false,
  }
}

export function MessageThread({
  orderId,
  currentUserId,
  currentUserRole,
  tailorName,
  tailorAvatarUrl,
  customerName,
  customerAvatarUrl,
  locked = false,
  lockedMessage,
  callAvailable = false,
  callLoading = false,
  onPressCall,
  callAccessibilityLabel = 'Open Drapeon call options',
}: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const messagesRef = useRef<Message[]>([])
  const [reactions, setReactions] = useState<MessageReaction[]>([])
  const [reactionsAvailable, setReactionsAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [refreshingThread, setRefreshingThread] = useState(false)
  const [hasEarlier, setHasEarlier] = useState(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const loadingEarlierRef = useRef(false)
  const optimisticReactionIdRef = useRef(0)
  const [loadError, setLoadError] = useState('')
  const [threadNotice, setThreadNotice] = useState<ThreadNotice | null>(null)
  const [text, setText] = useState('')
  const [textError, setTextError] = useState('')
  const [sending, setSending] = useState(false)
  const [rateLimited, setRateLimited] = useState(false)
  const [recording, setRecording] = useState<Audio.Recording | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const flatListRef = useRef<FlatList>(null)
  const sendTimestamps = useRef<number[]>([])
  const insets = useSafeAreaInsets()
  const composerBottomPadding = Math.max(insets.bottom + Spacing.sm, Spacing.md)

  const reactionsByMessageId = useMemo(() => {
    const grouped = new Map<string, MessageReaction[]>()
    for (const reaction of reactions) {
      const current = grouped.get(reaction.message_id) ?? []
      current.push(reaction)
      grouped.set(reaction.message_id, current)
    }
    return grouped
  }, [reactions])

  const fetchReactionsForMessageIds = useCallback(async (messageIds: string[]) => {
    if (messageIds.length === 0) {
      setReactions([])
      return
    }
    if (!reactionsAvailable) return

    const { data, error } = await supabase
      .from('message_reactions')
      .select('id, message_id, order_id, user_id, emoji, created_at')
      .eq('order_id', orderId)
      .in('message_id', messageIds)

    if (error) {
      setReactionsAvailable(false)
      setReactions([])
      return
    }

    setReactionsAvailable(true)
    setReactions((data ?? []) as MessageReaction[])
  }, [orderId, reactionsAvailable])

  const fetchMessages = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true
    if (silent) setRefreshingThread(true)
    else setLoading(true)
    setLoadError('')

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
        .limit(MSG_PAGE_SIZE)

      if (error) throw error

      const nextMessages = data ? ([...data].reverse() as Message[]) : []
      messagesRef.current = nextMessages
      setMessages(nextMessages)
      await fetchReactionsForMessageIds(nextMessages.map((message) => message.id))
      setHasEarlier((data?.length ?? 0) === MSG_PAGE_SIZE)
      setThreadNotice(null)
    } catch (error) {
      const hasCachedMessages = messagesRef.current.length > 0
      const message = resolveThreadLoadError(error, hasCachedMessages)
      if (hasCachedMessages) {
        setThreadNotice({ tone: 'warning', text: message })
      } else {
        setLoadError(message)
      }
    } finally {
      setRefreshingThread(false)
      setLoading(false)
    }
  }, [fetchReactionsForMessageIds, orderId])

  async function loadEarlier() {
    if (!hasEarlier || loadingEarlierRef.current || messages.length === 0) return
    loadingEarlierRef.current = true
    setLoadingEarlier(true)
    const oldest = messages[0].created_at
    try {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('order_id', orderId)
        .lt('created_at', oldest)
        .order('created_at', { ascending: false })
        .limit(MSG_PAGE_SIZE)

      if (data) {
        const earlierMessages = [...data].reverse() as Message[]
        const nextMessages = [...earlierMessages, ...messages]
        setMessages(nextMessages)
        messagesRef.current = nextMessages
        await fetchReactionsForMessageIds(nextMessages.map((message) => message.id))
        setHasEarlier(data.length === MSG_PAGE_SIZE)
      }
    } catch (error) {
      setThreadNotice({
        tone: 'warning',
        text: resolveThreadLoadError(error, true),
      })
    } finally {
      loadingEarlierRef.current = false
      setLoadingEarlier(false)
    }
  }

  useEffect(() => {
    const initialLoad = setTimeout(() => {
      void fetchMessages()
    }, 0)

    // Realtime subscription
    const channel = supabase
      .channel(`messages:${orderId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `order_id=eq.${orderId}` },
        (payload) => {
          setMessages((prev) => {
            if (prev.find((m) => m.id === payload.new.id)) return prev
            const nextMessages = [...prev, payload.new as Message]
            messagesRef.current = nextMessages
            return nextMessages
          })
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100)
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `order_id=eq.${orderId}` },
        (payload) => {
          setMessages((prev) => {
            const nextMessages = prev.map((message) =>
              message.id === payload.new.id ? { ...message, ...(payload.new as Partial<Message>) } : message
            )
            messagesRef.current = nextMessages
            return nextMessages
          })
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_reactions', filter: `order_id=eq.${orderId}` },
        (payload) => {
          const next = payload.new as MessageReaction
          setReactionsAvailable(true)
          setReactions((prev) => prev.some((reaction) => reaction.id === next.id) ? prev : [...prev, next])
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'message_reactions', filter: `order_id=eq.${orderId}` },
        (payload) => {
          const old = payload.old as Partial<MessageReaction>
          if (!old.id) return
          setReactions((prev) => prev.filter((reaction) => reaction.id !== old.id))
        }
      )
      .subscribe()

    return () => {
      clearTimeout(initialLoad)
      supabase.removeChannel(channel)
    }
  }, [fetchMessages, orderId])

  // Mark incoming messages as read
  useEffect(() => {
    if (messages.length === 0) return
    const unread = messages
      .filter((m) => m.sender_id !== currentUserId && !m.read_at)
      .map((m) => m.id)
    if (unread.length > 0) {
      const now = new Date().toISOString()
      supabase
        .from('messages')
        .update({ read_at: now })
        .in('id', unread)
        .then(({ error }) => {
          if (!error) {
            setMessages((prev) => prev.map((message) =>
              unread.includes(message.id) ? { ...message, read_at: message.read_at ?? now } : message
            ))
          }
        })
    }
  }, [messages, currentUserId])

  function checkRateLimit(): boolean {
    const now = Date.now()
    sendTimestamps.current = sendTimestamps.current.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS)
    if (sendTimestamps.current.length >= RATE_LIMIT_COUNT) {
      setRateLimited(true)
      setTimeout(() => setRateLimited(false), RATE_LIMIT_WINDOW_MS)
      return false
    }
    sendTimestamps.current.push(now)
    return true
  }

  function validateText(t: string): boolean {
    const res = filterContactInfo(t)
    if (res.blocked) {
      setTextError(res.userMessage)
      return false
    }
    setTextError('')
    return true
  }

  async function sendText() {
    if (!text.trim() || !validateText(text)) return
    if (!checkRateLimit()) return
    setSending(true)
    setThreadNotice(null)

    const { error } = await invokeFunction('message-action', {
      body: {
        action: 'send-message',
        orderId,
        type: 'TEXT',
        body: text.trim(),
      },
    })

    if (error) {
      const failure = await resolveMessageSendFailure(error, 'Could not send message. Please try again.')
      if (failure.inlineMessage) {
        setTextError(failure.inlineMessage)
      }
      if (failure.rateLimited) {
        setRateLimited(true)
        setTimeout(() => setRateLimited(false), RATE_LIMIT_WINDOW_MS)
      }
      if (failure.connectivity) {
        setThreadNotice({
          tone: 'warning',
          text: 'Connection looks weak. Your draft stayed in place so you can retry when the signal improves.',
        })
      }
      if (failure.showAlert !== false) {
        Alert.alert(failure.title, failure.message)
      }
    } else {
      setText('')
      setTextError('')
      await fetchMessages({ silent: true })
      Keyboard.dismiss()
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100)
    }
    setSending(false)
  }

  function openPhotoSourceSheet() {
    Alert.alert('Send photo', 'Take a photo now or choose one from your library.', [
      { text: 'Take photo', onPress: () => void sendPhotoFromSource('camera') },
      { text: 'Choose from library', onPress: () => void sendPhotoFromSource('library') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  async function pickMessagePhoto(source: MessagePhotoSource) {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()

    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        source === 'camera'
          ? 'Allow camera access to send a photo.'
          : 'Allow photo access to send an image.',
      )
      return null
    }

    const pickerOptions = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    }

    return source === 'camera'
      ? ImagePicker.launchCameraAsync(pickerOptions)
      : ImagePicker.launchImageLibraryAsync(pickerOptions)
  }

  async function sendPhotoFromSource(source: MessagePhotoSource) {
    if (!checkRateLimit()) return
    const result = await pickMessagePhoto(source)
    if (!result) return
    if (result.canceled || !result.assets[0]) return

    setSending(true)
    setThreadNotice(null)
    const cleanUri = await stripExif(result.assets[0].uri)
    const ext = 'jpg' // stripExif always outputs JPEG
    const filename = `messages/${orderId}/${Date.now()}.${ext}`

    try {
      const payload = await createValidatedUploadPayload(cleanUri, {
        maxBytes: 10 * 1024 * 1024,
        contentType: 'image/jpeg',
        purpose: 'MESSAGE_MEDIA',
      })
      const { error: uploadError } = await supabase.storage
        .from('message-media')
        .upload(filename, payload.data, { contentType: 'image/jpeg' })
      if (uploadError) throw uploadError

      const { error: insertError } = await invokeFunction('message-action', {
        body: {
          action: 'send-message',
          orderId,
          type: 'PHOTO',
          photoUrl: filename,
        },
      })
      if (insertError) throw insertError
      await fetchMessages()
    } catch (error) {
      const failure = resolveMediaFailure('photo', error)
      if (failure.connectivity) {
        setThreadNotice({
          tone: 'warning',
          text: 'Connection looks weak. Photo uploads can take longer, so retry when the signal improves.',
        })
      }
      Alert.alert(failure.title, failure.message)
    }
    setSending(false)
  }

  async function startRecording() {
    try {
      await Audio.requestPermissionsAsync()
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true })
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY)
      setRecording(rec)
      setIsRecording(true)
    } catch {
      Alert.alert('Microphone unavailable', 'Drapeon could not access your microphone. Check your phone permissions and try again.')
    }
  }

  async function stopRecording() {
    if (!recording) return
    setIsRecording(false)
    await recording.stopAndUnloadAsync()
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false })
    const uri = recording.getURI()
    setRecording(null)

    if (!uri) return

    setSending(true)
    setThreadNotice(null)
    const filename = `messages/${orderId}/${Date.now()}.m4a`
    try {
      const payload = await createValidatedUploadPayload(uri, 25 * 1024 * 1024)
      if (payload.byteLength > 25 * 1024 * 1024) {
        setSending(false)
        Alert.alert('Recording too large', 'Voice notes must be under 25 MB.')
        return
      }
      const { error: uploadError } = await supabase.storage.from('message-media').upload(filename, payload.data, { contentType: 'audio/m4a' })
      if (uploadError) throw uploadError

      const { error: insertError } = await invokeFunction('message-action', {
        body: {
          action: 'send-message',
          orderId,
          type: 'VOICE',
          voiceUrl: filename,
        },
      })
      if (insertError) throw insertError
      await fetchMessages()
    } catch (error) {
      const failure = resolveMediaFailure('voice', error)
      if (failure.connectivity) {
        setThreadNotice({
          tone: 'warning',
          text: 'Connection looks weak. Retry this voice note when the signal improves.',
        })
      }
      Alert.alert(failure.title, failure.message)
    }
    setSending(false)
  }

  async function toggleReaction(message: Message, emoji: string) {
    if (!reactionsAvailable) return
    const existing = reactions.find((reaction) => (
      reaction.message_id === message.id &&
      reaction.user_id === currentUserId &&
      reaction.emoji === emoji
    ))
    const previous = reactions

    if (existing) {
      setReactions((current) => current.filter((reaction) => reaction.id !== existing.id))
      const { error } = await supabase.from('message_reactions').delete().eq('id', existing.id)
      if (error) {
        setReactions(previous)
        Alert.alert('Reaction not saved', 'Could not update this reaction right now.')
      }
      return
    }

    optimisticReactionIdRef.current += 1
    const tempReaction: MessageReaction = {
      id: `local-${message.id}-${emoji}-${optimisticReactionIdRef.current}`,
      message_id: message.id,
      order_id: message.order_id,
      user_id: currentUserId,
      emoji,
      created_at: new Date().toISOString(),
    }
    setReactions((current) => [...current, tempReaction])
    const { data, error } = await supabase
      .from('message_reactions')
      .insert({
        message_id: message.id,
        order_id: message.order_id,
        user_id: currentUserId,
        emoji,
      })
      .select('id, message_id, order_id, user_id, emoji, created_at')
      .single()

    if (error) {
      setReactions(previous)
      Alert.alert('Reaction not saved', 'Could not update this reaction right now.')
      return
    }

    setReactions((current) => current.map((reaction) => (
      reaction.id === tempReaction.id ? data as MessageReaction : reaction
    )))
  }

  function openReactionSheet(message: Message) {
    if (!reactionsAvailable) return
    const messageReactions = reactionsByMessageId.get(message.id) ?? []
    Alert.alert('React to message', undefined, [
      ...MESSAGE_REACTION_OPTIONS.map((emoji) => {
        const selected = messageReactions.some((reaction) => reaction.user_id === currentUserId && reaction.emoji === emoji)
        const count = messageReactions.filter((reaction) => reaction.emoji === emoji).length
        return {
          text: `${selected ? 'Remove ' : ''}${emoji}${count > 0 ? ` ${count}` : ''}`,
          onPress: () => { void toggleReaction(message, emoji) },
        }
      }),
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  const otherName = currentUserRole === 'CUSTOMER' ? tailorName : customerName
  const otherAvatarUrl = currentUserRole === 'CUSTOMER' ? tailorAvatarUrl : customerAvatarUrl

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={Colors.needleGreen} size="large" />

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        ListHeaderComponent={
          hasEarlier ? (
            <TouchableOpacity style={styles.loadEarlierBtn} onPress={loadEarlier} disabled={loadingEarlier}>
              {loadingEarlier
                ? <ActivityIndicator size="small" color={Colors.needleGreen} />
                : <Text style={styles.loadEarlierText}>↑ Load earlier messages</Text>
              }
            </TouchableOpacity>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyCard}>
              <Text style={styles.emptyEyebrow}>Conversation</Text>
              {loadError ? (
                <>
                  <Text style={styles.emptyTitle}>Couldn't load messages.</Text>
                  <Text style={styles.emptyText}>{loadError}</Text>
                  <TouchableOpacity
                    style={styles.retryThreadBtn}
                    onPress={() => void fetchMessages({ silent: true })}
                    disabled={refreshingThread}
                  >
                    {refreshingThread
                      ? <ActivityIndicator size="small" color={Colors.textInverse} />
                      : <Text style={styles.retryThreadBtnText}>Refresh thread</Text>
                    }
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.emptyTitle}>No messages yet</Text>
                  <Text style={styles.emptyText}>Start the conversation with {otherName}. Keep updates and decisions here.</Text>
                </>
              )}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <MessageBubble
            message={item}
            isOwn={item.sender_id === currentUserId}
            avatarUrl={item.sender_id === currentUserId ? null : otherAvatarUrl}
            reactions={reactionsByMessageId.get(item.id) ?? []}
            currentUserId={currentUserId}
            reactionsAvailable={reactionsAvailable}
            onOpenReactions={() => openReactionSheet(item)}
            onToggleReaction={(emoji) => { void toggleReaction(item, emoji) }}
          />
        )}
      />

      {threadNotice ? (
        <View style={[styles.threadNotice, threadNotice.tone === 'error' && styles.threadNoticeError]}>
          <Text style={[styles.threadNoticeText, threadNotice.tone === 'error' && styles.threadNoticeTextError]}>
            {threadNotice.text}
          </Text>
          <TouchableOpacity
            style={styles.threadNoticeBtn}
            onPress={() => void fetchMessages({ silent: true })}
            disabled={refreshingThread}
          >
            <Text style={styles.threadNoticeBtnText}>{refreshingThread ? 'Refreshing…' : 'Refresh thread'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Locked banner — shown when order is terminal */}
      {locked ? (
        <View style={[styles.lockedBar, { paddingBottom: composerBottomPadding }]}>
          <Text style={styles.lockedText}>{lockedMessage ?? 'This conversation is closed. You can still read previous messages.'}</Text>
        </View>
      ) : (
        <>
          {/* Contact filter warning */}
          {textError ? (
            <View style={styles.filterWarning}>
              <Text style={styles.filterWarningText}>{textError}</Text>
            </View>
          ) : null}

          {/* Rate limit warning */}
          {rateLimited ? (
            <View style={styles.filterWarning}>
              <Text style={styles.filterWarningText}>You're sending messages too quickly. Please wait a moment.</Text>
            </View>
          ) : null}

          {/* Recording indicator */}
          {isRecording && (
            <View style={styles.recordingBar}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>Recording… release to send</Text>
            </View>
          )}

          {/* Input bar */}
          <View style={[styles.inputBar, { paddingBottom: composerBottomPadding }]}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={openPhotoSourceSheet}
              disabled={sending || rateLimited}
              accessibilityRole="button"
              accessibilityLabel="Attach photo"
            >
              <Feather name="paperclip" size={20} color={Colors.needleGreen} />
            </TouchableOpacity>

            <View style={styles.textInputWrap}>
              <TextInput
                style={styles.textInput}
                placeholder="Message…"
                placeholderTextColor={Colors.midGrey}
                value={text}
                onChangeText={(v) => {
                  setText(v)
                  if (textError) validateText(v)
                }}
                multiline
                maxLength={2000}
                returnKeyType="default"
                testID="message-input"
              />
              {text.length > 1200 ? (
                <Text style={styles.composerCounter}>{text.length}/2000</Text>
              ) : null}
            </View>

            <View style={styles.composerActions}>
              {callAvailable && onPressCall ? (
                <TouchableOpacity
                  style={styles.callBtn}
                  onPress={onPressCall}
                  disabled={sending || callLoading}
                  accessibilityRole="button"
                  accessibilityLabel={callAccessibilityLabel}
                >
                  {callLoading
                    ? <ActivityIndicator color={Colors.needleGreen} size="small" />
                    : <Feather name="phone-call" size={18} color={Colors.needleGreen} />
                  }
                </TouchableOpacity>
              ) : null}

              {text.trim() ? (
                <TouchableOpacity
                  style={styles.sendBtn}
                  onPress={sendText}
                  disabled={sending || !!textError || rateLimited}
                  accessibilityRole="button"
                  accessibilityLabel="Send message"
                >
                  {sending
                    ? <ActivityIndicator color={Colors.textInverse} size="small" />
                    : <Text style={styles.sendBtnText}>→</Text>
                  }
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.voiceBtn, isRecording && styles.voiceBtnActive]}
                  onPressIn={startRecording}
                  onPressOut={stopRecording}
                  disabled={sending}
                  accessibilityRole="button"
                  accessibilityLabel={isRecording ? 'Recording voice note' : 'Hold to record voice note'}
                >
                  <Feather
                    name="mic"
                    size={20}
                    color={isRecording ? Colors.textInverse : Colors.needleGreen}
                  />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </>
      )}
    </View>
  )
}

function MessageBubble({
  message,
  isOwn,
  avatarUrl,
  reactions,
  currentUserId,
  reactionsAvailable,
  onOpenReactions,
  onToggleReaction,
}: {
  message: Message
  isOwn: boolean
  avatarUrl?: string | null
  reactions: MessageReaction[]
  currentUserId: string
  reactionsAvailable: boolean
  onOpenReactions: () => void
  onToggleReaction: (emoji: string) => void
}) {
  const [sound, setSound] = useState<Audio.Sound | null>(null)
  const [playing, setPlaying] = useState(false)
  const photoUrl = useMessageMediaUrl(message.photo_url)
  const voiceUrl = useMessageMediaUrl(message.voice_url)

  async function toggleVoice() {
    if (!voiceUrl) return
    if (playing && sound) {
      await sound.pauseAsync()
      setPlaying(false)
      return
    }
    if (sound) {
      await sound.playAsync()
      setPlaying(true)
      return
    }
    const { sound: s } = await Audio.Sound.createAsync({ uri: voiceUrl })
    setSound(s)
    setPlaying(true)
    await s.playAsync()
    s.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        setPlaying(false)
        s.unloadAsync()
        setSound(null)
      }
    })
  }

  const time = (parseDateValue(message.created_at) ?? new Date()).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const receipt = message.read_at
    ? { text: '✓✓', label: 'Read', style: styles.readReceiptRead }
    : { text: '✓✓', label: 'Delivered', style: styles.readReceiptDelivered }
  const bodyText = decodeDisplayText(message.body ?? '')
  const reactionCounts = MESSAGE_REACTION_OPTIONS.map((emoji) => {
    const matching = reactions.filter((reaction) => reaction.emoji === emoji)
    return {
      emoji,
      count: matching.length,
      selected: matching.some((reaction) => reaction.user_id === currentUserId),
    }
  }).filter(({ count }) => count > 0)

  return (
    <View style={[styles.bubbleRow, isOwn && styles.bubbleRowOwn]}>
      {!isOwn ? (
        <AvatarImage
          uri={avatarUrl}
          initials={message.sender_name}
          size={32}
          style={styles.messageAvatar}
          borderColor={Colors.white}
          borderWidth={2}
        />
      ) : null}
      <TouchableOpacity
        activeOpacity={0.92}
        onLongPress={reactionsAvailable ? onOpenReactions : undefined}
        accessibilityRole="button"
        accessibilityHint={reactionsAvailable ? 'Long press to react to this message' : undefined}
        style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}
      >
        {!isOwn && <Text style={styles.senderName}>{message.sender_name}</Text>}

        {message.type === 'TEXT' && (
          <Text style={[styles.bubbleText, isOwn && styles.bubbleTextOwn]}>{bodyText}</Text>
        )}

        {message.type === 'PHOTO' && message.photo_url && (
          <RemoteImage
            uri={photoUrl}
            style={styles.bubblePhoto}
            contentFit="cover"
            transition={120}
            surface="message_photo"
            fallback={<View style={[styles.bubblePhoto, styles.photoFallback]} />}
          />
        )}

        {message.type === 'VOICE' && (
          <TouchableOpacity
            style={styles.voiceNote}
            onPress={toggleVoice}
            accessibilityRole="button"
            accessibilityLabel={playing ? 'Pause voice note' : 'Play voice note'}
          >
            <Text style={styles.voiceNoteIcon}>{playing ? '⏸' : '▶'}</Text>
            <View style={styles.voiceWave}>
              {[...Array(12)].map((_, i) => {
                const seed = message.id.charCodeAt(i % message.id.length)
                return <View key={i} style={[styles.voiceBar, { height: (seed % 12) + 4 }]} />
              })}
            </View>
            <Text style={styles.voiceNoteLabel}>Voice note</Text>
          </TouchableOpacity>
        )}

        <View style={styles.bubbleMeta}>
          <Text style={[styles.bubbleTime, isOwn && styles.bubbleTimeOwn]}>{time}</Text>
          {isOwn ? (
            <Text
              style={[styles.readReceipt, receipt.style]}
              accessibilityLabel={`Message ${receipt.label.toLowerCase()}`}
            >
              {receipt.text} {receipt.label}
            </Text>
          ) : null}
          {reactionsAvailable ? (
            <TouchableOpacity
              onPress={onOpenReactions}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="React to message"
            >
              <Feather name="smile" size={13} color={isOwn ? 'rgba(255,255,255,0.72)' : Colors.midGrey} />
            </TouchableOpacity>
          ) : null}
        </View>
        {reactionCounts.length > 0 ? (
          <View style={[styles.reactionSummary, isOwn && styles.reactionSummaryOwn]}>
            {reactionCounts.map(({ emoji, count, selected }) => (
              <TouchableOpacity
                key={emoji}
                style={[styles.reactionChip, selected && styles.reactionChipSelected, isOwn && styles.reactionChipOwn]}
                onPress={() => onToggleReaction(emoji)}
                accessibilityRole="button"
                accessibilityLabel={`${selected ? 'Remove' : 'Add'} ${emoji} reaction`}
              >
                <Text style={[
                  styles.reactionChipText,
                  isOwn && styles.reactionChipTextOwn,
                  selected && styles.reactionChipTextSelected,
                ]}>
                  {emoji} {count}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.md },

  loadEarlierBtn: {
    alignSelf: 'center', paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  loadEarlierText: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  empty: { paddingTop: 56, gap: Spacing.md, paddingHorizontal: Spacing.xl },
  emptyCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    alignSelf: 'stretch',
    ...Shadow.sm,
  },
  emptyEyebrow: {
    alignSelf: 'flex-start',
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  emptyText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 21 },
  retryThreadBtn: {
    marginTop: Spacing.sm,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    minHeight: 44,
  },
  retryThreadBtnText: { color: Colors.textInverse, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },

  lockedBar: {
    backgroundColor: Colors.lightGrey, paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.lightGrey,
    alignItems: 'center',
  },
  lockedText: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center' as const, lineHeight: 20 },

  filterWarning: {
    backgroundColor: Colors.kanteRustLight, paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.kanteRust + '30',
  },
  filterWarningText: { fontSize: FontSize.xs, color: Colors.kanteRust, lineHeight: 18 },
  threadNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    backgroundColor: Colors.boneDeep,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  threadNoticeError: {
    backgroundColor: Colors.errorLight,
    borderTopColor: Colors.error + '30',
  },
  threadNoticeText: {
    flex: 1,
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 18,
  },
  threadNoticeTextError: { color: Colors.error },
  threadNoticeBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  threadNoticeBtnText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
  },

  recordingBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.needleGreenLight, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
  },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.error },
  recordingText: { fontSize: FontSize.sm, color: Colors.needleGreen },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: Colors.lightGrey,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  textInputWrap: { flex: 1, gap: 3 },
  textInput: {
    backgroundColor: Colors.bone, borderRadius: Radius.xl,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    fontSize: FontSize.md, color: Colors.ink, maxHeight: 120,
  },
  composerCounter: {
    alignSelf: 'flex-end',
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    marginRight: Spacing.sm,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.needleGreen, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnText: { color: Colors.textInverse, fontSize: 18, fontWeight: FontWeight.bold },
  composerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  callBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '24',
  },
  voiceBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: Colors.needleGreenLight,
  },
  voiceBtnActive: { backgroundColor: Colors.needleGreen },

  bubbleRow: { flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'flex-end', gap: Spacing.xs },
  bubbleRowOwn: { justifyContent: 'flex-end' },
  messageAvatar: { marginBottom: 2 },
  bubble: {
    maxWidth: '78%', borderRadius: Radius.lg, padding: Spacing.md,
    gap: Spacing.xs,
  },
  bubbleOther: {
    backgroundColor: Colors.white, borderBottomLeftRadius: 4,
    ...Shadow.sm,
  },
  bubbleOwn: { backgroundColor: Colors.needleGreen, borderBottomRightRadius: 4 },
  senderName: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreen, fontFamily: Fonts.display },
  bubbleText: { fontSize: FontSize.md, color: Colors.ink, lineHeight: 22 },
  bubbleTextOwn: { color: Colors.textInverse },
  bubblePhoto: { width: 200, height: 200, borderRadius: Radius.md },
  photoFallback: { backgroundColor: Colors.boneDeep },
  voiceNote: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 2 },
  voiceNoteIcon: { fontSize: 18 },
  voiceWave: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2 },
  voiceBar: { width: 3, backgroundColor: Colors.needleGreen, borderRadius: 2 },
  voiceNoteLabel: { fontSize: FontSize.xs, color: Colors.inkLight },
  bubbleMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, justifyContent: 'flex-end' },
  bubbleTime: { fontSize: 10, color: Colors.midGrey },
  bubbleTimeOwn: { color: 'rgba(255,255,255,0.7)' },
  readReceipt: { fontSize: 10, fontWeight: FontWeight.semibold },
  readReceiptDelivered: { color: 'rgba(255,255,255,0.72)' },
  readReceiptRead: { color: Colors.accentLight },
  reactionSummary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  reactionSummaryOwn: {
    justifyContent: 'flex-end',
  },
  reactionChip: {
    borderRadius: Radius.full,
    backgroundColor: Colors.bone,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  reactionChipOwn: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  reactionChipSelected: {
    backgroundColor: Colors.needleGreenLight,
  },
  reactionChipText: {
    fontSize: 11,
    color: Colors.inkLight,
    fontWeight: FontWeight.semibold,
  },
  reactionChipTextOwn: {
    color: Colors.textInverse,
  },
  reactionChipTextSelected: {
    color: Colors.needleGreen,
  },
})
