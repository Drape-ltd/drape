import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'

type OrderRow = {
  id: string
  reference: string
  garmentType: string
  stage: OrderStage
  customerName: string
  estimatedDate: string | null
  quotedAmount: number | null
  createdAt: string
}

type Tab = 'active' | 'completed'

const ACTIVE_STAGES: OrderStage[] = [
  'PENDING_QUOTE', 'QUOTE_SENT', 'PAYMENT_PENDING',
  'CONFIRMED', 'CUTTING', 'SEWING', 'FINISHING',
  'SHIPPED', 'READY_FOR_COLLECTION', 'IN_DISPUTE',
]
const TERMINAL_STAGES: OrderStage[] = ['COMPLETE', 'DELIVERED', 'COLLECTED', 'DECLINED', 'EXPIRED', 'REFUNDED', 'CANCELLED']

const STAGE_COLOR: Partial<Record<OrderStage, string>> = {
  PENDING_QUOTE: Colors.warning,
  QUOTE_SENT: Colors.warning,
  PAYMENT_PENDING: Colors.warning,
  CONFIRMED: Colors.needleGreen,
  CUTTING: Colors.needleGreen,
  SEWING: Colors.needleGreen,
  FINISHING: Colors.needleGreen,
  SHIPPED: Colors.needleGreen,
  READY_FOR_COLLECTION: Colors.needleGreen,
  IN_DISPUTE: Colors.kanteRust,
  COMPLETE: Colors.midGrey,
  DELIVERED: Colors.midGrey,
  COLLECTED: Colors.midGrey,
  DECLINED: Colors.midGrey,
  EXPIRED: Colors.midGrey,
  CANCELLED: Colors.midGrey,
}

export default function TailorOrdersScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('active')
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  async function fetchOrders(t: Tab) {
    const stages = t === 'active' ? ACTIVE_STAGES : TERMINAL_STAGES
    const { data } = await supabase
      .from('orders')
      .select(`
        id, reference, garment_type, stage, quoted_completion_date, quoted_amount, created_at,
        customer_profiles!customer_id(display_name)
      `)
      .eq('tailor_id', user?.id)
      .in('stage', stages)
      .order('created_at', { ascending: false })
      .limit(50)

    setOrders(
      (data ?? []).map((o: any) => ({
        id: o.id,
        reference: o.reference,
        garmentType: o.garment_type,
        stage: o.stage,
        customerName: o.customer_profiles?.display_name ?? 'Customer',
        estimatedDate: o.quoted_completion_date,
        quotedAmount: o.quoted_amount,
        createdAt: o.created_at,
      }))
    )
  }

  useFocusEffect(useCallback(() => {
    setLoading(true)
    fetchOrders(tab).finally(() => setLoading(false))
  }, [tab]))

  async function onRefresh() {
    setRefreshing(true)
    await fetchOrders(tab)
    setRefreshing(false)
  }

  // Group: pending quotes first when on active tab
  const sortedOrders = tab === 'active'
    ? [
        ...orders.filter((o) => o.stage === 'PENDING_QUOTE'),
        ...orders.filter((o) => o.stage !== 'PENDING_QUOTE'),
      ]
    : orders

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Orders</Text>
        <View style={styles.tabs}>
          {(['active', 'completed'] as Tab[]).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
              onPress={() => setTab(t)}
            >
              <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={Colors.needleGreen} size="large" />
      ) : (
        <FlatList
          data={sortedOrders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{tab === 'active' ? 'No active orders.' : 'No completed orders yet.'}</Text>
            </View>
          }
          renderItem={({ item }) => {
            const isPending = item.stage === 'PENDING_QUOTE'
            return (
              <TouchableOpacity
                style={[styles.card, isPending && styles.cardPending]}
                testID={`tailor-order-card-${item.stage}`}
                onPress={() => router.push(`/(tailor)/orders/${item.id}`)}
              >
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.garment}>{item.garmentType}</Text>
                    <Text style={styles.customer}>{item.customerName}</Text>
                  </View>
                  <View style={[styles.stagePill, { backgroundColor: (STAGE_COLOR[item.stage] ?? Colors.midGrey) + '20' }]}>
                    <Text style={[styles.stageText, { color: STAGE_COLOR[item.stage] ?? Colors.midGrey }]}>
                      {STAGE_LABELS[item.stage]}
                    </Text>
                  </View>
                </View>
                <View style={styles.cardMeta}>
                  <Text style={styles.ref}>#{item.reference}</Text>
                  {item.estimatedDate && (
                    <Text style={styles.due}>
                      Due {new Date(item.estimatedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </Text>
                  )}
                  {item.quotedAmount && (
                    <Text style={styles.amount}>£{(item.quotedAmount / 100).toFixed(0)}</Text>
                  )}
                </View>
                {isPending && (
                  <Text style={styles.pendingCta}>Tap to review brief and send quote →</Text>
                )}
              </TouchableOpacity>
            )
          }}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: { padding: Spacing.xl, gap: Spacing.md },
  title: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink },
  tabs: {
    flexDirection: 'row', backgroundColor: Colors.boneDeep,
    borderRadius: Radius.full, padding: 3,
  },
  tabBtn: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.full, alignItems: 'center' },
  tabBtnActive: { backgroundColor: Colors.white, ...Shadow.sm },
  tabLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.midGrey },
  tabLabelActive: { color: Colors.ink, fontWeight: FontWeight.semibold },

  list: { padding: Spacing.xl, gap: Spacing.md, paddingBottom: Spacing.xxxl },
  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.md, ...Shadow.sm },
  cardPending: { borderWidth: 1.5, borderColor: Colors.warning },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  garment: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  customer: { fontSize: FontSize.sm, color: Colors.inkLight, marginTop: 2 },
  stagePill: { paddingHorizontal: Spacing.md, paddingVertical: 4, borderRadius: Radius.full },
  stageText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  cardMeta: { flexDirection: 'row', gap: Spacing.lg, alignItems: 'center' },
  ref: { fontSize: FontSize.xs, color: Colors.midGrey },
  due: { fontSize: FontSize.xs, color: Colors.midGrey },
  amount: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, marginLeft: 'auto' },
  pendingCta: { fontSize: FontSize.sm, color: Colors.warning, fontWeight: FontWeight.medium },

  empty: { flex: 1, paddingTop: 80, alignItems: 'center' },
  emptyText: { fontSize: FontSize.md, color: Colors.inkLight },
})
