import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useAuth } from '@/lib/auth'
import { Button, FeatureStateCard } from '@/components/ui'
import { customerOrderHint } from '@/lib/order-flow'
import { useCustomerOrders, useRefreshOnFocus } from '@/lib/queries'
import { customerOrderStageLabel } from '@/lib/customer-order-copy'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import type { OrderStage } from '@drape/shared/order-machine'
import { formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'

const STAGE_COLOR: Partial<Record<OrderStage, string>> = {
  PENDING_QUOTE: Colors.warning,
  CONSULTATION: Colors.warning,
  QUOTE_SENT: Colors.warning,
  PAYMENT_PENDING: Colors.warning,
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

const CUSTOMER_ORDERS_GUIDE_KEY = 'drape_customer_orders_best_use_dismissed'

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
  const [showGuide, setShowGuide] = useState(true)

  useEffect(() => {
    if (params.tab === 'completed' || params.tab === 'active') {
      setTab(params.tab)
    }
  }, [params.tab])

  useEffect(() => {
    AsyncStorage.getItem(`${CUSTOMER_ORDERS_GUIDE_KEY}:${user?.id ?? 'guest'}`)
      .then((value) => setShowGuide(value !== '1'))
      .catch(() => {})
  }, [user?.id])

  async function dismissGuide() {
    setShowGuide(false)
    try {
      await AsyncStorage.setItem(`${CUSTOMER_ORDERS_GUIDE_KEY}:${user?.id ?? 'guest'}`, '1')
    } catch {}
  }

  const { data: orders = [], isLoading: loading, isFetching, isError, refetch } = useCustomerOrders(user?.id, tab)

  const sortedOrders = tab === 'active'
    ? [...orders].sort((a, b) => {
        const priorityDiff = orderPriority(a.stage) - orderPriority(b.stage)
        if (priorityDiff !== 0) return priorityDiff
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })
    : orders

  // Refetch whenever this screen comes back into focus (e.g. returning from order detail)
  useRefreshOnFocus(refetch)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Orders</Text>
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'active' && styles.tabBtnActive]}
            onPress={() => setTab('active')}
          >
            <Text style={[styles.tabLabel, tab === 'active' && styles.tabLabelActive]}>Active</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'completed' && styles.tabBtnActive]}
            onPress={() => setTab('completed')}
          >
            <Text style={[styles.tabLabel, tab === 'completed' && styles.tabLabelActive]}>Completed</Text>
          </TouchableOpacity>
        </View>
      </View>

      {showGuide && (
        <View style={styles.guideCard}>
          <View style={styles.guideHeader}>
            <Text style={styles.guideEyebrow}>Best use</Text>
            <TouchableOpacity onPress={() => void dismissGuide()} style={styles.guideClose}>
              <Feather name="x" size={16} color={Colors.midGrey} />
            </TouchableOpacity>
          </View>
          <Text style={styles.guideText}>Use Active for live work and Completed for finished orders you may want to revisit or review.</Text>
        </View>
      )}

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
          refreshControl={<RefreshControl refreshing={isFetching && !loading} onRefresh={refetch} tintColor={Colors.needleGreen} />}
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
              onPress={() => router.push({
                pathname: '/(customer)/orders/[id]',
                params: { id: item.id, tab },
              })}
            >
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.garment}>{item.garmentType}</Text>
                  <Text style={styles.tailor}>{item.tailorName}</Text>
                </View>
                <View style={[styles.stagePill, { backgroundColor: (STAGE_COLOR[item.stage] ?? Colors.midGrey) + '20' }]}>
                  <Text style={[styles.stageText, { color: STAGE_COLOR[item.stage] ?? Colors.midGrey }]}>
                    {customerOrderStageLabel(item.stage, item.orderKind)}
                  </Text>
                </View>
              </View>

              <View style={styles.cardMeta}>
                <Text style={styles.ref}>#{item.reference}</Text>
                {item.estimatedDate && (
                  <Text style={styles.eta}>
                    Est. {new Date(item.estimatedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </Text>
                )}
                {item.quotedAmount && (
                  <Text style={styles.amount}>
                    {formatAmount(item.quotedAmount, item.quotedCurrency as CurrencyCode, item.quotedCurrency as CurrencyCode, STATIC_FALLBACK_RATES)}
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
                  <Text style={styles.reviewNudgeText}>{customerOrderHint(item.stage, item.orderKind)}</Text>
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
      <FeatureStateCard
        eyebrow="Completed orders"
        title="No completed orders yet."
        body="Orders you finish with a tailor will appear here once the full journey is closed out in the app."
        accentColor={Colors.warning}
        icon="archive"
      >
        <Button label="Explore tailors" onPress={onExplore} />
      </FeatureStateCard>
    )
  }

  const GHOST_ROWS: Array<{ icon: React.ComponentProps<typeof Feather>['name']; label: string }> = [
    { icon: 'scissors', label: 'Custom garment' },
    { icon: 'package', label: 'Ready to collect' },
    { icon: 'tag', label: 'Quote received' },
  ]

  return (
    <View style={emptyStyles.container}>
      {/* Ghost preview cards — Airbnb Trips style */}
      <View style={emptyStyles.previewStack}>
        {GHOST_ROWS.map(({ icon }, i) => (
          <View key={i} style={[emptyStyles.ghostCard, { opacity: 1 - i * 0.22 }]}>
            <View style={emptyStyles.ghostImage}>
              <Feather name={icon} size={22} color={Colors.midGrey} />
            </View>
            <View style={emptyStyles.ghostLines}>
              <View style={[emptyStyles.ghostLine, { width: '65%' }]} />
              <View style={[emptyStyles.ghostLine, { width: '45%', marginTop: 8 }]} />
            </View>
          </View>
        ))}
      </View>

      {/* Heading + copy */}
      <View style={emptyStyles.textBlock}>
        <Text style={emptyStyles.heading}>Your orders, all in one place</Text>
        <Text style={emptyStyles.sub}>
          Browse tailors and book a custom garment.{'\n'}When you do, they'll show up right here.
        </Text>
      </View>

      {/* Primary CTA */}
      <TouchableOpacity style={emptyStyles.ctaBtn} onPress={onExplore}>
        <Text style={emptyStyles.ctaBtnText}>Explore tailors</Text>
      </TouchableOpacity>

      {/* Secondary — view completed */}
      <TouchableOpacity style={emptyStyles.secondaryCard} onPress={onViewCompleted}>
        <Text style={emptyStyles.secondaryText}>Find past orders</Text>
        <Text style={emptyStyles.secondaryChevron}>›</Text>
      </TouchableOpacity>
    </View>
  )
}

const emptyStyles = StyleSheet.create({
  container: {
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
    alignItems: 'center',
    gap: Spacing.lg,
  },
  previewStack: { width: '100%', gap: Spacing.sm },
  ghostCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    ...Shadow.sm,
  },
  ghostImage: {
    width: 56,
    height: 56,
    borderRadius: Radius.md,
    backgroundColor: Colors.boneDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostLines: { flex: 1, gap: 0 },
  ghostLine: {
    height: 10,
    borderRadius: 6,
    backgroundColor: Colors.boneDeep,
  },

  textBlock: { alignItems: 'center', gap: 6 },
  heading: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
  sub: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 20 },

  ctaBtn: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingVertical: 10,
    paddingHorizontal: Spacing.xxxl,
    minHeight: 44,
    justifyContent: 'center',
  },
  ctaBtnText: { color: Colors.white, fontWeight: FontWeight.semibold, fontSize: FontSize.md },
  primaryCta: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxxl,
  },
  primaryCtaText: { color: Colors.white, fontWeight: FontWeight.semibold, fontSize: FontSize.md },

  secondaryCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 12,
    ...Shadow.sm,
    minHeight: 44,
  },
  secondaryText: { fontSize: FontSize.md, fontWeight: FontWeight.medium, color: Colors.ink },
  secondaryChevron: { fontSize: 22, color: Colors.midGrey },
})

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: { paddingHorizontal: Spacing.lg, paddingTop: 10, paddingBottom: 8, gap: Spacing.sm },
  title: { fontSize: 30, fontWeight: FontWeight.bold, color: Colors.ink },
  guideCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
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
    flexDirection: 'row', backgroundColor: Colors.boneDeep,
    borderRadius: Radius.full, padding: 3,
  },
  tabBtn: { flex: 1, paddingVertical: 9, borderRadius: Radius.full, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  tabBtnActive: { backgroundColor: Colors.white, ...Shadow.sm },
  tabLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.midGrey },
  tabLabelActive: { color: Colors.ink, fontWeight: FontWeight.semibold },

  list: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.xxl },
  card: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, gap: Spacing.sm, ...Shadow.sm },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  garment: { fontSize: 15, fontWeight: FontWeight.semibold, color: Colors.ink },
  tailor: { fontSize: FontSize.sm, color: Colors.inkLight, marginTop: 2 },
  stagePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  stageText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  cardMeta: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  reviewNudge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.kanteRust + '15',
    borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  reviewNudgeText: { fontSize: FontSize.xs, color: Colors.kanteRust, fontWeight: FontWeight.semibold },
  ref: { fontSize: FontSize.xs, color: Colors.midGrey },
  eta: { fontSize: FontSize.xs, color: Colors.midGrey },
  amount: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, marginLeft: 'auto' },

})
