/**
 * Tailor Notifications
 *
 * Feed of activity on the tailor's orders:
 *   - New bookings (PENDING_QUOTE) needing a quote
 *   - Stage updates: payment confirmed, disputes, cancellations, etc.
 *   - New messages from customers
 *
 * Badge clears by stamping last_tailor_notif_check on open, same as customer.
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
import {
  materialAdvanceCustomerDecisionFromNote,
  sourcedFabricDecisionFromNote,
  styleAlignmentDecisionFromNote,
} from '@drape/shared'
import { formatEmbeddedDateTimes } from '@drape/shared/display-text'
import { appendToHistory, goBackOrFallback } from '@/lib/navigation'

type NotifItem = {
  id: string
  orderId: string
  orderRef: string
  garmentType: string
  orderKind: 'CUSTOM' | 'READY_MADE'
  customerName: string
  kind: 'stage_update' | 'message'
  stage: OrderStage | null
  messagePreview: string | null
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

type MessageNotificationRow = {
  id: string
  order_id: string
  sender_name: string | null
  body: string | null
  type: string
  created_at: string
  orders: Omit<TailorNotificationOrderRow, 'stage' | 'created_at'> | Omit<TailorNotificationOrderRow, 'stage' | 'created_at'>[] | null
}

function firstJoinedRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function itemIcon(item: NotifItem): React.ComponentProps<typeof Feather>['name'] {
  if (item.kind === 'message') return 'message-circle'
  const materialDecision = materialAdvanceCustomerDecisionFromNote(item.note)
  if (materialDecision === 'APPROVED') return 'check-circle'
  if (materialDecision === 'DECLINED') return 'x-circle'
  const fabricDecision = sourcedFabricDecisionFromNote(item.note)
  if (fabricDecision === 'APPROVED') return 'check-circle'
  if (fabricDecision === 'CHANGES_REQUESTED') return 'refresh-cw'
  const styleDecision = styleAlignmentDecisionFromNote(item.note)
  if (styleDecision === 'APPROVED') return 'check-circle'
  if (styleDecision === 'CHANGES_REQUESTED') return 'edit-3'
  const stage = item.stage
  if (!stage) return 'bell'
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

function itemColor(item: NotifItem): string {
  if (item.kind === 'message') return Colors.needleGreen
  const materialDecision = materialAdvanceCustomerDecisionFromNote(item.note)
  if (materialDecision === 'APPROVED') return Colors.success
  if (materialDecision === 'DECLINED') return Colors.kanteRust
  const fabricDecision = sourcedFabricDecisionFromNote(item.note)
  if (fabricDecision === 'APPROVED') return Colors.success
  if (fabricDecision === 'CHANGES_REQUESTED') return Colors.kanteRust
  const styleDecision = styleAlignmentDecisionFromNote(item.note)
  if (styleDecision === 'APPROVED') return Colors.success
  if (styleDecision === 'CHANGES_REQUESTED') return Colors.kanteRust
  const stage = item.stage
  if (!stage) return Colors.needleGreen
  if (stage === 'PENDING_QUOTE') return Colors.warning
  if (stage === 'IN_DISPUTE') return Colors.kanteRust
  if (stage === 'PAYMENT_FAILED') return Colors.kanteRust
  if (stage === 'CANCELLED' || stage === 'DECLINED' || stage === 'EXPIRED') return Colors.midGrey
  if (stage === 'COMPLETE' || stage === 'COLLECTED' || stage === 'DELIVERED') return Colors.success
  if (stage === 'CONFIRMED') return Colors.needleGreen
  return Colors.needleGreen
}

function itemTitle(item: NotifItem): string {
  if (item.kind === 'message') return 'New message'
  const materialDecision = materialAdvanceCustomerDecisionFromNote(item.note)
  if (materialDecision === 'APPROVED') return 'Material request approved'
  if (materialDecision === 'DECLINED') return 'Material request declined'
  const fabricDecision = sourcedFabricDecisionFromNote(item.note)
  if (fabricDecision === 'APPROVED') return 'Fabric approved'
  if (fabricDecision === 'CHANGES_REQUESTED') return 'Fabric changes requested'
  const styleDecision = styleAlignmentDecisionFromNote(item.note)
  if (styleDecision === 'APPROVED') return 'Style plan approved'
  if (styleDecision === 'CHANGES_REQUESTED') return 'Style clarification requested'
  if (!item.stage) return 'Order update'
  return stageDescription({ stage: item.stage, orderKind: item.orderKind })
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

function stageDescription(item: Pick<NotifItem, 'stage' | 'orderKind'>): string {
  if (!item.stage) return 'Order update'
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
          const [newOrdersRes, updatesRes, messagesRes] = await Promise.allSettled([
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
            supabase
              .from('messages')
              .select(`
                id, order_id, sender_name, body, type, created_at,
                orders!inner(
                  id, reference, garment_type, order_kind, tailor_id,
                  customer_profiles!customer_id(display_name)
                )
              `)
              .eq('sender_role', 'CUSTOMER')
              .eq('orders.tailor_id', userId)
              .gte('created_at', since)
              .order('created_at', { ascending: false })
              .limit(60),
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
              kind: 'stage_update' as const,
              stage: o.stage ?? 'PENDING_QUOTE',
              messagePreview: null,
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
              kind: 'stage_update' as const,
              stage: row.stage ?? 'PENDING_QUOTE',
              messagePreview: null,
              note: row.note ?? null,
              createdAt: row.created_at,
              isNew: lastCheck ? new Date(row.created_at) > new Date(lastCheck) : true,
            }
          })

          // Deduplicate messages to one entry per order (most recent wins)
          const rawMessages: MessageNotificationRow[] =
            messagesRes.status === 'fulfilled' && !messagesRes.value.error
              ? ((messagesRes.value.data ?? []) as MessageNotificationRow[])
              : []

          const latestMessageByOrder = new Map<string, MessageNotificationRow>()
          for (const row of rawMessages) {
            const orderId = firstJoinedRow(row.orders)?.id ?? row.order_id
            if (!latestMessageByOrder.has(orderId)) latestMessageByOrder.set(orderId, row)
          }

          const messageItems: NotifItem[] = [...latestMessageByOrder.values()].map((row) => {
            const order = firstJoinedRow(row.orders)
            const customerProfile = firstJoinedRow(order?.customer_profiles)
            const senderName = row.sender_name ?? customerProfile?.display_name ?? 'Customer'
            return {
              id: `msg-${row.id}`,
              orderId: order?.id ?? row.order_id,
              orderRef: order?.reference ?? '',
              garmentType: order?.garment_type ?? 'Order',
              orderKind: order?.order_kind ?? 'CUSTOM',
              customerName: customerProfile?.display_name ?? 'Customer',
              kind: 'message' as const,
              stage: null,
              messagePreview: buildMessagePreview(row.type, row.body, senderName),
              note: null,
              createdAt: row.created_at,
              isNew: lastCheck ? new Date(row.created_at) > new Date(lastCheck) : true,
            }
          })

          if (
            (newOrdersRes.status === 'rejected' || (newOrdersRes.status === 'fulfilled' && newOrdersRes.value.error)) &&
            (updatesRes.status === 'rejected' || (updatesRes.status === 'fulfilled' && updatesRes.value.error)) &&
            (messagesRes.status === 'rejected' || (messagesRes.status === 'fulfilled' && messagesRes.value.error))
          ) {
            setFetchError(true)
            setItems([])
            return
          }

          const seen = new Set<string>()
          const merged: NotifItem[] = []
          for (const item of [...bookingItems, ...updateItems, ...messageItems].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )) {
            // Deduplicate stage items by orderId+stage; messages already deduped per order
            const materialDecision = materialAdvanceCustomerDecisionFromNote(item.note)
            const key = item.kind === 'message'
              ? `msg-${item.orderId}`
              : materialDecision
                ? `material-${item.id}`
                : `${item.orderId}-${item.stage}`
            if (!seen.has(key)) {
              seen.add(key)
              merged.push(item)
            }
          }

          setItems(merged)

          try {
            const checkedAt = new Date().toISOString()
            await supabase.auth.updateUser({ data: { last_tailor_notif_check: checkedAt } })
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
          body="We're gathering new bookings, messages, customer responses, and order changes that may need your attention."
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
          <Button label="Open profile" variant="ghost" onPress={goBack} />
        </FeatureStateCard>
      ) : items.length === 0 ? (
        <FeatureStateCard
          eyebrow="Notifications"
          title="You're all caught up"
          body="We'll notify you about new bookings, messages, and order updates."
          accentColor={Colors.warning}
          icon="bell-off"
        >
          <Button label="Open orders" onPress={() => router.replace('/(tailor)/orders')} />
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
          renderItem={({ item }) => {
            const color = itemColor(item)
            const metaParts = [
              item.garmentType,
              item.orderRef ? `#${item.orderRef}` : null,
              item.customerName,
            ].filter(Boolean).join(' · ')
            return (
              <TouchableOpacity
                style={[styles.card, item.isNew && styles.cardNew]}
                onPress={() => router.push({
                  pathname: '/(tailor)/orders/[id]',
                  params: {
                    id: item.orderId,
                    historyChain: appendToHistory(undefined, '/(tailor)/profile/notifications'),
                  },
                })}
                activeOpacity={0.7}
              >
                {item.isNew && <View style={styles.unreadDot} />}

                <View style={[styles.iconWrap, { backgroundColor: color + '18' }]}>
                  <Feather name={itemIcon(item)} size={18} color={color} />
                </View>

                <View style={styles.notificationBody}>
                  <View style={styles.titleRow}>
                    <Text style={styles.itemTitle} numberOfLines={1}>{itemTitle(item)}</Text>
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemTitle: {
    fontSize: 14, fontWeight: FontWeight.semibold, color: Colors.ink,
    lineHeight: 18, flex: 1, minWidth: 0,
  },
  metaLine: { fontSize: 12, color: Colors.midGrey, lineHeight: 17, marginTop: 2 },
  note: { fontSize: 12, color: Colors.midGrey, lineHeight: 17, marginTop: 2 },
  time: { fontSize: 12, color: Colors.midGrey, flexShrink: 0, marginTop: 1, maxWidth: 70 },
})
