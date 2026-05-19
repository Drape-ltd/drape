import { useState, useCallback, useEffect } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
  Alert, TextInput,
} from 'react-native'
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Feather } from '@expo/vector-icons'
import { useAuth } from '@/lib/auth'
import { Button, FeatureStateCard } from '@/components/ui'
import { openConsultationCallUrl } from '@/lib/consultation'
import { tailorOrderHint, tailorOrderPriority, tailorOrderStageLabel } from '@/lib/order-flow'
import { deriveTailorReadiness, type TailorReadinessInput } from '@/lib/tailor-readiness'
import { supabase } from '@/lib/supabase'
import { useTailorOrders, useRefreshOnFocus } from '@/lib/queries'
import { shareTailorProfile } from '@/lib/invite'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import type { OrderStage } from '@drape/shared/order-machine'
import { formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'
import { stageColor } from '@/lib/stageColors'

type Tab = 'active' | 'completed'

const TAILOR_ORDERS_GUIDE_KEY = 'drape_tailor_orders_best_use_dismissed'

function orderHintForItem(item: { stage: OrderStage; orderKind?: 'CUSTOM' | 'READY_MADE' }): string | null {
  return tailorOrderHint(item.stage, item.orderKind ?? 'CUSTOM')
}

export default function TailorOrdersScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ tab?: string }>()
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('active')
  const [completedSearch, setCompletedSearch] = useState('')
  const [openingCallOrderId, setOpeningCallOrderId] = useState<string | null>(null)
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
  } | null>(null)
  const [showGuide, setShowGuide] = useState(true)

  useEffect(() => {
    if (params.tab === 'completed' || params.tab === 'active') {
      setTab(params.tab)
    }
  }, [params.tab])

  const { data: orders = [], isLoading: loading, isFetching, isError, refetch } = useTailorOrders(user?.id, tab)

  async function loadTailorProfile() {
    if (!user?.id) {
      setTailorProfile(null)
      return
    }

    const { data, error } = await supabase
      .from('tailor_profiles')
      .select('id, display_name, is_live, id_verification_status, profile_completed, payout_currency, payout_provider, payout_reverification_required, payout_account_verified, payout_account_type')
      .eq('user_id', user.id)
      .maybeSingle()

    if (error || !data) {
      setTailorProfile(null)
      return
    }

    setTailorProfile({
      id: (data as any).id,
      displayName: (data as any).display_name,
      isLive: (data as any).is_live,
      idVerificationStatus: (data as any).id_verification_status ?? 'NOT_SUBMITTED',
      profileCompleted: (data as any).profile_completed ?? false,
      stripeAccountId: null,
      paystackAccountId: null,
      payoutCurrency: (data as any).payout_currency ?? null,
      payoutProvider: (data as any).payout_provider ?? null,
      payoutReverificationRequired: (data as any).payout_reverification_required ?? null,
      payoutAccountVerified: (data as any).payout_account_verified ?? null,
      payoutAccountType: (data as any).payout_account_type ?? null,
    })
  }

  useFocusEffect(useCallback(() => {
    void loadTailorProfile()
  }, [user?.id]))

  useFocusEffect(useCallback(() => {
    AsyncStorage.getItem(`${TAILOR_ORDERS_GUIDE_KEY}:${user?.id ?? 'guest'}`)
      .then((value) => setShowGuide(value !== '1'))
      .catch(() => {})
  }, [user?.id]))

  async function dismissGuide() {
    setShowGuide(false)
    try {
      await AsyncStorage.setItem(`${TAILOR_ORDERS_GUIDE_KEY}:${user?.id ?? 'guest'}`, '1')
    } catch {}
  }

  // Refetch whenever this screen comes back into focus (e.g. returning from order detail)
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

  async function openCallUrl(url: string) {
    await openConsultationCallUrl(url, 'tailor')
  }

  async function handleConsultationCall(item: typeof orders[number]) {
    if (openingCallOrderId) return
    if (item.videoCallUrl) {
      setOpeningCallOrderId(item.id)
      try {
        await openCallUrl(item.videoCallUrl)
      } finally {
        setOpeningCallOrderId(null)
      }
      return
    }

    router.push({
      pathname: '/(tailor)/orders/[id]',
      params: { id: item.id, returnTo: '/(tailor)/orders' },
    })
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
            >
              <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
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
          <Text style={styles.guideText}>Use Active for quotes and production, then switch to Completed when you need finished work and past client history.</Text>
        </View>
      )}

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
          <Button
            label="Open dashboard"
            variant="secondary"
            onPress={() => router.push('/(tailor)')}
          />
          <Button
            label="Open profile"
            variant="ghost"
            onPress={() => router.push('/(tailor)/profile')}
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
            tab === 'active' ? (
              <ActiveEmptyState
                readinessInput={tailorProfile}
                profileId={tailorProfile?.id ?? null}
                displayName={tailorProfile?.displayName ?? ''}
                onSetupPress={() => router.navigate('/(tailor)/profile/setup')}
                onPayoutPress={() => router.navigate({ pathname: '/(tailor)/profile/payout-setup', params: { returnTo: '/(tailor)/orders' } } as never)}
                onReviewProfilePress={() => router.navigate('/(tailor)/profile/edit')}
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
            return (
              <TouchableOpacity
                style={[styles.card, isPending && styles.cardPending, isConsultation && styles.cardConsultation]}
                testID={`tailor-order-card-${item.stage}`}
                onPress={() => router.push({
                  pathname: '/(tailor)/orders/[id]',
                  params: { id: item.id, returnTo: '/(tailor)/orders' },
                })}
              >
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.garment}>{item.garmentType}</Text>
                    <Text style={styles.customer}>{item.customerName}</Text>
                  </View>
                  <View style={[styles.stagePill, { backgroundColor: stageColor(item.stage).bg }]}>
                    <Text style={[styles.stageText, { color: stageColor(item.stage).text }]}>
                      {tailorOrderStageLabel(item.stage, item.orderKind ?? 'CUSTOM')}
                    </Text>
                  </View>
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
                {orderHintForItem(item) && (
                  <Text style={item.stage === 'IN_DISPUTE' ? styles.statusHintDispute : isPending ? styles.pendingCta : styles.statusHint}>
                    {orderHintForItem(item)}
                  </Text>
                )}
                {isConsultation && (
                  <View style={styles.consultationActions}>
                    <TouchableOpacity
                      style={styles.callChip}
                      disabled={openingCallOrderId === item.id}
                      onPress={(e) => {
                        e.stopPropagation()
                        if (openingCallOrderId === item.id) return
                        if (item.videoCallUrl) {
                          Alert.alert('Join call', 'Rejoin your consultation call.', [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Video', onPress: () => { void handleConsultationCall(item) } },
                            { text: 'Audio', onPress: () => { void handleConsultationCall(item) } },
                          ])
                        } else {
                          void handleConsultationCall(item)
                        }
                      }}
                    >
                      <Text style={styles.callChipText}>
                        {openingCallOrderId === item.id
                          ? 'Opening…'
                          : item.videoCallUrl ? 'Rejoin call' : 'Start call'}
                      </Text>
                    </TouchableOpacity>
                    <Text style={styles.consultationHint}>Consultation in progress</Text>
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

function GhostCard({ opacity }: { opacity: number }) {
  return (
    <View style={[ghostStyles.card, { opacity }]}>
      <View style={ghostStyles.iconBox} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={[ghostStyles.line, { width: '60%' }]} />
        <View style={[ghostStyles.line, { width: '40%' }]} />
      </View>
      <View style={[ghostStyles.pill, { width: 64 }]} />
    </View>
  )
}

function ActiveEmptyState({
  readinessInput, profileId, displayName, onSetupPress, onPayoutPress, onReviewProfilePress,
}: {
  readinessInput: (TailorReadinessInput & { isLive?: boolean | null }) | null
  profileId: string | null
  displayName: string
  onSetupPress: () => void
  onPayoutPress: () => void
  onReviewProfilePress: () => void
}) {
  const readiness = deriveTailorReadiness(readinessInput)
  const isLive = readinessInput?.isLive === true

  return (
    <View style={emptyStyles.wrap}>
      <View style={{ gap: 10, width: '100%', marginBottom: Spacing.xl }}>
        <GhostCard opacity={0.5} />
        <GhostCard opacity={0.3} />
        <GhostCard opacity={0.15} />
      </View>
      <Text style={emptyStyles.heading}>No active orders yet</Text>
      {isLive ? (
        <>
          <Text style={emptyStyles.sub}>Share your profile to attract your first clients.</Text>
          {profileId && (
            <TouchableOpacity style={emptyStyles.cta} onPress={() => shareTailorProfile(profileId, displayName)}>
              <Text style={emptyStyles.ctaText}>Share my profile</Text>
            </TouchableOpacity>
          )}
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

const ghostStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
    ...Shadow.sm,
  },
  iconBox: { width: 42, height: 42, borderRadius: Radius.md, backgroundColor: Colors.lightGrey },
  line: { height: 10, borderRadius: 5, backgroundColor: Colors.lightGrey },
  pill: { height: 24, borderRadius: Radius.full, backgroundColor: Colors.lightGrey },
})

const emptyStyles = StyleSheet.create({
  wrap: { paddingTop: Spacing.lg, paddingHorizontal: Spacing.lg, alignItems: 'center' },
  heading: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center', fontFamily: 'Georgia' },
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
  title: { fontSize: 28, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: 'Georgia' },
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
  card: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 12, gap: Spacing.xs, ...Shadow.sm },
  cardPending: { borderWidth: 1.5, borderColor: Colors.warning },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  garment: { fontSize: 15, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },
  customer: { fontSize: FontSize.sm, color: Colors.inkLight, marginTop: 2 },
  stagePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  stageText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  cardMeta: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  ref: { fontSize: FontSize.xs, color: Colors.midGrey },
  due: { fontSize: FontSize.xs, color: Colors.midGrey },
  amount: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, marginLeft: 'auto', fontFamily: 'Georgia' },
  pendingCta: { fontSize: FontSize.sm, color: Colors.warning, fontWeight: FontWeight.medium },
  statusHint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  statusHintDispute: { fontSize: FontSize.xs, color: Colors.kanteRust, lineHeight: 18 },
  cardConsultation: { borderWidth: 1.5, borderColor: Colors.needleGreen },
  consultationActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  callChip: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: 14, paddingVertical: 8, minHeight: 44, justifyContent: 'center',
  },
  callChipText: { fontSize: FontSize.xs, color: Colors.textInverse, fontWeight: FontWeight.semibold },
  consultationHint: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  empty: { flex: 1, paddingTop: 80, alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl },
  emptyText: { fontSize: FontSize.md, color: Colors.inkLight },
  emptySubtext: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 20 },
})
