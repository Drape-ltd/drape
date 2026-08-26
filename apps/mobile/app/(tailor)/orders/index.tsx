import { useState, useCallback, useEffect } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
  Alert, TextInput,
} from 'react-native'
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useAuth } from '@/lib/auth'
import { Button, DrapeStatusChip, FeatureStateCard } from '@/components/ui'
import { DRAPE_CAPSULE_NAV_CONTENT_CLEARANCE, useDrapeCapsuleNavScroll } from '@/components/ui/DrapeCapsuleNav'
import { tailorOrderHint, tailorOrderPriority, tailorOrderStageLabel } from '@/lib/order-flow'
import { deriveTailorReadiness, type TailorReadinessInput } from '@/lib/tailor-readiness'
import { supabase } from '@/lib/supabase'
import { useRefreshOnFocus, useTailorOrders } from '@/lib/queries'
import { shareTailorProfile } from '@/lib/invite'
import { appendToHistory } from '@/lib/navigation'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import type { OrderStage } from '@drape/shared/order-machine'
import { formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'
import { consultationOrderListState } from '@drape/shared/consultations'
import { deriveFulfillmentAwareOrderStagePresentation } from '@drape/shared/drapeon-dispatch'

type Tab = 'active' | 'completed'
type TailorOrdersProfileRow = {
  id: string
  display_name: string | null
  total_orders: number | null
  is_live: boolean | null
  id_verification_status: string | null
  profile_completed: boolean | null
  payout_currency: string | null
  payout_provider: string | null
  payout_reverification_required: boolean | null
  payout_account_verified: boolean | null
  payout_account_type: 'PAYSTACK' | 'STRIPE_CONNECT' | null
}

function orderHintForItem(item: { stage: OrderStage; orderKind?: 'CUSTOM' | 'READY_MADE' }): string | null {
  return tailorOrderHint(item.stage, item.orderKind ?? 'CUSTOM')
}

export default function TailorOrdersScreen() {
  const router = useRouter()
  const capsuleNavScroll = useDrapeCapsuleNavScroll()
  const params = useLocalSearchParams<{ tab?: string }>()
  const { user } = useAuth()
  const userId = user?.id
  const [tab, setTab] = useState<Tab>('active')
  const [completedSearch, setCompletedSearch] = useState('')
  const [tailorProfile, setTailorProfile] = useState<{
    id: string
    displayName: string
    isLive: boolean
    idVerificationStatus: string
    profileCompleted: boolean
    stripeAccountId: string | null
    paystackAccountId: string | null
    payoutCurrency: string | null
    payoutProvider: string | null
    payoutReverificationRequired: boolean | null
    payoutAccountVerified: boolean | null
    payoutAccountType: 'PAYSTACK' | 'STRIPE_CONNECT' | null
    totalOrders: number
  } | null>(null)

  useEffect(() => {
    if (params.tab === 'completed' || params.tab === 'active') {
      const timer = setTimeout(() => {
        setTab(params.tab as Tab)
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [params.tab])

  const { data: orders = [], isLoading: loading, isFetching, isError, refetch } = useTailorOrders(userId, tab)
  const consultationOrderIdsKey = orders
    .filter((order) => order.stage === 'CONSULTATION')
    .map((order) => order.id)
    .sort()
    .join(',')

  useEffect(() => {
    if (!consultationOrderIdsKey) return
    const orderIds = consultationOrderIdsKey.split(',')
    const channel = supabase.channel(`tailor-consultation-list:${userId ?? 'anonymous'}`)
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
  }, [consultationOrderIdsKey, refetch, userId])

  const loadTailorProfile = useCallback(async () => {
    if (!userId) {
      setTailorProfile(null)
      return
    }

    const { data, error } = await supabase
      .from('tailor_profiles')
      .select('id, display_name, total_orders, is_live, id_verification_status, profile_completed, payout_currency, payout_provider, payout_reverification_required, payout_account_verified, payout_account_type')
      .eq('user_id', userId)
      .maybeSingle()

    if (error || !data) {
      setTailorProfile(null)
      return
    }

    const profile = data as TailorOrdersProfileRow
    setTailorProfile({
      id: profile.id,
      displayName: profile.display_name ?? '',
      isLive: profile.is_live ?? false,
      idVerificationStatus: profile.id_verification_status ?? 'NOT_SUBMITTED',
      profileCompleted: profile.profile_completed ?? false,
      stripeAccountId: null,
      paystackAccountId: null,
      payoutCurrency: profile.payout_currency ?? null,
      payoutProvider: profile.payout_provider ?? null,
      payoutReverificationRequired: profile.payout_reverification_required ?? null,
      payoutAccountVerified: profile.payout_account_verified ?? null,
      payoutAccountType: profile.payout_account_type ?? null,
      totalOrders: profile.total_orders ?? 0,
    })
  }, [userId])

  useFocusEffect(useCallback(() => {
    void loadTailorProfile()
  }, [loadTailorProfile]))

  useRefreshOnFocus(refetch, 0)

  // Group: pending quotes first when on active tab; search on completed tab
  const sortedOrders = (() => {
    if (tab === 'active') {
      return [...orders].sort((a, b) => {
        const priorityDiff = tailorOrderPriority(a.stage) - tailorOrderPriority(b.stage)
        if (priorityDiff !== 0) return priorityDiff
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })
    }
    if (!completedSearch.trim()) return orders
    const q = completedSearch.toLowerCase()
    return orders.filter((o) =>
      o.garmentType.toLowerCase().includes(q) ||
      o.customerName.toLowerCase().includes(q) ||
      o.reference.toLowerCase().includes(q)
    )
  })()

  function openRecoveryMenu() {
    Alert.alert('Where do you want to go?', 'Open a stable tailor area while Orders refreshes.', [
      { text: 'Dashboard', onPress: () => router.push('/(tailor)') },
      { text: 'Profile', onPress: () => router.push('/(tailor)/profile') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Orders</Text>
        <View style={styles.tabs}>
          {(['active', 'completed'] as Tab[]).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
              onPress={() => setTab(t)}
              accessibilityRole="button"
              accessibilityState={{ selected: tab === t }}
            >
              <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {tab === 'completed' && (
        <View style={styles.searchWrap}>
          <TextInput
            style={styles.search}
            placeholder="Search by garment, customer, or reference…"
            placeholderTextColor={Colors.midGrey}
            value={completedSearch}
            onChangeText={setCompletedSearch}
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>
      )}

      {(loading || (isFetching && orders.length === 0)) ? (
        <FeatureStateCard
          eyebrow="Orders"
          title="Loading your pipeline…"
          body="We’re gathering your pending quotes, live production work, and completed jobs."
          loading
        />
      ) : isError ? (
        <FeatureStateCard
          eyebrow="Orders"
          title="Couldn't load your orders."
          body="This is where your quote queue, production work, and completed jobs should stay visible."
          accentColor={Colors.kanteRust}
          icon="alert-circle"
        >
          <Button label="Try again" onPress={() => refetch()} />
          <TouchableOpacity style={styles.compactActionMenuButton} onPress={openRecoveryMenu}>
            <Text style={styles.compactActionMenuText}>Open dashboard or profile</Text>
            <Feather name="chevron-down" size={16} color={Colors.needleGreen} />
          </TouchableOpacity>
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
          refreshControl={<RefreshControl refreshing={isFetching && !loading} onRefresh={refetch} tintColor={Colors.needleGreen} />}
          ListEmptyComponent={
            tab === 'active' ? (
              <ActiveEmptyState
                readinessInput={tailorProfile}
                profileId={tailorProfile?.id ?? null}
                displayName={tailorProfile?.displayName ?? ''}
                totalOrders={tailorProfile?.totalOrders ?? 0}
                onSetupPress={() => router.navigate('/(tailor)/profile/setup')}
                onPayoutPress={() => router.navigate({ pathname: '/(tailor)/profile/payout-setup', params: { returnTo: '/(tailor)/orders', historyChain: appendToHistory(undefined, '/(tailor)/orders') } } as never)}
                onReviewProfilePress={() => router.navigate('/(tailor)/profile/edit')}
                onCompletedPress={() => setTab('completed')}
              />
            ) : (
              <FeatureStateCard
                eyebrow="Completed orders"
                title="No completed orders yet."
                body="Finished customer jobs will appear here once they are fully closed out in the app."
                accentColor={Colors.warning}
                icon="archive"
              >
                <Button label="View active orders" onPress={() => setTab('active')} />
              </FeatureStateCard>
            )
          }
          renderItem={({ item }) => {
            const isPending = item.stage === 'PENDING_QUOTE'
            const isConsultation = item.stage === 'CONSULTATION'
            const stagePresentation = deriveFulfillmentAwareOrderStagePresentation({
              orderStage: item.stage,
              effectiveMethod: item.deliveryMethod,
            })
            const hint = stagePresentation.label
              ? item.deliveryMethod === 'SHIPPING'
                ? 'Shipping is being arranged. No collection code is needed.'
                : 'Drapeon Dispatch is arranging delivery. No collection code is needed.'
              : orderHintForItem(item)
            const consultationState = isConsultation
              ? consultationOrderListState({ actorRole: 'TAILOR', review: item.consultationReview })
              : null
            return (
              <TouchableOpacity
                style={[styles.card, isPending && styles.cardPending, isConsultation && styles.cardConsultation]}
                testID={`tailor-order-card-${item.stage}`}
                activeOpacity={0.84}
                accessibilityRole="button"
                accessibilityLabel={`Open order ${item.reference}`}
                onPress={() => router.push({
                  pathname: '/(tailor)/orders/[id]',
                  params: {
                    id: item.id,
                    returnTo: '/(tailor)/orders',
                    historyChain: appendToHistory(undefined, '/(tailor)/orders'),
                  },
                })}
              >
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.garment}>{item.garmentType}</Text>
                    <Text style={styles.customer}>{item.customerName}</Text>
                  </View>
                  <DrapeStatusChip
                    value={stagePresentation.stage ?? item.stage}
                    label={stagePresentation.label ?? tailorOrderStageLabel(item.stage, item.orderKind ?? 'CUSTOM')}
                    domain="order"
                  />
                </View>
                <View style={styles.cardMeta}>
                  <Text style={styles.ref}>#{item.reference}</Text>
                  {item.estimatedDate && (
                    <Text style={styles.due}>
                      Due {new Date(item.estimatedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </Text>
                  )}
                  {item.quotedAmount && (
                    <Text style={styles.amount}>
                      {formatAmount(item.quotedAmount, item.quotedCurrency as CurrencyCode, item.quotedCurrency as CurrencyCode, STATIC_FALLBACK_RATES)}
                    </Text>
                  )}
                </View>
                {hint && !isConsultation && (
                  <Text style={item.stage === 'IN_DISPUTE' ? styles.statusHintDispute : isPending ? styles.pendingCta : styles.statusHint}>
                    {hint}
                  </Text>
                )}
                {isConsultation && (
                  <View style={[
                    styles.consultationState,
                    consultationState?.needsAction && styles.consultationStateAttention,
                  ]}>
                    <View style={[
                      styles.consultationDot,
                      consultationState?.needsAction && styles.consultationDotAttention,
                    ]} />
                    <Text style={[
                      styles.consultationStateText,
                      consultationState?.needsAction && styles.consultationStateTextAttention,
                    ]}>
                      {consultationState?.label ?? 'Consultation scheduled'}
                    </Text>
                    <Feather name="chevron-right" size={16} color={Colors.midGrey} />
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

// ─── Active orders empty state ────────────────────────────────────────────────

function ActiveEmptyState({
  readinessInput, profileId, displayName, totalOrders, onSetupPress, onPayoutPress, onReviewProfilePress, onCompletedPress,
}: {
  readinessInput: (TailorReadinessInput & { isLive?: boolean | null }) | null
  profileId: string | null
  displayName: string
  totalOrders: number
  onSetupPress: () => void
  onPayoutPress: () => void
  onReviewProfilePress: () => void
  onCompletedPress: () => void
}) {
  const readiness = deriveTailorReadiness(readinessInput)
  const isLive = readinessInput?.isLive === true
  const hasOrderHistory = totalOrders > 0

  return (
    <View style={emptyStyles.wrap}>
      <View style={emptyStyles.illustration}>
        <Feather name={isLive ? 'send' : 'clipboard'} size={30} color={Colors.needleGreen} />
      </View>
      <Text style={emptyStyles.heading}>{hasOrderHistory ? 'No active orders right now' : 'No active orders yet'}</Text>
      {isLive ? (
        <>
          <Text style={emptyStyles.sub}>
            {hasOrderHistory
              ? 'Your live work queue is clear. Completed jobs stay in your archive, and new quote requests will appear here.'
              : 'Your profile is live. Share it with a client or keep your shop stocked so the first request has a clear path.'}
          </Text>
          {hasOrderHistory ? (
            <TouchableOpacity style={emptyStyles.cta} onPress={onCompletedPress}>
              <Text style={emptyStyles.ctaText}>View completed orders</Text>
            </TouchableOpacity>
          ) : profileId ? (
            <TouchableOpacity style={emptyStyles.cta} onPress={() => shareTailorProfile(profileId, displayName)}>
              <Text style={emptyStyles.ctaText}>Share live profile</Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : !readiness.payoutReady && readiness.identityVerified ? (
        <>
          <Text style={emptyStyles.sub}>{readiness.body}</Text>
          <TouchableOpacity style={emptyStyles.cta} onPress={onPayoutPress}>
            <Text style={emptyStyles.ctaText}>{readiness.actionLabel ?? 'Set up payout account'}</Text>
          </TouchableOpacity>
        </>
      ) : readiness.actionLabel === 'Review live profile' ? (
        <>
          <Text style={emptyStyles.sub}>{readiness.body}</Text>
          <TouchableOpacity style={emptyStyles.cta} onPress={onReviewProfilePress}>
            <Text style={emptyStyles.ctaText}>Review live profile</Text>
          </TouchableOpacity>
        </>
      ) : readiness.actionLabel == null ? (
        <Text style={emptyStyles.sub}>{readiness.body}</Text>
      ) : (
        <>
          <Text style={emptyStyles.sub}>{readiness.body}</Text>
          <TouchableOpacity style={emptyStyles.cta} onPress={onSetupPress}>
            <Text style={emptyStyles.ctaText}>{readiness.actionLabel ?? 'Complete profile'}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  )
}

const emptyStyles = StyleSheet.create({
  wrap: { paddingTop: Spacing.lg, paddingHorizontal: Spacing.lg, alignItems: 'center' },
  illustration: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '24',
  },
  heading: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center', fontFamily: Fonts.display },
  sub: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 19, marginTop: 4 },
  cta: {
    marginTop: Spacing.xl,
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xxl,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  ctaText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textInverse },
})

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: { paddingHorizontal: Spacing.lg, paddingTop: 8, paddingBottom: 6, gap: Spacing.xs },
  title: { fontSize: 28, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display },
  tabs: {
    flexDirection: 'row', backgroundColor: Colors.boneDeep,
    borderRadius: Radius.full, padding: 3,
  },
  tabBtn: { flex: 1, paddingVertical: 9, borderRadius: Radius.full, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  tabBtnActive: { backgroundColor: Colors.white, ...Shadow.sm },
  tabLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.midGrey },
  tabLabelActive: { color: Colors.ink, fontWeight: FontWeight.semibold },

  searchWrap: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xs },
  search: {
    backgroundColor: Colors.white, borderRadius: Radius.full,
    paddingHorizontal: 14, paddingVertical: 9,
    fontSize: FontSize.sm, color: Colors.ink,
    borderWidth: 1, borderColor: Colors.lightGrey,
    minHeight: 44,
  },

  list: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.xl },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  cardPending: { borderWidth: 1.5, borderColor: Colors.warning },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  garment: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  customer: { fontSize: FontSize.sm, color: Colors.inkLight, marginTop: 2 },
  cardMeta: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  ref: { fontSize: FontSize.xs, color: Colors.midGrey },
  due: { fontSize: FontSize.xs, color: Colors.midGrey },
  amount: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    marginLeft: 'auto',
  },
  pendingCta: { fontSize: FontSize.sm, color: Colors.warning, fontWeight: FontWeight.medium },
  statusHint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  statusHintDispute: { fontSize: FontSize.xs, color: Colors.kanteRust, lineHeight: 18 },
  cardConsultation: { borderWidth: 1, borderColor: Colors.needleGreen, paddingVertical: 12, gap: 7 },
  consultationState: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: Radius.md,
    backgroundColor: Colors.needleGreenLight,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  consultationStateAttention: { backgroundColor: Colors.accentLight },
  consultationDot: { width: 7, height: 7, borderRadius: Radius.full, backgroundColor: Colors.midGrey },
  consultationDotAttention: { backgroundColor: Colors.kanteRust },
  consultationStateText: { flex: 1, fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  consultationStateTextAttention: { color: Colors.kanteRust },
  compactActionMenuButton: {
    minHeight: 46,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  compactActionMenuText: {
    color: Colors.needleGreen,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },

})
