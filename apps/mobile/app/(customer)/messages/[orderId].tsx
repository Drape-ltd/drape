import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, Alert, Linking } from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { MessageThread } from '@/components/ui/MessageThread'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { TERMINAL_STAGES, type OrderStage } from '@drape/shared/order-machine'

export default function CustomerMessagesScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()

  const [orderInfo, setOrderInfo] = useState<{
    garmentType: string
    tailorName: string
    tailorId: string
    customerId: string
    customerName: string
    stage: OrderStage
    videoCallUrl: string | null
  } | null>(null)
  const [resolvedOrderId, setResolvedOrderId] = useState(orderId)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  function goBack() {
    if (navigation.canGoBack()) router.back()
    else router.replace('/(customer)/messages')
  }

  async function openCallUrl(url: string) {
    const supported = await Linking.canOpenURL(url)
    if (!supported) {
      Alert.alert('Unable to open call', 'This consultation link is unavailable right now. Keep this thread open and ask your tailor to resend the consultation details.')
      return
    }

    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert('Unable to open call', 'Please try again in a moment. If it still fails, ask your tailor for a fresh consultation link here in Messages.')
    }
  }

  async function fetchOrderInfo() {
    setFetchError(false)
    setLoading(true)
    setOrderInfo(null)
    setResolvedOrderId(orderId)
    // orderId may be a tailor ID (from "Message" on profile) — find their active order
    // or an actual order ID — handle both

    try {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select(`
          id, garment_type, stage, customer_id, video_call_url,
          tailor_profiles!tailor_profile_id(id, display_name),
          customer_profiles!customer_id(display_name)
        `)
        .eq('id', orderId)
        .eq('customer_id', user?.id)
        .maybeSingle()

      if (order) {
        const o = order as any
        setOrderInfo({
          garmentType: o.garment_type,
          tailorName: o.tailor_profiles?.display_name ?? 'Tailor',
          tailorId: o.tailor_profiles?.id,
          customerId: o.customer_id,
          customerName: o.customer_profiles?.display_name ?? user?.user_metadata?.display_name ?? 'Customer',
          stage: o.stage,
          videoCallUrl: o.video_call_url ?? null,
        })
      } else if (!orderError) {
        const { data: found, error: foundError } = await supabase
          .from('orders')
          .select(`
            id, garment_type, stage, customer_id, video_call_url,
            tailor_profiles!inner(id, display_name),
            customer_profiles(display_name)
          `)
          .eq('customer_id', user?.id)
          .eq('tailor_id', orderId)
          .not('stage', 'in', '("COMPLETE","DECLINED","EXPIRED","CANCELLED","REFUNDED")')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (found) {
          const o = found as any
          setResolvedOrderId(o.id)
          setOrderInfo({
            garmentType: o.garment_type,
            tailorName: o.tailor_profiles?.display_name ?? 'Tailor',
            tailorId: o.tailor_profiles?.id,
            customerId: o.customer_id,
            customerName: o.customer_profiles?.display_name ?? user?.user_metadata?.display_name ?? 'Customer',
            stage: o.stage,
            videoCallUrl: o.video_call_url ?? null,
          })
        } else if (foundError) {
          setFetchError(true)
          setOrderInfo(null)
        } else {
          setResolvedOrderId(orderId)
          setOrderInfo(null)
        }
      } else {
        setFetchError(true)
        setOrderInfo(null)
      }
    } catch {
      setFetchError(true)
      setOrderInfo(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchOrderInfo()
  }, [orderId, user?.id, user?.user_metadata?.display_name])

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Order conversation</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading this conversation…</Text>
            <Text style={styles.stateHint}>
              We’re pulling together the working thread for this order so quotes, updates, and next steps stay in one place.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (!orderInfo) {
    if (fetchError) {
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
              <Text style={styles.stateHint}>
                This thread should keep every order question, quote, and update in one place instead of leaving you guessing.
              </Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => void fetchOrderInfo()}>
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
            <Text style={styles.stateHint}>
              Conversations on Drape start from an order, so open your orders or place a new brief to pick the thread back up.
            </Text>
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
                    { text: '📹 Video', onPress: () => { void openCallUrl(orderInfo.videoCallUrl!) } },
                    { text: '🎙 Audio only', onPress: () => { void openCallUrl(orderInfo.videoCallUrl!) } },
                  ]
                )
              }}
            >
              <Text style={styles.callBtnText}>{orderInfo.videoCallUrl ? '📞' : '💬'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.orderBtn}
            onPress={() => router.push(`/(customer)/orders/${resolvedOrderId}`)}
          >
            <Text style={styles.orderBtnText}>View order</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.contextBanner}>
        <Text style={styles.contextBannerEyebrow}>Order thread</Text>
        <Text style={styles.contextBannerTitle}>Everything about this order lives here.</Text>
        <Text style={styles.contextBannerText}>
          Keep quote questions, consultation details, fit notes, and progress updates in this
          thread so the order stays easy to follow from start to finish.
        </Text>
      </View>

      <View style={styles.guideCard}>
        <Text style={styles.guideTitle}>Best messaging habit</Text>
        <Text style={styles.guideText}>
          Keep decisions and clarifications in this thread, then use the order screen for the formal status and delivery checkpoints.
        </Text>
      </View>

      <MessageThread
        orderId={resolvedOrderId}
        currentUserId={user?.id ?? ''}
        currentUserRole="CUSTOMER"
        tailorName={orderInfo.tailorName}
        customerName={orderInfo.customerName}
        locked={TERMINAL_STAGES.includes(orderInfo.stage)}
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
