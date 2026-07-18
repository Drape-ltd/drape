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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { shareTailorProfile, inviteCustomerFromTailor, sharePassportInvite } from '@/lib/invite'
import { appendToHistory } from '@/lib/navigation'
import { AvatarImage } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const DIARY_BANNER_KEY = 'drape:diary_banner_dismissed'

type Tab = 'customers' | 'diary'

type ClientRow = {
  customerId: string
  displayName: string
  avatarUrl: string | null
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

type CustomerProfileJoinRow = {
  display_name: string | null
  avatar_url: string | null
}

type ClientOrderQueryRow = {
  customer_id: string | null
  garment_type: string | null
  created_at: string
  customer_profiles: CustomerProfileJoinRow | CustomerProfileJoinRow[] | null
}

type DiaryEntryQueryRow = {
  id: string
  passport_id: string
  full_name: string
  measured_at: string | null
  invite_status: string
  chest: number | null
  shoulder: number | null
  sleeve: number | null
  waist: number | null
  hip: number | null
  neck: number | null
  event_type: string | null
  measurement_unit: string | null
}

type TailorProfileQueryRow = {
  id: string
  display_name: string | null
  is_live: boolean | null
}

function firstJoinedRow<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

// An entry is share-ready when it has a name and at least one measurement.
function isEntryShareReady(item: DiaryRow): boolean {
  if (!item.fullName.trim()) return false
  return [item.chest, item.shoulder, item.sleeve, item.waist, item.hip, item.neck]
    .some((v) => v !== null)
}

export default function TailorClientsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const userId = user?.id
  const [tab, setTab] = useState<Tab>('customers')

  // Online clients
  const [clients, setClients] = useState<ClientRow[]>([])
  const [filtered, setFiltered] = useState<ClientRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [tailorProfile, setTailorProfile] = useState<{ id: string; displayName: string; isLive: boolean } | null>(null)

  // Diary
  const [diary, setDiary] = useState<DiaryRow[]>([])
  const [diarySearch, setDiarySearch] = useState('')
  const [diaryLoading, setDiaryLoading] = useState(false)
  const [diaryFetchError, setDiaryFetchError] = useState(false)
  const [showDiaryBanner, setShowDiaryBanner] = useState(false)
  const [sharingDiaryId, setSharingDiaryId] = useState<string | null>(null)

  useEffect(() => {
    AsyncStorage.getItem(DIARY_BANNER_KEY).then((val) => {
      if (val !== '1') setShowDiaryBanner(true)
    })
  }, [])

  function dismissDiaryBanner() {
    setShowDiaryBanner(false)
    AsyncStorage.setItem(DIARY_BANNER_KEY, '1').catch(() => {})
  }

  const fetchClients = useCallback(async () => {
    if (!userId) {
      setClients([])
      setFiltered([])
      return
    }
    setFetchError(false)
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          customer_id, garment_type, created_at,
          customer_profiles!customer_id(display_name, avatar_url)
        `)
        .eq('tailor_id', userId)
        .order('created_at', { ascending: false })

      if (error) throw error
      if (!data) {
        setClients([])
        setFiltered([])
        return
      }

      // Aggregate per customer
      const map = new Map<string, ClientRow>()
      for (const row of data as ClientOrderQueryRow[]) {
        if (!row.customer_id) continue
        const customerProfile = firstJoinedRow(row.customer_profiles)
        const existing = map.get(row.customer_id)
        if (existing) {
          existing.totalOrders += 1
        } else {
          map.set(row.customer_id, {
            customerId: row.customer_id,
            displayName: customerProfile?.display_name ?? 'Customer',
            avatarUrl: customerProfile?.avatar_url ?? null,
            totalOrders: 1,
            lastOrderDate: row.created_at,
            lastGarmentType: row.garment_type ?? 'Order',
          })
        }
      }

      const list = Array.from(map.values()).sort((a, b) =>
        new Date(b.lastOrderDate).getTime() - new Date(a.lastOrderDate).getTime()
      )
      setClients(list)
      applySearch(list, search)
    } catch {
      setFetchError(true)
      setClients([])
      setFiltered([])
    }
  }, [search, userId])

  function applySearch(list: ClientRow[], q: string) {
    if (!q.trim()) {
      setFiltered(list)
    } else {
      const lower = q.toLowerCase()
      setFiltered(list.filter((c) => c.displayName.toLowerCase().includes(lower)))
    }
  }

  const fetchDiary = useCallback(async () => {
    if (!userId) return
    setDiaryFetchError(false)
    try {
      const { data, error } = await supabase
        .from('diary_entries')
        .select('id, passport_id, full_name, measured_at, invite_status, chest, shoulder, sleeve, waist, hip, neck, event_type, measurement_unit')
        .eq('tailor_id', userId)
        .order('created_at', { ascending: false })
      if (error) throw error
      setDiary(((data ?? []) as DiaryEntryQueryRow[]).map((r) => ({
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
        unit: r.measurement_unit ?? 'in',
      })))
    } catch {
      setDiaryFetchError(true)
      setDiary([])
    }
  }, [userId])

  const loadTailorProfile = useCallback(async () => {
    if (!userId) {
      setTailorProfile(null)
      return
    }

    const { data, error } = await supabase
      .from('tailor_profiles')
      .select('id, display_name, is_live')
      .eq('user_id', userId)
      .maybeSingle()

    if (error || !data) {
      setTailorProfile(null)
      return
    }

    const profile = data as TailorProfileQueryRow
    setTailorProfile({
      id: profile.id,
      displayName: profile.display_name ?? '',
      isLive: profile.is_live ?? false,
    })
  }, [userId])

  useFocusEffect(useCallback(() => {
    setLoading(true)
    fetchClients().finally(() => setLoading(false))
    setDiaryLoading(true)
    fetchDiary().finally(() => setDiaryLoading(false))
    void loadTailorProfile()
  }, [fetchClients, fetchDiary, loadTailorProfile]))

  const onSearch = useCallback((text: string) => {
    setSearch(text)
    applySearch(clients, text)
  }, [clients])

  async function onRefresh() {
    setRefreshing(true)
    await Promise.allSettled([fetchClients(), fetchDiary()])
    setRefreshing(false)
  }

  async function markInviteSent(entryId: string) {
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 30)
    const { error } = await supabase
      .from('diary_entries')
      .update({ invite_status: 'INVITE_SENT', invite_expires_at: expiresAt.toISOString() })
      .eq('id', entryId)

    if (error) {
      throw error
    }

    // Optimistically update local state so the pill reflects INVITE_SENT immediately
    setDiary((prev) =>
      prev.map((d) => d.id === entryId ? { ...d, inviteStatus: 'INVITE_SENT' } : d)
    )
  }

  async function markInviteSentWithFeedback(entryId: string) {
    try {
      await markInviteSent(entryId)
    } catch {
      Alert.alert('Invite not updated', 'The share opened, but we could not save the invite status. Please try again.')
    }
  }

  function wasShareCompleted(result: { action: string }) {
    return result.action !== Share.dismissedAction
  }

  async function shareInviteLink(link: string, entryId: string) {
    try {
      const result = await Share.share({ message: link })
      if (wasShareCompleted(result)) {
        await markInviteSentWithFeedback(entryId)
      }
    } catch {
      Alert.alert('Unable to share invite', 'Sharing is unavailable right now. Retry from this diary entry in a moment, or come back later and try again.')
    }
  }

  async function sharePassportInviteWithFeedback(item: DiaryRow, tailorName: string) {
    try {
      await sharePassportInvite(item.passportId, item.fullName, tailorName)
      await markInviteSentWithFeedback(item.id)
    } catch {
      Alert.alert('Unable to share invite', 'Sharing is unavailable right now. Retry from this diary entry in a moment, or come back later and try again.')
    }
  }

  async function handleShareCard(item: DiaryRow) {
    if (sharingDiaryId) return
    if (!isEntryShareReady(item)) {
      Alert.alert('', 'Complete customer details to generate an invite.', [{ text: 'OK' }])
      return
    }
    const link = `https://drape.app/passport/claim/${item.passportId}`
    const tailorName = tailorProfile?.displayName ?? ''
    setSharingDiaryId(item.id)

    try {
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          { options: ['Cancel', 'Share invite link', 'Share…'], cancelButtonIndex: 0 },
          async (idx) => {
            if (idx === 1) {
              await shareInviteLink(link, item.id)
            } else if (idx === 2) {
              await sharePassportInviteWithFeedback(item, tailorName)
            }
            setSharingDiaryId(null)
          }
        )
        return
      }

      Alert.alert(
        'Share invite',
        undefined,
        [
          {
            text: 'Share invite link',
            onPress: async () => {
              await shareInviteLink(link, item.id)
              setSharingDiaryId(null)
            },
          },
          {
            text: 'Share…',
            onPress: async () => {
              await sharePassportInviteWithFeedback(item, tailorName)
              setSharingDiaryId(null)
            },
          },
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => setSharingDiaryId(null),
          },
        ]
      )
    } catch {
      setSharingDiaryId(null)
      Alert.alert('Unable to share invite', 'Sharing is unavailable right now. Retry from this diary entry in a moment, or come back later and try again.')
    }
  }

  const initials = (name: string) =>
    name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')

  const filteredDiary = diarySearch.trim()
    ? diary.filter((d) => d.fullName.toLowerCase().includes(diarySearch.toLowerCase()))
    : diary
  const showDiaryFab = diary.length > 0 || !showDiaryBanner

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Clients</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading your clients…</Text>
            <Text style={styles.stateHint}>
              We’re gathering your active customers and offline diary entries so your relationship context stays in one place.
            </Text>
          </View>
        </View>
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
          contentContainerStyle={[styles.list, { paddingBottom: Math.max(insets.bottom + 112, 148) }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} />
          }
          ListEmptyComponent={
            diaryFetchError ? (
              <View style={styles.stateWrap}>
                <View style={styles.stateCard}>
                  <Text style={styles.stateEyebrow}>Client diary</Text>
                  <Text style={styles.stateTitle}>Couldn't load your diary.</Text>
                  <Text style={styles.stateHint}>
                    This tab should help you carry offline clients and measurements into Drapeon without losing context.
                  </Text>
                  <TouchableOpacity
                    style={styles.addDiaryBtn}
                    onPress={() => {
                      setDiaryLoading(true)
                      fetchDiary().finally(() => setDiaryLoading(false))
                    }}
                  >
                    <Text style={styles.addDiaryBtnText}>Try again</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.emptySecondaryBtn}
                    onPress={() => setTab('customers')}
                  >
                    <Text style={styles.emptySecondaryBtnText}>View customers</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.emptySecondaryBtn}
                    onPress={() => router.replace('/(tailor)')}
                  >
                    <Text style={styles.emptySecondaryBtnText}>Open dashboard</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.empty}>
                <Feather name="book" size={36} color={Colors.lightGrey} style={{ marginBottom: Spacing.md }} />
                <Text style={styles.emptyTitle}>
                  {diarySearch ? 'No results' : 'Build your client passport book'}
                </Text>
                <Text style={styles.emptyHint}>
                  {diarySearch
                    ? 'Try a different name.'
                    : 'Add walk-in clients, record measurements, and share a claim link when they are ready to join Drapeon.'}
                </Text>
                {!diarySearch ? (
                  <TouchableOpacity
                    style={styles.addDiaryBtn}
                    onPress={() =>
                      router.push({
                        pathname: '/(tailor)/clients/diary/[id]',
                        params: { id: 'new', historyChain: appendToHistory(undefined, '/(tailor)/clients') },
                      })
                    }
                    activeOpacity={0.8}
                  >
                    <Text style={styles.addDiaryBtnText}>Add first client</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )
          }
          ListHeaderComponent={
            showDiaryBanner && diary.length > 0 ? (
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
                    Record measurements for walk-in clients. Share a link so they can claim their profile when they join Drapeon.
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.diaryBannerCta}
                  onPress={() =>
                    router.push({
                      pathname: '/(tailor)/clients/diary/[id]',
                      params: { id: 'new', historyChain: appendToHistory(undefined, '/(tailor)/clients') },
                    })
                  }
                  activeOpacity={0.8}
                >
                  <Text style={styles.diaryBannerCtaText}>{diary.length > 0 ? 'Add client' : 'Add first client'}</Text>
                </TouchableOpacity>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() =>
                router.push({
                  pathname: '/(tailor)/clients/diary/[id]',
                  params: { id: item.id, historyChain: appendToHistory(undefined, '/(tailor)/clients') },
                })
              }
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
                    onPress={(event) => {
                      event.stopPropagation()
                      void handleShareCard(item)
                    }}
                    style={styles.shareCardBtn}
                    disabled={sharingDiaryId === item.id}
                    activeOpacity={0.7}
                  >
                    {sharingDiaryId === item.id ? (
                      <ActivityIndicator size="small" color={Colors.needleGreen} />
                    ) : (
                      <>
                        <Feather name="send" size={13} color={Colors.needleGreen} />
                        <Text style={styles.shareCardBtnText}>Invite</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
                <Text style={styles.chevron}>›</Text>
              </View>
            </TouchableOpacity>
          )}
        />
        {showDiaryFab ? (
          <TouchableOpacity
            style={[styles.fab, { bottom: Math.max(insets.bottom + Spacing.lg, Spacing.xl) }]}
            onPress={() =>
              router.push({
                pathname: '/(tailor)/clients/diary/[id]',
                params: { id: 'new', historyChain: appendToHistory(undefined, '/(tailor)/clients') },
              })
            }
            activeOpacity={0.85}
          >
            <Feather name="plus" size={22} color={Colors.textInverse} />
          </TouchableOpacity>
        ) : null}
        </>
      ) : (
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.customerId}
        contentContainerStyle={[styles.list, { paddingBottom: Math.max(insets.bottom + 112, 148) }]}
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
          ) : fetchError ? (
            <View style={styles.stateWrap}>
              <View style={styles.stateCard}>
                <Text style={styles.stateEyebrow}>Clients</Text>
                <Text style={styles.stateTitle}>Couldn't load your clients.</Text>
                <Text style={styles.stateHint}>
                  This tab should help you revisit repeat customers, notes, and order history without guesswork.
                </Text>
                <TouchableOpacity
                  style={styles.addDiaryBtn}
                  onPress={() => {
                    setLoading(true)
                    fetchClients().finally(() => setLoading(false))
                  }}
                >
                  <Text style={styles.addDiaryBtnText}>Try again</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.emptySecondaryBtn}
                  onPress={() => setTab('diary')}
                >
                  <Text style={styles.emptySecondaryBtnText}>Open diary instead</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.emptySecondaryBtn}
                  onPress={() => router.replace('/(tailor)')}
                >
                  <Text style={styles.emptySecondaryBtnText}>Open dashboard</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
              <ClientsEmptyState
                isLive={tailorProfile?.isLive ?? false}
                profileId={tailorProfile?.id ?? null}
                displayName={tailorProfile?.displayName ?? ''}
                hasDiaryClients={diary.length > 0}
                onSetupPress={() => router.push('/(tailor)/profile/setup')}
              />
            )
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() =>
              router.push({
                pathname: '/(tailor)/clients/[clientId]',
                params: { clientId: item.customerId, historyChain: appendToHistory(undefined, '/(tailor)/clients') },
              })
            }
            activeOpacity={0.75}
          >
            <AvatarImage
              uri={item.avatarUrl}
              initials={item.displayName}
              size={44}
              borderColor={Colors.lightGrey}
              borderWidth={1}
            />
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
  isLive, profileId, displayName, hasDiaryClients, onSetupPress,
}: {
  isLive: boolean
  profileId: string | null
  displayName: string
  hasDiaryClients: boolean
  onSetupPress: () => void
}) {
  return (
    <View style={clientEmptyStyles.wrap}>
      <View style={{ gap: 10, width: '100%', marginBottom: Spacing.xl }}>
        <GhostClientCard opacity={0.55} />
        <GhostClientCard opacity={0.32} />
        <GhostClientCard opacity={0.15} />
      </View>
      <Text style={clientEmptyStyles.heading}>{hasDiaryClients ? 'No Drapeon customers yet' : 'No clients yet'}</Text>
      <Text style={clientEmptyStyles.sub}>
        {hasDiaryClients
          ? 'Your diary clients are saved. This tab fills when someone places an order through Drapeon.'
          : 'Client relationships start here once someone places an order or you add them to your diary.'}
        {isLive ? ' Invite a client when you are ready to bring them into Drapeon.' : ' Complete your profile before customers can book you.'}
      </Text>
      <View style={clientEmptyStyles.ctaStack}>
        {isLive && profileId ? (
          <TouchableOpacity
            style={clientEmptyStyles.cta}
            onPress={() => inviteCustomerFromTailor(profileId, displayName)}
          >
            <Feather name="user-plus" size={16} color={Colors.textInverse} />
            <Text style={clientEmptyStyles.ctaText}>Invite a client</Text>
          </TouchableOpacity>
        ) : null}
        {isLive && profileId ? (
          <TouchableOpacity
            style={clientEmptyStyles.secondaryTextButton}
            onPress={() => shareTailorProfile(profileId, displayName)}
          >
            <Text style={clientEmptyStyles.secondaryText}>Share live profile instead</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={clientEmptyStyles.cta}
            onPress={onSetupPress}
          >
            <Feather name="user-check" size={16} color={Colors.textInverse} />
            <Text style={clientEmptyStyles.ctaText}>Complete profile</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={clientEmptyStyles.ctaHint}>
        Use the diary for walk-in clients; use this tab for customers with Drapeon order history.
      </Text>
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
  ctaStack: { gap: Spacing.md, marginTop: Spacing.xl, alignItems: 'center' },
  ctaHint: {
    marginTop: Spacing.md,
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 300,
  },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    minHeight: 48,
  },
  ctaText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse },
  secondaryTextButton: { minHeight: 44, justifyContent: 'center' },
  secondaryText: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.semibold },
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
  stateTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 21 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.lg, paddingTop: 10, paddingBottom: 8,
  },
  title: { fontSize: 30, fontWeight: FontWeight.bold, color: Colors.ink },
  count: {
    fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse,
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 4, overflow: 'hidden', minWidth: 26, textAlign: 'center',
  },
  searchWrap: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  search: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: FontSize.sm, color: Colors.ink, ...Shadow.sm,
    minHeight: 44,
  },

  list: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl, gap: Spacing.sm },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.white, borderRadius: Radius.md,
    padding: 14, ...Shadow.sm,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.needleGreenLight,
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontSize: 15, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  cardBody: { flex: 1, gap: 3 },
  clientName: { fontSize: 15, fontWeight: FontWeight.semibold, color: Colors.ink },
  clientMeta: { fontSize: FontSize.xs, color: Colors.midGrey },
  cardRight: { alignItems: 'flex-end', gap: 2 },
  lastDate: { fontSize: FontSize.xs, color: Colors.midGrey },
  chevron: { fontSize: 20, color: Colors.midGrey, lineHeight: 22 },

  empty: { paddingTop: Spacing.xxxl, alignItems: 'center', gap: Spacing.sm },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyHint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', maxWidth: 280, lineHeight: 20 },

  tabRow: {
    flexDirection: 'row', backgroundColor: Colors.boneDeep, borderRadius: Radius.full,
    padding: 3, marginHorizontal: Spacing.lg, marginBottom: Spacing.sm,
  },
  tabBtn: { flex: 1, paddingVertical: 9, borderRadius: Radius.full, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  tabBtnActive: { backgroundColor: Colors.white, ...Shadow.sm },
  tabLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.midGrey },
  tabLabelActive: { color: Colors.ink, fontWeight: FontWeight.semibold },

  fab: {
    position: 'absolute', bottom: Spacing.lg, right: Spacing.lg,
    width: 52, height: 52, borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen, alignItems: 'center', justifyContent: 'center',
    ...Shadow.md,
  },
  addDiaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, marginTop: Spacing.xl,
  },
  addDiaryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse },
  emptySecondaryBtn: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  emptySecondaryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink },

  // Diary info banner
  diaryBanner: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    marginHorizontal: Spacing.lg, marginBottom: Spacing.sm,
    padding: 14,
    alignItems: 'center',
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  diaryBannerDismiss: {
    position: 'absolute', top: Spacing.md, right: Spacing.md,
  },
  diaryBannerIconWrap: {
    width: 46, height: 46, borderRadius: Radius.md,
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
    fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse,
  },

  // Share button inside diary card
  shareCardBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.needleGreen + '30',
    minHeight: 32,
  },
  shareCardBtnText: {
    fontSize: 11, fontWeight: FontWeight.semibold, color: Colors.needleGreen,
  },
})
