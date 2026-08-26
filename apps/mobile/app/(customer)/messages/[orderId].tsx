import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native'
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '@/lib/auth'
import {
  blockConversation,
  getConversationAccessStatus,
  getEmptyConversationAccessState,
  type ConversationAccessState,
} from '@/lib/conversation-access'
import { invokeFunction, supabase } from '@/lib/supabase'
import { getConsultationCallAccess } from '@/lib/consultation-call-access'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { formatExplicitZonedDateTime } from '@drape/shared/date-time'
import { useCustomerMessageOrderInfo, useRefreshOnFocus } from '@/lib/queries'
import { MessageThread } from '@/components/ui/MessageThread'
import { AvatarImage } from '@/components/ui/AvatarImage'
import { OrderCallScheduleModal } from '@/components/ui/OrderCallScheduleModal'
import { ChatSafetyBar } from '@/components/ui/ChatSafetyBar'
import { ConversationDetailsSheet } from '@/components/ui/ConversationDetailsSheet'
import { ContextualSwipeBack } from '@/components/ui/ContextualSwipeBack'
import { appendToHistory, goBackOrReturnTo, pickSafeReturnTo } from '@/lib/navigation'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { useConversationTranslation } from '@/lib/message-translation'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { TERMINAL_STAGES, type OrderStage } from '@drape/shared/order-machine'
import type { OrderConversationAction } from '@drape/shared/order-negotiation'
import { getCallLifecycleState } from '@drape/shared/call-scheduling-policy'
import type { OrderCallMeta } from '@/lib/order-support'

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

export default function CustomerMessagesScreen() {
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
  const {
    data: orderInfo,
    isLoading,
    isError,
    error: loadError,
    refetch,
  } = useCustomerMessageOrderInfo(orderId, user?.id, user?.user_metadata?.display_name ?? '')
  const resolvedOrderId = orderInfo?.resolvedOrderId ?? orderId
  const loadErrorMessage = isLikelyConnectivityIssue(loadError)
    ? 'Your connection looks weak. Keep the order thread as the source of truth and retry here when the signal stabilizes.'
    : 'Refresh this conversation or reopen the live order to keep working from the latest order record.'
  const [reportingSafety, setReportingSafety] = useState(false)
  const [conversationAccess, setConversationAccess] = useState<ConversationAccessState>(
    getEmptyConversationAccessState()
  )
  const [, setLoadingConversationAccess] = useState(false)
  const [startingCall, setStartingCall] = useState<'audio' | 'video' | null>(null)
  const [showOrderCallScheduler, setShowOrderCallScheduler] = useState(false)
  const [showConversationDetails, setShowConversationDetails] = useState(false)
  const [counterpartyOnline, setCounterpartyOnline] = useState(false)
  const [consultationRescheduleRequired, setConsultationRescheduleRequired] = useState(false)
  const [consultationBookingId, setConsultationBookingId] = useState<string | null>(null)
  const translation = useConversationTranslation(resolvedOrderId)
  const consultationMeta = orderInfo?.supportMeta.consultation ?? null
  const consultationPaymentBlocked =
    orderInfo?.stage === 'CONSULTATION' &&
    !!consultationMeta?.feeAmount &&
    consultationMeta.paymentTiming === 'BEFORE_CALL_STARTS' &&
    !consultationMeta.paidAt

  const refreshConsultationCallAccess = useCallback(async () => {
    if (!resolvedOrderId || orderInfo?.stage !== 'CONSULTATION') {
      setConsultationRescheduleRequired(false)
      setConsultationBookingId(null)
      return
    }
    try {
      const access = await getConsultationCallAccess(resolvedOrderId)
      setConsultationRescheduleRequired(access.rescheduleRequired)
      setConsultationBookingId(access.bookingId)
    } catch {
      // The consultation room remains server-gated if this secondary UI check cannot refresh.
    }
  }, [orderInfo?.stage, resolvedOrderId])

  const refreshConversationAccess = useCallback(async () => {
    if (!resolvedOrderId) return
    setLoadingConversationAccess(true)
    try {
      const nextState = await getConversationAccessStatus(resolvedOrderId)
      setConversationAccess(nextState)
    } catch (error) {
      if (!isLikelyConnectivityIssue(error)) {
        setConversationAccess(getEmptyConversationAccessState())
      }
    } finally {
      setLoadingConversationAccess(false)
    }
  }, [resolvedOrderId])

  useRefreshOnFocus(() => {
    void refetch()
    void refreshConversationAccess()
    void refreshConsultationCallAccess()
  }, 0)

  useFocusEffect(
    useCallback(() => {
      setShowConversationDetails(false)
      setShowOrderCallScheduler(false)
    }, [])
  )

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
      .channel(`customer-message-consultation-access:${consultationBookingId}`)
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

  function goBack() {
    goBackOrReturnTo(router, navigation, pickSafeReturnTo(historyChain, returnTo), '/(customer)/messages')
  }

  useContextualBackHandler(goBack)

  function openConsultationPayment() {
    if (!resolvedOrderId) return
    router.push({
      pathname: '/(customer)/orders/[id]',
      params: {
        id: resolvedOrderId,
        returnTo: `/(customer)/messages/${resolvedOrderId}`,
        historyChain: appendToHistory(historyChain, `/(customer)/messages/${resolvedOrderId}`),
      },
    })
  }

  const openConversationAction = useCallback((action: OrderConversationAction) => {
    if (!resolvedOrderId) return
    router.push({
      pathname: '/(customer)/orders/[id]',
      params: {
        id: resolvedOrderId,
        action: action.kind,
        returnTo: `/(customer)/messages/${resolvedOrderId}`,
        historyChain: appendToHistory(historyChain, `/(customer)/messages/${resolvedOrderId}`),
      },
    })
  }, [historyChain, resolvedOrderId, router])

  const openOrderControl = useCallback(() => {
    if (!orderInfo) return
    setShowConversationDetails(false)
    if (
      orderInfo.orderKind === 'READY_MADE' &&
      orderInfo.stage === 'PENDING_QUOTE' &&
      orderInfo.sellerItemId
    ) {
      router.push({
        pathname: '/(customer)/tailor/item/[itemId]',
        params: {
          itemId: orderInfo.sellerItemId,
          returnTo: `/(customer)/messages/${resolvedOrderId}`,
          historyChain: appendToHistory(historyChain, `/(customer)/messages/${resolvedOrderId}`),
        },
      })
      return
    }
    router.push({
      pathname: '/(customer)/orders/[id]',
      params: {
        id: resolvedOrderId,
        returnTo: `/(customer)/messages/${resolvedOrderId}`,
        historyChain: appendToHistory(historyChain, `/(customer)/messages/${resolvedOrderId}`),
      },
    })
  }, [historyChain, orderInfo, resolvedOrderId, router])

  async function startConsultationCall(callType: 'audio' | 'video') {
    if (startingCall) return
    setStartingCall(callType)
    try {
      router.push({
        pathname: '/call-join',
        params: {
          orderId: resolvedOrderId,
          callKind: 'consultation',
          callType,
          historyChain: appendToHistory(historyChain, `/(customer)/messages/${resolvedOrderId}`),
        },
      })
    } finally {
      setStartingCall(null)
    }
  }

  async function startOrderCall(callType: 'audio' | 'video') {
    if (startingCall) return
    setStartingCall(callType)
    try {
      router.push({
        pathname: '/call-join',
        params: {
          orderId: resolvedOrderId,
          callKind: 'ready-made',
          callType,
          historyChain: appendToHistory(historyChain, `/(customer)/messages/${resolvedOrderId}`),
        },
      })
    } finally {
      setStartingCall(null)
    }
  }

  function showDrapeCallOptions() {
    if (!orderInfo || startingCall) return
    if (orderInfo.stage === 'CONSULTATION' && consultationRescheduleRequired) {
      Alert.alert(
        'Choose a new consultation time',
        'The previous consultation window is closed. Open the order to choose a new protected time.',
        [
          { text: 'Close', style: 'cancel' },
          { text: 'View order', onPress: openConsultationPayment },
        ],
      )
      return
    }
    const consultation =
      orderInfo.stage === 'CONSULTATION' &&
      consultationMeta?.status === 'SCHEDULED' &&
      !!consultationMeta.scheduledStartAt
    if (!consultation) {
      showReadyMadeOrderCallOptions()
      return
    }
    if (consultation && consultationPaymentBlocked) {
      Alert.alert(
        'Consultation fee required',
        'Consultation fee required before the room can open',
        [
          { text: 'Close', style: 'cancel' },
          { text: 'Pay fee', onPress: openConsultationPayment },
        ],
      )
      return
    }
    const scheduledCallType = consultationMeta?.callType === 'AUDIO' ? 'audio' : 'video'
    const title = 'Consultation call'
    const body = `Start or join the scheduled ${scheduledCallType} call with ${orderInfo.tailorName}. This call stays inside Drapeon.`

    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: scheduledCallType === 'audio' ? 'Open audio call' : 'Open video call',
        onPress: () => {
          void startConsultationCall(scheduledCallType)
        },
      },
    ])
  }

  function showReadyMadeOrderCallOptions() {
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
          text: 'Video',
          onPress: () => {
            void startOrderCall('video')
          },
        },
        {
          text: 'Audio only',
          onPress: () => {
            void startOrderCall('audio')
          },
        },
      ]
    )
  }

  async function submitSafetyReport(category: SafetyReportCategory, reportedMessageId?: string) {
    if (reportingSafety) return
    setReportingSafety(true)
    const { error } = await invokeFunction('conversation-safety-report', {
      body: { orderId: resolvedOrderId, category, surface: 'messages', messageId: reportedMessageId },
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
    if (reportingSafety || !resolvedOrderId) return
    setReportingSafety(true)
    try {
      const nextState = await blockConversation(resolvedOrderId, reason)
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

  if (isLoading && orderInfo === undefined) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Order conversation</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading this conversation…</Text>
            <Text style={styles.stateHint}>Loading the latest thread.</Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (!orderInfo) {
    if (isError) {
      return (
        <SafeAreaView style={styles.safe}>
          <View style={styles.header}>
            <TouchableOpacity onPress={goBack}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.stateWrap}>
            <View style={styles.stateCard}>
              <Text style={styles.stateEyebrow}>Order conversation</Text>
              <Text style={styles.stateTitle}>Couldn't load this conversation.</Text>
              <Text style={styles.stateHint}>{loadErrorMessage}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => void refetch()}>
                <Text style={styles.retryBtnText}>Try again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => router.replace('/(customer)/orders')}
              >
                <Text style={styles.secondaryBtnText}>Open orders</Text>
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      )
    }
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerBackBtn}
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Feather name="chevron-left" size={26} color={Colors.needleGreen} />
          </TouchableOpacity>
        </View>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Order conversation</Text>
            <Text style={styles.stateTitle}>No active order with this tailor.</Text>
            <Text style={styles.stateHint}>Open your orders or place a new brief.</Text>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => router.replace('/(customer)/orders')}
            >
              <Text style={styles.secondaryBtnText}>Open orders</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ghostBtn} onPress={() => router.replace('/(customer)')}>
              <Text style={styles.ghostBtnText}>Explore tailors</Text>
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
        actionLoading: !!startingCall,
        onJoinVideo: () => {
          void startConsultationCall('video')
        },
        onReschedule: openConsultationPayment,
        rescheduleLabel: 'View order',
        paymentActionLabel: 'Pay fee',
        onPressPayment: openConsultationPayment,
      }
    : scheduledOrderCall
      ? {
          kind: 'order' as const,
          createdAt: orderInfo.supportMeta.orderCall?.requestedAt ?? orderInfo.supportMeta.orderCall?.scheduledStartAt,
          scheduledStartAt: orderInfo.supportMeta.orderCall?.scheduledStartAt,
          timezone: orderInfo.supportMeta.orderCall?.timezone,
          status: orderInfo.supportMeta.orderCall?.status,
          reason: orderInfo.supportMeta.orderCall?.reason,
          actionLoading: !!startingCall,
          onJoinVideo: () => {
            void startOrderCall('video')
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
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <View style={styles.headerAvatarWrap}>
              <AvatarImage
                uri={orderInfo.tailorAvatarUrl}
                initials={orderInfo.tailorName}
                size={36}
                borderColor={Colors.lightGrey}
                borderWidth={1}
              />
              {counterpartyOnline ? <View style={styles.headerPresenceDot} accessibilityLabel="Online" /> : null}
            </View>
            <View style={styles.headerTextBlock}>
              <Text style={styles.headerName}>{orderInfo.tailorName}</Text>
              <Text style={styles.headerSub}>{orderInfo.garmentType}</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            {(consultationCallAvailable || isOrderCallStage(orderInfo.stage)) ? (
              <TouchableOpacity
                style={styles.headerCallBtn}
                onPress={showDrapeCallOptions}
                disabled={!!startingCall || consultationPaymentBlocked}
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
          orderId={resolvedOrderId}
          currentUserId={user?.id ?? ''}
          currentUserRole="CUSTOMER"
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
          callGateActionLabel={consultationPaymentBlocked ? 'Pay fee' : null}
          onPressCallGateAction={consultationPaymentBlocked ? openConsultationPayment : undefined}
          callLifecycleEvent={callLifecycleEvent}
          emptyConversationPrompt={
            orderInfo.stage === 'CONSULTATION'
              ? {
                  eyebrow: 'Consultation',
                  title: `Start aligning with ${orderInfo.tailorName.split(' ')[0]}`,
                  body:
                    'Use this thread to clarify the brief before the quote. Pick a starter below or write your own message.',
                  starters: [
                    'I want to confirm the fit and measurements before the quote.',
                    'Can we align on the fabric, colour, and finish?',
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
          orderId={resolvedOrderId}
          counterpartName={orderInfo.tailorName}
          actorLabel="customer"
          existingOrderCall={orderInfo.supportMeta.orderCall ?? null}
          onClose={() => setShowOrderCallScheduler(false)}
          onScheduled={() => {
            void refetch()
          }}
        />
        <ConversationDetailsSheet
          visible={showConversationDetails}
          orderId={resolvedOrderId}
          orderLabel={orderInfo.garmentType}
          orderStage={orderInfo.stage}
          participants={[
            { name: orderInfo.tailorName, role: 'Tailor', avatarUrl: orderInfo.tailorAvatarUrl },
            { name: orderInfo.customerName || 'You', role: 'Customer', avatarUrl: orderInfo.customerAvatarUrl },
          ]}
          onClose={() => setShowConversationDetails(false)}
          onOpenOrder={openOrderControl}
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
