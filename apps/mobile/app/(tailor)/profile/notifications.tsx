/**
 * Tailor Notifications
 *
 * Feed of activity on the tailor's orders:
 *   - New bookings (PENDING_QUOTE) needing a quote
 *   - Payment confirmed, customer signed off, disputes, cancellations
 *
 * Badge clears by stamping last_notif_check on open, same as customer.
 */

import { useCallback, useState } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'

type NotifItem = {
  id: string
  orderId: string
  orderRef: string
  garmentType: string
  customerName: string
  stage: OrderStage
  note: string | null
  createdAt: string
  isNew: boolean
}

function stageIcon(stage: OrderStage): React.ComponentProps<typeof Feather>['name'] {
  if (stage === 'PENDING_QUOTE') return 'inbox'
  if (stage === 'CONFIRMED') return 'check-circle'
  if (stage === 'COMPLETE' || stage === 'COLLECTED' || stage === 'DELIVERED') return 'star'
  if (stage === 'IN_DISPUTE') return 'alert-triangle'
  if (stage === 'CANCELLED' || stage === 'DECLINED' || stage === 'EXPIRED') return 'x-circle'
  if (stage === 'CONSULTATION') return 'video'
  if (stage === 'SHIPPED' || stage === 'READY_FOR_COLLECTION') return 'package'
  return 'bell'
}

function stageColor(stage: OrderStage): string {
  if (stage === 'PENDING_QUOTE') return Colors.warning
  if (stage === 'IN_DISPUTE') return Colors.kanteRust
  if (stage === 'CANCELLED' || stage === 'DECLINED' || stage === 'EXPIRED') return Colors.midGrey
  if (stage === 'COMPLETE' || stage === 'COLLECTED' || stage === 'DELIVERED') return Colors.success
  if (stage === 'CONFIRMED') return Colors.needleGreen
  return Colors.needleGreen
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function stageDescription(stage: OrderStage): string {
  if (stage === 'PENDING_QUOTE') return 'New booking — quote requested'
  if (stage === 'CONFIRMED') return 'Payment confirmed by customer'
  if (stage === 'COMPLETE') return 'Customer marked order complete'
  if (stage === 'COLLECTED') return 'Customer collected their order'
  if (stage === 'DELIVERED') return 'Order marked as delivered'
  if (stage === 'IN_DISPUTE') return 'Customer raised a dispute'
  if (stage === 'CANCELLED') return 'Order was cancelled'
  if (stage === 'CONSULTATION') return 'Consultation started'
  return STAGE_LABELS[stage] ?? stage
}

export default function TailorNotificationsScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const [items, setItems] = useState<NotifItem[]>([])
  const [loading, setLoading] = useState(true)

  useFocusEffect(
    useCallback(() => {
      async function load() {
        const lastCheck: string | null = user?.user_metadata?.last_tailor_notif_check ?? null
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

        // 1) New bookings (PENDING_QUOTE orders in last 30 days)
        const { data: newOrders } = await supabase
          .from('orders')
          .select(`id, reference, garment_type, stage, created_at, customer_profiles!customer_id(display_name)`)
          .eq('tailor_id', user?.id)
          .eq('stage', 'PENDING_QUOTE')
          .gte('created_at', since)
          .order('created_at', { ascending: false })

        // 2) Relevant stage updates on their orders (customer-initiated)
        const { data: updates } = await supabase
          .from('order_stage_updates')
          .select(`
            id, stage, note, created_at, order_id,
            orders!inner(
              id, reference, garment_type, tailor_id,
              customer_profiles!customer_id(display_name)
            )
          `)
          .eq('orders.tailor_id', user?.id)
          .in('stage', ['CONFIRMED', 'COMPLETE', 'COLLECTED', 'DELIVERED', 'IN_DISPUTE', 'CANCELLED', 'EXPIRED', 'CONSULTATION'])
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(40)

        const bookingItems: NotifItem[] = ((newOrders ?? []) as any[]).map((o) => ({
          id: `order-${o.id}`,
          orderId: o.id,
          orderRef: o.reference,
          garmentType: o.garment_type,
          customerName: o.customer_profiles?.display_name ?? 'Customer',
          stage: o.stage as OrderStage,
          note: null,
          createdAt: o.created_at,
          isNew: lastCheck ? new Date(o.created_at) > new Date(lastCheck) : true,
        }))

        const updateItems: NotifItem[] = ((updates ?? []) as any[]).map((row) => ({
          id: row.id,
          orderId: row.orders?.id ?? row.order_id,
          orderRef: row.orders?.reference ?? '',
          garmentType: row.orders?.garment_type ?? '',
          customerName: row.orders?.customer_profiles?.display_name ?? 'Customer',
          stage: row.stage as OrderStage,
          note: row.note ?? null,
          createdAt: row.created_at,
          isNew: lastCheck ? new Date(row.created_at) > new Date(lastCheck) : true,
        }))

        // Merge and deduplicate by orderId + stage, sort newest first
        const seen = new Set<string>()
        const merged: NotifItem[] = []
        for (const item of [...bookingItems, ...updateItems].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )) {
          const key = `${item.orderId}-${item.stage}`
          if (!seen.has(key)) {
            seen.add(key)
            merged.push(item)
          }
        }

        setItems(merged)
        setLoading(false)

        // Stamp last check so badge clears
        await supabase.auth.updateUser({
          data: { last_tailor_notif_check: new Date().toISOString() },
        })
      }
      load()
    }, [user?.id])
  )

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={Colors.needleGreen} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="bell-off" size={40} color={Colors.lightGrey} />
          <Text style={styles.emptyTitle}>All caught up</Text>
          <Text style={styles.emptySub}>New bookings and order updates will appear here.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl, gap: Spacing.sm }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.card, item.isNew && styles.cardNew]}
              onPress={() => router.navigate(`/(tailor)/orders/${item.orderId}` as any)}
              activeOpacity={0.7}
            >
              {item.isNew && <View style={styles.unreadDot} />}

              <View style={[styles.iconWrap, { backgroundColor: stageColor(item.stage) + '18' }]}>
                <Feather name={stageIcon(item.stage)} size={18} color={stageColor(item.stage)} />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle} numberOfLines={1}>
                  {item.garmentType}
                  <Text style={styles.ref}> · #{item.orderRef}</Text>
                </Text>
                <Text style={styles.stageLine}>
                  <Text style={{ color: stageColor(item.stage), fontWeight: FontWeight.semibold }}>
                    {stageDescription(item.stage)}
                  </Text>
                  {item.customerName ? `  ·  ${item.customerName}` : ''}
                </Text>
                {item.note ? (
                  <Text style={styles.note} numberOfLines={2}>{item.note}</Text>
                ) : null}
              </View>

              <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: Radius.full,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    ...Shadow.sm,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink },

  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: Spacing.md, padding: Spacing.xxxl,
  },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  emptySub: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 22 },

  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    ...Shadow.sm, position: 'relative', overflow: 'hidden',
  },
  cardNew: { borderLeftWidth: 3, borderLeftColor: Colors.needleGreen },
  unreadDot: {
    position: 'absolute', top: Spacing.md, right: Spacing.md,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: Colors.needleGreen,
  },
  iconWrap: {
    width: 40, height: 40, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  itemTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, marginBottom: 2 },
  ref: { fontWeight: FontWeight.regular, color: Colors.midGrey },
  stageLine: { fontSize: FontSize.sm, color: Colors.inkLight, marginBottom: 2 },
  note: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18, marginTop: 2 },
  time: { fontSize: FontSize.xs, color: Colors.midGrey, flexShrink: 0, marginTop: 2 },
})
