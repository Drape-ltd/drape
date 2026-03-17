import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Linking } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { MessageThread } from '@/components/ui/MessageThread'
import { Colors, FontSize, FontWeight, Spacing } from '@/constants/theme'
import { TERMINAL_STAGES, type OrderStage } from '@drape/shared/order-machine'

export default function TailorMessagesScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>()
  const router = useRouter()
  const { user } = useAuth()

  const [orderInfo, setOrderInfo] = useState<{
    garmentType: string
    customerName: string
    tailorName: string
    stage: OrderStage
    videoCallUrl: string | null
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [startingCall, setStartingCall] = useState(false)

  async function fetchOrder() {
    const { data } = await supabase
      .from('orders')
      .select(`
        garment_type, stage, video_call_url,
        customer_profiles!customer_id(display_name),
        tailor_profiles!tailor_profile_id(display_name)
      `)
      .eq('id', orderId)
      .eq('tailor_id', user?.id)
      .single()

    if (data) {
      const d = data as any
      setOrderInfo({
        garmentType: d.garment_type,
        customerName: d.customer_profiles?.display_name ?? 'Customer',
        tailorName: d.tailor_profiles?.display_name ?? user?.user_metadata?.display_name ?? 'Tailor',
        stage: d.stage,
        videoCallUrl: d.video_call_url ?? null,
      })
    }
    setLoading(false)
  }

  useEffect(() => { fetchOrder() }, [orderId])

  async function startCall(callType: 'audio' | 'video') {
    setStartingCall(true)
    try {
      const { data, error } = await supabase.functions.invoke('create-consultation-room', {
        body: { orderId, callType },
      })
      if (error || !data?.url) {
        Alert.alert('Error', 'Could not start call. Please try again.')
        return
      }
      await fetchOrder()
      await Linking.openURL(data.url)
    } catch {
      Alert.alert('Error', 'Could not start call.')
    } finally {
      setStartingCall(false)
    }
  }

  async function showCallOptions() {
    const url = orderInfo?.videoCallUrl
    if (url) {
      // Room exists — just open it
      Alert.alert(
        'Join call',
        'Rejoin your consultation call.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: '📹 Video', onPress: () => Linking.openURL(url) },
          { text: '🎙 Audio only', onPress: () => Linking.openURL(url) },
        ]
      )
    } else {
      Alert.alert(
        'Start consultation call',
        'Start a call with this customer.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: '📹 Video call', onPress: () => startCall('video') },
          { text: '🎙 Audio call', onPress: () => startCall('audio') },
        ]
      )
    }
  }

  const isConsultation = orderInfo?.stage === 'CONSULTATION'

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator style={{ flex: 1 }} color={Colors.needleGreen} size="large" />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerName}>{orderInfo?.customerName ?? 'Customer'}</Text>
          <Text style={styles.headerSub}>{orderInfo?.garmentType ?? ''}</Text>
        </View>
        {isConsultation ? (
          <TouchableOpacity style={styles.callBtn} onPress={showCallOptions} disabled={startingCall}>
            <Text style={styles.callBtnText}>{orderInfo?.videoCallUrl ? '📞' : '📞'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 60 }} />
        )}
      </View>

      <MessageThread
        orderId={orderId}
        currentUserId={user?.id ?? ''}
        currentUserRole="TAILOR"
        tailorName={orderInfo?.tailorName ?? ''}
        customerName={orderInfo?.customerName ?? ''}
        locked={orderInfo ? TERMINAL_STAGES.includes(orderInfo.stage) : false}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.lightGrey,
  },
  backText: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium, width: 60 },
  headerCenter: { alignItems: 'center' },
  headerName: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  headerSub: { fontSize: FontSize.xs, color: Colors.midGrey },
  callBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.needleGreen, alignItems: 'center', justifyContent: 'center',
  },
  callBtnText: { fontSize: 18 },
})
