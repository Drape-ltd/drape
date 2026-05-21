import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '@/lib/auth'
import { Button, FeatureStateCard, StateCard } from '@/components/ui'
import { customerOrderHint } from '@/lib/order-flow'
import { useCustomerOrders, useRefreshOnFocus } from '@/lib/queries'
import { customerOrderStageLabel } from '@/lib/customer-order-copy'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import type { OrderStage } from '@drape/shared/order-machine'
import { formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'

const STAGE_COLOR: Partial<Record<OrderStage, string>> = {
  PENDING_QUOTE: Colors.warning,
  CONSULTATION: Colors.warning,
  QUOTE_SENT: Colors.warning,
  PAYMENT_PENDING: Colors.warning,
  PAYMENT_FAILED: Colors.kanteRust,
  CONFIRMED: Colors.needleGreen,
  DESIGNING: Colors.needleGreen,
  SOURCING: Colors.needleGreen,
  CUTTING: Colors.needleGreen,
  SEWING: Colors.needleGreen,
  FINISHING: Colors.needleGreen,
  OUT_FOR_DELIVERY: Colors.needleGreen,
  SHIPPED: Colors.needleGreen,
  READY_FOR_COLLECTION: Colors.needleGreen,
  IN_DISPUTE: Colors.kanteRust,
  COMPLETE: Colors.midGrey,
  DELIVERED: Colors.needleGreen,
  COLLECTED: Colors.needleGreen,
  DECLINED: Colors.midGrey,
  EXPIRED: Colors.midGrey,
  CANCELLED: Colors.midGrey,
  REFUNDED: Colors.midGrey,
}

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

  const sortedOrders =
    tab === 'active'
      ? [...orders].sort((a, b) => {
          const priorityDiff = orderPriority(a.stage) - orderPriority(b.stage)
          if (priorityDiff !== 0) return priorityDiff
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        })
      : orders

  // Refetch on focus, but keep a short freshness window so tab hops do not hammer Supabase.
  useRefreshOnFocus(refetch, 30_000)

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
          data={sortedOrders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
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
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              testID={`order-card-${item.stage}`}
              activeOpacity={0.84}
              accessibilityRole="button"
              accessibilityLabel={`Open order ${item.reference}`}
              onPress={() =>
                router.push({
                  pathname: '/(customer)/orders/[id]',
                  params: { id: item.id, tab },
                })
              }
            >
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.garment}>{item.garmentType}</Text>
                  <Text style={styles.tailor}>{item.tailorName}</Text>
                </View>
                <View
                  style={[
                    styles.stagePill,
                    { backgroundColor: (STAGE_COLOR[item.stage] ?? Colors.midGrey) + '20' },
                  ]}
                >
                  <Text
                    style={[styles.stageText, { color: STAGE_COLOR[item.stage] ?? Colors.midGrey }]}
                  >
                    {customerOrderStageLabel(item.stage, item.orderKind)}
                  </Text>
                </View>
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
              {['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(item.stage) && !item.hasReview && (
                <View style={styles.reviewNudge}>
                  <Text style={styles.reviewNudgeText}>
                    {item.stage === 'COMPLETE' ? '★  Leave a review' : '★  Finish and review'}
                  </Text>
                </View>
              )}
              {customerOrderHint(item.stage, item.orderKind) && (
                <View style={styles.reviewNudge}>
                  <Text style={styles.reviewNudgeText}>
                    {customerOrderHint(item.stage, item.orderKind)}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          )}
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
  guideCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 12,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  guideHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  guideClose: { padding: 2 },
  guideEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  guideText: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
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
    borderWidth: 1,
    borderColor: Colors.lightGrey,
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
  stagePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  stageText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
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
