import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from 'react-native'
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
import { openConsultationCallUrl } from '@/lib/consultation'
import { invokeFunction } from '@/lib/supabase'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { useCustomerMessageOrderInfo, useRefreshOnFocus } from '@/lib/queries'
import { MessageThread } from '@/components/ui/MessageThread'
import { goBackOrReturnTo } from '@/lib/navigation'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { TERMINAL_STAGES } from '@drape/shared/order-machine'

const SUPPORT_EMAIL = 'support@drapeon.co'
type SafetyReportCategory = 'ABUSIVE_LANGUAGE' | 'OFF_PLATFORM_PRESSURE' | 'UNSAFE_BEHAVIOR'

export default function CustomerMessagesScreen() {
  const { orderId, returnTo } = useLocalSearchParams<{ orderId: string; returnTo?: string }>()
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
  const [conversationAccess, setConversationAccess] = useState<ConversationAccessState>(getEmptyConversationAccessState())
  const [loadingConversationAccess, setLoadingConversationAccess] = useState(false)

  async function refreshConversationAccess() {
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
  }

  useRefreshOnFocus(() => {
    void refetch()
    void refreshConversationAccess()
  }, 0)

  useEffect(() => {
    void refreshConversationAccess()
  }, [resolvedOrderId])

  function goBack() {
    goBackOrReturnTo(router, navigation, returnTo, '/(customer)/messages')
  }

  async function openCallUrl(url: string) {
    await openConsultationCallUrl(url, 'customer')
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
          : `Could not send this report right now. Retry in a moment, or email ${SUPPORT_EMAIL} and keep the thread intact as evidence.`,
      )
      return
    }

    Alert.alert(
      'Report received',
      'Drape logged this concern for review. Keep the conversation in Drape and leave the message thread intact as evidence.',
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
        nextState.userMessage ?? 'This conversation is paused while Drape reviews a safety concern.',
      )
    } catch (error) {
      Alert.alert(
        'Pause unavailable',
        isLikelyConnectivityIssue(error)
          ? `Connection looks weak. We could not pause this chat yet. Retry when the signal improves, or email ${SUPPORT_EMAIL} and keep the thread intact as evidence.`
          : `Could not pause this chat right now. Retry in a moment, or email ${SUPPORT_EMAIL} if you need urgent help.`,
      )
    } finally {
      setReportingSafety(false)
    }
  }

  function openSafetyReportOptions() {
    if (reportingSafety) return

    Alert.alert(
      'Safety in chat',
      'Choose what best matches this conversation.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Abusive language', onPress: () => { void submitSafetyReport('ABUSIVE_LANGUAGE') } },
        { text: 'Move off Drape', onPress: () => { void submitSafetyReport('OFF_PLATFORM_PRESSURE') } },
        { text: 'Unsafe behavior', onPress: () => { void submitSafetyReport('UNSAFE_BEHAVIOR') } },
        { text: 'Pause this chat', onPress: () => { void pauseConversation('UNSAFE_BEHAVIOR') } },
      ],
    )
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
            <TouchableOpacity
              style={styles.ghostBtn}
              onPress={() => router.replace('/(customer)')}
            >
              <Text style={styles.ghostBtnText}>Explore tailors</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerName}>{orderInfo.tailorName}</Text>
          <Text style={styles.headerSub}>{orderInfo.garmentType}</Text>
        </View>
        <View style={styles.headerActions}>
          {orderInfo.stage === 'CONSULTATION' && (
            <TouchableOpacity
              style={styles.callBtn}
              onPress={() => {
                if (!orderInfo.videoCallUrl) {
                  Alert.alert(
                    'Consultation requested',
                    `${orderInfo.tailorName} has requested a consultation. Keep chatting here and they’ll share the call link when ready.`
                  )
                  return
                }

                Alert.alert(
                  'Join call',
                  `Join your consultation with ${orderInfo.tailorName}.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Video', onPress: () => { void openCallUrl(orderInfo.videoCallUrl!) } },
                    { text: 'Audio only', onPress: () => { void openCallUrl(orderInfo.videoCallUrl!) } },
                  ]
                )
              }}
              accessibilityRole="button"
              accessibilityLabel={orderInfo.videoCallUrl ? 'Join consultation call' : 'Consultation requested'}
            >
              <Feather name={orderInfo.videoCallUrl ? 'phone-call' : 'message-circle'} size={18} color={Colors.textInverse} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.orderBtn}
            onPress={() => {
              if (orderInfo.orderKind === 'READY_MADE' && orderInfo.stage === 'PENDING_QUOTE' && orderInfo.sellerItemId) {
                router.push({
                  pathname: '/(customer)/tailor/item/[itemId]',
                  params: {
                    itemId: orderInfo.sellerItemId,
                    returnTo: `/(customer)/messages/${resolvedOrderId}`,
                  },
                })
                return
              }

              router.push({
                pathname: '/(customer)/orders/[id]',
                params: { id: resolvedOrderId, returnTo: `/(customer)/messages/${resolvedOrderId}` },
              })
            }}
          >
            <Text style={styles.orderBtnText}>
              {orderInfo.orderKind === 'READY_MADE' && orderInfo.stage === 'PENDING_QUOTE' && orderInfo.sellerItemId
                ? 'View item'
                : 'View order'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.safetyCard}>
        <Text style={styles.safetyTitle}>Safety in chat</Text>
        <Text style={styles.safetyText}>
          If someone pressures you to move off Drape, shares abuse, or makes you feel unsafe, report it and keep the order
          thread intact as evidence.
        </Text>
        {conversationAccess.blocked ? (
          <Text style={styles.safetyWarning}>
            {conversationAccess.userMessage ?? 'This conversation is paused while Drape reviews a safety concern.'}
          </Text>
        ) : null}
        <TouchableOpacity style={styles.safetyBtn} onPress={openSafetyReportOptions} disabled={reportingSafety}>
          <Text style={styles.safetyBtnText}>
            {reportingSafety
              ? conversationAccess.blocked ? 'Pausing chat…' : 'Sending report…'
              : conversationAccess.blocked ? 'Conversation paused' : 'Report abuse or pressure'}
          </Text>
        </TouchableOpacity>
        {loadingConversationAccess && !conversationAccess.blocked ? (
          <Text style={styles.safetyMeta}>Checking conversation safety status…</Text>
        ) : null}
      </View>

      <MessageThread
        orderId={resolvedOrderId}
        currentUserId={user?.id ?? ''}
        currentUserRole="CUSTOMER"
        tailorName={orderInfo.tailorName}
        customerName={orderInfo.customerName}
        locked={TERMINAL_STAGES.includes(orderInfo.stage) || conversationAccess.blocked}
        lockedMessage={
          conversationAccess.blocked
            ? conversationAccess.userMessage ?? 'This conversation is paused while Drape reviews a safety concern.'
            : undefined
        }
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
  stateTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 21 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: 8,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.lightGrey,
  },
  backText: { color: Colors.needleGreen, fontSize: FontSize.sm, fontWeight: FontWeight.medium, width: 56 },
  headerCenter: { alignItems: 'center' },
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
  guideTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, marginBottom: Spacing.xs },
  guideText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  safetyCard: {
    backgroundColor: Colors.white,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    gap: 8,
    ...Shadow.sm,
  },
  safetyTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  safetyText: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  safetyWarning: { fontSize: FontSize.xs, color: Colors.kanteRust, lineHeight: 18 },
  safetyBtn: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.kanteRustLight,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.full,
    minHeight: 44,
    justifyContent: 'center',
  },
  safetyBtnText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.kanteRust },
  safetyMeta: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  callBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.needleGreen, alignItems: 'center', justifyContent: 'center',
  },
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
  retryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse },
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
