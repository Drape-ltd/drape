/**
 * Shared messaging thread component.
 * Used by both customer and tailor — pass senderId and the orderId.
 * Supports text, camera/library photo, and voice note messages.
 * Contact filter applied inline before send.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Keyboard,
  PanResponder, Animated, Vibration, AppState,
} from 'react-native'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { Audio } from 'expo-av'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase, invokeFunction } from '@/lib/supabase'
import { stripExif } from '@/lib/stripExif'
import { createValidatedUploadPayload } from '@/lib/storage-upload'
import { readFunctionErrorMessage, readFunctionErrorPayload } from '@/lib/function-errors'
import { launchImagePickerSafely, preferCompatibleVideoRepresentation } from '@/lib/image-picker-safe'
import * as FileSystem from 'expo-file-system'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { decodeDisplayText } from '@drape/shared/display-text'
import {
  groupMessageMediaClusters,
  type ClusterPosition,
} from '@drape/shared/message-thread-clusters'
import {
  callSchedulingReasonFor,
  formatCallCountdown,
  getCallLifecycleState,
} from '@drape/shared/call-scheduling-policy'
import {
  deriveOrderConversationActions,
  ORDER_EVENT_LABELS,
  type OrderConversationAction,
  type OrderEvent,
  type QuoteRevisionRequest,
} from '@drape/shared/order-negotiation'
import type { OrderStage } from '@drape/shared/order-machine'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { MOBILE_FEATURE_FLAGS } from '@/lib/feature-flags'
import { AvatarImage } from '@/components/ui/AvatarImage'
import { RemoteImage } from '@/components/ui/RemoteImage'
import { PortfolioVideoPreview } from '@/components/ui/PortfolioVideoPreview'
import { BottomSheetScaffold } from './BottomSheetScaffold'
import type { MediaLightboxItem } from './MediaLightboxModal'
import { DrapeMediaViewer } from './DrapeMediaViewer'
import { DrapeMediaMosaic, type DrapeMediaMosaicItem } from './DrapeMediaMosaic'
import { DrapeVoicePlayer } from './DrapeVoicePlayer'
import {
  DrapeCapsuleButton,
  DrapeIconButton,
  DrapeInlineActionCard,
  DrapeSheet,
  DrapeStatusChip,
} from './DrapePrimitives'
import {
  ALLOWED_IMAGE_CONTENT_TYPES,
  ALLOWED_VIDEO_CONTENT_TYPES,
  MEDIA_LIMITS_BYTES,
  MEDIA_LIMITS_SECONDS,
  OPERATIONAL_VIDEO_DURATION_LIMIT_MESSAGE,
  isVideoMediaUrl,
} from '@drape/shared/media-policy'

type MessageType = 'TEXT' | 'PHOTO' | 'VOICE'
type MessageMediaSource = 'camera-photo' | 'camera-video' | 'library'
type ThreadNotice = { tone: 'warning' | 'error'; text: string }
type CallLifecycleEvent = {
  kind: 'consultation' | 'ready-made'
  scheduledStartAt: string | null | undefined
  timezone?: string | null
  reason?: string | null
  status?: string | null
  paymentRequired?: boolean
  paymentPaid?: boolean
  actionLoading?: boolean
  onJoinVideo?: () => void
  onReschedule?: () => void
  rescheduleLabel?: string
  paymentActionLabel?: string | null
  onPressPayment?: () => void
}

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
  is_deleted: boolean
  edited_at: string | null
  reply_to_id: string | null
}

type MessageReaction = {
  id: string
  message_id: string
  order_id: string
  user_id: string
  emoji: string
  created_at: string | null
}

type MessageMediaPreview = {
  items: MediaLightboxItem[]
  index: number
}

type ThreadEntry =
  | { kind: 'messages'; key: string; createdAt: string; messages: Message[] }
  | { kind: 'event'; key: string; createdAt: string; event: OrderEvent }

type NegotiationState = {
  activeQuote: { id: string; version: number; status: 'ACTIVE' } | null
  openRevision: Pick<QuoteRevisionRequest, 'id' | 'status' | 'roundNumber'> | null
  roundsUsed: number
  roundLimit: number
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
  callBlocked?: boolean
  callGateMessage?: string | null
  callGateActionLabel?: string | null
  onPressCallGateAction?: () => void
  callLifecycleEvent?: CallLifecycleEvent | null
  orderKind?: 'CUSTOM' | 'READY_MADE'
  orderStage?: OrderStage
  focusedEventId?: string | null
  focusedMessageId?: string | null
  onConversationAction?: (action: OrderConversationAction) => void
}

// Rate limit: max 8 sends in 30 seconds
const RATE_LIMIT_COUNT = 8
const RATE_LIMIT_WINDOW_MS = 30_000
const MESSAGE_VIDEO_MAX_BYTES = MEDIA_LIMITS_BYTES.messageVideo
const MESSAGE_VIDEO_MAX_SECONDS = MEDIA_LIMITS_SECONDS.messageVideo
const MESSAGE_MEDIA_TILE_SIZE = 216
const CHAT_ORDER_ACTIONS_ENABLED = MOBILE_FEATURE_FLAGS.chatOrderActionsV1
const MESSAGE_SIGNED_URL_CACHE_WINDOW_MS = 50 * 60 * 1000
const messageSignedUrlCache = new Map<string, { url: string; expiresAt: number }>()

function cachedMessageSignedUrl(path: string) {
  const cached = messageSignedUrlCache.get(path)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    messageSignedUrlCache.delete(path)
    return null
  }
  return cached.url
}

function cacheMessageSignedUrl(path: string, url: string) {
  messageSignedUrlCache.set(path, {
    url,
    expiresAt: Date.now() + MESSAGE_SIGNED_URL_CACHE_WINDOW_MS,
  })
}
const COMPOSER_CONTEXT_BAR_MIN_HEIGHT = 56

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

function isWithin15Minutes(isoString: string) {
  const raw = /\dT\d/.test(isoString) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(isoString) ? `${isoString}Z` : isoString
  const date = new Date(raw)
  return !Number.isNaN(date.getTime()) && Date.now() - date.getTime() < 15 * 60 * 1000
}

function isAbsoluteMediaUrl(value: string) {
  return /^(https?:|file:|blob:|data:)/i.test(value)
}

function messageMediaPath(value: string) {
  return value.trim().replace(/^\/+/, '').replace(/^message-media\//, '')
}

function extensionFromAsset(asset: ImagePicker.ImagePickerAsset) {
  const raw = asset.fileName || asset.uri.split('?')[0]?.split('/').pop() || ''
  return raw.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || ''
}

function isMessageVideoAsset(asset: ImagePicker.ImagePickerAsset) {
  const mimeType = asset.mimeType?.split(';')[0]?.trim().toLowerCase() ?? ''
  return asset.type === 'video' || mimeType.startsWith('video/') || /\.(mp4|mov|m4v)(?:$|\?)/iu.test(asset.uri)
}

function messageVideoContentType(asset: ImagePicker.ImagePickerAsset) {
  const normalizedMime = asset.mimeType?.split(';')[0]?.trim().toLowerCase()
  if (normalizedMime && ALLOWED_VIDEO_CONTENT_TYPES.includes(normalizedMime as (typeof ALLOWED_VIDEO_CONTENT_TYPES)[number])) {
    return normalizedMime
  }
  const extension = extensionFromAsset(asset)
  if (extension === 'mov' || extension === 'qt') return 'video/quicktime'
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4'
  return normalizedMime ?? 'video/mp4'
}

function messageVideoExtension(asset: ImagePicker.ImagePickerAsset) {
  const extension = extensionFromAsset(asset)
  if (extension === 'mov' || extension === 'qt') return 'mov'
  return 'mp4'
}

function messageVideoDurationSeconds(asset: ImagePicker.ImagePickerAsset) {
  if (typeof asset.duration !== 'number' || !Number.isFinite(asset.duration) || asset.duration <= 0) return null
  return asset.duration > 1000 ? asset.duration / 1000 : asset.duration
}

function validateMessageVideoAsset(asset: ImagePicker.ImagePickerAsset) {
  const contentType = messageVideoContentType(asset)
  if (!ALLOWED_VIDEO_CONTENT_TYPES.includes(contentType as (typeof ALLOWED_VIDEO_CONTENT_TYPES)[number])) {
    return 'Choose an MP4 or MOV video.'
  }
  if (typeof asset.fileSize === 'number' && asset.fileSize > MESSAGE_VIDEO_MAX_BYTES) {
    return `Choose videos under ${Math.round(MESSAGE_VIDEO_MAX_BYTES / (1024 * 1024))} MB.`
  }
  const durationSeconds = messageVideoDurationSeconds(asset)
  if (durationSeconds != null && durationSeconds > MESSAGE_VIDEO_MAX_SECONDS) {
    return OPERATIONAL_VIDEO_DURATION_LIMIT_MESSAGE
  }
  return null
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
    if (cachedMessageSignedUrl(storagePath)) return undefined
    let cancelled = false
    supabase.storage
      .from('message-media')
      .createSignedUrl(storagePath, 60 * 60)
      .then(({ data, error }) => {
        if (cancelled) return
        const url = error ? null : data?.signedUrl ?? null
        if (url) cacheMessageSignedUrl(storagePath, url)
        setSignedUrl({ path: storagePath, url })
      })

    return () => {
      cancelled = true
    }
  }, [storagePath])

  if (immediateUrl) return immediateUrl
  if (!storagePath) return null
  const cachedUrl = cachedMessageSignedUrl(storagePath)
  if (cachedUrl) return cachedUrl
  return signedUrl?.path === storagePath ? signedUrl.url : null
}

function useMessageMediaUrls(messages: Message[]) {
  const signature = messages.map((message) => `${message.id}:${message.photo_url ?? ''}`).join('|')
  const [resolvedBatch, setResolvedBatch] = useState<{ signature: string; urls: Map<string, string> } | null>(null)

  useEffect(() => {
    const immediateUrls = new Map<string, string>()
    const unresolvedPaths: string[] = []
    const messageIdByPath = new Map<string, string>()

    for (const message of messages) {
      const raw = message.photo_url?.trim()
      if (!raw) continue
      if (isAbsoluteMediaUrl(raw)) {
        immediateUrls.set(message.id, raw)
        continue
      }
      const path = messageMediaPath(raw)
      const cachedUrl = cachedMessageSignedUrl(path)
      if (cachedUrl) {
        immediateUrls.set(message.id, cachedUrl)
      } else {
        unresolvedPaths.push(path)
        messageIdByPath.set(path, message.id)
      }
    }

    if (unresolvedPaths.length === 0) {
      setResolvedBatch({ signature, urls: immediateUrls })
      return undefined
    }

    let cancelled = false
    setResolvedBatch({ signature, urls: immediateUrls })
    supabase.storage
      .from('message-media')
      .createSignedUrls(unresolvedPaths, 60 * 60)
      .then(({ data, error }) => {
        if (cancelled || error || !data) return
        const urls = new Map(immediateUrls)
        for (const result of data) {
          if (!result.path || !result.signedUrl) continue
          cacheMessageSignedUrl(result.path, result.signedUrl)
          const messageId = messageIdByPath.get(result.path)
          if (messageId) urls.set(messageId, result.signedUrl)
        }
        setResolvedBatch({ signature, urls })
      })

    return () => {
      cancelled = true
    }
  }, [messages, signature])

  return resolvedBatch?.signature === signature ? resolvedBatch.urls : new Map<string, string>()
}

function messageMediaPreviewItems(
  messages: Message[],
  resolvedMessageId?: string,
  resolvedUri?: string | null,
) {
  const mediaMessages = messages.filter((message) => message.type === 'PHOTO' && !!message.photo_url)

  return mediaMessages
    .map((message, index) => {
      const uri = message.photo_url!
      const isVideo = isVideoMediaUrl(uri)
      return {
        uri,
        resolvedUri: message.id === resolvedMessageId ? resolvedUri ?? undefined : undefined,
        label: `${isVideo ? 'Video' : 'Photo'} ${index + 1} of ${mediaMessages.length}`,
        contextId: message.id,
        kind: isVideo ? 'video' : 'photo',
        bucket: 'message-media',
        requiresSignedUrl: !isAbsoluteMediaUrl(uri),
      } satisfies MediaLightboxItem
    })
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

function formatPresenceTime(isoString: string): string {
  const date = parseDateValue(isoString)
  if (!date) return 'recently'
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function resolveMediaFailure(kind: 'photo' | 'video' | 'voice', error: unknown) {
  const label = kind === 'voice' ? 'Voice note' : kind === 'video' ? 'Video' : 'Photo'
  if (isLikelyConnectivityIssue(error)) {
    const message =
      kind === 'voice'
        ? 'Your connection looks weak. Retry this voice note when the signal improves.'
        : kind === 'video'
          ? 'Your connection looks weak. Retry this video when the signal improves.'
          : 'Your connection looks weak. Retry this upload when the signal improves.'
    return {
      title: `${label} not sent`,
      message,
      connectivity: true,
    }
  }

  return {
    title: `${label} not sent`,
    message:
      kind === 'voice'
        ? 'Could not send this voice note right now. Please try again in a moment.'
        : kind === 'video'
          ? 'Could not send this video right now. Please try again in a moment.'
          : 'Could not send this photo right now. Please try again in a moment.',
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
  callBlocked = false,
  callGateMessage,
  callGateActionLabel,
  onPressCallGateAction,
  callLifecycleEvent,
  orderKind = 'CUSTOM',
  orderStage,
  focusedEventId,
  focusedMessageId,
  onConversationAction,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const messagesRef = useRef<Message[]>([])
  const [contextMenuMessage, setContextMenuMessage] = useState<Message | null>(null)
  const [mediaPreview, setMediaPreview] = useState<MessageMediaPreview | null>(null)
  const [orderEvents, setOrderEvents] = useState<OrderEvent[]>([])
  const [negotiationState, setNegotiationState] = useState<NegotiationState>({
    activeQuote: null,
    openRevision: null,
    roundsUsed: 0,
    roundLimit: 3,
  })
  const [showConversationActions, setShowConversationActions] = useState(false)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [editingMessage, setEditingMessage] = useState<Message | null>(null)
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
  const [isRecording, setIsRecording] = useState(false)
  const [showCancelHint, setShowCancelHint] = useState(false)
  const recordingRef = useRef<Audio.Recording | null>(null)
  const recordingStartingRef = useRef(false)
  const recordingStoppingRef = useRef(false)
  const recordingGestureActiveRef = useRef(false)
  const recordingStopRequestedRef = useRef(false)
  const recordingSessionRef = useRef(0)
  const isCancelledRef = useRef(false)
  const sendingRef = useRef(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typingClearRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const appStateRef = useRef(AppState.currentState)
  const [counterpartyIsTyping, setCounterpartyIsTyping] = useState(false)
  const [counterpartyPresence, setCounterpartyPresence] = useState<{ online: boolean; lastSeen: string | null }>({ online: false, lastSeen: null })
  // PanResponder is created once; callbacks read only from refs so stale closures are safe
  const micPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !sendingRef.current,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        recordingGestureActiveRef.current = true
        recordingStopRequestedRef.current = false
        void startRecording()
      },
      onPanResponderMove: (_, g) => {
        if (g.dx < -60 && !isCancelledRef.current) {
          isCancelledRef.current = true
          setShowCancelHint(true)
          Vibration.vibrate(40)
        }
      },
      onPanResponderRelease: () => {
        recordingGestureActiveRef.current = false
        recordingStopRequestedRef.current = true
        void stopRecording()
      },
      onPanResponderTerminate: () => {
        recordingGestureActiveRef.current = false
        recordingStopRequestedRef.current = true
        isCancelledRef.current = true
        void stopRecording()
      },
    })
  ).current
  const flatListRef = useRef<FlashListRef<ThreadEntry>>(null)
  const composerInputRef = useRef<TextInput>(null)
  const sendTimestamps = useRef<number[]>([])
  const insets = useSafeAreaInsets()
  const composerBottomPadding = Math.max(insets.bottom + Spacing.sm, Spacing.md)
  const replyingToMediaUrl = useMessageMediaUrl(
    replyingTo?.type === 'PHOTO' ? replyingTo.photo_url : null,
  )
  const replyingToMediaIsVideo = isVideoMediaUrl(replyingTo?.photo_url)

  // Keep sending ref in sync so PanResponder can gate on it without stale closure
  sendingRef.current = sending

  const messagesById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages])
  const messageGroups = useMemo(() => groupMessageMediaClusters(messages), [messages])
  const timelineEntries = useMemo<ThreadEntry[]>(() => {
    const messageEntries: ThreadEntry[] = messageGroups
      .filter((group) => group.length > 0)
      .map((group) => ({
        kind: 'messages',
        key: `messages:${group.map((message) => message.id).join(':')}`,
        createdAt: group[0]?.created_at ?? '',
        messages: group,
      }))
    const eventEntries: ThreadEntry[] = orderEvents.map((event) => ({
      kind: 'event',
      key: `event:${event.id}`,
      createdAt: event.createdAt,
      event,
    }))
    return [...messageEntries, ...eventEntries].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    )
  }, [messageGroups, orderEvents])

  const conversationActions = useMemo(() => {
    if (!CHAT_ORDER_ACTIONS_ENABLED || !orderStage) return null
    return deriveOrderConversationActions({
      role: currentUserRole,
      orderKind,
      stage: orderStage,
      activeQuote: negotiationState.activeQuote,
      openRevision: negotiationState.openRevision,
      negotiationRoundsUsed: negotiationState.roundsUsed,
      negotiationRoundLimit: negotiationState.roundLimit,
    })
  }, [currentUserRole, negotiationState, orderKind, orderStage])

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

  const fetchOrderConversationState = useCallback(async () => {
    if (!CHAT_ORDER_ACTIONS_ENABLED || orderKind !== 'CUSTOM') {
      setOrderEvents([])
      setNegotiationState({ activeQuote: null, openRevision: null, roundsUsed: 0, roundLimit: 3 })
      return
    }

    const [orderResult, revisionResult, eventResult] = await Promise.all([
      supabase
        .from('orders')
        .select('active_quote_id, active_quote_version, negotiation_rounds_used, negotiation_round_limit')
        .eq('id', orderId)
        .maybeSingle(),
      supabase
        .from('quote_revision_requests')
        .select('id, status, round_number')
        .eq('order_id', orderId)
        .eq('status', 'OPEN')
        .maybeSingle(),
      supabase
        .from('order_events')
        .select('id, order_id, event_type, actor_id, actor_role, quote_id, quote_version, revision_request_id, title, summary, metadata, created_at')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true }),
    ])

    if (orderResult.error || revisionResult.error || eventResult.error) {
      if (__DEV__) {
        console.warn(
          '[drape] Could not load conversation actions.',
          orderResult.error ?? revisionResult.error ?? eventResult.error,
        )
      }
      return
    }

    const orderRow = orderResult.data as {
      active_quote_id?: string | null
      active_quote_version?: number | null
      negotiation_rounds_used?: number | null
      negotiation_round_limit?: number | null
    } | null
    const revisionRow = revisionResult.data as {
      id: string
      status: QuoteRevisionRequest['status']
      round_number: number
    } | null
    const eventRows = (eventResult.data ?? []) as Array<{
      id: string
      order_id: string
      event_type: OrderEvent['eventType']
      actor_id: string | null
      actor_role: OrderEvent['actorRole']
      quote_id: string | null
      quote_version: number | null
      revision_request_id: string | null
      title: string
      summary: string | null
      metadata: Record<string, unknown> | null
      created_at: string
    }>

    setNegotiationState({
      activeQuote: orderRow?.active_quote_id && orderRow.active_quote_version
        ? { id: orderRow.active_quote_id, version: orderRow.active_quote_version, status: 'ACTIVE' }
        : null,
      openRevision: revisionRow
        ? { id: revisionRow.id, status: revisionRow.status, roundNumber: revisionRow.round_number }
        : null,
      roundsUsed: orderRow?.negotiation_rounds_used ?? 0,
      roundLimit: orderRow?.negotiation_round_limit ?? 3,
    })
    setOrderEvents(eventRows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      eventType: row.event_type,
      actorId: row.actor_id,
      actorRole: row.actor_role,
      quoteId: row.quote_id,
      quoteVersion: row.quote_version,
      revisionRequestId: row.revision_request_id,
      title: row.title,
      summary: row.summary,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
    })))
  }, [orderId, orderKind])

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
      .on('broadcast', { event: 'typing' }, ({ payload }: { payload: { userId: string; isTyping: boolean } }) => {
        if (payload.userId === currentUserId) return
        setCounterpartyIsTyping(!!payload.isTyping)
        if (typingClearRef.current) clearTimeout(typingClearRef.current)
        if (payload.isTyping) {
          typingClearRef.current = setTimeout(() => setCounterpartyIsTyping(false), 4000)
        }
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<{ userId: string }>()
        const others = Object.values(state).flat().filter((p) => p.userId !== currentUserId)
        const isOnline = others.length > 0
        setCounterpartyPresence((prev) => ({
          online: isOnline,
          lastSeen: isOnline ? null : (prev.online ? new Date().toISOString() : prev.lastSeen),
        }))
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ userId: currentUserId, threadStatus: 'open' })
        }
      })

    channelRef.current = channel

    // Untrack when app backgrounds, re-track when it returns
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (appStateRef.current === 'active' && nextState !== 'active') {
        void channel.untrack()
      } else if (appStateRef.current !== 'active' && nextState === 'active') {
        void channel.track({ userId: currentUserId, threadStatus: 'open' })
      }
      appStateRef.current = nextState
    })

    return () => {
      clearTimeout(initialLoad)
      appStateSub.remove()
      if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current)
      if (typingClearRef.current) clearTimeout(typingClearRef.current)
      channelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [fetchMessages, orderId, currentUserId])

  useEffect(() => {
    if (!CHAT_ORDER_ACTIONS_ENABLED || orderKind !== 'CUSTOM') return undefined

    const initialLoad = setTimeout(() => {
      void fetchOrderConversationState()
    }, 0)
    const channel = supabase
      .channel(`order-conversation:${orderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_events', filter: `order_id=eq.${orderId}` },
        () => { void fetchOrderConversationState() },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quote_revision_requests', filter: `order_id=eq.${orderId}` },
        () => { void fetchOrderConversationState() },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        () => { void fetchOrderConversationState() },
      )
      .subscribe()

    return () => {
      clearTimeout(initialLoad)
      void supabase.removeChannel(channel)
    }
  }, [fetchOrderConversationState, orderId, orderKind])

  useEffect(() => {
    if (!focusedEventId || timelineEntries.length === 0) return
    const index = timelineEntries.findIndex(
      (entry) => entry.kind === 'event' && entry.event.id === focusedEventId,
    )
    if (index < 0) return
    const timer = setTimeout(() => {
      flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.45 })
    }, 180)
    return () => clearTimeout(timer)
  }, [focusedEventId, timelineEntries])

  useEffect(() => {
    if (!focusedMessageId || timelineEntries.length === 0) return
    const index = timelineEntries.findIndex(
      (entry) => entry.kind === 'messages' && entry.messages.some((message) => message.id === focusedMessageId),
    )
    if (index < 0) return
    const timer = setTimeout(() => {
      flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.45 })
    }, 180)
    return () => clearTimeout(timer)
  }, [focusedMessageId, timelineEntries])

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
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current)
    void channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUserId, isTyping: false } })
    setSending(true)
    setThreadNotice(null)

    if (editingMessage) {
      const { error } = await invokeFunction('message-action', {
        body: { action: 'edit', messageId: editingMessage.id, body: text.trim() },
      })
      if (error) {
        const failure = await resolveMessageSendFailure(error, 'Could not edit this message. Please try again.')
        if (failure.inlineMessage) setTextError(failure.inlineMessage)
        if (failure.showAlert !== false) Alert.alert(failure.title, failure.message)
      } else {
        const now = new Date().toISOString()
        setMessages((prev) => prev.map((m) => m.id === editingMessage.id ? { ...m, body: text.trim(), edited_at: now } : m))
        messagesRef.current = messagesRef.current.map((m) => m.id === editingMessage.id ? { ...m, body: text.trim(), edited_at: now } : m)
        setText('')
        setTextError('')
        setEditingMessage(null)
      }
      setSending(false)
      return
    }

    if (!checkRateLimit()) { setSending(false); return }

    const { error } = await invokeFunction('message-action', {
      body: {
        action: 'send-message',
        orderId,
        type: 'TEXT',
        body: text.trim(),
        ...(replyingTo ? { replyToId: replyingTo.id } : {}),
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
      setReplyingTo(null)
      await fetchMessages({ silent: true })
      Keyboard.dismiss()
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100)
    }
    setSending(false)
  }

  async function performUnsend(message: Message) {
    const { error } = await invokeFunction('message-action', {
      body: { action: 'unsend', messageId: message.id },
    })
    if (error) {
      const payload = await readFunctionErrorPayload(error)
      const code = readPayloadString(payload, 'code')
      if (code === 'UNSEND_WINDOW_EXPIRED') {
        Alert.alert('Cannot unsend', 'Messages can only be unsent within 15 minutes of sending.')
      } else {
        Alert.alert('Could not unsend', 'Something went wrong. Please try again.')
      }
      return
    }
    setMessages((prev) => prev.map((m) => m.id === message.id ? { ...m, is_deleted: true, body: null } : m))
    messagesRef.current = messagesRef.current.map((m) => m.id === message.id ? { ...m, is_deleted: true, body: null } : m)
    if (editingMessage?.id === message.id) { setEditingMessage(null); setText('') }
  }

  function openPhotoSourceSheet() {
    Alert.alert('Send media', 'Take a photo, record a short video, or choose media from your library.', [
      { text: 'Take photo', onPress: () => void sendMediaFromSource('camera-photo') },
      { text: 'Record video', onPress: () => void sendMediaFromSource('camera-video') },
      { text: 'Choose from library', onPress: () => void sendMediaFromSource('library') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  async function pickMessageMedia(source: MessageMediaSource) {
    const permission =
      source === 'camera-photo' || source === 'camera-video'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()

    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        source === 'camera-photo' || source === 'camera-video'
          ? 'Allow camera access to send media.'
          : 'Allow photo access to send media.',
      )
      return null
    }

    if (source === 'camera-photo') {
      return launchImagePickerSafely(
        () =>
          ImagePicker.launchCameraAsync({
            mediaTypes: 'images',
            quality: 0.8,
          }),
        {
          context: 'message_camera_photo_picker',
          mediaLabel: 'message photo',
          extra: { source, orderId, senderId: currentUserId },
        }
      )
    }
    if (source === 'camera-video') {
      return launchImagePickerSafely(
        () =>
          ImagePicker.launchCameraAsync({
            mediaTypes: 'videos',
            quality: 0.8,
            videoMaxDuration: MESSAGE_VIDEO_MAX_SECONDS,
          }),
        {
          context: 'message_camera_video_picker',
          mediaLabel: 'message video',
          extra: { source, orderId, senderId: currentUserId },
        }
      )
    }
    return launchImagePickerSafely(
      () =>
        ImagePicker.launchImageLibraryAsync(
          preferCompatibleVideoRepresentation({
            mediaTypes: ['images', 'videos'],
            quality: 0.8,
            videoMaxDuration: MESSAGE_VIDEO_MAX_SECONDS,
            allowsMultipleSelection: true,
            selectionLimit: 6,
          })
        ),
      {
        context: 'message_library_media_picker',
        mediaLabel: 'message media file',
        extra: { source, orderId, senderId: currentUserId },
      }
    )
  }

  async function sendMediaFromSource(source: MessageMediaSource) {
    if (!checkRateLimit()) return
    const result = await pickMessageMedia(source)
    if (!result) return
    const assets = result.assets ?? []
    if (result.canceled || assets.length === 0) return

    for (const asset of assets) {
      const isVideo = isMessageVideoAsset(asset)
      const videoValidationError = isVideo ? validateMessageVideoAsset(asset) : null
      if (videoValidationError) {
        Alert.alert('Video not sent', videoValidationError)
        return
      }
    }

    setSending(true)
    setThreadNotice(null)
    const replyTargetId = replyingTo?.id ?? null
    let sentCount = 0
    let failure: { kind: 'photo' | 'video'; error: unknown } | null = null

    try {
      for (let index = 0; index < assets.length; index += 1) {
        const asset = assets[index]
        const isVideo = isMessageVideoAsset(asset)
        try {
          const uploadUri = isVideo ? asset.uri : await stripExif(asset.uri)
          const contentType = isVideo ? messageVideoContentType(asset) : 'image/jpeg'
          const extension = isVideo ? messageVideoExtension(asset) : 'jpg'
          const filename = `messages/${orderId}/${Date.now()}-${index}.${extension}`
          const payload = await createValidatedUploadPayload(uploadUri, {
            maxBytes: isVideo ? MESSAGE_VIDEO_MAX_BYTES : MEDIA_LIMITS_BYTES.image,
            contentType,
            allowedContentTypes: isVideo ? ALLOWED_VIDEO_CONTENT_TYPES : ALLOWED_IMAGE_CONTENT_TYPES,
            purpose: 'MESSAGE_MEDIA',
          })
          const { error: uploadError } = await supabase.storage
            .from('message-media')
            .upload(filename, payload.data, { contentType })
          if (uploadError) throw uploadError

          const { error: insertError } = await invokeFunction('message-action', {
            body: {
              action: 'send-message',
              orderId,
              type: 'PHOTO',
              photoUrl: filename,
              ...(replyTargetId ? { replyToId: replyTargetId } : {}),
            },
          })
          if (insertError) throw insertError
          sentCount += 1
        } catch (error) {
          failure = { kind: isVideo ? 'video' : 'photo', error }
          break
        }
      }

      if (sentCount > 0) {
        setReplyingTo(null)
        await fetchMessages({ silent: true })
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 120)
      }

      if (failure) {
        const resolved = resolveMediaFailure(failure.kind, failure.error)
        if (resolved.connectivity) {
          setThreadNotice({
            tone: 'warning',
            text: 'Connection looks weak. Some media may need another try when the signal improves.',
          })
        }
        if (assets.length > 1 && sentCount > 0) {
          Alert.alert('Some media were not sent', `${sentCount} of ${assets.length} items were sent. ${resolved.message}`)
        } else {
          Alert.alert(resolved.title, resolved.message)
        }
      }
    } finally {
      setSending(false)
    }
  }

  async function startRecording() {
    if (
      recordingStartingRef.current ||
      recordingStoppingRef.current ||
      recordingRef.current ||
      sendingRef.current
    ) return

    const sessionId = recordingSessionRef.current + 1
    recordingSessionRef.current = sessionId
    recordingStartingRef.current = true
    isCancelledRef.current = false
    setShowCancelHint(false)
    try {
      const currentPermission = await Audio.getPermissionsAsync()
      const permission = currentPermission.granted || !currentPermission.canAskAgain
        ? currentPermission
        : await Audio.requestPermissionsAsync()
      if (recordingSessionRef.current !== sessionId) return
      if (!permission.granted) {
        if (recordingGestureActiveRef.current) {
          Alert.alert('Microphone unavailable', 'Drapeon could not access your microphone. Check your phone permissions and try again.')
        }
        return
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true })
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY)

      if (recordingSessionRef.current !== sessionId) {
        await rec.stopAndUnloadAsync().catch(() => undefined)
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => undefined)
        return
      }

      recordingRef.current = rec
      setIsRecording(true)
      if (recordingStopRequestedRef.current || !recordingGestureActiveRef.current) {
        await stopRecording(sessionId)
      }
    } catch (error) {
      if (__DEV__) console.warn('[drape] Could not start voice recording.', error)
      if (recordingSessionRef.current === sessionId && recordingGestureActiveRef.current) {
        Alert.alert('Recording unavailable', 'Drapeon could not start a voice note right now. Please try again.')
      }
    } finally {
      if (recordingSessionRef.current === sessionId) {
        recordingStartingRef.current = false
      }
    }
  }

  async function stopRecording(expectedSessionId = recordingSessionRef.current) {
    recordingStopRequestedRef.current = true
    if (expectedSessionId !== recordingSessionRef.current) return
    const rec = recordingRef.current
    if (!rec || recordingStoppingRef.current) return
    recordingStoppingRef.current = true
    recordingRef.current = null
    setIsRecording(false)
    setShowCancelHint(false)

    let durationSeconds = 0
    let uri: string | null = null
    try {
      const status = await rec.getStatusAsync()
      durationSeconds = Math.round((status.durationMillis ?? 0) / 1000)
      await rec.stopAndUnloadAsync()
      uri = rec.getURI()
    } catch (error) {
      if (__DEV__) console.warn('[drape] Could not finalize voice recording.', error)
    } finally {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => undefined)
      recordingStoppingRef.current = false
    }

    // Cancelled via swipe: discard silently
    if (isCancelledRef.current) {
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true })
      return
    }

    // Too short: discard and show inline hint
    if (durationSeconds < 1) {
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true })
      setThreadNotice({ tone: 'warning', text: 'Hold to record, swipe left to cancel.' })
      return
    }

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
      const { error: uploadError } = await supabase.storage.from('message-media').upload(filename, payload.data, { contentType: 'audio/mp4' })
      if (uploadError) throw uploadError

      const { error: insertError } = await invokeFunction('message-action', {
        body: {
          action: 'send-message',
          orderId,
          type: 'VOICE',
          voiceUrl: filename,
          voiceDuration: durationSeconds,
          ...(replyingTo ? { replyToId: replyingTo.id } : {}),
        },
      })
      if (insertError) throw insertError
      setReplyingTo(null)
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

  function focusComposer() {
    setTimeout(() => composerInputRef.current?.focus(), 24)
  }

  function openReplyComposer(message: Message) {
    setEditingMessage(null)
    setReplyingTo(message)
    focusComposer()
  }

  function openEditComposer(message: Message) {
    setReplyingTo(null)
    setEditingMessage(message)
    setText(message.body ?? '')
    focusComposer()
  }

  function openContextMenu(message: Message) {
    setContextMenuMessage(message)
  }

  const otherName = currentUserRole === 'CUSTOMER' ? tailorName : customerName
  const otherAvatarUrl = currentUserRole === 'CUSTOMER' ? tailorAvatarUrl : customerAvatarUrl
  const hasListHeader = hasEarlier || !!callLifecycleEvent

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={Colors.needleGreen} size="large" />

  return (
    <View style={styles.container}>
      {/* Presence bar — shown at top when counterparty is tracked in this thread */}
      {(counterpartyPresence.online || counterpartyPresence.lastSeen) ? (
        <View style={styles.presenceBar}>
          {counterpartyPresence.online ? (
            <>
              <View style={styles.presenceDotOnline} />
              <Text style={styles.presenceTextOnline}>Active now</Text>
            </>
          ) : (
            <Text style={styles.presenceTextMuted}>
              Last viewed {formatPresenceTime(counterpartyPresence.lastSeen!)}
            </Text>
          )}
        </View>
      ) : null}

      <FlashList
        ref={flatListRef}
        data={timelineEntries}
        keyExtractor={(entry) => entry.key}
        drawDistance={420}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => {
          if (focusedEventId || focusedMessageId) return
          flatListRef.current?.scrollToEnd({ animated: false })
        }}
        ListHeaderComponent={hasListHeader ? (
          <View style={styles.listHeaderStack}>
            {hasEarlier ? (
              <TouchableOpacity style={styles.loadEarlierBtn} onPress={loadEarlier} disabled={loadingEarlier}>
                {loadingEarlier
                  ? <ActivityIndicator size="small" color={Colors.needleGreen} />
                  : <Text style={styles.loadEarlierText}>↑ Load earlier messages</Text>
                }
              </TouchableOpacity>
            ) : null}
            {callLifecycleEvent ? <CallLifecycleEventCard event={callLifecycleEvent} /> : null}
          </View>
        ) : null}
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
        renderItem={({ item: entry }) => {
          if (entry.kind === 'event') {
            return (
              <OrderConversationEventCard
                event={entry.event}
                focused={entry.event.id === focusedEventId}
                onOpenQuote={onConversationAction && entry.event.quoteId
                  ? () => onConversationAction({
                      kind: 'VIEW_QUOTE',
                      label: 'View quote',
                      emphasis: 'SECONDARY',
                      requiresQuoteVersion: true,
                    })
                  : undefined}
              />
            )
          }
          const group = entry.messages
          const item = group[0]
          if (!item) return null
          if (group.length > 1) {
            return (
              <MediaMessageCluster
                messages={group}
                isOwn={item.sender_id === currentUserId}
                avatarUrl={item.sender_id === currentUserId ? null : otherAvatarUrl}
                onOpenContextMenu={openContextMenu}
                onOpenMedia={setMediaPreview}
                replyMessage={item.reply_to_id ? (messagesById.get(item.reply_to_id) ?? null) : null}
              />
            )
          }
          return (
            <MessageBubble
              message={item}
              isOwn={item.sender_id === currentUserId}
              avatarUrl={item.sender_id === currentUserId ? null : otherAvatarUrl}
              reactions={reactionsByMessageId.get(item.id) ?? []}
              currentUserId={currentUserId}
              reactionsAvailable={reactionsAvailable}
              onOpenContextMenu={() => openContextMenu(item)}
              onOpenMedia={setMediaPreview}
              onToggleReaction={(emoji) => { void toggleReaction(item, emoji) }}
              replyMessage={item.reply_to_id ? (messagesById.get(item.reply_to_id) ?? null) : null}
              mediaClusterMessages={group}
            />
          )
        }}
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

      {/* Context menu bottom sheet */}
      <MessageContextSheet
        message={contextMenuMessage}
        isOwn={contextMenuMessage?.sender_id === currentUserId}
        visible={contextMenuMessage !== null}
        onDismiss={() => setContextMenuMessage(null)}
        onReply={() => openReplyComposer(contextMenuMessage!)}
        onEdit={() => openEditComposer(contextMenuMessage!)}
        onUnsend={() => { void performUnsend(contextMenuMessage!) }}
        reactions={contextMenuMessage ? (reactionsByMessageId.get(contextMenuMessage.id) ?? []) : []}
        currentUserId={currentUserId}
        reactionsAvailable={reactionsAvailable}
        onToggleReaction={(emoji) => { if (contextMenuMessage) void toggleReaction(contextMenuMessage, emoji) }}
      />

      <MessageMediaPreviewModal
        preview={mediaPreview}
        onDismiss={() => setMediaPreview(null)}
        onOpenItemActions={(item) => {
          const message = item.contextId ? messagesById.get(item.contextId) : null
          if (!message) return
          setMediaPreview(null)
          openContextMenu(message)
        }}
      />

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

          {/* Typing indicator */}
          {counterpartyIsTyping ? (
            <View style={styles.typingRow}>
              <Text style={styles.typingText}>{otherName} is typing…</Text>
            </View>
          ) : null}

          {/* Recording indicator */}
          {isRecording && (
            <View style={[styles.recordingBar, showCancelHint && styles.recordingBarCancel]}>
              <View style={[styles.recordingDot, showCancelHint && styles.recordingDotCancel]} />
              <Text style={[styles.recordingText, showCancelHint && styles.recordingTextCancel]}>
                {showCancelHint ? 'Release to discard' : 'Recording — slide ← to cancel'}
              </Text>
            </View>
          )}

          {conversationActions?.primary && onConversationAction ? (
            <OrderConversationActionStrip
              primary={conversationActions.primary}
              overflowCount={conversationActions.overflow.length}
              revisionRoundsUsed={conversationActions.revisionRoundsUsed}
              revisionRoundLimit={conversationActions.revisionRoundLimit}
              onPressPrimary={() => onConversationAction(conversationActions.primary!)}
              onPressMore={() => setShowConversationActions(true)}
            />
          ) : null}

          {/* Reply preview bar */}
          {replyingTo ? (
            <View style={styles.replyBar} testID="message-reply-preview">
              {replyingTo.type === 'PHOTO' ? (
                <View style={styles.replyBarMedia}>
                  {replyingToMediaIsVideo ? (
                    <Feather name="play" size={18} color={Colors.textInverse} />
                  ) : replyingToMediaUrl ? (
                    <RemoteImage
                      uri={replyingToMediaUrl}
                      containerStyle={styles.replyBarMedia}
                      style={styles.replyBarMediaImage}
                      contentFit="cover"
                      transition={80}
                      surface="message_reply_target"
                    />
                  ) : (
                    <ActivityIndicator size="small" color={Colors.midGrey} />
                  )}
                </View>
              ) : null}
              <View style={styles.replyBarContent}>
                <Text style={styles.replyBarAuthor}>{replyingTo.sender_name}</Text>
                <Text style={styles.replyBarBody} numberOfLines={1}>
                  {replyingTo.is_deleted
                    ? 'This message was unsent.'
                    : replyingTo.type === 'PHOTO'
                      ? 'Photo'
                      : replyingTo.type === 'VOICE'
                        ? 'Voice note'
                        : decodeDisplayText(replyingTo.body ?? '')}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setReplyingTo(null)}
                style={styles.replyBarDismiss}
                accessibilityRole="button"
                accessibilityLabel="Cancel reply"
              >
                <Feather name="x" size={18} color={Colors.midGrey} />
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Edit mode bar */}
          {editingMessage ? (
            <View style={styles.editBar}>
              <Text style={styles.editBarLabel}>Editing message</Text>
              <TouchableOpacity
                onPress={() => { setEditingMessage(null); setText('') }}
                style={styles.editBarDismiss}
                accessibilityRole="button"
                accessibilityLabel="Cancel edit"
              >
                <Feather name="x" size={18} color={Colors.midGrey} />
              </TouchableOpacity>
            </View>
          ) : null}

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
                ref={composerInputRef}
                style={styles.textInput}
                placeholder="Message…"
                placeholderTextColor={Colors.midGrey}
                value={text}
                onChangeText={(v) => {
                  setText(v)
                  if (textError) validateText(v)
                  if (channelRef.current) {
                    void channelRef.current.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUserId, isTyping: true } })
                    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current)
                    typingDebounceRef.current = setTimeout(() => {
                      void channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUserId, isTyping: false } })
                    }, 2000)
                  }
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
                  disabled={sending || callLoading || callBlocked}
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
                    : <Feather name="arrow-up" size={18} color={Colors.textInverse} />
                  }
                </TouchableOpacity>
              ) : (
                <Animated.View
                  {...micPanResponder.panHandlers}
                  style={[styles.voiceBtn, isRecording && styles.voiceBtnActive]}
                  accessibilityRole="button"
                  accessibilityLabel={isRecording ? 'Recording voice note' : 'Hold to record voice note'}
                >
                  <Feather
                    name="mic"
                    size={20}
                    color={isRecording ? Colors.textInverse : Colors.needleGreen}
                  />
                </Animated.View>
              )}
            </View>
          </View>

          {callGateMessage ? (
            <View style={styles.callGateCard}>
              <Text style={styles.callGateText}>{callGateMessage}</Text>
              {callGateActionLabel && onPressCallGateAction ? (
                <TouchableOpacity
                  style={styles.callGateAction}
                  onPress={onPressCallGateAction}
                  accessibilityRole="button"
                >
                  <Text style={styles.callGateActionText}>{callGateActionLabel}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </>
      )}

      <DrapeSheet
        visible={showConversationActions}
        title="Order actions"
        subtitle={conversationActions
          ? `Revision ${conversationActions.revisionRoundsUsed} of ${conversationActions.revisionRoundLimit}`
          : undefined}
        onDismiss={() => setShowConversationActions(false)}
        enableDynamicSizing
      >
        <View style={styles.conversationActionSheetList}>
          {conversationActions?.overflow.map((action) => (
            <DrapeCapsuleButton
              key={action.kind}
              label={action.label}
              tone={action.emphasis === 'DESTRUCTIVE' ? 'destructive' : 'secondary'}
              onPress={() => {
                setShowConversationActions(false)
                onConversationAction?.(action)
              }}
            />
          ))}
        </View>
      </DrapeSheet>
    </View>
  )
}

function OrderConversationActionStrip({
  primary,
  overflowCount,
  revisionRoundsUsed,
  revisionRoundLimit,
  onPressPrimary,
  onPressMore,
}: {
  primary: OrderConversationAction
  overflowCount: number
  revisionRoundsUsed: number
  revisionRoundLimit: number
  onPressPrimary: () => void
  onPressMore: () => void
}) {
  return (
    <View style={styles.conversationActionStrip}>
      <View style={styles.conversationActionCopy}>
        <Text style={styles.conversationActionEyebrow}>Order action</Text>
        <Text style={styles.conversationActionMeta}>
          Revision {revisionRoundsUsed} of {revisionRoundLimit}
        </Text>
      </View>
      <DrapeCapsuleButton
        label={primary.label}
        compact
        tone={primary.emphasis === 'DESTRUCTIVE' ? 'destructive' : 'primary'}
        onPress={onPressPrimary}
        style={styles.conversationPrimaryAction}
      />
      {overflowCount > 0 ? (
        <DrapeIconButton
          icon="more-horizontal"
          tone="secondary"
          accessibilityLabel={`Open ${overflowCount} more order actions`}
          onPress={onPressMore}
        />
      ) : null}
    </View>
  )
}

function OrderConversationEventCard({
  event,
  focused,
  onOpenQuote,
}: {
  event: OrderEvent
  focused: boolean
  onOpenQuote?: () => void
}) {
  const label = ORDER_EVENT_LABELS[event.eventType]
  const versionLabel = event.quoteVersion ? `Quote v${event.quoteVersion}` : null
  return (
    <View style={[styles.orderEventWrap, focused && styles.orderEventWrapFocused]}>
      <DrapeInlineActionCard
        eyebrow={[versionLabel, formatPresenceTime(event.createdAt)].filter(Boolean).join(' · ')}
        title={label}
        body={event.summary ? decodeDisplayText(event.summary) : null}
        icon={event.eventType === 'PAYMENT_CONFIRMED' ? 'check-circle' : 'file-text'}
      >
        <View style={styles.orderEventFooter}>
          <DrapeStatusChip
            label={label}
            tone={event.eventType.includes('DECLINED') || event.eventType.includes('EXPIRED') ? 'danger' : 'info'}
          />
          {onOpenQuote ? (
            <DrapeCapsuleButton label="View quote" compact tone="secondary" onPress={onOpenQuote} />
          ) : null}
        </View>
      </DrapeInlineActionCard>
    </View>
  )
}

function formatLifecycleTime(value: string | null | undefined, timezone?: string | null) {
  const date = parseDateValue(value)
  if (!date) return 'Time not set'
  try {
    return date.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone || undefined,
    })
  } catch {
    return date.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }
}

function CallLifecycleEventCard({ event }: { event: CallLifecycleEvent }) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const lifecycle = getCallLifecycleState(event.scheduledStartAt, now)
  if (lifecycle.status === 'unscheduled') return null

  const reason = event.kind === 'consultation'
    ? 'Consultation'
    : callSchedulingReasonFor(event.reason).label
  const isPaymentBlocked = event.paymentRequired === true && event.paymentPaid !== true
  const isExpired =
    event.status === 'EXPIRED' ||
    event.status === 'DECLINED' ||
    event.status === 'COMPLETED' ||
    lifecycle.status === 'expired'
  const scheduledLabel = formatLifecycleTime(event.scheduledStartAt ?? null, event.timezone)
  const title = event.kind === 'consultation' ? 'Consultation call' : 'Ready-made coordination call'

  return (
    <View style={[styles.callLifecycleCard, isExpired && styles.callLifecycleCardExpired]}>
      <View style={styles.callLifecycleHeader}>
        <View style={styles.callLifecycleIcon}>
          <Feather name="video" size={18} color={isExpired ? Colors.midGrey : Colors.needleGreen} />
        </View>
        <View style={styles.callLifecycleTitleWrap}>
          <Text style={styles.callLifecycleEyebrow}>Order lifecycle event</Text>
          <Text style={styles.callLifecycleTitle}>{title}</Text>
          <Text style={styles.callLifecycleMeta}>{scheduledLabel}</Text>
        </View>
      </View>

      <View style={styles.callLifecycleReasonRow}>
        <Text style={styles.callLifecycleReasonLabel}>Reason</Text>
        <Text style={styles.callLifecycleReasonValue}>{reason}</Text>
      </View>

      {isPaymentBlocked ? (
        <View style={styles.callLifecyclePaymentBlock}>
          <Text style={styles.callLifecyclePaymentText}>Consultation fee required before the room can open</Text>
          {event.paymentActionLabel && event.onPressPayment ? (
            <TouchableOpacity
              style={styles.callLifecyclePaymentAction}
              onPress={event.onPressPayment}
              accessibilityRole="button"
            >
              <Text style={styles.callLifecyclePaymentActionText}>{event.paymentActionLabel}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : isExpired ? (
        <View style={styles.callLifecycleExpiredBlock}>
          <Text style={styles.callLifecycleExpiredText}>Call Missed / Window Expired</Text>
          {event.onReschedule ? (
            <TouchableOpacity
              style={styles.callLifecycleTextAction}
              onPress={event.onReschedule}
              accessibilityRole="button"
            >
              <Text style={styles.callLifecycleTextActionLabel}>{event.rescheduleLabel ?? 'Reschedule'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : lifecycle.status === 'active' ? (
        <TouchableOpacity
          style={styles.callLifecyclePrimaryAction}
          onPress={event.onJoinVideo}
          disabled={event.actionLoading || !event.onJoinVideo}
          accessibilityRole="button"
          accessibilityLabel="Join video call now"
        >
          {event.actionLoading ? (
            <ActivityIndicator size="small" color={Colors.textInverse} />
          ) : (
            <Text style={styles.callLifecyclePrimaryActionText}>Join Video Call Now</Text>
          )}
        </TouchableOpacity>
      ) : (
        <View style={styles.callLifecycleDisabledAction}>
          <Text style={styles.callLifecycleDisabledActionText}>
            {formatCallCountdown(lifecycle.msUntilOpen)}
          </Text>
        </View>
      )}
    </View>
  )
}

function MediaMessageCluster({
  messages,
  isOwn,
  avatarUrl,
  onOpenContextMenu,
  onOpenMedia,
  replyMessage,
}: {
  messages: Message[]
  isOwn: boolean
  avatarUrl?: string | null
  onOpenContextMenu: (message: Message) => void
  onOpenMedia: (preview: MessageMediaPreview) => void
  replyMessage: Message | null
}) {
  const mediaUrls = useMessageMediaUrls(messages)
  const firstMessage = messages[0]
  const lastMessage = messages[messages.length - 1]
  if (!firstMessage || !lastMessage) return null
  const mosaicItems: DrapeMediaMosaicItem[] = messages.map((message, index) => {
    const resolvedUri = mediaUrls.get(message.id) ?? null
    const isVideo = isVideoMediaUrl(message.photo_url) || isVideoMediaUrl(resolvedUri)
    return {
      id: message.id,
      uri: resolvedUri,
      kind: isVideo ? 'video' : 'photo',
      label: `Open ${isVideo ? 'video' : 'photo'} ${index + 1} of ${messages.length}`,
    }
  })

  const time = (parseDateValue(lastMessage.created_at) ?? new Date()).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })
  const receipt = lastMessage.read_at
    ? { text: '✓✓', label: 'Read', style: styles.readReceiptRead }
    : { text: '✓', label: 'Sent', style: styles.readReceiptDelivered }

  return (
    <View style={[styles.bubbleRow, isOwn && styles.bubbleRowOwn]}>
      {!isOwn ? (
        <AvatarImage
          uri={avatarUrl}
          initials={firstMessage.sender_name}
          size={32}
          style={styles.messageAvatar}
          borderColor={Colors.white}
          borderWidth={2}
        />
      ) : null}
      <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther, styles.bubbleMedia, styles.mediaMosaicBubble]}>
        {!isOwn ? <Text style={styles.senderName}>{firstMessage.sender_name}</Text> : null}
        {replyMessage ? (
          <View style={[styles.replyQuote, isOwn && styles.replyQuoteOwn]}>
            <Text style={[styles.replyQuoteAuthor, isOwn && styles.replyQuoteAuthorOwn]}>{replyMessage.sender_name}</Text>
            <Text style={[styles.replyQuoteBody, isOwn && styles.replyQuoteBodyOwn]} numberOfLines={2}>
              {replyMessage.is_deleted
                ? 'This message was unsent.'
                : replyMessage.type === 'PHOTO'
                  ? 'Photo'
                  : replyMessage.type === 'VOICE'
                    ? 'Voice note'
                    : decodeDisplayText(replyMessage.body ?? '')}
            </Text>
          </View>
        ) : null}
        <DrapeMediaMosaic
          items={mosaicItems}
          compact
          testID="message-media-mosaic"
          onPressItem={(item, index) => {
            onOpenMedia({
              items: messageMediaPreviewItems(messages, item.id, item.uri),
              index,
            })
          }}
          onLongPressItem={(item) => {
            const message = messages.find((candidate) => candidate.id === item.id)
            if (!message) return
            Vibration.vibrate(12)
            onOpenContextMenu(message)
          }}
        />
        <View style={styles.bubbleMeta}>
          <Text style={[styles.bubbleTime, isOwn && styles.bubbleTimeOwn]}>{time}</Text>
          {isOwn ? (
            <Text style={[styles.readReceipt, receipt.style]} accessibilityLabel={`Message batch ${receipt.label.toLowerCase()}`}>
              {receipt.text} {receipt.label}
            </Text>
          ) : null}
        </View>
      </View>
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
  onOpenContextMenu,
  onOpenMedia,
  onToggleReaction,
  replyMessage,
  clusterPosition = 'isolated',
  mediaClusterMessages,
}: {
  message: Message
  isOwn: boolean
  avatarUrl?: string | null
  reactions: MessageReaction[]
  currentUserId: string
  reactionsAvailable: boolean
  onOpenContextMenu: () => void
  onOpenMedia: (preview: MessageMediaPreview) => void
  onToggleReaction: (emoji: string) => void
  replyMessage: Message | null
  clusterPosition?: ClusterPosition
  mediaClusterMessages: Message[]
}) {
  const photoUrl = useMessageMediaUrl(message.photo_url)
  const voiceUrl = useMessageMediaUrl(message.voice_url)
  const hasVideoAttachment = !!photoUrl && (isVideoMediaUrl(photoUrl) || isVideoMediaUrl(message.photo_url))
  const isMediaMessage = message.type === 'PHOTO' && !!message.photo_url
  const showAvatar = !isOwn && (!isMediaMessage || clusterPosition === 'isolated' || clusterPosition === 'end')
  const showSenderName = !isOwn && (!isMediaMessage || clusterPosition === 'isolated' || clusterPosition === 'start')
  const mediaPreviewItems = messageMediaPreviewItems(mediaClusterMessages, message.id, photoUrl)
  const mediaPreviewIndex = Math.max(
    0,
    mediaClusterMessages.findIndex((clusterMessage) => clusterMessage.id === message.id),
  )
  const mediaClusterStyle = isMediaMessage
    ? [
        styles.bubbleMedia,
        clusterPosition === 'start' && (isOwn ? styles.mediaClusterOwnStart : styles.mediaClusterOtherStart),
        clusterPosition === 'middle' && (isOwn ? styles.mediaClusterOwnMiddle : styles.mediaClusterOtherMiddle),
        clusterPosition === 'end' && (isOwn ? styles.mediaClusterOwnEnd : styles.mediaClusterOtherEnd),
      ]
    : null
  const voiceDurationSeconds = (() => {
    if (message.type !== 'VOICE' || !message.body) return null
    const n = parseInt(message.body, 10)
    return Number.isFinite(n) && n > 0 ? n : null
  })()

  const time = (parseDateValue(message.created_at) ?? new Date()).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  if (message.is_deleted) {
    return (
      <View style={[styles.bubbleRow, isOwn && styles.bubbleRowOwn]}>
        {!isOwn ? (
          <AvatarImage uri={avatarUrl} initials={message.sender_name} size={32} style={styles.messageAvatar} borderColor={Colors.white} borderWidth={2} />
        ) : null}
        <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther, styles.bubbleDeleted]}>
          {!isOwn && <Text style={styles.senderName}>{message.sender_name}</Text>}
          <Text style={[styles.bubbleDeletedText, isOwn && styles.bubbleDeletedTextOwn]}>This message was unsent.</Text>
          <View style={styles.bubbleMeta}>
            <Text style={[styles.bubbleTime, isOwn && styles.bubbleTimeOwn]}>{time}</Text>
          </View>
        </View>
      </View>
    )
  }

  const receipt = message.read_at
    ? { text: '✓✓', label: 'Read', style: styles.readReceiptRead }
    : { text: '✓', label: 'Sent', style: styles.readReceiptDelivered }
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
    <View style={[styles.bubbleRow, isOwn && styles.bubbleRowOwn, isMediaMessage && clusterPosition !== 'isolated' && styles.bubbleRowClustered]}>
      {!isOwn ? (
        showAvatar ? (
          <AvatarImage
            uri={avatarUrl}
            initials={message.sender_name}
            size={32}
            style={styles.messageAvatar}
            borderColor={Colors.white}
            borderWidth={2}
          />
        ) : <View style={styles.messageAvatarSpacer} />
      ) : null}
      <TouchableOpacity
        activeOpacity={0.92}
        onLongPress={onOpenContextMenu}
        accessibilityRole="button"
        accessibilityHint="Long press for message options"
        style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther, mediaClusterStyle]}
      >
        {showSenderName ? <Text style={styles.senderName}>{message.sender_name}</Text> : null}

        {replyMessage ? (
          <View style={[styles.replyQuote, isOwn && styles.replyQuoteOwn]}>
            <Text style={[styles.replyQuoteAuthor, isOwn && styles.replyQuoteAuthorOwn]}>{replyMessage.sender_name}</Text>
            <Text style={[styles.replyQuoteBody, isOwn && styles.replyQuoteBodyOwn]} numberOfLines={2}>
              {replyMessage.is_deleted
                ? 'This message was unsent.'
                : replyMessage.type === 'PHOTO'
                  ? 'Photo'
                  : replyMessage.type === 'VOICE'
                    ? 'Voice note'
                    : decodeDisplayText(replyMessage.body ?? '')}
            </Text>
          </View>
        ) : null}

        {message.type === 'TEXT' && (
          <Text style={[styles.bubbleText, isOwn && styles.bubbleTextOwn]}>{bodyText}</Text>
        )}

        {message.type === 'PHOTO' && message.photo_url && (
          photoUrl && hasVideoAttachment ? (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => onOpenMedia({ items: mediaPreviewItems, index: mediaPreviewIndex })}
              onLongPress={onOpenContextMenu}
              accessibilityRole="imagebutton"
              accessibilityLabel="Open video message"
              style={styles.bubbleMediaWrap}
            >
              <PortfolioVideoPreview
                uri={photoUrl}
                style={styles.bubblePhoto}
                contentFit="contain"
                nativeControls={false}
                autoplay={false}
                isLooping={false}
              />
              <View style={styles.mediaOpenBadge}>
                <Feather name="maximize-2" size={15} color={Colors.textInverse} />
              </View>
            </TouchableOpacity>
          ) : photoUrl ? (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => onOpenMedia({ items: mediaPreviewItems, index: mediaPreviewIndex })}
              onLongPress={onOpenContextMenu}
              accessibilityRole="imagebutton"
              accessibilityLabel="Open photo message"
              style={styles.bubbleMediaWrap}
            >
              <RemoteImage
                uri={photoUrl}
                style={styles.bubblePhoto}
                contentFit="cover"
                transition={120}
                surface="message_photo"
                fallback={<View style={[styles.bubblePhoto, styles.photoFallback]} />}
              />
              <View style={styles.mediaOpenBadge}>
                <Feather name="maximize-2" size={15} color={Colors.textInverse} />
              </View>
            </TouchableOpacity>
          ) : (
            <View style={[styles.bubblePhoto, styles.photoFallback]} />
          )
        )}

        {message.type === 'VOICE' ? (
          <DrapeVoicePlayer
            uri={voiceUrl}
            durationSeconds={voiceDurationSeconds}
            inverse={isOwn}
          />
        ) : null}

        <View style={styles.bubbleMeta}>
          {message.edited_at ? (
            <Text style={[styles.editedTag, isOwn && styles.editedTagOwn]}>(edited)</Text>
          ) : null}
          <Text style={[styles.bubbleTime, isOwn && styles.bubbleTimeOwn]}>{time}</Text>
          {isOwn ? (
            <Text
              style={[styles.readReceipt, receipt.style]}
              accessibilityLabel={'Message ' + receipt.label.toLowerCase()}
            >
              {receipt.text} {receipt.label}
            </Text>
          ) : null}
          <TouchableOpacity
            onPress={onOpenContextMenu}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Message options"
          >
            <Feather name="more-horizontal" size={13} color={isOwn ? 'rgba(255,255,255,0.72)' : Colors.midGrey} />
          </TouchableOpacity>
        </View>
        {reactionCounts.length > 0 ? (
          <View style={[styles.reactionSummary, isOwn && styles.reactionSummaryOwn]}>
            {reactionCounts.map(({ emoji, count, selected }) => (
              <TouchableOpacity
                key={emoji}
                style={[styles.reactionChip, selected && styles.reactionChipSelected, isOwn && styles.reactionChipOwn]}
                onPress={() => onToggleReaction(emoji)}
                accessibilityRole="button"
                accessibilityLabel={(selected ? 'Remove' : 'Add') + ' ' + emoji + ' reaction'}
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

function MessageMediaPreviewModal({
  preview,
  onDismiss,
  onOpenItemActions,
}: {
  preview: MessageMediaPreview | null
  onDismiss: () => void
  onOpenItemActions: (item: MediaLightboxItem, index: number) => void
}) {
  return (
    <DrapeMediaViewer
      items={preview?.items ?? []}
      activeIndex={preview?.index ?? null}
      onDismiss={onDismiss}
      onOpenItemActions={onOpenItemActions}
      testID="message-media-viewer"
    />
  )
}

function MessageContextSheet({
  message,
  isOwn,
  visible,
  onDismiss,
  onReply,
  onEdit,
  onUnsend,
  reactions,
  currentUserId,
  reactionsAvailable,
  onToggleReaction,
}: {
  message: Message | null
  isOwn: boolean
  visible: boolean
  onDismiss: () => void
  onReply: () => void
  onEdit: () => void
  onUnsend: () => void
  reactions: MessageReaction[]
  currentUserId: string
  reactionsAvailable: boolean
  onToggleReaction: (emoji: string) => void
}) {
  if (!message) return null
  const canUnsend = isOwn && !message.is_deleted && isWithin15Minutes(message.created_at)
  const canEdit = isOwn && !message.is_deleted && message.type === 'TEXT'
  const canReply = !message.is_deleted
  const canReact = reactionsAvailable && !message.is_deleted
  const actionCount = Number(canReply) + Number(canEdit) + Number(canUnsend)
  const actionSheetSnapPoint = actionCount <= 1 ? '34%' : '46%'
  const previewLabel = message.is_deleted
    ? 'This message was unsent.'
    : message.type === 'PHOTO'
      ? 'Media message'
      : message.type === 'VOICE'
        ? 'Voice note'
        : decodeDisplayText(message.body ?? '')

  return (
    <BottomSheetScaffold
      visible={visible}
      testID="message-actions-sheet"
      title="Message actions"
      subtitle={previewLabel}
      onDismiss={onDismiss}
      scrollable
      snapPoints={[actionSheetSnapPoint]}
      enableDynamicSizing={false}
    >
      {canReact ? (
        <View style={styles.sheetReactionRow}>
          {MESSAGE_REACTION_OPTIONS.map((emoji) => {
            const selected = reactions.some((reaction) => reaction.user_id === currentUserId && reaction.emoji === emoji)
            return (
              <TouchableOpacity
                key={emoji}
                style={[styles.sheetEmojiBtn, selected && styles.sheetEmojiBtnSelected]}
                onPress={() => { onToggleReaction(emoji); onDismiss() }}
                accessibilityRole="button"
                accessibilityLabel={`${selected ? 'Remove' : 'Add'} ${emoji} reaction`}
              >
                <Text style={styles.sheetEmojiText}>{emoji}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      ) : null}

      <View style={styles.sheetActionList}>
        {canReply ? (
          <TouchableOpacity
            style={styles.sheetActionRow}
            onPress={() => { onReply(); onDismiss() }}
            accessibilityRole="button"
            testID="message-action-reply"
          >
            <Text style={styles.sheetActionLabel}>Reply</Text>
          </TouchableOpacity>
        ) : null}

        {canEdit ? (
          <TouchableOpacity style={styles.sheetActionRow} onPress={() => { onEdit(); onDismiss() }} accessibilityRole="button">
            <Text style={styles.sheetActionLabel}>Edit</Text>
          </TouchableOpacity>
        ) : null}

        {canUnsend ? (
          <TouchableOpacity style={styles.sheetActionRow} onPress={() => { onUnsend(); onDismiss() }} accessibilityRole="button">
            <Text style={[styles.sheetActionLabel, styles.sheetActionLabelDestructive]}>Unsend</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </BottomSheetScaffold>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.md },
  listHeaderStack: { gap: Spacing.sm },

  loadEarlierBtn: {
    alignSelf: 'center', paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  loadEarlierText: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },
  callLifecycleCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '24',
    padding: Spacing.lg,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  callLifecycleCardExpired: {
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
  },
  callLifecycleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  callLifecycleIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  callLifecycleTitleWrap: { flex: 1, gap: 2 },
  callLifecycleEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  callLifecycleTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
  },
  callLifecycleMeta: {
    fontSize: FontSize.xs,
    lineHeight: 18,
    color: Colors.inkLight,
  },
  callLifecycleReasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
    paddingTop: Spacing.sm,
  },
  callLifecycleReasonLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.midGrey,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  callLifecycleReasonValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  callLifecyclePrimaryAction: {
    minHeight: 46,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
    paddingHorizontal: Spacing.lg,
  },
  callLifecyclePrimaryActionText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.textInverse,
  },
  callLifecycleDisabledAction: {
    minHeight: 46,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
    paddingHorizontal: Spacing.lg,
  },
  callLifecycleDisabledActionText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
  },
  callLifecyclePaymentBlock: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.kanteRust + '24',
    backgroundColor: Colors.kanteRustLight,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  callLifecyclePaymentText: {
    flex: 1,
    fontSize: FontSize.xs,
    lineHeight: 18,
    fontWeight: FontWeight.semibold,
    color: Colors.kanteRust,
  },
  callLifecyclePaymentAction: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  callLifecyclePaymentActionText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.needleGreen,
  },
  callLifecycleExpiredBlock: {
    borderRadius: Radius.md,
    backgroundColor: Colors.lightGrey,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  callLifecycleExpiredText: {
    flex: 1,
    fontSize: FontSize.xs,
    lineHeight: 18,
    fontWeight: FontWeight.semibold,
    color: Colors.midGrey,
  },
  callLifecycleTextAction: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  callLifecycleTextActionLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.needleGreen,
  },

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
  recordingBarCancel: { backgroundColor: Colors.kanteRustLight },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.error },
  recordingDotCancel: { backgroundColor: Colors.kanteRust },
  recordingText: { fontSize: FontSize.sm, color: Colors.needleGreen },
  recordingTextCancel: { color: Colors.kanteRust },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingTop: Spacing.sm,
    backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: Colors.lightGrey,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  textInputWrap: { flex: 1, gap: 3 },
  textInput: {
    backgroundColor: Colors.bone, borderRadius: Radius.xl,
    paddingHorizontal: Spacing.md, paddingVertical: 7,
    fontSize: FontSize.md, lineHeight: 20, color: Colors.ink, maxHeight: 108,
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
  callGateCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    marginTop: -Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.kanteRust + '24',
    backgroundColor: Colors.kanteRustLight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  callGateText: {
    flex: 1,
    fontSize: FontSize.xs,
    lineHeight: 18,
    color: Colors.kanteRust,
    fontWeight: FontWeight.medium,
  },
  callGateAction: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  callGateActionText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
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
  bubbleRowClustered: { marginTop: -Spacing.xs },
  messageAvatar: { marginBottom: 2 },
  messageAvatarSpacer: { width: 32 },
  bubble: {
    maxWidth: '82%',
    minWidth: 0,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: 3,
  },
  bubbleMedia: {
    padding: 6,
    gap: 6,
  },
  mediaMosaicBubble: {
    width: MESSAGE_MEDIA_TILE_SIZE + 12,
  },
  bubbleOther: {
    backgroundColor: Colors.white, borderBottomLeftRadius: 4,
    ...Shadow.sm,
  },
  bubbleOwn: { backgroundColor: Colors.needleGreen, borderBottomRightRadius: 4 },
  mediaClusterOtherStart: { borderBottomLeftRadius: 10, borderBottomRightRadius: Radius.md },
  mediaClusterOtherMiddle: { borderTopLeftRadius: 10, borderBottomLeftRadius: 10, borderTopRightRadius: Radius.md, borderBottomRightRadius: Radius.md },
  mediaClusterOtherEnd: { borderTopLeftRadius: 10, borderTopRightRadius: Radius.md },
  mediaClusterOwnStart: { borderBottomRightRadius: 10, borderBottomLeftRadius: Radius.md },
  mediaClusterOwnMiddle: { borderTopRightRadius: 10, borderBottomRightRadius: 10, borderTopLeftRadius: Radius.md, borderBottomLeftRadius: Radius.md },
  mediaClusterOwnEnd: { borderTopRightRadius: 10, borderTopLeftRadius: Radius.md },
  senderName: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreen, fontFamily: Fonts.display },
  bubbleText: { fontSize: FontSize.md, color: Colors.ink, lineHeight: 20 },
  bubbleTextOwn: { color: Colors.textInverse },
  bubbleMediaWrap: {
    position: 'relative',
    width: MESSAGE_MEDIA_TILE_SIZE,
    maxWidth: '100%',
    alignSelf: 'flex-start',
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  bubblePhoto: { width: '100%', height: MESSAGE_MEDIA_TILE_SIZE, borderRadius: Radius.md, overflow: 'hidden' },
  photoFallback: { backgroundColor: Colors.boneDeep },
  mediaOpenBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.46)',
  },
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

  presenceBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xs,
    backgroundColor: Colors.bone,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
  },
  presenceDotOnline: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.needleGreen,
  },
  presenceTextOnline: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
  },
  presenceTextMuted: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
  },
  typingRow: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xs,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
  },
  typingText: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontStyle: 'italic',
  },
  conversationActionStrip: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.bone,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
  },
  conversationActionCopy: { flex: 1, gap: 2 },
  conversationActionEyebrow: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
  },
  conversationActionMeta: {
    fontFamily: Fonts.body,
    fontSize: FontSize.xs,
    color: Colors.inkLight,
  },
  conversationPrimaryAction: { flexShrink: 1, minWidth: 132 },
  conversationActionSheetList: { gap: Spacing.sm, paddingBottom: Spacing.md },
  orderEventWrap: {
    width: '88%',
    maxWidth: 380,
    alignSelf: 'center',
    paddingVertical: Spacing.sm,
  },
  orderEventWrapFocused: {
    borderRadius: Radius.md,
    backgroundColor: Colors.needleGreenLight,
    paddingHorizontal: Spacing.xs,
  },
  orderEventFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },

  // Reply bar above composer
  replyBar: {
    minHeight: COMPOSER_CONTEXT_BAR_MIN_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.needleGreenLight,
    borderTopWidth: 1,
    borderTopColor: Colors.needleGreen + '24',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  replyBarContent: { flex: 1, gap: 2 },
  replyBarMedia: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
  },
  replyBarMediaImage: { width: '100%', height: '100%' },
  replyBarAuthor: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  replyBarBody: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 16 },
  replyBarDismiss: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  replyBarDismissText: { fontSize: FontSize.sm, color: Colors.midGrey },

  // Edit mode bar above composer
  editBar: {
    minHeight: COMPOSER_CONTEXT_BAR_MIN_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.bone,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  editBarLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  editBarDismiss: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  editBarDismissText: { fontSize: FontSize.sm, color: Colors.midGrey },

  // Deleted bubble
  bubbleDeleted: { opacity: 0.62 },
  bubbleDeletedText: { fontSize: FontSize.sm, color: Colors.midGrey, fontStyle: 'italic', lineHeight: 20 },
  bubbleDeletedTextOwn: { color: 'rgba(255,255,255,0.6)' },

  // Edited tag in bubble meta
  editedTag: { fontSize: 9, color: Colors.midGrey, fontStyle: 'italic' },
  editedTagOwn: { color: 'rgba(255,255,255,0.52)' },

  // Reply quote inside bubble
  replyQuote: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.lightGrey,
    paddingLeft: Spacing.sm,
    marginBottom: Spacing.xs,
    gap: 2,
  },
  replyQuoteOwn: { borderLeftColor: 'rgba(255,255,255,0.38)' },
  replyQuoteAuthor: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  replyQuoteAuthorOwn: { color: 'rgba(255,255,255,0.8)' },
  replyQuoteBody: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 16 },
  replyQuoteBodyOwn: { color: 'rgba(255,255,255,0.6)' },

  // Context menu bottom sheet
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.44)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.lightGrey,
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  sheetReactionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: Spacing.md,
  },
  sheetActionList: {
    gap: Spacing.xs,
    paddingBottom: Spacing.xs,
  },
  sheetEmojiBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bone,
  },
  sheetEmojiBtnSelected: { backgroundColor: Colors.needleGreenLight },
  sheetEmojiText: { fontSize: 22 },
  sheetDivider: { height: 1, backgroundColor: Colors.lightGrey, marginVertical: Spacing.xs },
  sheetActionRow: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.md },
  sheetActionLabel: { fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.medium },
  sheetActionLabelDestructive: { color: Colors.kanteRust },
  sheetActionLabelMuted: { fontSize: FontSize.md, color: Colors.midGrey, fontWeight: FontWeight.medium },
})
