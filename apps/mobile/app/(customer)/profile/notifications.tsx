/**
 * Notifications
 *
 * Shows the customer a feed of order stage updates and new messages — the same
 * events that trigger push notifications. Unacknowledged items are highlighted
 * until the user opens this screen, at which point we stamp last_notif_check
 * in auth user_metadata and the bell badge clears.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect, useNavigation, useRouter } from 'expo-router'
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { customerOrderStageLabel } from '@/lib/customer-order-copy'
import { Button, FeatureStateCard } from '@/components/ui'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import type { OrderStage } from '@drape/shared/order-machine'
import { formatEmbeddedDateTimes } from '@drape/shared/display-text'
import { appendToHistory, goBackOrFallback } from '@/lib/navigation'

type NotifItem = {
  id: string
  orderId: string
  orderRef: string
  garmentType: string
  tailorName: string
  orderKind: 'CUSTOM' | 'READY_MADE'
  kind: 'stage_update' | 'message'
  stage: OrderStage | null
  messagePreview: string | null
  note: string | null
  createdAt: string
  isNew: boolean
}

type TailorProfileJoinRow = {
  display_name: string | null
}
type NotificationOrderRow = {
  id: string
  reference: string | null
  garment_type: string | null
  order_kind: 'CUSTOM' | 'READY_MADE' | null
  customer_id: string
  tailor_profiles: TailorProfileJoinRow | TailorProfileJoinRow[] | null
}
type StageUpdateNotificationRow = {
  id: string
  stage: OrderStage
  note: string | null
  created_at: string
  order_id: string
  orders: NotificationOrderRow | NotificationOrderRow[] | null
}
type MessageNotificationRow = {
  id: string
  order_id: string
  sender_name: string | null
  body: string | null
  type: string
  created_at: string
  orders: NotificationOrderRow | NotificationOrderRow[] | null
}

function firstJoinedRow<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

function itemIcon(item: NotifItem): React.ComponentProps<typeof Feather>['name'] {
  if (item.kind === 'message') return 'message-circle'
  const stage = item.stage
  if (!stage) return 'bell'
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

function itemColor(item: NotifItem): string {
  if (item.kind === 'message') return Colors.needleGreen
  const stage = item.stage
  if (!stage) return Colors.needleGreen
  if (stage === 'IN_DISPUTE') return Colors.kanteRust
  if (stage === 'DECLINED' || stage === 'CANCELLED') return Colors.midGrey
  if (stage === 'COMPLETE' || stage === 'DELIVERED' || stage === 'COLLECTED') return Colors.success
  if (stage === 'PAYMENT_FAILED') return Colors.kanteRust
  if (stage === 'QUOTE_SENT' || stage === 'CONSULTATION') return Colors.warning
  return Colors.needleGreen
}

function itemTitle(item: NotifItem): string {
  if (item.kind === 'message') return 'New message'
  if (!item.stage) return 'Order update'
  return customerOrderStageLabel(item.stage, item.orderKind)
}

function buildMessagePreview(type: string, body: string | null, senderName: string): string {
  if (type === 'PHOTO') return `${senderName}: Sent a photo`
  if (type === 'VOICE') return `${senderName}: Sent a voice note`
  const text = body?.trim() ?? ''
  const preview = text.slice(0, 60)
  return preview ? `${senderName}: ${preview}${text.length > 60 ? '…' : ''}` : `${senderName}: Sent a message`
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
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const lastNotifCheckRef = useRef<string | null>(null)
  const [items, setItems] = useState<NotifItem[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [retryTrigger, setRetryTrigger] = useState(0)

  useEffect(() => {
    lastNotifCheckRef.current =
      typeof user?.user_metadata?.last_notif_check === 'string'
        ? user.user_metadata.last_notif_check
        : null
  }, [user?.id, user?.user_metadata?.last_notif_check])

  useFocusEffect(
    useCallback(() => {
      void retryTrigger
      async function load() {
        if (!user?.id) {
          setItems([])
          setFetchError(false)
          setLoading(false)
          return
        }
        setFetchError(false)
        setLoading(true)
        const lastCheck = lastNotifCheckRef.current
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

        try {
          const [stageRes, messageRes] = await Promise.allSettled([
            supabase
              .from('order_stage_updates')
              .select(`
                id, stage, note, created_at, order_id,
                orders!inner(
                  id, reference, garment_type, order_kind, customer_id,
                  tailor_profiles!tailor_profile_id(display_name)
                )
              `)
              .eq('orders.customer_id', user.id)
              .gte('created_at', since)
              .order('created_at', { ascending: false })
              .limit(60),
            supabase
              .from('messages')
              .select(`
                id, order_id, sender_name, body, type, created_at,
                orders!inner(
                  id, reference, garment_type, order_kind, customer_id,
                  tailor_profiles!tailor_profile_id(display_name)
                )
              `)
              .eq('sender_role', 'TAILOR')
              .eq('orders.customer_id', user.id)
              .gte('created_at', since)
              .order('created_at', { ascending: false })
              .limit(60),
          ])

          if (
            (stageRes.status === 'rejected' || (stageRes.status === 'fulfilled' && stageRes.value.error)) &&
            (messageRes.status === 'rejected' || (messageRes.status === 'fulfilled' && messageRes.value.error))
          ) {
            setFetchError(true)
            setItems([])
            return
          }

          const stageItems: NotifItem[] = (
            stageRes.status === 'fulfilled' && !stageRes.value.error
              ? ((stageRes.value.data ?? []) as StageUpdateNotificationRow[])
              : []
          ).map((row) => {
            const order = firstJoinedRow(row.orders)
            const tailor = firstJoinedRow(order?.tailor_profiles)
            return {
              id: row.id,
              orderId: order?.id ?? row.order_id,
              orderRef: order?.reference ?? '',
              garmentType: order?.garment_type ?? 'Order',
              tailorName: tailor?.display_name ?? 'Tailor',
              orderKind: order?.order_kind ?? 'CUSTOM',
              kind: 'stage_update' as const,
              stage: row.stage,
              messagePreview: null,
              note: row.note ?? null,
              createdAt: row.created_at,
              isNew: lastCheck ? new Date(row.created_at) > new Date(lastCheck) : true,
            }
          })

          // Deduplicate messages to one entry per order (most recent wins)
          const rawMessages: MessageNotificationRow[] =
            messageRes.status === 'fulfilled' && !messageRes.value.error
              ? ((messageRes.value.data ?? []) as MessageNotificationRow[])
              : []

          const latestMessageByOrder = new Map<string, MessageNotificationRow>()
          for (const row of rawMessages) {
            const orderId = firstJoinedRow(row.orders)?.id ?? row.order_id
            if (!latestMessageByOrder.has(orderId)) latestMessageByOrder.set(orderId, row)
          }

          const messageItems: NotifItem[] = [...latestMessageByOrder.values()].map((row) => {
            const order = firstJoinedRow(row.orders)
            const tailor = firstJoinedRow(order?.tailor_profiles)
            const senderName = row.sender_name ?? tailor?.display_name ?? 'Tailor'
            return {
              id: `msg-${row.id}`,
              orderId: order?.id ?? row.order_id,
              orderRef: order?.reference ?? '',
              garmentType: order?.garment_type ?? 'Order',
              tailorName: tailor?.display_name ?? 'Tailor',
              orderKind: order?.order_kind ?? 'CUSTOM',
              kind: 'message' as const,
              stage: null,
              messagePreview: buildMessagePreview(row.type, row.body, senderName),
              note: null,
              createdAt: row.created_at,
              isNew: lastCheck ? new Date(row.created_at) > new Date(lastCheck) : true,
            }
          })

          const merged = [...stageItems, ...messageItems].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )
          setItems(merged)

          try {
            const checkedAt = new Date().toISOString()
            await supabase.auth.updateUser({ data: { last_notif_check: checkedAt } })
            lastNotifCheckRef.current = checkedAt
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
          body="We're gathering the latest messages, quotes, production, delivery, and completion updates across your orders."
          loading
        />
      ) : fetchError ? (
        <FeatureStateCard
          eyebrow="Notifications"
          title="Couldn't load notifications"
          body="This feed should keep every order update and message easy to spot without checking each order manually."
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
            onPress={() => router.replace('/(customer)/orders')}
          />
          <Button label="Open profile" variant="ghost" onPress={goBack} />
        </FeatureStateCard>
      ) : items.length === 0 ? (
        <FeatureStateCard
          eyebrow="Notifications"
          title="You're all caught up"
          body="We'll notify you about orders, messages, and important updates."
          accentColor={Colors.warning}
          icon="bell-off"
        >
          <Button label="Open orders" onPress={() => router.replace('/(customer)/orders')} />
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
          contentContainerStyle={{
            paddingVertical: Spacing.sm,
            paddingHorizontal: Spacing.lg,
            paddingBottom: Math.max(insets.bottom + Spacing.lg, Spacing.xl),
            gap: Spacing.xs,
          }}
          renderItem={({ item }) => {
            const color = itemColor(item)
            const metaParts = [
              item.garmentType,
              item.orderRef ? `#${item.orderRef}` : null,
              item.tailorName,
            ].filter(Boolean).join(' · ')
            return (
              <TouchableOpacity
                style={[styles.card, item.isNew && styles.cardNew]}
                onPress={() =>
                  router.push({
                    pathname: '/(customer)/orders/[id]',
                    params: {
                      id: item.orderId,
                      historyChain: appendToHistory(undefined, '/(customer)/profile/notifications'),
                    },
                  })
                }
                activeOpacity={0.7}
              >
                {item.isNew && <View style={styles.unreadDot} />}

                <View style={[styles.iconWrap, { backgroundColor: color + '18' }]}>
                  <Feather name={itemIcon(item)} size={18} color={color} />
                </View>

                <View style={styles.notificationBody}>
                  <View style={styles.titleRow}>
                    <Text style={styles.title} numberOfLines={1}>{itemTitle(item)}</Text>
                    <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
                  </View>
                  <Text style={styles.metaLine} numberOfLines={1}>{metaParts}</Text>
                  {item.kind === 'message' && item.messagePreview ? (
                    <Text style={styles.note} numberOfLines={2}>
                      {formatEmbeddedDateTimes(item.messagePreview)}
                    </Text>
                  ) : item.note ? (
                    <Text style={styles.note} numberOfLines={2}>
                      {formatEmbeddedDateTimes(item.note)}
                    </Text>
                  ) : null}
                </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.sm,
  },
  headerTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    ...Shadow.sm,
    position: 'relative',
    overflow: 'hidden',
  },
  cardNew: {
    borderWidth: 1,
    borderColor: Colors.needleGreen + '35',
  },
  unreadDot: {
    position: 'absolute',
    top: 11,
    right: 11,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.needleGreen,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  notificationBody: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    lineHeight: 18,
    flex: 1,
    minWidth: 0,
  },
  metaLine: { fontSize: 12, color: Colors.midGrey, lineHeight: 17, marginTop: 2 },
  note: { fontSize: 12, color: Colors.midGrey, lineHeight: 17, marginTop: 2 },
  time: { fontSize: 12, color: Colors.midGrey, flexShrink: 0, marginTop: 1, maxWidth: 70 },
})
