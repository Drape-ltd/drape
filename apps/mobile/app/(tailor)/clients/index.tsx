/**
 * Tailor CRM — client list + diary
 * "Online" tab: platform clients who've placed orders
 * "Diary" tab: offline clients measured in-person (Client Passport system)
 */
import { useState, useCallback, useEffect } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl,
  ActionSheetIOS, Alert, Share, Platform,
} from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { shareTailorProfile, inviteCustomerFromTailor, sharePassportInvite } from '@/lib/invite'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const DIARY_BANNER_KEY = 'drape:diary_banner_dismissed'

type Tab = 'customers' | 'diary'

type ClientRow = {
  customerId: string
  displayName: string
  totalOrders: number
  lastOrderDate: string
  lastGarmentType: string
}

type DiaryRow = {
  id: string
  passportId: string
  fullName: string
  measuredAt: string | null
  inviteStatus: string
  // Measurements — used to determine whether an entry is share-ready
  chest: number | null
  shoulder: number | null
  sleeve: number | null
  waist: number | null
  hip: number | null
  neck: number | null
  eventType: string | null
  unit: string
}

// An entry is share-ready when it has a name and at least one measurement.
function isEntryShareReady(item: DiaryRow): boolean {
  if (!item.fullName.trim()) return false
  return [item.chest, item.shoulder, item.sleeve, item.waist, item.hip, item.neck]
    .some((v) => v !== null)
}

export default function TailorClientsScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('customers')

  // Online clients
  const [clients, setClients] = useState<ClientRow[]>([])
  const [filtered, setFiltered] = useState<ClientRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tailorProfile, setTailorProfile] = useState<{ id: string; displayName: string; isLive: boolean } | null>(null)

  // Diary
  const [diary, setDiary] = useState<DiaryRow[]>([])
  const [diarySearch, setDiarySearch] = useState('')
  const [diaryLoading, setDiaryLoading] = useState(false)
  const [showDiaryBanner, setShowDiaryBanner] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(DIARY_BANNER_KEY).then((val) => {
      if (val !== '1') setShowDiaryBanner(true)
    })
  }, [])

  function dismissDiaryBanner() {
    setShowDiaryBanner(false)
    AsyncStorage.setItem(DIARY_BANNER_KEY, '1').catch(() => {})
  }

  async function fetchClients() {
    const { data } = await supabase
      .from('orders')
      .select(`
        customer_id, garment_type, created_at,
        customer_profiles!customer_id(display_name)
      `)
      .eq('tailor_id', user?.id)
      .order('created_at', { ascending: false })

    if (!data) return

    // Aggregate per customer
    const map = new Map<string, ClientRow>()
    for (const row of data as any[]) {
      if (!row.customer_id) continue
      const existing = map.get(row.customer_id)
      if (existing) {
        existing.totalOrders += 1
      } else {
        map.set(row.customer_id, {
          customerId: row.customer_id,
          displayName: row.customer_profiles?.display_name ?? 'Customer',
          totalOrders: 1,
          lastOrderDate: row.created_at,
          lastGarmentType: row.garment_type,
        })
      }
    }

    const list = Array.from(map.values()).sort((a, b) =>
      new Date(b.lastOrderDate).getTime() - new Date(a.lastOrderDate).getTime()
    )
    setClients(list)
    applySearch(list, search)
  }

  function applySearch(list: ClientRow[], q: string) {
    if (!q.trim()) {
      setFiltered(list)
    } else {
      const lower = q.toLowerCase()
      setFiltered(list.filter((c) => c.displayName.toLowerCase().includes(lower)))
    }
  }

  async function fetchDiary() {
    if (!user?.id) return
    const { data } = await supabase
      .from('diary_entries')
      .select('id, passport_id, full_name, measured_at, invite_status, chest, shoulder, sleeve, waist, hip, neck, event_type, measurement_unit')
      .eq('tailor_id', user.id)
      .order('created_at', { ascending: false })
    setDiary(((data ?? []) as any[]).map((r) => ({
      id: r.id,
      passportId: r.passport_id,
      fullName: r.full_name,
      measuredAt: r.measured_at,
      inviteStatus: r.invite_status,
      chest: r.chest,
      shoulder: r.shoulder,
      sleeve: r.sleeve,
      waist: r.waist,
      hip: r.hip,
      neck: r.neck,
      eventType: r.event_type,
      unit: r.measurement_unit,
    })))
  }

  useFocusEffect(useCallback(() => {
    setLoading(true)
    fetchClients().finally(() => setLoading(false))
    setDiaryLoading(true)
    fetchDiary().finally(() => setDiaryLoading(false))
    if (user?.id) {
      supabase
        .from('tailor_profiles')
        .select('id, display_name, is_live')
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setTailorProfile({ id: (data as any).id, displayName: (data as any).display_name, isLive: (data as any).is_live })
        })
    }
  }, [user?.id]))

  const onSearch = useCallback((text: string) => {
    setSearch(text)
    applySearch(clients, text)
  }, [clients])

  async function onRefresh() {
    setRefreshing(true)
    await Promise.all([fetchClients(), fetchDiary()])
    setRefreshing(false)
  }

  async function markInviteSent(entryId: string) {
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 30)
    await supabase
      .from('diary_entries')
      .update({ invite_status: 'INVITE_SENT', invite_expires_at: expiresAt.toISOString() })
      .eq('id', entryId)
    // Optimistically update local state so the pill reflects INVITE_SENT immediately
    setDiary((prev) =>
      prev.map((d) => d.id === entryId ? { ...d, inviteStatus: 'INVITE_SENT' } : d)
    )
  }

  async function handleShareCard(item: DiaryRow) {
    if (!isEntryShareReady(item)) {
      Alert.alert('', 'Complete customer details to generate an invite.', [{ text: 'OK' }])
      return
    }
    const link = `https://drape.app/passport/claim/${item.passportId}`
    const tailorName = tailorProfile?.displayName ?? ''

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', 'Copy invite link', 'Share…'], cancelButtonIndex: 0 },
        async (idx) => {
          if (idx === 1) {
            await Share.share({ message: link })
            await markInviteSent(item.id)
          } else if (idx === 2) {
            await sharePassportInvite(item.passportId, item.fullName, tailorName)
            await markInviteSent(item.id)
          }
        }
      )
    } else {
      Alert.alert(
        'Share invite',
        undefined,
        [
          {
            text: 'Copy invite link',
            onPress: async () => {
              await Share.share({ message: link })
              await markInviteSent(item.id)
            },
          },
          {
            text: 'Share…',
            onPress: async () => {
              await sharePassportInvite(item.passportId, item.fullName, tailorName)
              await markInviteSent(item.id)
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ]
      )
    }
  }

  const initials = (name: string) =>
    name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')

  const filteredDiary = diarySearch.trim()
    ? diary.filter((d) => d.fullName.toLowerCase().includes(diarySearch.toLowerCase()))
    : diary

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ActivityIndicator style={{ flex: 1 }} color={Colors.needleGreen} size="large" />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Clients</Text>
        <Text style={styles.count}>{tab === 'customers' ? clients.length : diary.length}</Text>
      </View>

      {/* Tab toggle */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'customers' && styles.tabBtnActive]}
          onPress={() => setTab('customers')}
        >
          <Text style={[styles.tabLabel, tab === 'customers' && styles.tabLabelActive]}>Customers</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'diary' && styles.tabBtnActive]}
          onPress={() => setTab('diary')}
        >
          <Text style={[styles.tabLabel, tab === 'diary' && styles.tabLabelActive]}>Diary</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          placeholder={tab === 'customers' ? 'Search clients…' : 'Search diary…'}
          placeholderTextColor={Colors.midGrey}
          value={tab === 'customers' ? search : diarySearch}
          onChangeText={tab === 'customers' ? onSearch : setDiarySearch}
          autoCorrect={false}
        />
      </View>

      {tab === 'diary' ? (
        <>
        {diaryLoading && <ActivityIndicator style={{ marginTop: Spacing.xl }} color={Colors.needleGreen} />}
        <FlatList
          data={filteredDiary}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="book" size={36} color={Colors.lightGrey} style={{ marginBottom: Spacing.md }} />
              <Text style={styles.emptyTitle}>{diarySearch ? 'No results' : 'Diary is empty'}</Text>
              <Text style={styles.emptyHint}>
                {diarySearch
                  ? 'Try a different name.'
                  : 'Add offline clients you\'ve measured. Their data becomes a portable Client Passport they can claim.'}
              </Text>
              {!diarySearch && (
                <TouchableOpacity
                  style={styles.addDiaryBtn}
                  onPress={() => router.push('/(tailor)/clients/diary/new')}
                >
                  <Feather name="plus" size={16} color={Colors.white} />
                  <Text style={styles.addDiaryBtnText}>Add client</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          ListHeaderComponent={
            showDiaryBanner ? (
              <View style={styles.diaryBanner}>
                <TouchableOpacity style={styles.diaryBannerDismiss} onPress={dismissDiaryBanner} hitSlop={10}>
                  <Feather name="x" size={13} color={Colors.midGrey} />
                </TouchableOpacity>
                <View style={styles.diaryBannerIconWrap}>
                  <Feather name="book-open" size={20} color={Colors.needleGreen} />
                </View>
                <View style={styles.diaryBannerBody}>
                  <Text style={styles.diaryBannerTitle}>Build your client passport book</Text>
                  <Text style={styles.diaryBannerText}>
                    Record measurements for walk-in clients. Share a link so they can claim their profile when they join Drape.
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.diaryBannerCta}
                  onPress={() => router.push('/(tailor)/clients/diary/new')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.diaryBannerCtaText}>Add first client</Text>
                </TouchableOpacity>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => router.push(`/(tailor)/clients/diary/${item.id}`)}
              activeOpacity={0.75}
            >
              <View style={[styles.avatar, { backgroundColor: Colors.needleGreenLight }]}>
                <Text style={styles.avatarText}>{initials(item.fullName)}</Text>
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.clientName}>{item.fullName}</Text>
                <Text style={styles.clientMeta}>
                  {item.measuredAt
                    ? new Date(item.measuredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                    : 'No date recorded'}
                  {item.eventType ? `  ·  ${item.eventType.charAt(0) + item.eventType.slice(1).toLowerCase()}` : ''}
                </Text>
                {(item.chest || item.waist) && (
                  <Text style={styles.clientMeta}>
                    {item.chest ? `Chest ${item.chest}${item.unit}` : ''}
                    {item.chest && item.waist ? '  ' : ''}
                    {item.waist ? `Waist ${item.waist}${item.unit}` : ''}
                  </Text>
                )}
              </View>
              <View style={styles.cardRight}>
                <InviteStatusPill status={item.inviteStatus} />
                {isEntryShareReady(item) && (
                  <TouchableOpacity
                    onPress={() => handleShareCard(item)}
                    style={styles.shareCardBtn}
                    activeOpacity={0.7}
                  >
                    <Feather name="send" size={13} color={Colors.needleGreen} />
                    <Text style={styles.shareCardBtnText}>Invite</Text>
                  </TouchableOpacity>
                )}
                <Text style={styles.chevron}>›</Text>
              </View>
            </TouchableOpacity>
          )}
        />
        {/* FAB — only on diary tab */}
        <TouchableOpacity
          style={styles.fab}
          onPress={() => router.push('/(tailor)/clients/diary/new')}
          activeOpacity={0.85}
        >
          <Feather name="plus" size={22} color={Colors.white} />
        </TouchableOpacity>
        </>
      ) : (
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.customerId}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} />
        }
        ListEmptyComponent={
          search ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No results</Text>
              <Text style={styles.emptyHint}>Try a different name.</Text>
            </View>
          ) : (
            <ClientsEmptyState
              isLive={tailorProfile?.isLive ?? false}
              profileId={tailorProfile?.id ?? null}
              displayName={tailorProfile?.displayName ?? ''}
            />
          )
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push(`/(tailor)/clients/${item.customerId}`)}
            activeOpacity={0.75}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(item.displayName)}</Text>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.clientName}>{item.displayName}</Text>
              <Text style={styles.clientMeta}>
                {item.totalOrders} order{item.totalOrders !== 1 ? 's' : ''}
                {'  ·  '}
                Last: {item.lastGarmentType}
              </Text>
            </View>
            <View style={styles.cardRight}>
              <Text style={styles.lastDate}>
                {new Date(item.lastOrderDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </Text>
              <Text style={styles.chevron}>›</Text>
            </View>
          </TouchableOpacity>
        )}
      />
      )}
    </SafeAreaView>
  )
}

// ─── InviteStatusPill ─────────────────────────────────────────────────────────

const INVITE_PILL: Record<string, { label: string; color: string; bg: string }> = {
  NOT_INVITED: { label: 'Not invited', color: Colors.midGrey, bg: Colors.lightGrey },
  INVITE_SENT: { label: 'Invite sent', color: Colors.warning, bg: Colors.warning + '20' },
  CLAIMED:     { label: 'Claimed',     color: Colors.success, bg: Colors.success + '20' },
}

function InviteStatusPill({ status }: { status: string }) {
  const cfg = INVITE_PILL[status] ?? INVITE_PILL.NOT_INVITED
  return (
    <View style={[invitePillStyles.pill, { backgroundColor: cfg.bg }]}>
      <Text style={[invitePillStyles.text, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  )
}

const invitePillStyles = StyleSheet.create({
  pill: { borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  text: { fontSize: 10, fontWeight: FontWeight.semibold },
})

// ─── Clients empty state ─────────────────────────────────────────────────────

function GhostClientCard({ opacity }: { opacity: number }) {
  return (
    <View style={[ghostStyles.card, { opacity }]}>
      <View style={ghostStyles.avatar} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={[ghostStyles.line, { width: '55%' }]} />
        <View style={[ghostStyles.line, { width: '35%' }]} />
      </View>
      <View style={[ghostStyles.line, { width: 36 }]} />
    </View>
  )
}

function ClientsEmptyState({
  isLive, profileId, displayName,
}: {
  isLive: boolean
  profileId: string | null
  displayName: string
}) {
  return (
    <View style={clientEmptyStyles.wrap}>
      <View style={{ gap: 10, width: '100%', marginBottom: Spacing.xl }}>
        <GhostClientCard opacity={0.55} />
        <GhostClientCard opacity={0.32} />
        <GhostClientCard opacity={0.15} />
      </View>
      <Text style={clientEmptyStyles.heading}>No clients yet</Text>
      <Text style={clientEmptyStyles.sub}>
        Clients appear here once a customer places their first order with you.
        {isLive ? ' Share your profile to attract bookings.' : ' Complete your profile to start receiving orders.'}
      </Text>
      <View style={clientEmptyStyles.ctaRow}>
        {isLive && profileId ? (
          <TouchableOpacity
            style={clientEmptyStyles.cta}
            onPress={() => shareTailorProfile(profileId, displayName)}
          >
            <Feather name="share-2" size={16} color={Colors.white} />
            <Text style={clientEmptyStyles.ctaText}>Share my profile</Text>
          </TouchableOpacity>
        ) : null}
        {isLive && profileId ? (
          <TouchableOpacity
            style={[clientEmptyStyles.cta, clientEmptyStyles.ctaSecondary]}
            onPress={() => inviteCustomerFromTailor(profileId, displayName)}
          >
            <Feather name="user-plus" size={16} color={Colors.needleGreen} />
            <Text style={[clientEmptyStyles.ctaText, { color: Colors.needleGreen }]}>Invite a customer</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  )
}

const ghostStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, ...Shadow.sm,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.lightGrey },
  line: { height: 10, borderRadius: 5, backgroundColor: Colors.lightGrey },
})

const clientEmptyStyles = StyleSheet.create({
  wrap: {
    paddingTop: Spacing.xl, paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxxl,
    alignItems: 'center',
  },
  heading: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
  sub: {
    fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center',
    lineHeight: 20, marginTop: 6, maxWidth: 300,
  },
  ctaRow: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xl, flexWrap: 'wrap', justifyContent: 'center' },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
  },
  ctaSecondary: {
    backgroundColor: Colors.white,
    borderWidth: 1.5, borderColor: Colors.needleGreen,
  },
  ctaText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },
})

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, paddingBottom: Spacing.sm,
  },
  title: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink },
  count: {
    fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white,
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 2, overflow: 'hidden',
  },

  searchWrap: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.md },
  search: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    fontSize: FontSize.md, color: Colors.ink, ...Shadow.sm,
  },

  list: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxxl, gap: Spacing.sm },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, ...Shadow.sm,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.needleGreenLight,
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  cardBody: { flex: 1, gap: 3 },
  clientName: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  clientMeta: { fontSize: FontSize.xs, color: Colors.midGrey },
  cardRight: { alignItems: 'flex-end', gap: 2 },
  lastDate: { fontSize: FontSize.xs, color: Colors.midGrey },
  chevron: { fontSize: 20, color: Colors.midGrey, lineHeight: 22 },

  empty: { paddingTop: Spacing.xxxl, alignItems: 'center', gap: Spacing.sm },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyHint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', maxWidth: 280, lineHeight: 20 },

  tabRow: {
    flexDirection: 'row', backgroundColor: Colors.boneDeep, borderRadius: Radius.full,
    padding: 3, marginHorizontal: Spacing.xl, marginBottom: Spacing.sm,
  },
  tabBtn: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.full, alignItems: 'center' },
  tabBtnActive: { backgroundColor: Colors.white, ...Shadow.sm },
  tabLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.midGrey },
  tabLabelActive: { color: Colors.ink, fontWeight: FontWeight.semibold },

  fab: {
    position: 'absolute', bottom: Spacing.xl, right: Spacing.xl,
    width: 52, height: 52, borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen, alignItems: 'center', justifyContent: 'center',
    ...Shadow.md,
  },
  addDiaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, marginTop: Spacing.xl,
  },
  addDiaryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },

  // Diary info banner
  diaryBanner: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    marginHorizontal: Spacing.xl, marginBottom: Spacing.md,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.md,
    ...Shadow.sm,
  },
  diaryBannerDismiss: {
    position: 'absolute', top: Spacing.md, right: Spacing.md,
  },
  diaryBannerIconWrap: {
    width: 52, height: 52, borderRadius: Radius.md,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center', justifyContent: 'center',
    marginTop: Spacing.xs,
  },
  diaryBannerBody: {
    alignItems: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.sm,
  },
  diaryBannerTitle: {
    fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink,
    textAlign: 'center',
  },
  diaryBannerText: {
    fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20,
    textAlign: 'center',
  },
  diaryBannerCta: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xxl, paddingVertical: Spacing.md,
    marginTop: Spacing.xs,
  },
  diaryBannerCtaText: {
    fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white,
  },

  // Share button inside diary card
  shareCardBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.needleGreen + '30',
  },
  shareCardBtnText: {
    fontSize: 11, fontWeight: FontWeight.semibold, color: Colors.needleGreen,
  },
})
