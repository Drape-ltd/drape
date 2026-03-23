import { useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator,
  Alert, Linking, TextInput,
} from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useTailorOrders, useRefreshOnFocus } from '@/lib/queries'
import { shareTailorProfile } from '@/lib/invite'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'
import { formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'
import { stageColor } from '@/lib/stageColors'

type Tab = 'active' | 'completed'

function orderPriority(stage: OrderStage): number {
  switch (stage) {
    case 'PENDING_QUOTE':
      return 0
    case 'CONSULTATION':
      return 1
    case 'IN_DISPUTE':
      return 2
    case 'READY_FOR_COLLECTION':
      return 3
    case 'DELIVERED':
    case 'COLLECTED':
      return 4
    case 'SHIPPED':
      return 5
    default:
      return 6
  }
}

function orderHint(stage: OrderStage): string | null {
  switch (stage) {
    case 'PENDING_QUOTE':
      return 'Tap to review and send your quote.'
    case 'CONSULTATION':
      return 'Consultation in progress. Rejoin the call or send a quote when ready.'
    case 'QUOTE_SENT':
      return 'Quote sent. Waiting for the customer to accept before production starts.'
    case 'CONFIRMED':
      return 'Order confirmed. Move it into the first production stage when you begin.'
    case 'DESIGNING':
      return 'Design work is underway. Advance when you are ready to source or cut.'
    case 'SOURCING':
      return 'Material sourcing is underway. Advance when you are ready to cut.'
    case 'CUTTING':
      return 'Cutting is in progress. Advance when you are ready to sew.'
    case 'SEWING':
      return 'Sewing is in progress. Advance when you are ready for finishing.'
    case 'FINISHING':
      return 'Final touches are underway. Mark shipped or ready for collection when done.'
    case 'DELIVERED':
      return 'Delivered to customer. Waiting for them to finish the order in the app.'
    case 'COLLECTED':
      return 'Collected by customer. Waiting for them to finish the order in the app.'
    case 'READY_FOR_COLLECTION':
      return 'Ready for collection. Confirm the customer\'s collection code when they arrive.'
    case 'SHIPPED':
      return 'Shipped to customer. Waiting for delivery confirmation.'
    case 'IN_DISPUTE':
      return 'Concern raised. This order is paused while support reviews it.'
    default:
      return null
  }
}

export default function TailorOrdersScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('active')
  const [completedSearch, setCompletedSearch] = useState('')
  const [openingCallOrderId, setOpeningCallOrderId] = useState<string | null>(null)
  const [tailorProfile, setTailorProfile] = useState<{ id: string; displayName: string; isLive: boolean; idVerificationStatus: string } | null>(null)

  const { data: orders = [], isLoading: loading, isFetching, isError, refetch } = useTailorOrders(user?.id, tab)

  async function loadTailorProfile() {
    if (!user?.id) {
      setTailorProfile(null)
      return
    }

    const { data, error } = await supabase
      .from('tailor_profiles')
      .select('id, display_name, is_live, id_verification_status')
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
    })
  }

  useFocusEffect(useCallback(() => {
    void loadTailorProfile()
  }, [user?.id]))

  // Refetch whenever this screen comes back into focus (e.g. returning from order detail)
  useRefreshOnFocus(refetch)

  // Group: pending quotes first when on active tab; search on completed tab
  const sortedOrders = (() => {
    if (tab === 'active') {
      return [...orders].sort((a, b) => {
        const priorityDiff = orderPriority(a.stage) - orderPriority(b.stage)
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
    const supported = await Linking.canOpenURL(url)
    if (!supported) {
      Alert.alert('Unable to open call', 'This call link is unavailable right now.')
      return
    }

    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert('Unable to open call', 'Please try again in a moment.')
    }
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

    router.push(`/(tailor)/orders/${item.id}`)
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

      <View style={styles.heroCard}>
        <View style={styles.heroBadge}>
          <Text style={styles.heroBadgeText}>Production pipeline</Text>
        </View>
        <Text style={styles.heroTitle}>Track every client order from quote to completion without losing the thread.</Text>
        <Text style={styles.heroSub}>
          Use active orders to move work forward and completed orders to review what has already
          been delivered, collected, or closed out.
        </Text>
      </View>

      <View style={styles.guideCard}>
        <Text style={styles.guideTitle}>Best working rhythm</Text>
        <Text style={styles.guideText}>
          Clear quotes, timely stage updates, and fast replies make this pipeline feel calm for both you and your customer.
        </Text>
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
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Orders</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading your pipeline…</Text>
            <Text style={styles.stateHint}>
              We’re gathering your pending quotes, live production work, and completed jobs.
            </Text>
          </View>
        </View>
      ) : isError ? (
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Orders</Text>
            <Text style={styles.stateTitle}>Couldn't load your orders.</Text>
            <Text style={styles.stateHint}>
              This is where your quote queue, production work, and completed jobs should stay visible.
            </Text>
            <View style={styles.stateGuideCard}>
              <Text style={styles.stateGuideTitle}>Best recovery move</Text>
              <Text style={styles.stateGuideText}>
                Refresh here first. If orders still do not appear, open your dashboard first, then profile if needed, so the rest of your business can keep moving while the pipeline catches up.
              </Text>
            </View>
            <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push('/(tailor)')}>
              <Text style={styles.secondaryBtnText}>Open dashboard</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push('/(tailor)/profile')}>
              <Text style={styles.secondaryBtnText}>Open profile</Text>
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
            tab === 'active' ? (
              <ActiveEmptyState
                isLive={tailorProfile?.isLive ?? false}
                idVerificationStatus={tailorProfile?.idVerificationStatus ?? 'NOT_SUBMITTED'}
                profileId={tailorProfile?.id ?? null}
                displayName={tailorProfile?.displayName ?? ''}
                onSetupPress={() => router.navigate('/(tailor)/profile/setup')}
              />
            ) : (
              <View style={styles.stateWrap}>
                <View style={styles.stateCard}>
                  <Text style={styles.stateEyebrow}>Completed orders</Text>
                  <Text style={styles.stateTitle}>No completed orders yet.</Text>
                  <Text style={styles.stateHint}>
                    Finished customer jobs will appear here once they are fully closed out in the app.
                  </Text>
                  <View style={styles.stateGuideCard}>
                    <Text style={styles.stateGuideTitle}>Best way to use this tab</Text>
                    <Text style={styles.stateGuideText}>
                      Come back here for finished work, past clients, and the orders that now serve as proof of how you deliver through Drape.
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.retryBtn} onPress={() => setTab('active')}>
                    <Text style={styles.retryBtnText}>View active orders</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )
          }
          renderItem={({ item }) => {
            const isPending = item.stage === 'PENDING_QUOTE'
            const isConsultation = item.stage === 'CONSULTATION'
            return (
              <TouchableOpacity
                style={[styles.card, isPending && styles.cardPending, isConsultation && styles.cardConsultation]}
                testID={`tailor-order-card-${item.stage}`}
                onPress={() => router.push(`/(tailor)/orders/${item.id}`)}
              >
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.garment}>{item.garmentType}</Text>
                    <Text style={styles.customer}>{item.customerName}</Text>
                  </View>
                  <View style={[styles.stagePill, { backgroundColor: stageColor(item.stage).bg }]}>
                    <Text style={[styles.stageText, { color: stageColor(item.stage).text }]}>
                      {STAGE_LABELS[item.stage]}
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
                {orderHint(item.stage) && (
                  <Text style={item.stage === 'IN_DISPUTE' ? styles.statusHintDispute : isPending ? styles.pendingCta : styles.statusHint}>
                    {orderHint(item.stage)}
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
                            { text: '📹 Video', onPress: () => { void handleConsultationCall(item) } },
                            { text: '🎙 Audio', onPress: () => { void handleConsultationCall(item) } },
                          ])
                        } else {
                          void handleConsultationCall(item)
                        }
                      }}
                    >
                      <Text style={styles.callChipText}>
                        {openingCallOrderId === item.id
                          ? 'Opening…'
                          : item.videoCallUrl ? '📞 Rejoin call' : '📞 Start call'}
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
  isLive, idVerificationStatus, profileId, displayName, onSetupPress,
}: {
  isLive: boolean
  idVerificationStatus: string
  profileId: string | null
  displayName: string
  onSetupPress: () => void
}) {
  const isPending = !isLive && idVerificationStatus === 'PENDING'
  const isRejected = !isLive && idVerificationStatus === 'REJECTED'

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
      ) : isPending ? (
        <Text style={emptyStyles.sub}>
          Your profile is under review. You'll start receiving orders once verified — usually within 24 hours.
        </Text>
      ) : isRejected ? (
        <>
          <Text style={emptyStyles.sub}>Your verification was declined. Update your ID to go live.</Text>
          <TouchableOpacity style={emptyStyles.cta} onPress={onSetupPress}>
            <Text style={emptyStyles.ctaText}>Resubmit verification</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={emptyStyles.sub}>Complete your profile and go live to start receiving orders.</Text>
          <TouchableOpacity style={emptyStyles.cta} onPress={onSetupPress}>
            <Text style={emptyStyles.ctaText}>Complete profile</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  )
}

const ghostStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    ...Shadow.sm,
  },
  iconBox: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.lightGrey },
  line: { height: 10, borderRadius: 5, backgroundColor: Colors.lightGrey },
  pill: { height: 24, borderRadius: Radius.full, backgroundColor: Colors.lightGrey },
})

const emptyStyles = StyleSheet.create({
  wrap: { paddingTop: Spacing.xxxl, paddingHorizontal: Spacing.xl, alignItems: 'center' },
  heading: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
  sub: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 20, marginTop: 6 },
  cta: {
    marginTop: Spacing.xl,
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.md,
  },
  ctaText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.white },
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
  tabs: {
    flexDirection: 'row', backgroundColor: Colors.boneDeep,
    borderRadius: Radius.full, padding: 3,
  },
  tabBtn: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.full, alignItems: 'center' },
  tabBtnActive: { backgroundColor: Colors.white, ...Shadow.sm },
  tabLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.midGrey },
  tabLabelActive: { color: Colors.ink, fontWeight: FontWeight.semibold },

  searchWrap: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.md },
  search: {
    backgroundColor: Colors.white, borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    fontSize: FontSize.sm, color: Colors.ink,
    borderWidth: 1, borderColor: Colors.lightGrey,
  },

  list: { padding: Spacing.xl, gap: Spacing.md, paddingBottom: Spacing.xxxl },
  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.md, ...Shadow.sm },
  cardPending: { borderWidth: 1.5, borderColor: Colors.warning },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  garment: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  customer: { fontSize: FontSize.sm, color: Colors.inkLight, marginTop: 2 },
  stagePill: { paddingHorizontal: Spacing.md, paddingVertical: 4, borderRadius: Radius.full },
  stageText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  cardMeta: { flexDirection: 'row', gap: Spacing.lg, alignItems: 'center' },
  ref: { fontSize: FontSize.xs, color: Colors.midGrey },
  due: { fontSize: FontSize.xs, color: Colors.midGrey },
  amount: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, marginLeft: 'auto' },
  pendingCta: { fontSize: FontSize.sm, color: Colors.warning, fontWeight: FontWeight.medium },
  statusHint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  statusHintDispute: { fontSize: FontSize.xs, color: Colors.kanteRust, lineHeight: 18 },
  cardConsultation: { borderWidth: 1.5, borderColor: Colors.needleGreen },
  consultationActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  callChip: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
  },
  callChipText: { fontSize: FontSize.xs, color: Colors.white, fontWeight: FontWeight.semibold },
  consultationHint: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  empty: { flex: 1, paddingTop: 80, alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl },
  emptyText: { fontSize: FontSize.md, color: Colors.inkLight },
  emptySubtext: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 20 },
  retryBtn: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  retryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },
  secondaryBtn: {
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  secondaryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink },
})
