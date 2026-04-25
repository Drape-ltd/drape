import { useCallback, useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  blockConversation,
  getConversationAccessStatus,
  getEmptyConversationAccessState,
  type ConversationAccessState,
} from '@/lib/conversation-access'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { createConsultationRoom, openConsultationCallUrl } from '@/lib/consultation'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { MessageThread } from '@/components/ui/MessageThread'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { TERMINAL_STAGES, type OrderStage } from '@drape/shared/order-machine'

const SUPPORT_EMAIL = 'support@drapeon.co'
type SafetyReportCategory = 'ABUSIVE_LANGUAGE' | 'OFF_PLATFORM_PRESSURE' | 'UNSAFE_BEHAVIOR'

export default function TailorMessagesScreen() {
  const { orderId, returnTo } = useLocalSearchParams<{ orderId: string; returnTo?: string }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()

  const [orderInfo, setOrderInfo] = useState<{
    garmentType: string
    customerName: string
    tailorName: string
    stage: OrderStage
    videoCallUrl: string | null
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchErrorMessage, setFetchErrorMessage] = useState<string | null>(null)
  const [startingCall, setStartingCall] = useState(false)
  const [reportingSafety, setReportingSafety] = useState(false)
  const [conversationAccess, setConversationAccess] = useState<ConversationAccessState>(getEmptyConversationAccessState())
  const [loadingConversationAccess, setLoadingConversationAccess] = useState(false)

  function goBack() {
    if (returnTo) router.replace(returnTo as any)
    else if (navigation.canGoBack()) router.back()
    else router.replace('/(tailor)/orders')
  }

  async function openCallUrl(url: string) {
    await openConsultationCallUrl(url, 'tailor')
  }

  async function refreshConversationAccess() {
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
  }

  async function submitSafetyReport(category: SafetyReportCategory) {
    if (reportingSafety) return
    setReportingSafety(true)
    const { error } = await invokeFunction('conversation-safety-report', {
      body: { orderId, category, surface: 'messages' },
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
    if (reportingSafety || !orderId) return
    setReportingSafety(true)
    try {
      const nextState = await blockConversation(orderId, reason)
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

  const fetchOrder = useCallback(async () => {
    setFetchErrorMessage(null)
    setLoading(true)
    setOrderInfo(null)
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          garment_type, stage, video_call_url,
          customer_profiles!customer_id(display_name),
          tailor_profiles!tailor_profile_id(display_name)
        `)
        .eq('id', orderId)
        .eq('tailor_id', user?.id)
        .maybeSingle()

      if (error) {
        throw error
      }

      if (data) {
        const d = data as any
        setOrderInfo({
          garmentType: d.garment_type,
          customerName: d.customer_profiles?.display_name ?? 'Customer',
          tailorName: d.tailor_profiles?.display_name ?? user?.user_metadata?.display_name ?? 'Tailor',
          stage: d.stage,
          videoCallUrl: d.video_call_url ?? null,
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
  }, [orderId, user?.id, user?.user_metadata?.display_name])

  useEffect(() => { void fetchOrder() }, [fetchOrder])
  useEffect(() => { void refreshConversationAccess() }, [orderId])

  useFocusEffect(
    useCallback(() => {
      void fetchOrder()
      void refreshConversationAccess()
    }, [fetchOrder, orderId])
  )

  async function startCall(callType: 'audio' | 'video') {
    if (startingCall) return
    setStartingCall(true)
    try {
      const room = await createConsultationRoom(orderId, callType)
      if (!room?.url) {
        return
      }
      await fetchOrder()
      await openCallUrl(room.url)
    } catch (error) {
      Alert.alert(
        'Call unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Your connection looks weak. Keep the order thread updated and try starting the consultation again when the signal improves.'
          : 'Could not start the consultation call. Keep using the order thread and try again in a moment.'
      )
    } finally {
      setStartingCall(false)
    }
  }

  async function showCallOptions() {
    if (startingCall) return
    const url = orderInfo?.videoCallUrl
    if (url) {
      // Room exists — just open it
      Alert.alert(
        'Join call',
        'Rejoin your consultation call.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: '📹 Video', onPress: () => { void openCallUrl(url) } },
          { text: '🎙 Audio only', onPress: () => { void openCallUrl(url) } },
        ]
      )
    } else {
      Alert.alert(
        'Start consultation call',
        'Start a call with this customer.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: '📹 Video call', onPress: () => { void startCall('video') } },
          { text: '🎙 Audio call', onPress: () => { void startCall('audio') } },
        ]
      )
    }
  }

  const isConsultation = orderInfo?.stage === 'CONSULTATION'

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
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={goBack}
          >
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
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={goBack}
          >
            <Text style={styles.secondaryBtnText}>Open orders</Text>
          </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerName}>{orderInfo.customerName}</Text>
          <Text style={styles.headerSub}>{orderInfo.garmentType}</Text>
        </View>
        <View style={styles.headerActions}>
          {isConsultation && (
            <TouchableOpacity style={styles.callBtn} onPress={showCallOptions} disabled={startingCall}>
              <Text style={styles.callBtnText}>📞</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.orderBtn}
            onPress={() => router.push({
              pathname: '/(tailor)/orders/[id]',
              params: { id: orderId, returnTo: `/(tailor)/messages/${orderId}` },
            })}
          >
            <Text style={styles.orderBtnText}>View order</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.safetyCard}>
        <Text style={styles.safetyTitle}>Safety in chat</Text>
        <Text style={styles.safetyText}>
          If a customer becomes abusive or pressures you to move the deal off Drape, report it and keep the order thread
          intact as evidence.
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
        orderId={orderId}
        currentUserId={user?.id ?? ''}
        currentUserRole="TAILOR"
        tailorName={orderInfo.tailorName}
        customerName={orderInfo.customerName}
        locked={TERMINAL_STAGES.includes(orderInfo.stage) || conversationAccess.blocked}
        lockedMessage={
          conversationAccess.blocked
            ? conversationAccess.userMessage ?? 'This conversation is paused while Drape reviews a safety concern.'
            : undefined
        }
      />
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
  callBtnText: { fontSize: 18 },
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
  retryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },
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
