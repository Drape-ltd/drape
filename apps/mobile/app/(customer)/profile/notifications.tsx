/**
 * Notifications
 *
 * Shows the customer a feed of order stage updates — the same events that
 * trigger push notifications. Unacknowledged items are highlighted until
 * the user opens this screen, at which point we stamp last_notif_check in
 * auth user_metadata and the bell badge clears.
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
  tailorName: string
  stage: OrderStage
  note: string | null
  createdAt: string
  isNew: boolean
}

// Stage → icon mapping
function stageIcon(stage: OrderStage): React.ComponentProps<typeof Feather>['name'] {
  if (stage === 'QUOTE_SENT') return 'tag'
  if (stage === 'CONFIRMED') return 'check-circle'
  if (stage === 'CUTTING' || stage === 'SEWING' || stage === 'FINISHING') return 'scissors'
  if (stage === 'SHIPPED') return 'truck'
  if (stage === 'READY_FOR_COLLECTION') return 'package'
  if (stage === 'DELIVERED' || stage === 'COLLECTED') return 'check-circle'
  if (stage === 'COMPLETE') return 'star'
  if (stage === 'IN_DISPUTE') return 'alert-triangle'
  if (stage === 'DECLINED') return 'x-circle'
  if (stage === 'CONSULTATION') return 'video'
  return 'bell'
}

function stageColor(stage: OrderStage): string {
  if (stage === 'IN_DISPUTE') return Colors.kanteRust
  if (stage === 'DECLINED' || stage === 'CANCELLED') return Colors.midGrey
  if (stage === 'COMPLETE' || stage === 'DELIVERED' || stage === 'COLLECTED') return Colors.success
  if (stage === 'QUOTE_SENT' || stage === 'CONSULTATION') return Colors.warning
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

export default function NotificationsScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const [items, setItems] = useState<NotifItem[]>([])
  const [loading, setLoading] = useState(true)

  useFocusEffect(
    useCallback(() => {
      async function load() {
        const lastCheck: string | null = user?.user_metadata?.last_notif_check ?? null

        // Fetch order stage updates for this customer's orders (last 30 days)
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        const { data } = await supabase
          .from('order_stage_updates')
          .select(`
            id, stage, note, created_at, order_id,
            orders!inner(
              id, reference, garment_type, customer_id,
              tailor_profiles!tailor_profile_id(display_name)
            )
          `)
          .eq('orders.customer_id', user?.id)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(60)

        setItems(
          ((data ?? []) as any[]).map((row) => ({
            id: row.id,
            orderId: row.orders?.id ?? row.order_id,
            orderRef: row.orders?.reference ?? '',
            garmentType: row.orders?.garment_type ?? '',
            tailorName: row.orders?.tailor_profiles?.display_name ?? 'Tailor',
            stage: row.stage as OrderStage,
            note: row.note ?? null,
            createdAt: row.created_at,
            isNew: lastCheck ? new Date(row.created_at) > new Date(lastCheck) : true,
          }))
        )

        setLoading(false)

        // Mark all as read — stamp now in user_metadata
        await supabase.auth.updateUser({
          data: { last_notif_check: new Date().toISOString() },
        })
      }
      load()
    }, [user?.id])
  )

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
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
          <Text style={styles.emptySub}>Order updates will appear here as your tailor progresses your work.</Text>
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
              onPress={() => router.navigate(`/(customer)/orders/${item.orderId}` as any)}
              activeOpacity={0.7}
            >
              {/* Unread dot */}
              {item.isNew && <View style={styles.unreadDot} />}

              {/* Icon */}
              <View style={[styles.iconWrap, { backgroundColor: stageColor(item.stage) + '18' }]}>
                <Feather name={stageIcon(item.stage)} size={18} color={stageColor(item.stage)} />
              </View>

              {/* Content */}
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>
                  {item.garmentType}
                  <Text style={styles.ref}> · #{item.orderRef}</Text>
                </Text>
                <Text style={styles.stageLine}>
                  <Text style={{ color: stageColor(item.stage), fontWeight: FontWeight.semibold }}>
                    {STAGE_LABELS[item.stage] ?? item.stage}
                  </Text>
                  {item.tailorName ? `  ·  ${item.tailorName}` : ''}
                </Text>
                {item.note ? (
                  <Text style={styles.note} numberOfLines={2}>{item.note}</Text>
                ) : null}
              </View>

              {/* Time */}
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
  cardNew: {
    borderLeftWidth: 3, borderLeftColor: Colors.needleGreen,
  },
  unreadDot: {
    position: 'absolute', top: Spacing.md, right: Spacing.md,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: Colors.needleGreen,
  },

  iconWrap: {
    width: 40, height: 40, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },

  title: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, marginBottom: 2 },
  ref: { fontWeight: FontWeight.regular, color: Colors.midGrey },
  stageLine: { fontSize: FontSize.sm, color: Colors.inkLight, marginBottom: 2 },
  note: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18, marginTop: 2 },
  time: { fontSize: FontSize.xs, color: Colors.midGrey, flexShrink: 0, marginTop: 2 },
})
