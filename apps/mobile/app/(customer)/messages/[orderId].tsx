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
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useAuth } from '@/lib/auth'
import {
  blockConversation,
  getConversationAccessStatus,
  getEmptyConversationAccessState,
  type ConversationAccessState,
} from '@/lib/conversation-access'
import { createConsultationRoom, openConsultationCallUrl } from '@/lib/consultation'
import { createOrderCallRoom, openDrapeCallUrl } from '@/lib/order-call'
import { invokeFunction } from '@/lib/supabase'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { useCustomerMessageOrderInfo, useRefreshOnFocus } from '@/lib/queries'
import { MessageThread } from '@/components/ui/MessageThread'
import { AvatarImage } from '@/components/ui/AvatarImage'
import { OrderCallScheduleModal } from '@/components/ui/OrderCallScheduleModal'
import { appendToHistory, goBackOrReturnTo, pickSafeReturnTo } from '@/lib/navigation'
import { useKeyboardState } from '@/lib/useKeyboardState'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { TERMINAL_STAGES, type OrderStage } from '@drape/shared/order-machine'
import { getCallLifecycleState } from '@drape/shared/call-scheduling-policy'
import type { OrderCallMeta } from '@/lib/order-support'

const SUPPORT_EMAIL = 'support@drapeon.co'
type SafetyReportCategory = 'ABUSIVE_LANGUAGE' | 'OFF_PLATFORM_PRESSURE' | 'UNSAFE_BEHAVIOR'
const ORDER_CALL_STAGES: OrderStage[] = [
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

function formatOrderCallTime(value: string | null | undefined) {
  if (!value) return 'the scheduled time'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'the scheduled time'
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function CustomerMessagesScreen() {
  const { orderId, returnTo, historyChain } = useLocalSearchParams<{
    orderId: string
    returnTo?: string
    historyChain?: string
  }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const keyboard = useKeyboardState()
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
  const [loadingConversationAccess, setLoadingConversationAccess] = useState(false)
  const [startingCall, setStartingCall] = useState<'audio' | 'video' | null>(null)
  const [showOrderCallScheduler, setShowOrderCallScheduler] = useState(false)
  const consultationMeta = orderInfo?.supportMeta.consultation ?? null
  const consultationPaymentBlocked =
    orderInfo?.stage === 'CONSULTATION' &&
    !!consultationMeta?.feeAmount &&
    consultationMeta.paymentTiming === 'BEFORE_CALL_STARTS' &&
    !consultationMeta.paidAt

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
  }, 0)

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshConversationAccess()
    }, 0)
    return () => clearTimeout(timer)
  }, [refreshConversationAccess])

  function goBack() {
    goBackOrReturnTo(router, navigation, pickSafeReturnTo(historyChain, returnTo), '/(customer)/messages')
  }

  async function openCallUrl(url: string) {
    await openConsultationCallUrl(url, 'customer')
  }

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

  async function startConsultationCall(callType: 'audio' | 'video') {
    if (startingCall) return
    setStartingCall(callType)
    try {
      const room = await createConsultationRoom(resolvedOrderId, callType)
      if (room?.fallback === 'MESSAGES') {
        await refetch()
        return
      }
      if (!room?.url) return
      await refetch()
      await openCallUrl(room.url)
    } catch (error) {
      Alert.alert(
        'Call unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Keep this thread updated and try the Drapeon call again when the signal improves.'
          : 'Could not start the consultation call. Keep using Messages and try again in a moment.'
      )
    } finally {
      setStartingCall(null)
    }
  }

  async function startOrderCall(callType: 'audio' | 'video') {
    if (startingCall) return
    setStartingCall(callType)
    try {
      const room = await createOrderCallRoom(resolvedOrderId, callType, 'customer')
      if (room?.fallback === 'MESSAGES') {
        await refetch()
        return
      }
      if (!room?.url) return
      await refetch()
      await openDrapeCallUrl(room.url, 'customer')
    } finally {
      setStartingCall(null)
    }
  }

  function showDrapeCallOptions() {
    if (!orderInfo || startingCall) return
    const consultation = orderInfo.stage === 'CONSULTATION'
    const readyMade = orderInfo.orderKind === 'READY_MADE'
    if (readyMade && !consultation) {
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
    const title = consultation ? 'Consultation call' : readyMade ? 'Order call' : 'Drapeon call'
    const body = consultation
      ? `Start or join the scheduled consultation with ${orderInfo.tailorName}. This call stays inside Drapeon; any fee must be the consultation fee already shown on the order.`
      : readyMade
        ? `Start a Drapeon call with ${orderInfo.tailorName} for pickup, delivery, sizing, or item-condition questions. Do not arrange extra payments outside Drapeon.`
      : `Start a Drapeon call with ${orderInfo.tailorName} for fit, fabric, delivery, or timeline questions. Keep final decisions in Messages after the call.`

    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Video',
        onPress: () => {
          void (consultation ? startConsultationCall('video') : startOrderCall('video'))
        },
      },
      {
        text: 'Audio only',
        onPress: () => {
          void (consultation ? startConsultationCall('audio') : startOrderCall('audio'))
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
        `This ready-made order call is set for ${formatOrderCallTime(orderCall?.scheduledStartAt)}. The room opens shortly before the scheduled time.`,
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
        'That ready-made order call window has passed. Set a new time from Messages.',
        [
          { text: 'Close', style: 'cancel' },
          { text: 'Schedule', onPress: () => setShowOrderCallScheduler(true) },
        ]
      )
      return
    }

    Alert.alert(
      'Join order call',
      `This ready-made call is free and stays inside Drapeon. Use it for pickup, delivery, sizing, or item-condition clarity; keep final decisions in Messages.`,
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

  async function submitSafetyReport(category: SafetyReportCategory) {
    if (reportingSafety) return
    setReportingSafety(true)
    const { error } = await invokeFunction('conversation-safety-report', {
      body: { orderId: resolvedOrderId, category, surface: 'messages' },
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

  function openSafetyReportOptions() {
    if (reportingSafety) return

    Alert.alert('Safety in chat', 'Choose what best matches this conversation.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Abusive language',
        onPress: () => {
          void submitSafetyReport('ABUSIVE_LANGUAGE')
        },
      },
      {
        text: 'Move off Drapeon',
        onPress: () => {
          void submitSafetyReport('OFF_PLATFORM_PRESSURE')
        },
      },
      {
        text: 'Unsafe behavior',
        onPress: () => {
          void submitSafetyReport('UNSAFE_BEHAVIOR')
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
          <TouchableOpacity onPress={goBack}>
            <Text style={styles.backText}>← Back</Text>
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
  const scheduledOrderCall = orderInfo.orderKind === 'READY_MADE' &&
    orderInfo.supportMeta.orderCall?.status === 'SCHEDULED' &&
    orderInfo.supportMeta.orderCall.scheduledStartAt
  const callLifecycleEvent = scheduledConsultation
    ? {
        kind: 'consultation' as const,
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
          kind: 'ready-made' as const,
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
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        enabled={Platform.OS === 'ios' || keyboard.visible}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <AvatarImage
              uri={orderInfo.tailorAvatarUrl}
              initials={orderInfo.tailorName}
              size={36}
              borderColor={Colors.lightGrey}
              borderWidth={1}
            />
            <View style={styles.headerTextBlock}>
              <Text style={styles.headerName}>{orderInfo.tailorName}</Text>
              <Text style={styles.headerSub}>{orderInfo.garmentType}</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.orderBtn}
              onPress={() => {
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
              }}
            >
              <Text style={styles.orderBtnText}>
                {orderInfo.orderKind === 'READY_MADE' &&
                orderInfo.stage === 'PENDING_QUOTE' &&
                orderInfo.sellerItemId
                  ? 'View item'
                  : 'View order'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.safetyCard}>
          <View style={styles.safetyIcon}>
            <Feather name="shield" size={15} color={Colors.needleGreen} />
          </View>
          <View style={styles.safetyCopy}>
            <Text style={styles.safetyTitle}>Protected chat</Text>
            <Text style={styles.safetyText}>
              Keep decisions, pickup details, and payments inside Drapeon.
            </Text>
            {conversationAccess.blocked ? (
              <Text style={styles.safetyWarning}>
                {conversationAccess.userMessage ??
                  'This conversation is paused while Drapeon reviews a safety concern.'}
              </Text>
            ) : null}
            {orderInfo.stage === 'IN_DISPUTE' && !conversationAccess.blocked ? (
              <Text style={styles.safetyWarning}>
                Calls are paused while Drapeon reviews this concern. Keep updates and evidence in this thread.
              </Text>
            ) : null}
            {loadingConversationAccess && !conversationAccess.blocked ? (
              <Text style={styles.safetyMeta}>Checking safety status…</Text>
            ) : null}
          </View>
          <TouchableOpacity
            style={styles.safetyBtn}
            onPress={openSafetyReportOptions}
            disabled={reportingSafety}
          >
            <Text style={styles.safetyBtnText}>
              {reportingSafety
                ? conversationAccess.blocked
                  ? 'Pausing chat…'
                  : 'Sending report…'
                : conversationAccess.blocked
                  ? 'Conversation paused'
                  : 'Report'}
            </Text>
          </TouchableOpacity>
        </View>

        <MessageThread
          orderId={resolvedOrderId}
          currentUserId={user?.id ?? ''}
          currentUserRole="CUSTOMER"
          tailorName={orderInfo.tailorName}
          tailorAvatarUrl={orderInfo.tailorAvatarUrl}
          customerName={orderInfo.customerName}
          customerAvatarUrl={orderInfo.customerAvatarUrl}
          callAvailable={orderInfo.stage === 'CONSULTATION' || isOrderCallStage(orderInfo.stage)}
          callLoading={!!startingCall}
          onPressCall={showDrapeCallOptions}
          callAccessibilityLabel={
            orderInfo.stage === 'CONSULTATION'
              ? 'Open consultation call options'
              : orderInfo.orderKind === 'READY_MADE'
                ? 'Schedule or join order call'
                : 'Open Drapeon call options'
          }
          callBlocked={consultationPaymentBlocked}
          callGateMessage={consultationPaymentBlocked && !callLifecycleEvent ? 'Consultation fee required before the room can open' : null}
          callGateActionLabel={consultationPaymentBlocked ? 'Pay fee' : null}
          onPressCallGateAction={consultationPaymentBlocked ? openConsultationPayment : undefined}
          callLifecycleEvent={callLifecycleEvent}
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
      </KeyboardAvoidingView>
    </SafeAreaView>
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
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
  },
  backText: {
    color: Colors.needleGreen,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    width: 56,
  },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  headerTextBlock: { alignItems: 'center', maxWidth: 176 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
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
