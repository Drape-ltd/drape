/**
 * Tailor Notifications
 *
 * Feed of activity on the tailor's orders:
 *   - New bookings (PENDING_QUOTE) needing a quote
 *   - Payment confirmed, customer signed off, disputes, cancellations
 *
 * Badge clears by stamping last_notif_check on open, same as customer.
 */

import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect, useNavigation, useRouter } from 'expo-router'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'

const TAILOR_NOTIFICATIONS_GUIDE_KEY = 'drape_tailor_notifications_best_use_dismissed'

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
  if (stage === 'DESIGNING') return 'Production moved into design work'
  if (stage === 'SOURCING') return 'Production moved into material sourcing'
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
  const navigation = useNavigation()
  const { user } = useAuth()
  const [items, setItems] = useState<NotifItem[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [retryTrigger, setRetryTrigger] = useState(0)
  const [showGuide, setShowGuide] = useState(true)

  useEffect(() => {
    AsyncStorage.getItem(`${TAILOR_NOTIFICATIONS_GUIDE_KEY}:${user?.id ?? 'guest'}`)
      .then((value) => setShowGuide(value !== '1'))
      .catch(() => {})
  }, [user?.id])

  async function dismissGuide() {
    setShowGuide(false)
    try {
      await AsyncStorage.setItem(`${TAILOR_NOTIFICATIONS_GUIDE_KEY}:${user?.id ?? 'guest'}`, '1')
    } catch {}
  }

  useFocusEffect(
    useCallback(() => {
      async function load() {
        setLoading(true)
        setFetchError(false)
        const lastCheck: string | null = user?.user_metadata?.last_tailor_notif_check ?? null
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        try {
          const [newOrdersRes, updatesRes] = await Promise.allSettled([
            supabase
              .from('orders')
              .select(`id, reference, garment_type, stage, created_at, customer_profiles!customer_id(display_name)`)
              .eq('tailor_id', user?.id)
              .eq('stage', 'PENDING_QUOTE')
              .gte('created_at', since)
              .order('created_at', { ascending: false }),
            supabase
              .from('order_stage_updates')
              .select(`
                id, stage, note, created_at, order_id,
                orders!inner(
                  id, reference, garment_type, tailor_id,
                  customer_profiles!customer_id(display_name)
                )
              `)
              .eq('orders.tailor_id', user?.id)
              .in('stage', ['CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING', 'SHIPPED', 'READY_FOR_COLLECTION', 'COMPLETE', 'COLLECTED', 'DELIVERED', 'IN_DISPUTE', 'CANCELLED', 'EXPIRED', 'CONSULTATION'])
              .gte('created_at', since)
              .order('created_at', { ascending: false })
              .limit(40),
          ])

          const bookingItems: NotifItem[] = (
            newOrdersRes.status === 'fulfilled' && !newOrdersRes.value.error
              ? ((newOrdersRes.value.data ?? []) as any[])
              : []
          ).map((o) => ({
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

          const updateItems: NotifItem[] = (
            updatesRes.status === 'fulfilled' && !updatesRes.value.error
              ? ((updatesRes.value.data ?? []) as any[])
              : []
          ).map((row) => ({
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
            await supabase.auth.updateUser({
              data: { last_tailor_notif_check: new Date().toISOString() },
            })
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
    }, [user?.id, retryTrigger])
  )

  function goBack() {
    if (navigation.canGoBack()) router.back()
    else router.replace('/(tailor)/profile')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
      </View>

      {loading ? (
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Notifications</Text>
            <ActivityIndicator color={Colors.needleGreen} />
            <Text style={styles.stateTitle}>Loading your notifications…</Text>
            <Text style={styles.stateHint}>
              We’re gathering new bookings, customer responses, and order changes that may need your attention.
            </Text>
          </View>
        </View>
      ) : fetchError ? (
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Notifications</Text>
            <Feather name="alert-circle" size={40} color={Colors.lightGrey} />
            <Text style={styles.stateTitle}>Couldn't load notifications</Text>
            <Text style={styles.stateHint}>
              This feed should surface the business moments that need a quote, a reply, or a production decision.
            </Text>
            <View style={styles.stateGuideCard}>
              <Text style={styles.stateGuideTitle}>Best recovery move</Text>
              <Text style={styles.stateGuideText}>
                Refresh here first. If updates still do not appear, open your live orders first, then profile if needed, so quotes, production work, and customer responses do not stall.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => {
                setFetchError(false)
                setRetryTrigger((n) => n + 1)
              }}
            >
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => router.replace('/(tailor)/orders')}
            >
              <Text style={styles.secondaryBtnText}>Open orders</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => router.replace('/(tailor)/profile')}
            >
              <Text style={styles.secondaryBtnText}>Open profile</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyBadge}>
            <Text style={styles.emptyBadgeText}>Notifications</Text>
          </View>
          <Feather name="bell-off" size={40} color={Colors.lightGrey} />
          <Text style={styles.emptyTitle}>All caught up</Text>
          <Text style={styles.emptySub}>
            New bookings and order updates will appear here.
          </Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => router.replace('/(tailor)/orders')}
          >
            <Text style={styles.retryBtnText}>Open orders</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.replace('/(tailor)')}
          >
            <Text style={styles.secondaryBtnText}>Open dashboard</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={(
            <View>
              {showGuide && (
                <View style={styles.guideCard}>
                  <View style={styles.guideHeader}>
                    <Text style={styles.guideEyebrow}>Best use</Text>
                    <TouchableOpacity onPress={() => void dismissGuide()} style={styles.guideClose}>
                      <Feather name="x" size={16} color={Colors.midGrey} />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.guideTitle}>Use this as a fast operating feed, then jump into the order that needs action.</Text>
                </View>
              )}
            </View>
          )}
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
  stateGuideCard: {
    alignSelf: 'stretch',
    backgroundColor: Colors.bone,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: 4,
  },
  stateGuideTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  stateGuideText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    textAlign: 'center',
    lineHeight: 20,
  },

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
  guideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: 4,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  guideHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  guideClose: {
    width: 28,
    height: 28,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.midGrey,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  guideTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    lineHeight: 22,
  },
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: Spacing.md, padding: Spacing.xxxl,
  },
  emptyBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  emptyBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  emptySub: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 22 },
  retryBtn: {
    marginTop: Spacing.md,
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  retryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },
  secondaryBtn: {
    backgroundColor: Colors.white,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  secondaryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },

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
