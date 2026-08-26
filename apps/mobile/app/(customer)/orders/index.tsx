import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '@/lib/auth'
import { Button, DrapeStatusChip, FeatureStateCard, StateCard } from '@/components/ui'
import { DRAPE_CAPSULE_NAV_CONTENT_CLEARANCE, useDrapeCapsuleNavScroll } from '@/components/ui/DrapeCapsuleNav'
import { customerOrderHint } from '@/lib/order-flow'
import { useCustomerOrders, useRefreshOnFocus } from '@/lib/queries'
import { customerOrderStageLabel } from '@/lib/customer-order-copy'
import { appendToHistory } from '@/lib/navigation'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import type { OrderStage } from '@drape/shared/order-machine'
import { formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'
import { consultationOrderListState } from '@drape/shared/consultations'
import { deriveFulfillmentAwareOrderStagePresentation } from '@drape/shared'
import { supabase } from '@/lib/supabase'

type Tab = 'active' | 'completed'

function orderPriority(stage: OrderStage): number {
  switch (stage) {
    case 'QUOTE_SENT':
      return 0
    case 'READY_FOR_COLLECTION':
      return 1
    case 'OUT_FOR_DELIVERY':
      return 4
    case 'DELIVERED':
    case 'COLLECTED':
      return 2
    case 'IN_DISPUTE':
      return 3
    case 'SHIPPED':
      return 4
    case 'PENDING_QUOTE':
    case 'CONSULTATION':
    case 'PAYMENT_PENDING':
    case 'PAYMENT_FAILED':
      return 5
    default:
      return 6
  }
}

export default function OrdersListScreen() {
  const router = useRouter()
  const capsuleNavScroll = useDrapeCapsuleNavScroll()
  const params = useLocalSearchParams<{ tab?: string }>()
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('active')

  useEffect(() => {
    if (params.tab === 'completed' || params.tab === 'active') {
      const nextTab = params.tab
      const timer = setTimeout(() => setTab(nextTab), 0)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [params.tab])

  const {
    data: orders = [],
    isLoading: loading,
    isFetching,
    isError,
    refetch,
  } = useCustomerOrders(user?.id, tab)
  const consultationOrderIdsKey = orders
    .filter((order) => order.stage === 'CONSULTATION')
    .map((order) => order.id)
    .sort()
    .join(',')

  useEffect(() => {
    if (!consultationOrderIdsKey) return
    const orderIds = consultationOrderIdsKey.split(',')
    const channel = supabase.channel(`customer-consultation-list:${user?.id ?? 'anonymous'}`)
    for (const orderId of orderIds) {
      for (const event of ['INSERT', 'UPDATE', 'DELETE'] as const) {
        channel.on(
          'postgres_changes',
          { event, schema: 'public', table: 'consultation_attendance_reviews', filter: `order_id=eq.${orderId}` },
          () => { void refetch() }
        )
      }
    }
    channel.subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [consultationOrderIdsKey, refetch, user?.id])

  const sortedOrders =
    tab === 'active'
      ? [...orders].sort((a, b) => {
          const priorityDiff = orderPriority(a.stage) - orderPriority(b.stage)
          if (priorityDiff !== 0) return priorityDiff
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        })
      : orders

  useRefreshOnFocus(refetch, 0)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Orders</Text>
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'active' && styles.tabBtnActive]}
            onPress={() => setTab('active')}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === 'active' }}
          >
            <Text style={[styles.tabLabel, tab === 'active' && styles.tabLabelActive]}>Active</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'completed' && styles.tabBtnActive]}
            onPress={() => setTab('completed')}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === 'completed' }}
          >
            <Text style={[styles.tabLabel, tab === 'completed' && styles.tabLabelActive]}>
              Completed
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <FeatureStateCard
          eyebrow="Orders"
          title="Loading your orders…"
          body="We’re gathering your live quotes, production updates, and completed order history."
          loading
        />
      ) : isError ? (
        <FeatureStateCard
          eyebrow="Orders"
          title="Couldn't load your orders."
          body="This is where your quote decisions, active progress, and finished garments should stay organised."
          accentColor={Colors.kanteRust}
          icon="alert-circle"
        >
          <Button label="Try again" onPress={() => refetch()} />
          <Button
            label="Explore tailors"
            variant="secondary"
            onPress={() => router.navigate('/(customer)')}
          />
        </FeatureStateCard>
      ) : (
        <FlatList
          {...capsuleNavScroll}
          data={sortedOrders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: DRAPE_CAPSULE_NAV_CONTENT_CLEARANCE },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !loading}
              onRefresh={refetch}
              tintColor={Colors.needleGreen}
            />
          }
          ListEmptyComponent={
            <EmptyOrdersView
              tab={tab}
              onExplore={() => router.navigate('/(customer)')}
              onViewCompleted={() => setTab('completed')}
            />
          }
          renderItem={({ item }) => {
            const showReviewNudge = ['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(item.stage) && !item.hasReview
            const consultationState = item.stage === 'CONSULTATION'
              ? consultationOrderListState({ actorRole: 'CUSTOMER', review: item.consultationReview })
              : null
            const stagePresentation = deriveFulfillmentAwareOrderStagePresentation({
              orderStage: item.stage,
              effectiveMethod: item.deliveryMethod,
            })
            const hint = consultationState?.label
              ?? stagePresentation.label
              ?? customerOrderHint(item.stage, item.orderKind)
            return (
              <TouchableOpacity
                style={styles.card}
                testID={`order-card-${item.stage}`}
                activeOpacity={0.84}
                accessibilityRole="button"
                accessibilityLabel={`Open order ${item.reference}`}
                onPress={() =>
                  router.push({
                    pathname: '/(customer)/orders/[id]',
                    params: {
                      id: item.id,
                      tab,
                      historyChain: appendToHistory(undefined, `/(customer)/orders?tab=${tab}`),
                    },
                  })
                }
              >
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.garment}>{item.garmentType}</Text>
                    <Text style={styles.tailor}>{item.tailorName}</Text>
                  </View>
                  <DrapeStatusChip
                    value={stagePresentation.stage ?? item.stage}
                    label={stagePresentation.label ?? customerOrderStageLabel(item.stage, item.orderKind)}
                    domain="order"
                  />
                </View>

                <View style={styles.cardMeta}>
                  <Text style={styles.ref}>#{item.reference}</Text>
                  {item.estimatedDate && (
                    <Text style={styles.eta}>
                      Est.{' '}
                      {new Date(item.estimatedDate).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </Text>
                  )}
                  {item.quotedAmount && (
                    <Text style={styles.amount}>
                      {formatAmount(
                        item.quotedAmount,
                        item.quotedCurrency as CurrencyCode,
                        item.quotedCurrency as CurrencyCode,
                        STATIC_FALLBACK_RATES
                      )}
                    </Text>
                  )}
                </View>
                {showReviewNudge && (
                  <View style={styles.reviewNudge}>
                    <Text style={styles.reviewNudgeText}>
                      {item.stage === 'COMPLETE' ? '★  Leave a review' : '★  Finish and review'}
                    </Text>
                  </View>
                )}
                {hint && !showReviewNudge && (
                  <View style={[
                    styles.reviewNudge,
                    consultationState?.needsAction && styles.reviewNudgeAttention,
                  ]}>
                    <Text style={[
                      styles.reviewNudgeText,
                      consultationState?.needsAction && styles.reviewNudgeTextAttention,
                    ]}>{hint}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )
          }}
        />
      )}
    </SafeAreaView>
  )
}

function EmptyOrdersView({
  tab,
  onExplore,
  onViewCompleted,
}: {
  tab: Tab
  onExplore: () => void
  onViewCompleted: () => void
}) {
  if (tab === 'completed') {
    return (
      <View style={emptyStyles.container}>
        <StateCard
          title="No completed orders yet"
          body="Finished custom and ready-made orders will appear here once delivery or pickup is closed out."
          tone="empty"
          icon="archive"
          actionLabel="Explore tailors"
          onAction={onExplore}
        />
      </View>
    )
  }

  return (
    <View style={emptyStyles.container}>
      <StateCard
        title="No active orders yet"
        body="When you request a quote, pay for an item, or start a custom order, it will appear here."
        tone="empty"
        icon="scissors"
        actionLabel="Explore tailors"
        onAction={onExplore}
      >
        <TouchableOpacity style={emptyStyles.linkButton} onPress={onViewCompleted}>
          <Text style={emptyStyles.linkButtonText}>View completed orders</Text>
        </TouchableOpacity>
      </StateCard>
    </View>
  )
}

const emptyStyles = StyleSheet.create({
  container: {
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkButton: {
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkButtonText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.needleGreenDark },
})

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: { paddingHorizontal: Spacing.lg, paddingTop: 8, paddingBottom: 6, gap: Spacing.xs },
  title: {
    fontSize: 28,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: Colors.boneDeep,
    borderRadius: Radius.full,
    padding: 3,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: Radius.full,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  tabBtnActive: { backgroundColor: Colors.white, ...Shadow.sm },
  tabLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.midGrey },
  tabLabelActive: { color: Colors.ink, fontWeight: FontWeight.semibold },

  list: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.xl },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  garment: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  tailor: { fontSize: FontSize.sm, color: Colors.inkLight, marginTop: 2 },
  cardMeta: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  reviewNudge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.kanteRust + '15',
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  reviewNudgeText: {
    fontSize: FontSize.xs,
    color: Colors.kanteRust,
    fontWeight: FontWeight.semibold,
  },
  reviewNudgeAttention: { backgroundColor: Colors.accentLight },
  reviewNudgeTextAttention: { color: Colors.kanteRust },
  ref: { fontSize: FontSize.xs, color: Colors.midGrey },
  eta: { fontSize: FontSize.xs, color: Colors.midGrey },
  amount: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    marginLeft: 'auto',
  },
})
