import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Linking, ScrollView,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'

type ConversationItem = {
  orderId: string
  tailorName: string
  tailorInitials: string
  garmentType: string
  stage: OrderStage
  lastMessage: string | null
  lastMessageAt: string | null
  unreadCount: number
}

type FilterTab = 'all' | 'support'

export default function MessagesInboxScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<FilterTab>('all')

  async function fetchConversations() {
    const { data } = await supabase
      .from('orders')
      .select(`
        id, garment_type, stage,
        tailor_profiles!tailor_profile_id(display_name),
        messages(body, created_at, sender_role)
      `)
      .eq('customer_id', user?.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (!data) return

    const items: ConversationItem[] = data.map((o: any) => {
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
        tailorName: name,
        tailorInitials: initials.toUpperCase(),
        garmentType: o.garment_type,
        stage: o.stage,
        lastMessage: last?.body ?? null,
        lastMessageAt: last?.created_at ?? null,
        unreadCount: unread,
      }
    })

    items.sort((a, b) => {
      if (a.unreadCount > 0 && b.unreadCount === 0) return -1
      if (b.unreadCount > 0 && a.unreadCount === 0) return 1
      const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
      const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
      return bTime - aTime
    })

    setConversations(items)
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
        <ActivityIndicator style={{ flex: 1 }} color={Colors.needleGreen} size="large" />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(c) => c.orderId}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} />}
          contentContainerStyle={conversations.length === 0 ? styles.emptyContainer : undefined}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="message-circle" size={48} color={Colors.lightGrey} />
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptyHint}>Your conversations with tailors will appear here once you place an order.</Text>
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
                    {formatTime(item.lastMessageAt)}
                  </Text>
                </View>
                <View style={styles.contentBottom}>
                  <Text
                    style={[styles.preview, item.unreadCount > 0 && styles.previewBold]}
                    numberOfLines={1}
                  >
                    {item.lastMessage ?? `${item.garmentType} · ${STAGE_LABELS[item.stage] ?? item.stage}`}
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
  const HELP_OPTIONS = [
    { icon: 'package' as const, label: 'Order issue' },
    { icon: 'credit-card' as const, label: 'Payment' },
    { icon: 'flag' as const, label: 'Report a problem' },
    { icon: 'help-circle' as const, label: 'FAQs' },
  ]

  return (
    <ScrollView style={styles.supportScroll} contentContainerStyle={styles.supportContent} showsVerticalScrollIndicator={false}>
      {/* Support conversation row */}
      <TouchableOpacity
        style={styles.row}
        onPress={() => Linking.openURL('mailto:support@drape.app')}
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
            onPress={() => Linking.openURL(`mailto:support@drape.app?subject=${encodeURIComponent(label)}`)}
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
        Average response time: under 4 hours{'\n'}support@drape.app
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.white },

  header: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
    gap: Spacing.md,
  },
  title: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink },

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

  emptyContainer: { flex: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', gap: Spacing.md, padding: Spacing.xl },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyHint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 22, maxWidth: 280 },

  // Support tab
  supportScroll: { flex: 1 },
  supportContent: { paddingBottom: Spacing.xxxl },
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
