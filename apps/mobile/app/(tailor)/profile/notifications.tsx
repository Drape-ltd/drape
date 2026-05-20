/**
 * Tailor Notifications
 *
 * Feed of activity on the tailor's orders:
 *   - New bookings (PENDING_QUOTE) needing a quote
 *   - Payment confirmed, customer signed off, disputes, cancellations
 *
 * Badge clears by stamping last_notif_check on open, same as customer.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect, useNavigation, useRouter } from 'expo-router'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Button, FeatureStateCard } from '@/components/ui'
import { tailorOrderHint, tailorOrderStageLabel } from '@/lib/order-flow'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import type { OrderStage } from '@drape/shared/order-machine'
import { goBackOrFallback } from '@/lib/navigation'

type NotifItem = {
  id: string
  orderId: string
  orderRef: string
  garmentType: string
  orderKind: 'CUSTOM' | 'READY_MADE'
  customerName: string
  stage: OrderStage
  note: string | null
  createdAt: string
  isNew: boolean
}

type CustomerProfileJoinRow = {
  display_name: string | null
}

type TailorNotificationOrderRow = {
  id: string
  reference: string | null
  garment_type: string | null
  order_kind: 'CUSTOM' | 'READY_MADE' | null
  stage: OrderStage | null
  created_at: string
  customer_profiles: CustomerProfileJoinRow | CustomerProfileJoinRow[] | null
}

type TailorNotificationStageUpdateRow = {
  id: string
  stage: OrderStage | null
  note: string | null
  created_at: string
  order_id: string
  orders: Omit<TailorNotificationOrderRow, 'stage' | 'created_at'> | Omit<TailorNotificationOrderRow, 'stage' | 'created_at'>[] | null
}

function firstJoinedRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function stageIcon(stage: OrderStage): React.ComponentProps<typeof Feather>['name'] {
  if (stage === 'PENDING_QUOTE') return 'inbox'
  if (stage === 'PAYMENT_FAILED') return 'alert-circle'
  if (stage === 'CONFIRMED') return 'check-circle'
  if (stage === 'DESIGNING') return 'edit-3'
  if (stage === 'SOURCING') return 'shopping-bag'
  if (stage === 'CUTTING' || stage === 'SEWING' || stage === 'FINISHING') return 'scissors'
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
  if (stage === 'PAYMENT_FAILED') return Colors.kanteRust
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

function stageDescription(item: Pick<NotifItem, 'stage' | 'orderKind'>): string {
  if (item.orderKind === 'READY_MADE' && item.stage === 'PENDING_QUOTE') return 'New ready-made inquiry'
  if (item.stage === 'CONFIRMED') {
    return item.orderKind === 'READY_MADE' ? 'Paid order placed' : 'Payment confirmed by customer'
  }
  if (item.stage === 'COMPLETE') return 'Customer marked order complete'
  if (item.stage === 'COLLECTED') return 'Customer collected their order'
  if (item.stage === 'DELIVERED') return 'Order marked as delivered'
  if (item.stage === 'IN_DISPUTE') return 'Customer raised a concern'
  if (item.stage === 'CANCELLED') return 'Order was cancelled'
  if (item.stage === 'CONSULTATION') return 'Consultation started'
  return tailorOrderHint(item.stage, item.orderKind) ?? tailorOrderStageLabel(item.stage, item.orderKind)
}

export default function TailorNotificationsScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const userId = user?.id ?? null
  const lastTailorNotifCheckRef = useRef<string | null>(null)
  const [items, setItems] = useState<NotifItem[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [retryTrigger, setRetryTrigger] = useState(0)

  useEffect(() => {
    lastTailorNotifCheckRef.current =
      typeof user?.user_metadata?.last_tailor_notif_check === 'string'
        ? user.user_metadata.last_tailor_notif_check
        : null
  }, [user?.id, user?.user_metadata?.last_tailor_notif_check])

  useFocusEffect(
    useCallback(() => {
      void retryTrigger
      async function load() {
        if (!userId) {
          setItems([])
          setFetchError(false)
          setLoading(false)
          return
        }
        setLoading(true)
        setFetchError(false)
        const lastCheck = lastTailorNotifCheckRef.current
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        try {
          const [newOrdersRes, updatesRes] = await Promise.allSettled([
            supabase
              .from('orders')
              .select(`id, reference, garment_type, order_kind, stage, created_at, customer_profiles!customer_id(display_name)`)
              .eq('tailor_id', userId)
              .eq('stage', 'PENDING_QUOTE')
              .gte('created_at', since)
              .order('created_at', { ascending: false }),
            supabase
              .from('order_stage_updates')
              .select(`
                id, stage, note, created_at, order_id,
                orders!inner(
                id, reference, garment_type, order_kind, tailor_id,
                customer_profiles!customer_id(display_name)
              )
            `)
              .eq('orders.tailor_id', userId)
              .in('stage', ['CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING', 'SHIPPED', 'READY_FOR_COLLECTION', 'COMPLETE', 'COLLECTED', 'DELIVERED', 'IN_DISPUTE', 'CANCELLED', 'EXPIRED', 'CONSULTATION'])
              .gte('created_at', since)
              .order('created_at', { ascending: false })
              .limit(40),
          ])

          const bookingItems: NotifItem[] = (
            newOrdersRes.status === 'fulfilled' && !newOrdersRes.value.error
              ? ((newOrdersRes.value.data ?? []) as TailorNotificationOrderRow[])
              : []
          ).map((o) => {
            const customerProfile = firstJoinedRow(o.customer_profiles)
            return {
              id: `order-${o.id}`,
              orderId: o.id,
              orderRef: o.reference ?? '',
              garmentType: o.garment_type ?? 'Order',
              orderKind: o.order_kind ?? 'CUSTOM',
              customerName: customerProfile?.display_name ?? 'Customer',
              stage: o.stage ?? 'PENDING_QUOTE',
              note: null,
              createdAt: o.created_at,
              isNew: lastCheck ? new Date(o.created_at) > new Date(lastCheck) : true,
            }
          })

          const updateItems: NotifItem[] = (
            updatesRes.status === 'fulfilled' && !updatesRes.value.error
              ? ((updatesRes.value.data ?? []) as TailorNotificationStageUpdateRow[])
              : []
          ).map((row) => {
            const order = firstJoinedRow(row.orders)
            const customerProfile = firstJoinedRow(order?.customer_profiles)
            return {
              id: row.id,
              orderId: order?.id ?? row.order_id,
              orderRef: order?.reference ?? '',
              garmentType: order?.garment_type ?? 'Order',
              orderKind: order?.order_kind ?? 'CUSTOM',
              customerName: customerProfile?.display_name ?? 'Customer',
              stage: row.stage ?? 'PENDING_QUOTE',
              note: row.note ?? null,
              createdAt: row.created_at,
              isNew: lastCheck ? new Date(row.created_at) > new Date(lastCheck) : true,
            }
          })

          if (
            (newOrdersRes.status === 'rejected' || (newOrdersRes.status === 'fulfilled' && newOrdersRes.value.error)) &&
            (updatesRes.status === 'rejected' || (updatesRes.status === 'fulfilled' && updatesRes.value.error))
          ) {
            setFetchError(true)
            setItems([])
            return
          }

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

          try {
            const checkedAt = new Date().toISOString()
            await supabase.auth.updateUser({
              data: { last_tailor_notif_check: checkedAt },
            })
            lastTailorNotifCheckRef.current = checkedAt
          } catch {
            // Non-fatal — the feed itself loaded successfully.
          }
        } catch {
          setFetchError(true)
          setItems([])
        } finally {
          setLoading(false)
        }
      }
      void load()
    }, [retryTrigger, userId])
  )

  function goBack() {
    goBackOrFallback(router, navigation, '/(tailor)/profile')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
      </View>

      {loading ? (
        <FeatureStateCard
          eyebrow="Notifications"
          title="Loading your notifications…"
          body="We’re gathering new bookings, customer responses, and order changes that may need your attention."
          loading
        />
      ) : fetchError ? (
        <FeatureStateCard
          eyebrow="Notifications"
          title="Couldn't load notifications"
          body="This feed should surface the business moments that need a quote, a reply, or a production decision."
          accentColor={Colors.kanteRust}
          icon="alert-circle"
        >
          <Button
            label="Try again"
            onPress={() => {
              setFetchError(false)
              setRetryTrigger((n) => n + 1)
            }}
          />
          <Button
            label="Open orders"
            variant="secondary"
            onPress={() => router.replace('/(tailor)/orders')}
          />
          <Button
            label="Open profile"
            variant="ghost"
            onPress={goBack}
          />
        </FeatureStateCard>
      ) : items.length === 0 ? (
        <FeatureStateCard
          eyebrow="Notifications"
          title="You're all caught up"
          body="We'll notify you about new bookings, messages, and order updates."
          accentColor={Colors.warning}
          icon="bell-off"
        >
          <Button
            label="Open orders"
            onPress={() => router.replace('/(tailor)/orders')}
          />
          <Button
            label="Open dashboard"
            variant="secondary"
            onPress={() => router.replace('/(tailor)')}
          />
        </FeatureStateCard>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingVertical: Spacing.sm,
            paddingHorizontal: Spacing.lg,
            paddingBottom: Math.max(insets.bottom + Spacing.lg, Spacing.xl),
            gap: Spacing.xs,
          }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.card, item.isNew && styles.cardNew]}
              onPress={() => router.push({
                pathname: '/(tailor)/orders/[id]',
                params: { id: item.orderId, returnTo: 'tailor-notifications' },
              })}
              activeOpacity={0.7}
            >
              {item.isNew && <View style={styles.unreadDot} />}

              <View style={[styles.iconWrap, { backgroundColor: stageColor(item.stage) + '18' }]}>
                <Feather name={stageIcon(item.stage)} size={18} color={stageColor(item.stage)} />
              </View>

              <View style={styles.notificationBody}>
                <View style={styles.titleRow}>
                  <Text style={styles.itemTitle} numberOfLines={2}>{item.garmentType}</Text>
                  <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
                </View>
                <Text style={styles.metaLine} numberOfLines={1}>
                  #{item.orderRef}{item.customerName ? ` · ${item.customerName}` : ''}
                </Text>
                <Text style={styles.stageLine}>
                  <Text style={{ color: stageColor(item.stage), fontWeight: FontWeight.semibold }}>
                    {stageDescription(item)}
                  </Text>
                </Text>
                {item.note ? (
                  <Text style={styles.note} numberOfLines={2}>{item.note}</Text>
                ) : null}
              </View>
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
    paddingHorizontal: Spacing.lg, paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
  },
  backBtn: {
    width: 44, height: 44, borderRadius: Radius.full,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    ...Shadow.sm,
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display },
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    ...Shadow.sm, position: 'relative', overflow: 'hidden',
  },
  cardNew: { borderWidth: 1, borderColor: Colors.needleGreen + '35' },
  unreadDot: {
    position: 'absolute', top: 11, right: 11,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: Colors.needleGreen,
  },
  iconWrap: {
    width: 40, height: 40, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  notificationBody: { flex: 1, minWidth: 0 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    lineHeight: 18,
    flex: 1,
    minWidth: 0,
  },
  ref: { fontWeight: FontWeight.regular, color: Colors.midGrey },
  metaLine: { fontSize: 12, color: Colors.midGrey, lineHeight: 17, marginTop: 2 },
  stageLine: { fontSize: 12, color: Colors.inkLight, marginTop: 2, lineHeight: 17 },
  note: { fontSize: 12, color: Colors.midGrey, lineHeight: 17, marginTop: 2 },
  time: { fontSize: 12, color: Colors.midGrey, flexShrink: 0, marginTop: 1, maxWidth: 70 },
})
