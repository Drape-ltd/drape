import { useCallback, useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Linking } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { MessageThread } from '@/components/ui/MessageThread'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { TERMINAL_STAGES, type OrderStage } from '@drape/shared/order-machine'

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
  const [fetchError, setFetchError] = useState(false)
  const [startingCall, setStartingCall] = useState(false)

  function goBack() {
    if (returnTo) router.replace(returnTo as any)
    else if (navigation.canGoBack()) router.back()
    else router.replace('/(tailor)/orders')
  }

  async function openCallUrl(url: string) {
    const supported = await Linking.canOpenURL(url)
    if (!supported) {
      Alert.alert('Unable to open call', 'This consultation link is unavailable right now. Reopen the order and create a fresh consultation room if needed.')
      return
    }

    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert('Unable to open call', 'Please try again in a moment. If it still fails, create a fresh consultation room from the order screen.')
    }
  }

  const fetchOrder = useCallback(async () => {
    setFetchError(false)
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
    } catch {
      setFetchError(true)
      setOrderInfo(null)
    } finally {
      setLoading(false)
    }
  }, [orderId, user?.id, user?.user_metadata?.display_name])

  useEffect(() => { void fetchOrder() }, [fetchOrder])

  useFocusEffect(
    useCallback(() => {
      void fetchOrder()
    }, [fetchOrder])
  )

  async function startCall(callType: 'audio' | 'video') {
    if (startingCall) return
    setStartingCall(true)
    try {
      const { data, error } = await invokeFunction('create-consultation-room', {
        body: { orderId, callType },
      })
      if (error || !data?.url) {
        Alert.alert('Error', 'Could not start call. Please try again.')
        return
      }
      await fetchOrder()
      await openCallUrl(data.url)
    } catch {
      Alert.alert('Error', 'Could not start call.')
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

  if (fetchError) {
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
            <Text style={styles.stateHint}>Try again or open orders.</Text>
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

      <MessageThread
        orderId={orderId}
        currentUserId={user?.id ?? ''}
        currentUserRole="TAILOR"
        tailorName={orderInfo.tailorName}
        customerName={orderInfo.customerName}
        locked={TERMINAL_STAGES.includes(orderInfo.stage)}
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
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.lightGrey,
  },
  backText: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium, width: 60 },
  headerCenter: { alignItems: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  headerName: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
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
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
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
