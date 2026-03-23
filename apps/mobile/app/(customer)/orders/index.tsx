import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '@/lib/auth'
import { useCustomerOrders, useRefreshOnFocus } from '@/lib/queries'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'
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

function orderHint(stage: OrderStage): string | null {
  switch (stage) {
    case 'QUOTE_SENT':
      return 'Review quote and confirm to start production'
    case 'CONSULTATION':
      return 'Consultation requested. Open the order or messages for the latest call details.'
    case 'PENDING_QUOTE':
      return 'Your tailor is reviewing your brief and preparing the next step.'
    case 'PAYMENT_PENDING':
      return 'Payment is being confirmed before production starts.'
    case 'CONFIRMED':
      return 'Your order is confirmed. Your tailor is preparing to begin production.'
    case 'DESIGNING':
      return 'Design details and pattern work are underway.'
    case 'SOURCING':
      return 'Fabric and materials are being sourced for your order.'
    case 'CUTTING':
      return 'Fabric is being cut to your measurements.'
    case 'SEWING':
      return 'Your garment is being sewn together.'
    case 'FINISHING':
      return 'Final touches and quality checks are underway.'
    case 'READY_FOR_COLLECTION':
      return 'Your order is ready. Bring your collection code.'
    case 'SHIPPED':
      return 'Your tailor has shipped this order. Open it to track delivery and confirm receipt.'
    case 'DELIVERED':
      return 'Delivery confirmed. Check everything carefully, then finish your order.'
    case 'COLLECTED':
      return 'Collection confirmed. Check everything carefully, then finish your order.'
    case 'IN_DISPUTE':
      return 'Concern under review. Open the order for the latest status.'
    default:
      return null
  }
}

export default function OrdersListScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ tab?: string }>()
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('active')

  useEffect(() => {
    if (params.tab === 'completed' || params.tab === 'active') {
      setTab(params.tab)
    }
  }, [params.tab])

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

      <View style={styles.heroCard}>
        <View style={styles.heroBadge}>
          <Text style={styles.heroBadgeText}>Order journey</Text>
        </View>
        <Text style={styles.heroTitle}>Follow every custom order from quote to final handoff.</Text>
        <Text style={styles.heroSub}>
          Active orders show what needs your attention now, while completed orders preserve the
          history of garments you have already finished with a tailor.
        </Text>
      </View>

      <View style={styles.guideCard}>
        <Text style={styles.guideTitle}>Best order habit</Text>
        <Text style={styles.guideText}>
          Check this list first for anything waiting on your decision, then open the order itself when you need the full status, timeline, or next action.
        </Text>
      </View>

      {loading ? (
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Orders</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading your orders…</Text>
            <Text style={styles.stateHint}>
              We’re gathering your live quotes, production updates, and completed order history.
            </Text>
          </View>
        </View>
      ) : isError ? (
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Orders</Text>
            <Text style={styles.stateTitle}>Couldn't load your orders.</Text>
            <Text style={styles.stateHint}>
              This is where your quote decisions, active progress, and finished garments should stay organised.
            </Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => router.navigate('/(customer)')}
            >
              <Text style={styles.secondaryBtnText}>Explore tailors</Text>
            </TouchableOpacity>
          </View>
        </View>
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
                    {STAGE_LABELS[item.stage]}
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
              {orderHint(item.stage) && (
                <View style={styles.reviewNudge}>
                  <Text style={styles.reviewNudgeText}>{orderHint(item.stage)}</Text>
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
      <View style={styles.stateWrap}>
        <View style={styles.stateCard}>
          <Text style={styles.stateEyebrow}>Completed orders</Text>
          <Text style={styles.stateTitle}>No completed orders yet.</Text>
          <Text style={styles.stateHint}>
            Orders you finish with a tailor will appear here once the full journey is closed out in the app.
          </Text>
          <View style={styles.stateGuideCard}>
            <Text style={styles.stateGuideTitle}>Best way to use this tab</Text>
            <Text style={styles.stateGuideText}>
              Come back here for finished garments, past references, and the orders you may want to review or revisit later.
            </Text>
          </View>
          <TouchableOpacity style={styles.retryBtn} onPress={onExplore}>
            <Text style={styles.retryBtnText}>Explore tailors</Text>
          </TouchableOpacity>
        </View>
      </View>
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
    paddingTop: Spacing.xl,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxxl,
    alignItems: 'center',
    gap: Spacing.xl,
  },
  previewStack: { width: '100%', gap: Spacing.md },
  ghostCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    ...Shadow.sm,
  },
  ghostImage: {
    width: 64,
    height: 64,
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

  textBlock: { alignItems: 'center', gap: Spacing.sm },
  heading: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
  sub: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 22 },

  ctaBtn: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxxl,
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
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    ...Shadow.sm,
  },
  secondaryText: { fontSize: FontSize.md, fontWeight: FontWeight.medium, color: Colors.ink },
  secondaryChevron: { fontSize: 22, color: Colors.midGrey },
})

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
  stateTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
  },
  stateHint: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    textAlign: 'center',
    lineHeight: 21,
  },
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
  },
  stateGuideText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    textAlign: 'center',
    lineHeight: 20,
  },
  header: { padding: Spacing.xl, gap: Spacing.md },
  title: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink },
  heroCard: {
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  guideCard: {
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  guideTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  guideText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  heroBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  heroBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  heroTitle: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    lineHeight: 38,
  },
  heroSub: {
    fontSize: FontSize.md,
    color: Colors.inkLight,
    lineHeight: 24,
  },
  tabs: {
    flexDirection: 'row', backgroundColor: Colors.boneDeep,
    borderRadius: Radius.full, padding: 3,
  },
  tabBtn: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.full, alignItems: 'center' },
  tabBtnActive: { backgroundColor: Colors.white, ...Shadow.sm },
  tabLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.midGrey },
  tabLabelActive: { color: Colors.ink, fontWeight: FontWeight.semibold },

  list: { padding: Spacing.xl, gap: Spacing.md, paddingBottom: Spacing.xxxl },
  retryBtn: { backgroundColor: Colors.needleGreen, borderRadius: Radius.full, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xxxl },
  retryBtnText: { color: Colors.white, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },
  secondaryBtn: {
    backgroundColor: Colors.white,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxxl,
  },
  secondaryBtnText: { color: Colors.ink, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },
  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.md, ...Shadow.sm },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  garment: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  tailor: { fontSize: FontSize.sm, color: Colors.inkLight, marginTop: 2 },
  stagePill: { paddingHorizontal: Spacing.md, paddingVertical: 4, borderRadius: Radius.full },
  stageText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  cardMeta: { flexDirection: 'row', gap: Spacing.lg, alignItems: 'center' },
  reviewNudge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FEF3C7',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: 4,
  },
  reviewNudgeText: { fontSize: FontSize.xs, color: '#92400E', fontWeight: FontWeight.semibold },
  ref: { fontSize: FontSize.xs, color: Colors.midGrey },
  eta: { fontSize: FontSize.xs, color: Colors.midGrey },
  amount: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, marginLeft: 'auto' },

})
