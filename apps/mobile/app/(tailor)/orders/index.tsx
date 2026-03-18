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

export default function TailorOrdersScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('active')
  const [completedSearch, setCompletedSearch] = useState('')
  const [tailorProfile, setTailorProfile] = useState<{ id: string; displayName: string; isLive: boolean; idVerificationStatus: string } | null>(null)

  const { data: orders = [], isLoading: loading, isFetching, refetch } = useTailorOrders(user?.id, tab)

  useFocusEffect(useCallback(() => {
    if (!user?.id) return
    supabase
      .from('tailor_profiles')
      .select('id, display_name, is_live, id_verification_status')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setTailorProfile({
          id: (data as any).id,
          displayName: (data as any).display_name,
          isLive: (data as any).is_live,
          idVerificationStatus: (data as any).id_verification_status ?? 'NOT_SUBMITTED',
        })
      })
  }, [user?.id]))

  // Refetch whenever this screen comes back into focus (e.g. returning from order detail)
  useRefreshOnFocus(refetch)

  // Group: pending quotes first when on active tab; search on completed tab
  const sortedOrders = (() => {
    if (tab === 'active') {
      return [
        ...orders.filter((o) => o.stage === 'PENDING_QUOTE'),
        ...orders.filter((o) => o.stage !== 'PENDING_QUOTE'),
      ]
    }
    if (!completedSearch.trim()) return orders
    const q = completedSearch.toLowerCase()
    return orders.filter((o) =>
      o.garmentType.toLowerCase().includes(q) ||
      o.customerName.toLowerCase().includes(q) ||
      o.reference.toLowerCase().includes(q)
    )
  })()

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
        <View style={styles.list}>
          <GhostCard opacity={1} />
          <GhostCard opacity={0.6} />
          <GhostCard opacity={0.35} />
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
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No completed orders yet.</Text>
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
                {isPending && (
                  <Text style={styles.pendingCta}>Tap to review and send your quote →</Text>
                )}
                {isConsultation && (
                  <View style={styles.consultationActions}>
                    <TouchableOpacity
                      style={styles.callChip}
                      onPress={(e) => {
                        e.stopPropagation()
                        if (item.videoCallUrl) {
                          Alert.alert('Join call', 'Rejoin your consultation call.', [
                            { text: 'Cancel', style: 'cancel' },
                            { text: '📹 Video', onPress: () => Linking.openURL(item.videoCallUrl!) },
                            { text: '🎙 Audio', onPress: () => Linking.openURL(item.videoCallUrl!) },
                          ])
                        } else {
                          router.push(`/(tailor)/orders/${item.id}`)
                        }
                      }}
                    >
                      <Text style={styles.callChipText}>
                        {item.videoCallUrl ? '📞 Rejoin call' : '📞 Start call'}
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
  header: { padding: Spacing.xl, gap: Spacing.md },
  title: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink },
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
  cardConsultation: { borderWidth: 1.5, borderColor: Colors.needleGreen },
  consultationActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  callChip: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
  },
  callChipText: { fontSize: FontSize.xs, color: Colors.white, fontWeight: FontWeight.semibold },
  consultationHint: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  empty: { flex: 1, paddingTop: 80, alignItems: 'center' },
  emptyText: { fontSize: FontSize.md, color: Colors.inkLight },
})
