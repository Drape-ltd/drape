import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Linking, ScrollView, Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'

type ConversationItem = {
  orderId: string
  orderKind: 'CUSTOM' | 'READY_MADE'
  tailorName: string
  tailorInitials: string
  garmentType: string
  stage: OrderStage
  createdAt: string
  lastMessage: string | null
  lastMessageAt: string | null
  unreadCount: number
}

type FilterTab = 'all' | 'support'

const MESSAGES_GUIDE_KEY = 'drape_messages_best_use_dismissed'

function orderPreview(stage: OrderStage, garmentType: string, orderKind: 'CUSTOM' | 'READY_MADE'): string {
  switch (stage) {
    case 'PENDING_QUOTE':
      return orderKind === 'READY_MADE'
        ? `${garmentType} · Item inquiry open`
        : `${garmentType} · Waiting for your tailor's quote`
    case 'CONSULTATION':
      return `${garmentType} · Consultation requested`
    case 'QUOTE_SENT':
      return `${garmentType} · Quote ready for review`
    case 'CONFIRMED':
    case 'DESIGNING':
    case 'SOURCING':
    case 'CUTTING':
    case 'SEWING':
    case 'FINISHING':
      return `${garmentType} · In progress`
    case 'SHIPPED':
      return `${garmentType} · Shipped and awaiting receipt`
    case 'READY_FOR_COLLECTION':
      return `${garmentType} · Ready for collection`
    case 'DELIVERED':
      return `${garmentType} · Delivered, ready to finish`
    case 'COLLECTED':
      return `${garmentType} · Collected, ready to finish`
    case 'COMPLETE':
      return `${garmentType} · Order complete`
    case 'IN_DISPUTE':
      return `${garmentType} · Concern under review`
    default:
      return `${garmentType} · ${STAGE_LABELS[stage] ?? stage}`
  }
}

export default function MessagesInboxScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [filter, setFilter] = useState<FilterTab>('all')
  const [showGuide, setShowGuide] = useState(true)

  useEffect(() => {
    AsyncStorage.getItem(MESSAGES_GUIDE_KEY)
      .then((value) => setShowGuide(value !== '1'))
      .catch(() => {})
  }, [])

  async function dismissGuide() {
    setShowGuide(false)
    try {
      await AsyncStorage.setItem(MESSAGES_GUIDE_KEY, '1')
    } catch {}
  }

  async function fetchConversations() {
    setFetchError(false)
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, garment_type, order_kind, stage, created_at,
          tailor_profiles!tailor_profile_id(display_name),
          messages(body, created_at, sender_role, read_at)
        `)
        .eq('customer_id', user?.id)
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) throw error

      const items: ConversationItem[] = ((data ?? []) as any[]).map((o: any) => {
        const msgs: any[] = o.messages ?? []
        const sorted = [...msgs].sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        const last = sorted[0] ?? null
        const unread = sorted.filter(
          (m) => m.sender_role === 'TAILOR' && m.read_at == null
        ).length

        const name: string = o.tailor_profiles?.display_name ?? 'Tailor'
        const parts = name.trim().split(' ')
        const initials = parts.length > 1
          ? `${parts[0][0]}${parts[parts.length - 1][0]}`
          : name.slice(0, 2)

        return {
          orderId: o.id,
          orderKind: o.order_kind ?? 'CUSTOM',
          tailorName: name,
          tailorInitials: initials.toUpperCase(),
          garmentType: o.garment_type,
          stage: o.stage,
          createdAt: o.created_at,
          lastMessage: last?.body ?? null,
          lastMessageAt: last?.created_at ?? null,
          unreadCount: unread,
        }
      })

      items.sort((a, b) => {
        if (a.unreadCount > 0 && b.unreadCount === 0) return -1
        if (b.unreadCount > 0 && a.unreadCount === 0) return 1
        const aTime = new Date(a.lastMessageAt ?? a.createdAt).getTime()
        const bTime = new Date(b.lastMessageAt ?? b.createdAt).getTime()
        return bTime - aTime
      })

      setConversations(items)
    } catch {
      setFetchError(true)
      setConversations([])
    }
  }

  useFocusEffect(useCallback(() => {
    setLoading(true)
    fetchConversations().finally(() => setLoading(false))
  }, [user?.id]))

  async function onRefresh() {
    setRefreshing(true)
    await fetchConversations()
    setRefreshing(false)
  }

  function formatTime(iso: string | null) {
    if (!iso) return ''
    const d = new Date(iso)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
    if (diffDays === 0) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' })
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        <View style={styles.filterRow}>
          {([
            { key: 'all' as FilterTab, label: 'All', badge: totalUnread },
            { key: 'support' as FilterTab, label: 'Support', badge: 0 },
          ]).map(({ key, label, badge }) => (
            <TouchableOpacity
              key={key}
              style={[styles.filterChip, filter === key && styles.filterChipActive]}
              onPress={() => setFilter(key)}
            >
              <Text style={[styles.filterLabel, filter === key && styles.filterLabelActive]}>
                {label}
              </Text>
              {badge > 0 && filter !== key && (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>{badge > 9 ? '9+' : badge}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Support tab */}
      {filter === 'support' ? (
        <SupportView />
      ) : loading ? (
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Messages</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading your conversations…</Text>
            <Text style={styles.stateHint}>Checking recent threads.</Text>
          </View>
        </View>
      ) : fetchError ? (
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Messages</Text>
            <Feather name="alert-circle" size={48} color={Colors.lightGrey} />
            <Text style={styles.stateTitle}>Couldn't load messages</Text>
            <Text style={styles.stateHint}>Refresh and try again.</Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => {
                setLoading(true)
                fetchConversations().finally(() => setLoading(false))
              }}
            >
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => router.navigate('/(customer)')}
            >
              <Text style={styles.secondaryBtnText}>Explore tailors</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => router.navigate('/(customer)/orders')}
            >
              <Text style={styles.secondaryBtnText}>Open orders</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(c) => c.orderId}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} />}
          ListHeaderComponent={(
            <View>
              {showGuide && conversations.length > 0 ? (
                <View style={styles.guideCard}>
                  <View style={styles.guideHeader}>
                    <Text style={styles.guideEyebrow}>Best use</Text>
                    <TouchableOpacity onPress={() => { void dismissGuide() }} hitSlop={8}>
                      <Text style={styles.guideClose}>×</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.guideTitle}>Use messages for discussion. Use the order screen for actions.</Text>
                </View>
              ) : null}
            </View>
          )}
          contentContainerStyle={conversations.length === 0 ? styles.emptyContainer : styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <View style={styles.emptyCard}>
                <Feather name="message-circle" size={42} color={Colors.lightGrey} />
                <Text style={styles.emptyTitle}>No messages yet</Text>
                <Text style={styles.emptyHint}>Custom orders and item inquiries appear here.</Text>
                <View style={styles.emptyActions}>
                  <TouchableOpacity style={styles.retryBtn} onPress={() => router.navigate('/(customer)')}>
                    <Text style={styles.retryBtnText}>Explore sellers</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.navigate('/(customer)/orders')}>
                    <Text style={styles.secondaryBtnText}>Open orders</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => router.push(`/(customer)/messages/${item.orderId}`)}
              activeOpacity={0.7}
            >
              <View style={[styles.avatar, item.unreadCount > 0 && styles.avatarActive]}>
                <Text style={[styles.avatarText, item.unreadCount > 0 && styles.avatarTextActive]}>
                  {item.tailorInitials}
                </Text>
              </View>
              <View style={styles.content}>
                <View style={styles.contentTop}>
                  <Text style={[styles.name, item.unreadCount > 0 && styles.nameBold]} numberOfLines={1}>
                    {item.tailorName}
                  </Text>
                  <Text style={[styles.time, item.unreadCount > 0 && styles.timeActive]}>
                    {formatTime(item.lastMessageAt ?? item.createdAt)}
                  </Text>
                </View>
                <View style={styles.contentBottom}>
                  <Text
                    style={[styles.preview, item.unreadCount > 0 && styles.previewBold]}
                    numberOfLines={1}
                  >
                    {item.lastMessage ?? orderPreview(item.stage, item.garmentType, item.orderKind)}
                  </Text>
                  {item.unreadCount > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>
                        {item.unreadCount > 9 ? '9+' : item.unreadCount}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  )
}

function SupportView() {
  const SUPPORT_EMAIL = 'support@drapeon.co'
  const HELP_OPTIONS = [
    { icon: 'package' as const, label: 'Order issue' },
    { icon: 'credit-card' as const, label: 'Payment' },
    { icon: 'flag' as const, label: 'Report a problem' },
    { icon: 'help-circle' as const, label: 'FAQs' },
  ]

  async function openSupportEmail(subject?: string) {
    const fallbackSubject = subject ?? 'Drape support request'
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(fallbackSubject)}`

    const supported = await Linking.canOpenURL(url)
    if (!supported) {
      Alert.alert('Unable to open email', `Please email ${SUPPORT_EMAIL} directly with the subject "${fallbackSubject}".`)
      return
    }

    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert('Unable to open email', `Please email ${SUPPORT_EMAIL} directly with the subject "${fallbackSubject}".`)
    }
  }

  return (
    <ScrollView style={styles.supportScroll} contentContainerStyle={styles.supportContent} showsVerticalScrollIndicator={false}>
      <View style={styles.supportHeroCard}>
        <Text style={styles.supportHeroTitle}>Support</Text>
        <Text style={styles.supportHeroSub}>Help with orders, payments, or anything off.</Text>
      </View>

      {/* Support conversation row */}
      <TouchableOpacity
        style={styles.row}
        onPress={() => { void openSupportEmail() }}
        activeOpacity={0.7}
      >
        <View style={styles.supportAvatar}>
          <Feather name="shield" size={22} color={Colors.needleGreen} />
        </View>
        <View style={styles.content}>
          <View style={styles.contentTop}>
            <Text style={styles.name}>Drape Support</Text>
          </View>
          <Text style={styles.preview} numberOfLines={1}>
            Tap to email us — we reply within a few hours
          </Text>
        </View>
        <Feather name="chevron-right" size={18} color={Colors.midGrey} />
      </TouchableOpacity>

      <View style={styles.supportDivider} />

      {/* Quick help grid */}
      <Text style={styles.supportSectionLabel}>What do you need help with?</Text>
      <View style={styles.helpGrid}>
        {HELP_OPTIONS.map(({ icon, label }) => (
          <TouchableOpacity
            key={label}
            style={styles.helpCard}
            onPress={() => { void openSupportEmail(label) }}
            activeOpacity={0.75}
          >
            <View style={styles.helpIcon}>
              <Feather name={icon} size={20} color={Colors.needleGreen} />
            </View>
            <Text style={styles.helpLabel}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.supportFootnote}>
        Average response time: under 4 hours{'\n'}support@drapeon.co
      </Text>
    </ScrollView>
  )
}

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
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
    gap: Spacing.md,
  },
  title: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink },
  guideCard: {
    marginHorizontal: Spacing.xl,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  guideHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  guideEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.midGrey,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  guideClose: { fontSize: 22, lineHeight: 22, color: Colors.midGrey },
  guideTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink, lineHeight: 20 },

  filterRow: { flexDirection: 'row', gap: Spacing.sm },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.boneDeep,
  },
  filterChipActive: { backgroundColor: Colors.ink },
  filterLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.inkLight },
  filterLabelActive: { color: Colors.white },
  filterBadge: {
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: Colors.needleGreen, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  filterBadgeText: { fontSize: 10, fontWeight: FontWeight.bold, color: Colors.white },

  separator: { height: 1, backgroundColor: Colors.lightGrey, marginLeft: 76 },
  listContent: { paddingBottom: Spacing.xxxl },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    backgroundColor: Colors.white,
    gap: Spacing.md,
  },
  avatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: Colors.boneDeep, alignItems: 'center', justifyContent: 'center',
  },
  avatarActive: { backgroundColor: Colors.needleGreenLight },
  avatarText: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.midGrey },
  avatarTextActive: { color: Colors.needleGreen },

  content: { flex: 1, gap: 4 },
  contentTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  contentBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  name: { fontSize: FontSize.md, fontWeight: FontWeight.medium, color: Colors.ink, flex: 1, marginRight: Spacing.sm },
  nameBold: { fontWeight: FontWeight.bold },
  time: { fontSize: FontSize.xs, color: Colors.midGrey },
  timeActive: { color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  preview: { fontSize: FontSize.sm, color: Colors.midGrey, flex: 1, marginRight: Spacing.sm },
  previewBold: { color: Colors.ink, fontWeight: FontWeight.medium },

  badge: {
    minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: Colors.needleGreen, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  badgeText: { fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white },

  emptyContainer: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxxl },
  emptyWrap: { flex: 1, justifyContent: 'center' },
  emptyCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    alignItems: 'center',
    ...Shadow.sm,
  },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyHint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 22, maxWidth: 280 },
  emptyActions: { alignSelf: 'stretch', gap: Spacing.sm, marginTop: Spacing.xs },
  retryBtn: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.needleGreen,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
  },
  retryBtnText: { fontSize: FontSize.sm, color: Colors.white, fontWeight: FontWeight.semibold },
  secondaryBtn: {
    backgroundColor: Colors.white,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  secondaryBtnText: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },

  // Support tab
  supportScroll: { flex: 1 },
  supportContent: { paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  supportHeroCard: {
    marginHorizontal: Spacing.xl,
    marginTop: Spacing.xl,
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  supportHeroTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    lineHeight: 24,
  },
  supportHeroSub: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
  supportAvatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: Colors.needleGreenLight, alignItems: 'center', justifyContent: 'center',
  },
  supportDivider: {
    height: 1, backgroundColor: Colors.lightGrey,
    marginHorizontal: Spacing.xl, marginTop: Spacing.sm,
  },
  supportSectionLabel: {
    fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.inkLight,
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl, paddingBottom: Spacing.md,
  },
  helpGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  helpCard: {
    width: '47%', backgroundColor: Colors.bone,
    borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm,
  },
  helpIcon: {
    width: 40, height: 40, borderRadius: Radius.md,
    backgroundColor: Colors.needleGreenLight, alignItems: 'center', justifyContent: 'center',
  },
  helpLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  supportFootnote: {
    fontSize: FontSize.xs, color: Colors.midGrey, textAlign: 'center',
    lineHeight: 20, paddingHorizontal: Spacing.xl, marginTop: Spacing.xl,
  },
})
