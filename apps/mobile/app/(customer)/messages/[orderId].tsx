import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { MessageThread } from '@/components/ui/MessageThread'
import { Colors, FontSize, FontWeight, Spacing } from '@/constants/theme'

export default function CustomerMessagesScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>()
  const router = useRouter()
  const { user } = useAuth()

  const [orderInfo, setOrderInfo] = useState<{
    garmentType: string
    tailorName: string
    tailorId: string
    customerId: string
    customerName: string
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetch() {
      // orderId may be a tailor ID (from "Message" on profile) — find their active order
      // or an actual order ID — handle both
      let resolvedOrderId = orderId

      // Try as order ID first
      const { data: order } = await supabase
        .from('orders')
        .select(`
          id, garment_type, customer_id,
          tailor_profiles!tailor_profile_id(id, display_name),
          customer_profiles!customer_id(display_name)
        `)
        .eq('id', orderId)
        .eq('customer_id', user?.id)
        .single()

      if (order) {
        const o = order as any
        setOrderInfo({
          garmentType: o.garment_type,
          tailorName: o.tailor_profiles?.display_name ?? 'Tailor',
          tailorId: o.tailor_profiles?.id,
          customerId: o.customer_id,
          customerName: o.customer_profiles?.display_name ?? user?.user_metadata?.display_name ?? 'Customer',
        })
      } else {
        // orderId is a tailor ID — find most recent active order with that tailor
        const { data: found } = await supabase
          .from('orders')
          .select(`
            id, garment_type, customer_id,
            tailor_profiles!inner(id, display_name),
            customer_profiles(display_name)
          `)
          .eq('customer_id', user?.id)
          .eq('tailor_id', orderId)
          .not('stage', 'in', '("COMPLETE","DECLINED","EXPIRED","CANCELLED","REFUNDED")')
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        if (found) {
          resolvedOrderId = (found as any).id
          const o = found as any
          setOrderInfo({
            garmentType: o.garment_type,
            tailorName: o.tailor_profiles?.display_name ?? 'Tailor',
            tailorId: o.tailor_profiles?.id,
            customerId: o.customer_id,
            customerName: o.customer_profiles?.display_name ?? user?.user_metadata?.display_name ?? 'Customer',
          })
        } else {
          // No active order — tailor profile message flow, no active order
          setOrderInfo(null)
        }
      }
      setLoading(false)
    }
    fetch()
  }, [orderId])

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator style={{ flex: 1 }} color={Colors.needleGreen} size="large" />
      </SafeAreaView>
    )
  }

  if (!orderInfo) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.noOrder}>
          <Text style={styles.noOrderText}>No active order with this tailor.</Text>
          <Text style={styles.noOrderHint}>Submit a brief to start a conversation.</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerName}>{orderInfo.tailorName}</Text>
          <Text style={styles.headerSub}>{orderInfo.garmentType}</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <MessageThread
        orderId={orderId}
        currentUserId={user?.id ?? ''}
        currentUserRole="CUSTOMER"
        tailorName={orderInfo.tailorName}
        customerName={orderInfo.customerName}
      />
      </KeyboardAvoidingView>
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
  noOrder: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.md, padding: Spacing.xl },
  noOrderText: { fontSize: FontSize.md, color: Colors.inkLight },
  noOrderHint: { fontSize: FontSize.sm, color: Colors.midGrey },
})
