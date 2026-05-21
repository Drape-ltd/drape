import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Linking,
  ScrollView,
  Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { customerOrderStageLabel } from '@/lib/customer-order-copy'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { AvatarImage, SkeletonBlock, StateCard } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import type { OrderStage } from '@drape/shared/order-machine'
import { CUSTOMER_ACTIVE_ORDER_STAGES } from '@/lib/order-flow'

type ConversationItem = {
  orderId: string
  orderKind: 'CUSTOM' | 'READY_MADE'
  tailorName: string
  tailorInitials: string
  tailorAvatarUrl: string | null
  garmentType: string
  stage: OrderStage
  createdAt: string
  lastMessage: string | null
  lastMessageAt: string | null
  unreadCount: number
}
type MessageRow = {
  body: string | null
  created_at: string
  sender_role: string | null
  read_at: string | null
}
type TailorProfileJoinRow = {
  display_name: string | null
  avatar_url: string | null
  portfolio_photo_urls: string[] | null
}
type ConversationOrderRow = {
  id: string
  garment_type: string | null
  order_kind: 'CUSTOM' | 'READY_MADE' | null
  stage: OrderStage
  created_at: string
  tailor_profiles: TailorProfileJoinRow | TailorProfileJoinRow[] | null
  messages: MessageRow[] | null
}

type FilterTab = 'open' | 'archive' | 'support'

function firstJoinedRow<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

function firstMediaUrl(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  return value.find((item): item is string => typeof item === 'string' && item.trim().length > 0) ?? null
}

function orderPreview(
  stage: OrderStage,
  garmentType: string,
  orderKind: 'CUSTOM' | 'READY_MADE'
): string {
  switch (stage) {
    case 'PENDING_QUOTE':
      return orderKind === 'READY_MADE'
        ? `${garmentType} · Item inquiry open`
        : `${garmentType} · Waiting for your tailor's quote`
    case 'CONSULTATION':
      return `${garmentType} · Consultation requested`
    case 'QUOTE_SENT':
      return `${garmentType} · Quote ready for review`
    case 'PAYMENT_FAILED':
      return `${garmentType} · Payment failed, retry needed`
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
      return `${garmentType} · Delivered, review window open`
    case 'COLLECTED':
      return `${garmentType} · Collected, review window open`
    case 'COMPLETE':
      return `${garmentType} · Order complete`
    case 'IN_DISPUTE':
      return `${garmentType} · Concern under review`
    default:
      return `${garmentType} · ${customerOrderStageLabel(stage, orderKind)}`
  }
}

export default function MessagesInboxScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const userId = user?.id
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchErrorMessage, setFetchErrorMessage] = useState('')
  const [filter, setFilter] = useState<FilterTab>('open')
  const [expandedArchiveTailor, setExpandedArchiveTailor] = useState<string | null>(null)
  const [archiveDirectoryOpen, setArchiveDirectoryOpen] = useState(false)

  const fetchConversations = useCallback(async () => {
    setFetchErrorMessage('')
    if (!userId) {
      setConversations([])
      return
    }
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(
          `
          id, garment_type, order_kind, stage, created_at,
          tailor_profiles!tailor_profile_id(display_name, avatar_url, portfolio_photo_urls),
          messages(body, created_at, sender_role, read_at)
        `
        )
        .eq('customer_id', userId)
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) throw error

      const items: ConversationItem[] = ((data ?? []) as ConversationOrderRow[]).map((o) => {
        const msgs = o.messages ?? []
        const sorted = [...msgs].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        const last = sorted[0] ?? null
        const unread = sorted.filter((m) => m.sender_role === 'TAILOR' && m.read_at == null).length

        const tailorProfile = firstJoinedRow(o.tailor_profiles)
        const name = tailorProfile?.display_name ?? 'Tailor'
        const parts = name.trim().split(' ')
        const initials =
          parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : name.slice(0, 2)

        return {
          orderId: o.id,
          orderKind: o.order_kind ?? 'CUSTOM',
          tailorName: name,
          tailorInitials: initials.toUpperCase(),
          tailorAvatarUrl:
            tailorProfile?.avatar_url ?? firstMediaUrl(tailorProfile?.portfolio_photo_urls) ?? null,
          garmentType: o.garment_type ?? 'Order',
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
    } catch (error) {
      setFetchErrorMessage(
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Existing threads will stay here, and you can retry when the signal improves.'
          : 'We could not refresh your messages right now. Retry here, or open Orders to continue from the latest order record.'
      )
    }
  }, [userId])

  useFocusEffect(
    useCallback(() => {
      setLoading(true)
      fetchConversations().finally(() => setLoading(false))
    }, [fetchConversations])
  )

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

  const openConversations = conversations.filter((item) => CUSTOMER_ACTIVE_ORDER_STAGES.includes(item.stage))
  const archivedConversations = conversations
    .filter((item) => !CUSTOMER_ACTIVE_ORDER_STAGES.includes(item.stage))
    .sort((a, b) => {
      const nameCompare = a.tailorName.localeCompare(b.tailorName)
      if (nameCompare !== 0) return nameCompare
      const aTime = new Date(a.lastMessageAt ?? a.createdAt).getTime()
      const bTime = new Date(b.lastMessageAt ?? b.createdAt).getTime()
      return bTime - aTime
    })
  const archiveGroups = groupConversationsByTailor(archivedConversations)

  function renderConversationRow(item: ConversationItem, labelMode: 'tailor' | 'order' = 'tailor') {
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => router.push(`/(customer)/messages/${item.orderId}`)}
        activeOpacity={0.7}
      >
        <AvatarImage
          uri={item.tailorAvatarUrl}
          initials={item.tailorName || item.tailorInitials}
          size={46}
          borderColor={item.unreadCount > 0 ? Colors.needleGreen : Colors.lightGrey}
          borderWidth={item.unreadCount > 0 ? 2 : 1}
        />
        <View style={styles.content}>
          <View style={styles.contentTop}>
            <Text
              style={[styles.name, item.unreadCount > 0 && styles.nameBold]}
              numberOfLines={1}
            >
              {labelMode === 'order' ? item.garmentType : item.tailorName}
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
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        <View style={styles.filterRow}>
          {[
            { key: 'open' as FilterTab, label: 'Open', badge: openConversations.reduce((sum, c) => sum + c.unreadCount, 0) },
            { key: 'archive' as FilterTab, label: 'Archive', badge: archivedConversations.reduce((sum, c) => sum + c.unreadCount, 0) },
            { key: 'support' as FilterTab, label: 'Support', badge: 0 },
          ].map(({ key, label, badge }) => (
            <TouchableOpacity
              key={key}
              style={[styles.filterChip, filter === key && styles.filterChipActive]}
              onPress={() => {
                setFilter(key)
                if (key !== 'archive') {
                  setArchiveDirectoryOpen(false)
                  setExpandedArchiveTailor(null)
                }
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === key }}
              accessibilityLabel={`${label} messages`}
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
        <SupportView onOpenMessages={() => setFilter('open')} />
      ) : loading ? (
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Messages</Text>
            <View style={styles.messageSkeletonList}>
              {[0, 1, 2].map((index) => (
                <View key={index} style={styles.messageSkeletonRow}>
                  <SkeletonBlock style={styles.messageSkeletonAvatar} />
                  <View style={styles.messageSkeletonCopy}>
                    <SkeletonBlock style={styles.messageSkeletonTitle} />
                    <SkeletonBlock style={styles.messageSkeletonLine} />
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>
      ) : fetchErrorMessage && conversations.length === 0 ? (
        <View style={styles.stateWrap}>
          <StateCard
            tone="error"
            icon="alert-circle"
            title="Couldn't load messages"
            body={fetchErrorMessage}
            actionLabel="Try again"
            onAction={() => {
              setLoading(true)
              fetchConversations().finally(() => setLoading(false))
            }}
          >
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
          </StateCard>
        </View>
      ) : (
        filter === 'archive' ? (
        <FlatList
          data={archiveDirectoryOpen ? archiveGroups : []}
          keyExtractor={(group) => group.tailorName}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.needleGreen}
            />
          }
          contentContainerStyle={archiveGroups.length === 0 ? styles.emptyContainer : styles.listContent}
          ListHeaderComponent={
            <View>
              {archiveGroups.length > 0 && !archiveDirectoryOpen ? (
                <TouchableOpacity
                  style={styles.archiveDirectoryCard}
                  activeOpacity={0.75}
                  onPress={() => setArchiveDirectoryOpen(true)}
                >
                  <View style={styles.archiveDirectoryIcon}>
                    <Feather name="archive" size={20} color={Colors.needleGreen} />
                  </View>
                  <View style={styles.archiveDirectoryCopy}>
                    <Text style={styles.archiveIntroTitle}>Past order threads</Text>
                    <Text style={styles.archiveIntroText}>
                      {archivedConversations.length} conversation{archivedConversations.length === 1 ? '' : 's'} grouped by tailor.
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={Colors.midGrey} />
                </TouchableOpacity>
              ) : null}
              {archiveGroups.length > 0 && archiveDirectoryOpen ? (
                <View style={styles.archiveIntro}>
                  <Text style={styles.archiveIntroTitle}>Past threads are tucked away by tailor.</Text>
                  <Text style={styles.archiveIntroText}>
                    Tap a tailor to see older order conversations.
                  </Text>
                </View>
              ) : null}
              {fetchErrorMessage && conversations.length > 0 ? (
                <View style={styles.syncNoticeCard}>
                  <Text style={styles.syncNoticeEyebrow}>Sync notice</Text>
                  <Text style={styles.syncNoticeBody}>{fetchErrorMessage}</Text>
                </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <StateCard
                icon="message-circle"
                title={filter === 'archive' ? 'No archived threads' : 'No open messages'}
                body={filter === 'archive'
                  ? 'Completed, declined, or cancelled order threads will move here.'
                  : 'Active custom orders and item inquiries appear here.'}
                actionLabel={filter === 'archive' ? 'Open messages' : 'Explore tailors'}
                onAction={() => filter === 'archive' ? setFilter('open') : router.navigate('/(customer)')}
              >
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => setFilter('open')}
                >
                  <Text style={styles.secondaryBtnText}>Open messages</Text>
                </TouchableOpacity>
              </StateCard>
            </View>
          }
          renderItem={({ item }) => {
            const expanded = expandedArchiveTailor === item.tailorName
            const unread = item.threads.reduce((sum, thread) => sum + thread.unreadCount, 0)
            const latest = item.threads[0]
            return (
              <View style={styles.archiveGroupCard}>
                <TouchableOpacity
                  style={styles.archiveGroupRow}
                  activeOpacity={0.75}
                  onPress={() => setExpandedArchiveTailor(expanded ? null : item.tailorName)}
                >
                  <AvatarImage
                    uri={latest?.tailorAvatarUrl ?? null}
                    initials={item.tailorName}
                    size={46}
                    borderColor={unread > 0 ? Colors.needleGreen : Colors.lightGrey}
                    borderWidth={unread > 0 ? 2 : 1}
                  />
                  <View style={styles.content}>
                    <View style={styles.contentTop}>
                      <Text style={[styles.name, unread > 0 && styles.nameBold]} numberOfLines={1}>{item.tailorName}</Text>
                      <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.midGrey} />
                    </View>
                    <View style={styles.contentBottom}>
                      <Text style={styles.preview} numberOfLines={1}>
                        {item.threads.length} past thread{item.threads.length === 1 ? '' : 's'}
                      </Text>
                      {unread > 0 ? (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </TouchableOpacity>
                {expanded ? (
                  <View style={styles.archiveThreadList}>
                    {item.threads.map((thread) => (
                      <View key={thread.orderId} style={styles.archiveThreadItem}>
                        {renderConversationRow(thread, 'order')}
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            )
          }}
        />
        ) : (
        <FlatList
          data={openConversations}
          keyExtractor={(c) => c.orderId}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.needleGreen}
            />
          }
          contentContainerStyle={openConversations.length === 0 ? styles.emptyContainer : styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListHeaderComponent={
            <View>
              {archivedConversations.length > 0 ? (
                <TouchableOpacity
                  style={styles.archiveShortcut}
                  activeOpacity={0.75}
                  onPress={() => setFilter('archive')}
                >
                  <Feather name="archive" size={16} color={Colors.needleGreen} />
                  <Text style={styles.archiveShortcutText}>
                    {archivedConversations.length} past thread{archivedConversations.length === 1 ? '' : 's'}
                  </Text>
                  <Feather name="chevron-right" size={16} color={Colors.midGrey} />
                </TouchableOpacity>
              ) : null}
              {fetchErrorMessage && conversations.length > 0 ? (
                <View style={styles.syncNoticeCard}>
                  <Text style={styles.syncNoticeEyebrow}>Sync notice</Text>
                  <Text style={styles.syncNoticeBody}>{fetchErrorMessage}</Text>
                </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <StateCard
                icon="message-circle"
                title="No open messages"
                body="Active custom orders and item inquiries appear here."
                actionLabel="Explore tailors"
                onAction={() => router.navigate('/(customer)')}
              >
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => router.navigate('/(customer)/orders')}
                >
                  <Text style={styles.secondaryBtnText}>Open orders</Text>
                </TouchableOpacity>
              </StateCard>
            </View>
          }
          renderItem={({ item }) => renderConversationRow(item)}
        />
        )
      )}
    </SafeAreaView>
  )
}

function SupportView({ onOpenMessages }: { onOpenMessages: () => void }) {
  const SUPPORT_EMAIL = 'support@drapeon.co'
  type SupportTopicKey = 'order' | 'payments' | 'report' | 'guide'
  const [selectedTopic, setSelectedTopic] = useState<SupportTopicKey | null>(null)
  const supportTopics: Record<
    SupportTopicKey,
    {
      icon: keyof typeof Feather.glyphMap
      title: string
      body: string
      details: string[]
      primaryLabel?: string
      onPrimary?: () => void
    }
  > = {
    order: {
      icon: 'package',
      title: 'Order help',
      body: 'Keep live order questions attached to the right thread so the tailor and support team see the same context.',
      details: [
        'Open the order conversation for quote, pickup, delivery, or stage questions.',
        'Use the order detail screen for timelines, payments, and production photos.',
      ],
      primaryLabel: 'Open order threads',
      onPrimary: onOpenMessages,
    },
    payments: {
      icon: 'credit-card',
      title: 'Payments and refunds',
      body: 'For payment issues, include the order name, receipt, and what changed after checkout.',
      details: [
        'Payment questions stay tied to the order before support steps in.',
        'Refund reviews need the original order and payment provider record.',
      ],
      primaryLabel: 'Email support',
      onPrimary: () => {
        void openSupportEmail('Payment or refund help')
      },
    },
    report: {
      icon: 'flag',
      title: 'Report a problem',
      body: 'Share what happened, when it happened, and attach screenshots if they help explain the issue.',
      details: [
        'For active orders, keep the order thread updated first.',
        'For bugs or account issues, email support with the screen name and steps.',
      ],
      primaryLabel: 'Email support',
      onPrimary: () => {
        void openSupportEmail('Report a problem')
      },
    },
    guide: {
      icon: 'book-open',
      title: 'Help guide',
      body: 'Quick paths for the moments customers usually need help with.',
      details: [
        'Custom order questions: open the order thread.',
        'Payment or refund questions: include the order and receipt.',
        'Account or app issues: email support with screenshots.',
      ],
      primaryLabel: 'Open order threads',
      onPrimary: onOpenMessages,
    },
  }
  const helpOptions = [
    {
      key: 'order' as const,
      title: 'Order help',
      body: 'Questions about quotes, pickup, delivery, or production updates.',
    },
    {
      key: 'payments' as const,
      title: 'Payments and refunds',
      body: 'What to include before support reviews the payment record.',
    },
    {
      key: 'report' as const,
      title: 'Report a problem',
      body: 'App issues, account problems, or anything that feels off.',
    },
    {
      key: 'guide' as const,
      title: 'Help guide',
      body: 'Fast answers for common customer support moments.',
    },
  ]

  async function openSupportEmail(subject?: string) {
    const fallbackSubject = subject ?? 'Drape support request'
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(fallbackSubject)}`

    const supported = await Linking.canOpenURL(url)
    if (!supported) {
      Alert.alert(
        'Unable to open email',
        `Please email ${SUPPORT_EMAIL} directly with the subject "${fallbackSubject}". If this is about a live order, keep the order thread updated in Drape too.`
      )
      return
    }

    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert(
        'Unable to open email',
        `Please email ${SUPPORT_EMAIL} directly with the subject "${fallbackSubject}". If this is about a live order, keep the order thread updated in Drape too.`
      )
    }
  }

  return (
    <ScrollView
      style={styles.supportScroll}
      contentContainerStyle={styles.supportContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.supportHeroCard}>
        <View style={styles.supportHeroIcon}>
          <Feather name="life-buoy" size={22} color={Colors.needleGreen} />
        </View>
        <View style={styles.supportHeroCopy}>
          <Text style={styles.supportHeroTitle}>How can we help?</Text>
          <Text style={styles.supportHeroSub}>
            For live orders, start from the order thread. For everything else, email support and include screenshots when useful.
          </Text>
        </View>
      </View>

      {selectedTopic ? (
        <View style={styles.supportTopicCard}>
          <View style={styles.supportTopicHeader}>
            <View style={styles.supportTopicIcon}>
              <Feather name={supportTopics[selectedTopic].icon} size={18} color={Colors.needleGreen} />
            </View>
            <View style={styles.supportTopicTitleWrap}>
              <Text style={styles.supportTopicTitle}>{supportTopics[selectedTopic].title}</Text>
              <Text style={styles.supportTopicBody}>{supportTopics[selectedTopic].body}</Text>
            </View>
          </View>
          <View style={styles.supportTopicDetails}>
            {supportTopics[selectedTopic].details.map((detail) => (
              <View key={detail} style={styles.supportTopicDetailRow}>
                <Feather name="check-circle" size={15} color={Colors.needleGreen} />
                <Text style={styles.supportTopicDetailText}>{detail}</Text>
              </View>
            ))}
          </View>
          {supportTopics[selectedTopic].primaryLabel && supportTopics[selectedTopic].onPrimary ? (
            <TouchableOpacity
              style={styles.supportTopicButton}
              activeOpacity={0.8}
              onPress={supportTopics[selectedTopic].onPrimary}
            >
              <Text style={styles.supportTopicButtonText}>
                {supportTopics[selectedTopic].primaryLabel}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <View style={styles.supportActionList}>
        {helpOptions.map(({ key, title, body }, index) => {
          const topic = supportTopics[key]
          return (
          <TouchableOpacity
            key={title}
            style={[styles.supportActionRow, index === helpOptions.length - 1 && styles.supportActionRowLast]}
            onPress={() => setSelectedTopic(selectedTopic === key ? null : key)}
            activeOpacity={0.75}
          >
            <View style={styles.supportActionIcon}>
              <Feather name={topic.icon} size={20} color={Colors.needleGreen} />
            </View>
            <View style={styles.supportActionCopy}>
              <Text style={styles.supportActionTitle}>{title}</Text>
              <Text style={styles.supportActionText}>{body}</Text>
            </View>
            <Feather
              name={selectedTopic === key ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={Colors.midGrey}
            />
          </TouchableOpacity>
          )
        })}
      </View>

      <TouchableOpacity
        style={styles.supportEmailCard}
        activeOpacity={0.8}
        onPress={() => {
          void openSupportEmail()
        }}
      >
        <Text style={styles.supportEmailTitle}>Email Drape Support</Text>
        <Text style={styles.supportEmailText}>{SUPPORT_EMAIL} · replies usually arrive within a few hours</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

function groupConversationsByTailor(items: ConversationItem[]) {
  const groups = new Map<string, ConversationItem[]>()
  for (const item of items) {
    const key = item.tailorName || 'Tailor'
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return Array.from(groups.entries()).map(([tailorName, threads]) => ({ tailorName, threads }))
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
  messageSkeletonList: {
    alignSelf: 'stretch',
    gap: Spacing.sm,
  },
  messageSkeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.bone,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  messageSkeletonAvatar: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
  },
  messageSkeletonCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
  messageSkeletonTitle: {
    width: '62%',
    height: 16,
  },
  messageSkeletonLine: {
    width: '86%',
    height: 13,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
    gap: Spacing.sm,
  },
  title: { fontSize: 30, fontWeight: FontWeight.bold, color: Colors.ink },
  guideCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
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
  guideTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.ink,
    lineHeight: 20,
  },
  syncNoticeCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  syncNoticeEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  syncNoticeBody: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  archiveShortcut: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
    minHeight: 52,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  archiveShortcutText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  archiveIntro: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 4,
    ...Shadow.sm,
  },
  archiveIntroTitle: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },
  archiveIntroText: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  archiveDirectoryCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
    minHeight: 88,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  archiveDirectoryIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  archiveDirectoryCopy: { flex: 1, gap: 4 },
  archiveGroupHeader: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  archiveGroupTitle: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },
  archiveGroupCount: { fontSize: FontSize.xs, color: Colors.midGrey },
  archiveGroupCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  archiveGroupRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
  },
  archiveThreadList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
    paddingVertical: Spacing.xs,
  },
  archiveThreadItem: {
    marginHorizontal: Spacing.sm,
    marginVertical: 4,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },

  filterRow: { flexDirection: 'row', gap: 8 },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Radius.full,
    backgroundColor: Colors.boneDeep,
    minHeight: 44,
    justifyContent: 'center',
  },
  filterChipActive: { backgroundColor: Colors.needleGreen },
  filterLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.inkLight },
  filterLabelActive: { color: Colors.textInverse },
  filterBadge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.needleGreen,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  filterBadgeText: { fontSize: 10, fontWeight: FontWeight.bold, color: Colors.textInverse },

  separator: { height: 1, backgroundColor: Colors.lightGrey },
  listContent: { paddingBottom: Spacing.xxxl },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
    backgroundColor: Colors.white,
    gap: 12,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Colors.boneDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarActive: { backgroundColor: Colors.needleGreenLight },
  avatarText: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.midGrey },
  avatarTextActive: { color: Colors.needleGreen },

  content: { flex: 1, gap: 4 },
  contentTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  contentBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  name: {
    fontSize: 15,
    fontWeight: FontWeight.medium,
    color: Colors.ink,
    flex: 1,
    marginRight: Spacing.sm,
  },
  nameBold: { fontWeight: FontWeight.bold },
  time: { fontSize: FontSize.xs, color: Colors.midGrey },
  timeActive: { color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  preview: { fontSize: FontSize.sm, color: Colors.midGrey, flex: 1, marginRight: Spacing.sm },
  previewBold: { color: Colors.ink, fontWeight: FontWeight.medium },

  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.needleGreen,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { fontSize: 11, fontWeight: FontWeight.bold, color: Colors.textInverse },

  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  emptyWrap: { flex: 1, justifyContent: 'center' },
  retryBtn: {
    marginTop: Spacing.xs,
    backgroundColor: Colors.needleGreen,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 10,
    borderRadius: Radius.full,
    minHeight: 44,
    justifyContent: 'center',
  },
  retryBtnText: {
    fontSize: FontSize.sm,
    color: Colors.textInverse,
    fontWeight: FontWeight.semibold,
  },
  secondaryBtn: {
    backgroundColor: Colors.white,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  secondaryBtnText: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },

  // Support tab
  supportScroll: { flex: 1 },
  supportContent: { paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  supportHeroCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 16,
    gap: Spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    ...Shadow.sm,
  },
  supportHeroIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportHeroCopy: { flex: 1, gap: 4 },
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
  supportGuideCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  supportGuideTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  supportGuideBody: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
  supportAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportActionList: {
    marginHorizontal: Spacing.lg,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  supportActionRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
  },
  supportActionRowLast: { borderBottomWidth: 0 },
  supportActionIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportActionCopy: { flex: 1, gap: 3 },
  supportActionTitle: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },
  supportActionText: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  supportTopicCard: {
    marginHorizontal: Spacing.lg,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  supportTopicHeader: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
  },
  supportTopicIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportTopicTitleWrap: { flex: 1, gap: 4 },
  supportTopicTitle: {
    fontSize: FontSize.md,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  supportTopicBody: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
  supportTopicDetails: { gap: Spacing.sm },
  supportTopicDetailRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
  },
  supportTopicDetailText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
  supportTopicButton: {
    minHeight: 48,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  supportTopicButtonText: {
    fontSize: FontSize.sm,
    color: Colors.textInverse,
    fontWeight: FontWeight.semibold,
  },
  supportEmailCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xs,
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 4,
  },
  supportEmailTitle: { fontSize: FontSize.sm, color: Colors.textInverse, fontWeight: FontWeight.semibold },
  supportEmailText: { fontSize: FontSize.xs, color: Colors.textInverse, lineHeight: 18 },
  supportDivider: {
    height: 1,
    backgroundColor: Colors.lightGrey,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xs,
  },
  supportSectionLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.inkLight,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  helpGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  helpCard: {
    width: '47%',
    backgroundColor: Colors.bone,
    borderRadius: Radius.md,
    padding: 14,
    gap: Spacing.xs,
    minHeight: 96,
  },
  helpIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  supportFootnote: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: Spacing.xl,
    marginTop: Spacing.xl,
  },
})
