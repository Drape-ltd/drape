import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  blockConversation,
  getConversationAccessStatus,
  getEmptyConversationAccessState,
  type ConversationAccessState,
} from '@/lib/conversation-access'
import { supabase, invokeFunction } from '@/lib/supabase'
import { getConsultationCallAccess } from '@/lib/consultation-call-access'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { formatExplicitZonedDateTime } from '@drape/shared/date-time'
import { MessageThread } from '@/components/ui/MessageThread'
import { AvatarImage } from '@/components/ui/AvatarImage'
import { OrderCallScheduleModal } from '@/components/ui/OrderCallScheduleModal'
import { ChatSafetyBar } from '@/components/ui/ChatSafetyBar'
import { ConversationDetailsSheet } from '@/components/ui/ConversationDetailsSheet'
import { ContextualSwipeBack } from '@/components/ui/ContextualSwipeBack'
import { appendToHistory, goBackOrReturnTo, pickSafeReturnTo } from '@/lib/navigation'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { useConversationTranslation } from '@/lib/message-translation'
import { parseOrderSupportMeta, type OrderCallMeta, type OrderSupportMeta } from '@/lib/order-support'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { TERMINAL_STAGES, type OrderStage } from '@drape/shared/order-machine'
import { decodeDisplayText } from '@drape/shared/display-text'
import { getCallLifecycleState } from '@drape/shared/call-scheduling-policy'
import type { OrderConversationAction } from '@drape/shared/order-negotiation'

const SUPPORT_EMAIL = 'support@drapeon.co'
type SafetyReportCategory = 'ABUSIVE_LANGUAGE' | 'OFF_PLATFORM_PRESSURE' | 'UNSAFE_BEHAVIOR'
const ORDER_CALL_STAGES: OrderStage[] = [
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'DELIVERED',
  'COLLECTED',
  'IN_DISPUTE',
]

function isOrderCallStage(stage: OrderStage | null | undefined) {
  return !!stage && ORDER_CALL_STAGES.includes(stage)
}

function displayText(value: string | null | undefined, fallback = '') {
  const decoded = decodeDisplayText(value ?? '').trim()
  return decoded || fallback
}

function readyMadeCallJoinState(orderCall: OrderCallMeta | null | undefined) {
  if (!orderCall || orderCall.status !== 'SCHEDULED' || !orderCall.scheduledStartAt) return 'needs-schedule' as const
  if (orderCall.expiredAt) return 'expired' as const
  const lifecycle = getCallLifecycleState(orderCall.scheduledStartAt)
  if (lifecycle.status === 'upcoming') return 'too-early' as const
  if (lifecycle.status === 'active') return 'join' as const
  return 'expired' as const
}

function formatOrderCallTime(value: string | null | undefined, timezone?: string | null) {
  return formatExplicitZonedDateTime(value, { timeZone: timezone, fallback: 'the scheduled time' }) ?? 'the scheduled time'
}

type ProfileJoinRow = {
  display_name: string | null
  avatar_url: string | null
}
type TailorMessageOrderRow = {
  garment_type: string | null
  order_kind: 'CUSTOM' | 'READY_MADE' | null
  stage: OrderStage
  video_call_url: string | null
  special_note: string | null
  customer_profiles: ProfileJoinRow | ProfileJoinRow[] | null
  tailor_profiles: ProfileJoinRow | ProfileJoinRow[] | null
}

function firstJoinedRow<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

export default function TailorMessagesScreen() {
  const { orderId, returnTo, historyChain, eventId, messageId } = useLocalSearchParams<{
    orderId: string
    returnTo?: string
    historyChain?: string
    eventId?: string
    messageId?: string
  }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const userId = user?.id
  const displayName = String(user?.user_metadata?.display_name ?? '').trim()

  const [orderInfo, setOrderInfo] = useState<{
    garmentType: string
    orderKind: 'CUSTOM' | 'READY_MADE'
    customerName: string
    customerAvatarUrl: string | null
    tailorName: string
    tailorAvatarUrl: string | null
    stage: OrderStage
    videoCallUrl: string | null
    supportMeta: OrderSupportMeta
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchErrorMessage, setFetchErrorMessage] = useState<string | null>(null)
  const [startingCall, setStartingCall] = useState(false)
  const [reportingSafety, setReportingSafety] = useState(false)
  const [showOrderCallScheduler, setShowOrderCallScheduler] = useState(false)
  const [showConversationDetails, setShowConversationDetails] = useState(false)
  const [counterpartyOnline, setCounterpartyOnline] = useState(false)
  const [consultationRescheduleRequired, setConsultationRescheduleRequired] = useState(false)
  const [consultationBookingId, setConsultationBookingId] = useState<string | null>(null)
  const translation = useConversationTranslation(orderId)
  const consultationMeta = orderInfo?.supportMeta.consultation ?? null
  const consultationPaymentBlocked =
    orderInfo?.stage === 'CONSULTATION' &&
    !!consultationMeta?.feeAmount &&
    consultationMeta.paymentTiming === 'BEFORE_CALL_STARTS' &&
    !consultationMeta.paidAt
  const [conversationAccess, setConversationAccess] = useState<ConversationAccessState>(
    getEmptyConversationAccessState()
  )
  const [, setLoadingConversationAccess] = useState(false)

  const refreshConsultationCallAccess = useCallback(async () => {
    if (!orderId || orderInfo?.stage !== 'CONSULTATION') {
      setConsultationRescheduleRequired(false)
      setConsultationBookingId(null)
      return
    }
    try {
      const access = await getConsultationCallAccess(orderId)
      setConsultationRescheduleRequired(access.rescheduleRequired)
      setConsultationBookingId(access.bookingId)
    } catch {
      // The consultation room remains server-gated if this secondary UI check cannot refresh.
    }
  }, [orderId, orderInfo?.stage])

  function goBack() {
    goBackOrReturnTo(router, navigation, pickSafeReturnTo(historyChain, returnTo), '/(tailor)/orders')
  }

  useContextualBackHandler(goBack)

  const openConsultationOrderDetails = useCallback(() => {
    router.push({
      pathname: '/(tailor)/orders/[id]',
      params: {
        id: orderId,
        returnTo: `/(tailor)/messages/${orderId}`,
        historyChain: appendToHistory(historyChain, `/(tailor)/messages/${orderId}`),
      },
    })
  }, [historyChain, orderId, router])

  const openConversationAction = useCallback((action: OrderConversationAction) => {
    router.push({
      pathname: '/(tailor)/orders/[id]',
      params: {
        id: orderId,
        action: action.kind,
        returnTo: `/(tailor)/messages/${orderId}`,
        historyChain: appendToHistory(historyChain, `/(tailor)/messages/${orderId}`),
      },
    })
  }, [historyChain, orderId, router])

  const refreshConversationAccess = useCallback(async () => {
    if (!orderId) return
    setLoadingConversationAccess(true)
    try {
      const nextState = await getConversationAccessStatus(orderId)
      setConversationAccess(nextState)
    } catch (error) {
      if (!isLikelyConnectivityIssue(error)) {
        setConversationAccess(getEmptyConversationAccessState())
      }
    } finally {
      setLoadingConversationAccess(false)
    }
  }, [orderId])

  async function submitSafetyReport(category: SafetyReportCategory, reportedMessageId?: string) {
    if (reportingSafety) return
    setReportingSafety(true)
    const { error } = await invokeFunction('conversation-safety-report', {
      body: { orderId, category, surface: 'messages', messageId: reportedMessageId },
    })
    setReportingSafety(false)

    if (error) {
      Alert.alert(
        'Report unavailable',
        isLikelyConnectivityIssue(error)
          ? `Connection looks weak. We could not send this report yet. Retry when the signal improves, or email ${SUPPORT_EMAIL} and keep the thread intact as evidence.`
          : `Could not send this report right now. Retry in a moment, or email ${SUPPORT_EMAIL} and keep the thread intact as evidence.`
      )
      return
    }

    Alert.alert(
      'Report received',
      'Drapeon logged this concern for review. Keep the conversation in Drapeon and leave the message thread intact as evidence.'
    )
  }

  async function pauseConversation(reason: SafetyReportCategory) {
    if (reportingSafety || !orderId) return
    setReportingSafety(true)
    try {
      const nextState = await blockConversation(orderId, reason)
      setConversationAccess(nextState)
      Alert.alert(
        'Conversation paused',
        nextState.userMessage ?? 'This conversation is paused while Drapeon reviews a safety concern.'
      )
    } catch (error) {
      Alert.alert(
        'Pause unavailable',
        isLikelyConnectivityIssue(error)
          ? `Connection looks weak. We could not pause this chat yet. Retry when the signal improves, or email ${SUPPORT_EMAIL} and keep the thread intact as evidence.`
          : `Could not pause this chat right now. Retry in a moment, or email ${SUPPORT_EMAIL} if you need urgent help.`
      )
    } finally {
      setReportingSafety(false)
    }
  }

  function openSafetyReportOptions(reportedMessageId?: string) {
    if (reportingSafety) return

    Alert.alert('Safety in chat', 'Choose what best matches this conversation.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Abusive language',
        onPress: () => {
          void submitSafetyReport('ABUSIVE_LANGUAGE', reportedMessageId)
        },
      },
      {
        text: 'Move off Drapeon',
        onPress: () => {
          void submitSafetyReport('OFF_PLATFORM_PRESSURE', reportedMessageId)
        },
      },
      {
        text: 'Unsafe behavior',
        onPress: () => {
          void submitSafetyReport('UNSAFE_BEHAVIOR', reportedMessageId)
        },
      },
      {
        text: 'Pause this chat',
        onPress: () => {
          void pauseConversation('UNSAFE_BEHAVIOR')
        },
      },
    ])
  }

  const fetchOrder = useCallback(async () => {
    if (!orderId || !userId) {
      setFetchErrorMessage(null)
      setLoading(false)
      setOrderInfo(null)
      return
    }
    setFetchErrorMessage(null)
    setLoading(true)
    setOrderInfo(null)
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(
          `
          garment_type, order_kind, stage, video_call_url, special_note,
          customer_profiles!customer_id(display_name, avatar_url),
          tailor_profiles!tailor_profile_id(display_name, avatar_url)
        `
        )
        .eq('id', orderId)
        .eq('tailor_id', userId)
        .maybeSingle()

      if (error) {
        throw error
      }

      if (data) {
        const d = data as TailorMessageOrderRow
        const customerProfile = firstJoinedRow(d.customer_profiles)
        const tailorProfile = firstJoinedRow(d.tailor_profiles)
        setOrderInfo({
          garmentType: displayText(d.garment_type, 'Order'),
          orderKind: d.order_kind ?? 'CUSTOM',
          customerName: displayText(customerProfile?.display_name, 'Customer'),
          customerAvatarUrl: customerProfile?.avatar_url ?? null,
          tailorName: displayText(tailorProfile?.display_name, displayName || 'Tailor'),
          tailorAvatarUrl: tailorProfile?.avatar_url ?? null,
          stage: d.stage,
          videoCallUrl: d.video_call_url ?? null,
          supportMeta: parseOrderSupportMeta(displayText(d.special_note)),
        })
      } else {
        setOrderInfo(null)
      }
    } catch (error) {
      setFetchErrorMessage(
        isLikelyConnectivityIssue(error)
          ? 'Your connection looks weak. Keep the order thread as the source of truth and retry here when the signal stabilizes.'
          : 'Refresh this conversation or reopen the live order to keep working from the latest order record.'
      )
      setOrderInfo(null)
    } finally {
      setLoading(false)
    }
  }, [displayName, orderId, userId])

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchOrder()
    }, 0)
    return () => clearTimeout(timer)
  }, [fetchOrder])
  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshConversationAccess()
    }, 0)
    return () => clearTimeout(timer)
  }, [refreshConversationAccess])
  useEffect(() => {
    void refreshConsultationCallAccess()
  }, [refreshConsultationCallAccess])
  useEffect(() => {
    if (!consultationBookingId) return
    const channel = supabase
      .channel(`tailor-message-consultation-access:${consultationBookingId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'consultation_attendance_reviews',
          filter: `booking_id=eq.${consultationBookingId}`,
        },
        () => { void refreshConsultationCallAccess() },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [consultationBookingId, refreshConsultationCallAccess])

  useFocusEffect(
    useCallback(() => {
      setShowConversationDetails(false)
      setShowOrderCallScheduler(false)
      void fetchOrder()
      void refreshConversationAccess()
      void refreshConsultationCallAccess()
    }, [fetchOrder, refreshConsultationCallAccess, refreshConversationAccess])
  )

  const startCall = useCallback(async (callType: 'audio' | 'video') => {
    if (startingCall) return
    const consultation =
      orderInfo?.stage === 'CONSULTATION' &&
      consultationMeta?.status === 'SCHEDULED' &&
      !!consultationMeta.scheduledStartAt
    setStartingCall(true)
    try {
      router.push({
        pathname: '/call-join',
        params: {
          orderId,
          callKind: consultation ? 'consultation' : 'ready-made',
          callType,
          historyChain: appendToHistory(historyChain, `/(tailor)/messages/${orderId}`),
        },
      })
    } finally {
      setStartingCall(false)
    }
  }, [consultationMeta, historyChain, orderId, orderInfo?.stage, router, startingCall])

  const showReadyMadeOrderCallOptions = useCallback(() => {
    if (!orderInfo || startingCall) return
    const orderCall = orderInfo.supportMeta.orderCall ?? null
    const state = readyMadeCallJoinState(orderCall)

    if (state === 'needs-schedule') {
      setShowOrderCallScheduler(true)
      return
    }

    if (state === 'too-early') {
      Alert.alert(
        'Call is scheduled',
        `This order call is set for ${formatOrderCallTime(orderCall?.scheduledStartAt, orderCall?.timezone)}. The room opens shortly before the scheduled time.`,
        [
          { text: 'Close', style: 'cancel' },
          { text: 'Reschedule', onPress: () => setShowOrderCallScheduler(true) },
        ]
      )
      return
    }

    if (state === 'expired') {
      Alert.alert(
        'Schedule a new call',
        'That order call window has passed. Set a new time from Messages.',
        [
          { text: 'Close', style: 'cancel' },
          { text: 'Schedule', onPress: () => setShowOrderCallScheduler(true) },
        ]
      )
      return
    }

    Alert.alert(
      'Join order call',
      'This scheduled call is free and stays inside Drapeon. Use it for order clarity and keep final decisions in Messages.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reschedule', onPress: () => setShowOrderCallScheduler(true) },
        {
          text: 'Video call',
          onPress: () => {
            void startCall('video')
          },
        },
        {
          text: 'Audio call',
          onPress: () => {
            void startCall('audio')
          },
        },
      ]
    )
  }, [orderInfo, startCall, startingCall])

  const showCallOptions = useCallback(() => {
    if (startingCall) return
    if (orderInfo?.stage === 'CONSULTATION' && consultationRescheduleRequired) {
      Alert.alert(
        'Choose a new consultation time',
        'The previous consultation window is closed. Open the order to send new protected time options.',
        [
          { text: 'Close', style: 'cancel' },
          { text: 'View order', onPress: openConsultationOrderDetails },
        ],
      )
      return
    }
    const consultation =
      orderInfo?.stage === 'CONSULTATION' &&
      consultationMeta?.status === 'SCHEDULED' &&
      !!consultationMeta.scheduledStartAt
    if (!consultation) {
      showReadyMadeOrderCallOptions()
      return
    }
    if (consultation && consultationPaymentBlocked) {
      Alert.alert(
        'Waiting on consultation fee',
        'Consultation fee required before the room can open',
        [
          { text: 'Close', style: 'cancel' },
          { text: 'View order', onPress: openConsultationOrderDetails },
        ],
      )
      return
    }
    const scheduledCallType = consultationMeta?.callType === 'AUDIO' ? 'audio' : 'video'
    Alert.alert(
      'Consultation call',
      `Start or join the scheduled ${scheduledCallType} call. Any fee must be the consultation fee already shown on the order.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: scheduledCallType === 'audio' ? 'Open audio call' : 'Open video call',
          onPress: () => {
            void startCall(scheduledCallType)
          },
        },
      ]
    )
  }, [consultationMeta, consultationPaymentBlocked, consultationRescheduleRequired, openConsultationOrderDetails, orderInfo?.stage, showReadyMadeOrderCallOptions, startCall, startingCall])

  const callAvailable = isOrderCallStage(orderInfo?.stage)

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Client conversation</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading this conversation…</Text>
            <Text style={styles.stateHint}>Loading the latest thread.</Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (fetchErrorMessage) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerName}>Conversation</Text>
            <Text style={styles.headerSub}>Unavailable right now</Text>
          </View>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Client conversation</Text>
            <Text style={styles.stateTitle}>Couldn't load this conversation.</Text>
            <Text style={styles.stateHint}>{fetchErrorMessage}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => void fetchOrder()}>
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={goBack}>
              <Text style={styles.secondaryBtnText}>Open orders</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.ghostBtn}
              onPress={() => router.replace('/(tailor)/clients')}
            >
              <Text style={styles.ghostBtnText}>Open clients</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (!orderInfo) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerName}>Conversation</Text>
            <Text style={styles.headerSub}>No active order</Text>
          </View>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Client conversation</Text>
            <Text style={styles.stateTitle}>No active order with this customer.</Text>
            <Text style={styles.stateHint}>Open orders to pick up the right thread.</Text>
            <TouchableOpacity style={styles.secondaryBtn} onPress={goBack}>
              <Text style={styles.secondaryBtnText}>Open orders</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  const scheduledConsultation = orderInfo.stage === 'CONSULTATION' &&
    consultationMeta?.status === 'SCHEDULED' &&
    consultationMeta.scheduledStartAt
  const consultationCallAvailable = Boolean(scheduledConsultation)
    && !consultationRescheduleRequired
  const scheduledOrderCall = orderInfo.supportMeta.orderCall?.status === 'SCHEDULED' &&
    orderInfo.supportMeta.orderCall.scheduledStartAt
  const callLifecycleEvent = scheduledConsultation
      ? {
          kind: 'consultation' as const,
          createdAt: consultationMeta?.requestedAt ?? consultationMeta?.approvedAt ?? consultationMeta?.scheduledStartAt ?? null,
          scheduledStartAt: consultationMeta?.scheduledStartAt ?? null,
        timezone: consultationMeta?.timezone ?? null,
        status: consultationMeta?.status ?? null,
        paymentRequired: !!consultationMeta?.feeAmount && consultationMeta?.paymentTiming === 'BEFORE_CALL_STARTS',
        paymentPaid: !!consultationMeta?.paidAt,
        actionLoading: startingCall,
        onJoinVideo: () => {
          void startCall('video')
        },
        onReschedule: openConsultationOrderDetails,
        rescheduleLabel: 'View order',
        paymentActionLabel: 'View order',
        onPressPayment: openConsultationOrderDetails,
      }
    : scheduledOrderCall
      ? {
          kind: 'order' as const,
          createdAt: orderInfo.supportMeta.orderCall?.requestedAt ?? orderInfo.supportMeta.orderCall?.scheduledStartAt,
          scheduledStartAt: orderInfo.supportMeta.orderCall?.scheduledStartAt,
          timezone: orderInfo.supportMeta.orderCall?.timezone,
          status: orderInfo.supportMeta.orderCall?.status,
          reason: orderInfo.supportMeta.orderCall?.reason,
          actionLoading: startingCall,
          onJoinVideo: () => {
            void startCall('video')
          },
          onReschedule: () => setShowOrderCallScheduler(true),
          rescheduleLabel: 'Reschedule',
        }
      : null

  return (
    <ContextualSwipeBack onBack={goBack}>
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBackBtn}
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Feather name="chevron-left" size={26} color={Colors.needleGreen} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerAvatarWrap}>
            <AvatarImage
              uri={orderInfo.customerAvatarUrl}
              initials={orderInfo.customerName}
              size={36}
              borderColor={Colors.lightGrey}
              borderWidth={1}
            />
            {counterpartyOnline ? <View style={styles.headerPresenceDot} accessibilityLabel="Online" /> : null}
          </View>
          <View style={styles.headerTextBlock}>
            <Text style={styles.headerName}>{orderInfo.customerName}</Text>
            <Text style={styles.headerSub}>{orderInfo.garmentType}</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          {(consultationCallAvailable || callAvailable) ? (
            <TouchableOpacity
              style={styles.headerCallBtn}
              onPress={showCallOptions}
              disabled={startingCall || consultationPaymentBlocked}
              accessibilityRole="button"
              accessibilityLabel="Open Drapeon call options"
            >
              {startingCall
                ? <ActivityIndicator size="small" color={Colors.needleGreen} />
                : <Feather name="phone" size={17} color={Colors.needleGreen} />}
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.orderBtn}
            onPress={() => setShowConversationDetails(true)}
            accessibilityRole="button"
            accessibilityLabel="Open conversation details and order controls"
          >
            <Text style={styles.orderBtnText}>Details</Text>
            <Feather name="chevron-down" size={14} color={Colors.needleGreen} />
          </TouchableOpacity>
        </View>
      </View>

      <ChatSafetyBar
        blocked={conversationAccess.blocked}
        blockedMessage={conversationAccess.userMessage}
        inDispute={orderInfo.stage === 'IN_DISPUTE'}
      />

      <MessageThread
        orderId={orderId}
        currentUserId={user?.id ?? ''}
        currentUserRole="TAILOR"
        tailorName={orderInfo.tailorName}
        tailorAvatarUrl={orderInfo.tailorAvatarUrl}
        customerName={orderInfo.customerName}
        customerAvatarUrl={orderInfo.customerAvatarUrl}
        orderKind={orderInfo.orderKind}
        orderStage={orderInfo.stage}
        focusedEventId={eventId}
        focusedMessageId={messageId}
        onConversationAction={openConversationAction}
        onReportMessage={openSafetyReportOptions}
        onCounterpartyOnlineChange={setCounterpartyOnline}
        translationPreference={translation.preference}
        onTranslateMessage={translation.translateMessage}
        callGateMessage={consultationPaymentBlocked && !callLifecycleEvent ? 'Consultation fee required before the room can open' : null}
        callGateActionLabel={consultationPaymentBlocked ? 'View order' : null}
        onPressCallGateAction={consultationPaymentBlocked ? openConsultationOrderDetails : undefined}
        callLifecycleEvent={callLifecycleEvent}
        emptyConversationPrompt={
          orderInfo.stage === 'CONSULTATION'
            ? {
                eyebrow: 'Consultation',
                title: `Begin the consultation with ${orderInfo.customerName.split(' ')[0]}`,
                body:
                  'Clarify the details you need before quoting. Pick a starter below or write your own message.',
                starters: [
                  'Before I quote, I need to confirm your preferred fit and measurements.',
                  'Let’s confirm the fabric, colour, and finish you want.',
                  'I want to confirm the style details and delivery timing.',
                ],
              }
            : undefined
        }
        locked={TERMINAL_STAGES.includes(orderInfo.stage) || conversationAccess.blocked}
        lockedMessage={
          conversationAccess.blocked
            ? (conversationAccess.userMessage ??
              'This conversation is paused while Drapeon reviews a safety concern.')
            : undefined
        }
      />
      <OrderCallScheduleModal
        visible={showOrderCallScheduler}
        orderId={orderId}
        counterpartName={orderInfo.customerName}
        actorLabel="tailor"
        existingOrderCall={orderInfo.supportMeta.orderCall ?? null}
        onClose={() => setShowOrderCallScheduler(false)}
        onScheduled={() => {
          void fetchOrder()
        }}
      />
      <ConversationDetailsSheet
        visible={showConversationDetails}
        orderId={orderId}
        orderLabel={orderInfo.garmentType}
        orderStage={orderInfo.stage}
        participants={[
          { name: orderInfo.customerName, role: 'Customer', avatarUrl: orderInfo.customerAvatarUrl },
          { name: orderInfo.tailorName || 'You', role: 'Tailor', avatarUrl: orderInfo.tailorAvatarUrl },
        ]}
        onClose={() => setShowConversationDetails(false)}
        onOpenOrder={() => {
          setShowConversationDetails(false)
          router.push({
            pathname: '/(tailor)/orders/[id]',
            params: {
              id: orderId,
              returnTo: `/(tailor)/messages/${orderId}`,
              historyChain: appendToHistory(historyChain, `/(tailor)/messages/${orderId}`),
            },
          })
        }}
        onReport={() => {
          setShowConversationDetails(false)
          setTimeout(openSafetyReportOptions, 220)
        }}
        translationPreference={translation.preference}
        translationLanguages={translation.languages}
        translationSaving={translation.saving}
        translationError={translation.error}
        onChangeTranslationPreference={translation.updatePreference}
      />
      </KeyboardAvoidingView>
    </SafeAreaView>
    </ContextualSwipeBack>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  stateCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.lg,
    alignItems: 'center',
    ...Shadow.lg,
  },
  stateEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  stateTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
  },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 21 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
    backgroundColor: Colors.needleGreenLight + '99',
    borderBottomWidth: 1,
    borderBottomColor: Colors.needleGreen + '18',
  },
  headerBackBtn: {
    width: 40,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  backText: {
    color: Colors.needleGreen,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
  },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  headerTextBlock: { alignItems: 'center', maxWidth: 176 },
  headerAvatarWrap: { position: 'relative' },
  headerPresenceDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.needleGreen,
    borderWidth: 2,
    borderColor: Colors.needleGreenLight,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  headerCallBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white + 'B8',
    borderWidth: 1,
    borderColor: Colors.needleGreen + '14',
  },
  headerName: { fontSize: 15, fontWeight: FontWeight.semibold, color: Colors.ink },
  headerSub: { fontSize: FontSize.xs, color: Colors.midGrey },
  contextBanner: {
    backgroundColor: Colors.white,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  contextBannerEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  contextBannerTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    marginBottom: Spacing.xs,
  },
  contextBannerText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 22,
  },
  guideCard: {
    backgroundColor: Colors.white,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  guideTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    marginBottom: Spacing.xs,
  },
  guideText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  safetyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  safetyIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  safetyCopy: { flex: 1, gap: 2 },
  safetyTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  safetyText: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 16 },
  safetyWarning: { fontSize: FontSize.xs, color: Colors.kanteRust, lineHeight: 18 },
  safetyBtn: {
    alignSelf: 'center',
    backgroundColor: Colors.kanteRustLight,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.full,
    minHeight: 34,
    justifyContent: 'center',
  },
  safetyBtnText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.kanteRust,
  },
  safetyMeta: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  orderBtn: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    justifyContent: 'center',
  },
  orderBtnText: { fontSize: FontSize.xs, color: Colors.ink, fontWeight: FontWeight.semibold },
  retryBtn: {
    backgroundColor: Colors.needleGreen,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: 999,
  },
  retryBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textInverse,
  },
  secondaryBtn: {
    backgroundColor: Colors.white,
    borderColor: Colors.lightGrey,
    borderWidth: 1,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: 999,
  },
  secondaryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  ghostBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  ghostBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.needleGreen },
})
