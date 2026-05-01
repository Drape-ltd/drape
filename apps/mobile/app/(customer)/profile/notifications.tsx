/**
 * Notifications
 *
 * Shows the customer a feed of order stage updates — the same events that
 * trigger push notifications. Unacknowledged items are highlighted until
 * the user opens this screen, at which point we stamp last_notif_check in
 * auth user_metadata and the bell badge clears.
 */

import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect, useNavigation, useRouter } from 'expo-router'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { customerOrderStageLabel } from '@/lib/customer-order-copy'
import { Button, FeatureStateCard } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import type { OrderStage } from '@drape/shared/order-machine'
import { goBackOrFallback } from '@/lib/navigation'

const CUSTOMER_NOTIFICATIONS_GUIDE_KEY = 'drape_customer_notifications_best_use_dismissed'

type NotifItem = {
  id: string
  orderId: string
  orderRef: string
  garmentType: string
  tailorName: string
  orderKind: 'CUSTOM' | 'READY_MADE'
  stage: OrderStage
  note: string | null
  createdAt: string
  isNew: boolean
}

// Stage → icon mapping
function stageIcon(stage: OrderStage): React.ComponentProps<typeof Feather>['name'] {
  if (stage === 'QUOTE_SENT') return 'tag'
  if (stage === 'PAYMENT_FAILED') return 'alert-circle'
  if (stage === 'CONFIRMED') return 'check-circle'
  if (stage === 'DESIGNING') return 'edit-3'
  if (stage === 'SOURCING') return 'shopping-bag'
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
  if (stage === 'PAYMENT_FAILED') return Colors.kanteRust
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
  const navigation = useNavigation()
  const { user } = useAuth()
  const [items, setItems] = useState<NotifItem[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [retryTrigger, setRetryTrigger] = useState(0)
  const [showGuide, setShowGuide] = useState(true)

  useEffect(() => {
    AsyncStorage.getItem(`${CUSTOMER_NOTIFICATIONS_GUIDE_KEY}:${user?.id ?? 'guest'}`)
      .then((value) => setShowGuide(value !== '1'))
      .catch(() => {})
  }, [user?.id])

  async function dismissGuide() {
    setShowGuide(false)
    try {
      await AsyncStorage.setItem(`${CUSTOMER_NOTIFICATIONS_GUIDE_KEY}:${user?.id ?? 'guest'}`, '1')
    } catch {}
  }

  useFocusEffect(
    useCallback(() => {
      async function load() {
        setFetchError(false)
        setLoading(true)
        const lastCheck: string | null = user?.user_metadata?.last_notif_check ?? null

        // Fetch order stage updates for this customer's orders (last 30 days)
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        try {
          const { data, error } = await supabase
            .from('order_stage_updates')
            .select(`
              id, stage, note, created_at, order_id,
              orders!inner(
                id, reference, garment_type, order_kind, customer_id,
                tailor_profiles!tailor_profile_id(display_name)
              )
            `)
            .eq('orders.customer_id', user?.id)
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(60)

          if (error) throw error

          setItems(
            ((data ?? []) as any[]).map((row) => ({
              id: row.id,
              orderId: row.orders?.id ?? row.order_id,
              orderRef: row.orders?.reference ?? '',
              garmentType: row.orders?.garment_type ?? '',
              tailorName: row.orders?.tailor_profiles?.display_name ?? 'Tailor',
              orderKind: row.orders?.order_kind ?? 'CUSTOM',
              stage: row.stage as OrderStage,
              note: row.note ?? null,
              createdAt: row.created_at,
              isNew: lastCheck ? new Date(row.created_at) > new Date(lastCheck) : true,
            }))
          )

          try {
            await supabase.auth.updateUser({
              data: { last_notif_check: new Date().toISOString() },
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
    goBackOrFallback(router, navigation, '/(customer)/profile')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
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
          body="We’re gathering the latest quote, production, delivery, and completion updates across your orders."
          loading
        />
      ) : fetchError ? (
        <FeatureStateCard
          eyebrow="Notifications"
          title="Couldn't load notifications"
          body="This feed should keep every order update easy to spot without checking each order manually."
          accentColor={Colors.kanteRust}
          icon="alert-circle"
          supportTitle="Best recovery move"
          supportBody="Refresh here first. If updates still do not appear, open your active orders first, then profile if needed, so you can keep moving while the feed catches up."
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
            onPress={() => router.replace('/(customer)/orders')}
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
          title="All caught up"
          body="Order updates will appear here as your tailor progresses your work."
          accentColor={Colors.warning}
          icon="bell-off"
        >
          <Button
            label="Open orders"
            onPress={() => router.replace('/(customer)/orders')}
          />
          <Button
            label="Explore tailors"
            variant="secondary"
            onPress={() => router.replace('/(customer)')}
          />
        </FeatureStateCard>
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
                  <Text style={styles.guideTitle}>Treat this as your fast catch-up feed, then jump into the order that needs you.</Text>
                </View>
              )}
            </View>
          )}
          contentContainerStyle={{ paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg, gap: Spacing.xs }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.card, item.isNew && styles.cardNew]}
              onPress={() => router.replace({
                pathname: '/(customer)/orders/[id]',
                params: { id: item.orderId, returnTo: '/(customer)/profile' },
              })}
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
                    {customerOrderStageLabel(item.stage, item.orderKind)}
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
    paddingHorizontal: Spacing.lg, paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
  },
  backBtn: {
    width: 44, height: 44, borderRadius: Radius.full,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    ...Shadow.sm,
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: 'Georgia' },
  guideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 10,
    gap: 3,
    marginBottom: Spacing.sm,
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
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    lineHeight: 17,
    fontFamily: 'Georgia',
  },

  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: 9, flexDirection: 'row', alignItems: 'flex-start', gap: 9,
    ...Shadow.sm, position: 'relative', overflow: 'hidden',
  },
  cardNew: {
    borderLeftWidth: 3, borderLeftColor: Colors.needleGreen,
  },
  unreadDot: {
    position: 'absolute', top: 11, right: 11,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: Colors.needleGreen,
  },

  iconWrap: {
    width: 32, height: 32, borderRadius: Radius.sm,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },

  title: { fontSize: 12, fontWeight: FontWeight.semibold, color: Colors.ink, marginBottom: 1, fontFamily: 'Georgia', lineHeight: 16 },
  ref: { fontWeight: FontWeight.regular, color: Colors.midGrey },
  stageLine: { fontSize: 10, color: Colors.inkLight, marginBottom: 1, lineHeight: 14 },
  note: { fontSize: 10, color: Colors.midGrey, lineHeight: 14, marginTop: 1 },
  time: { fontSize: 10, color: Colors.midGrey, flexShrink: 0, marginTop: 1 },
})
