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
  BackHandler,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { customerOrderStageLabel } from '@/lib/customer-order-copy'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { appendToHistory } from '@/lib/navigation'
import { AvatarImage, SkeletonBlock, StateCard } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { CONTACTS, buildWhatsAppSupportUrl } from '@drape/shared'
import type { OrderStage } from '@drape/shared/order-machine'
import { decodeDisplayText } from '@drape/shared/display-text'
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
type ConversationGroup = {
  tailorName: string
  threads: ConversationItem[]
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

function displayText(value: string | null | undefined, fallback = '') {
  const decoded = decodeDisplayText(value ?? '').trim()
  return decoded || fallback
}

function displayNullableText(value: string | null | undefined) {
  const decoded = displayText(value)
  return decoded || null
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
  const [expandedOpenTailor, setExpandedOpenTailor] = useState<string | null>(null)
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
        .limit(60)

      if (error) throw error

      const items: ConversationItem[] = ((data ?? []) as ConversationOrderRow[]).map((o) => {
        const msgs = o.messages ?? []
        const sorted = [...msgs].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        const last = sorted[0] ?? null
        const unread = sorted.filter((m) => m.sender_role === 'TAILOR' && m.read_at == null).length

        const tailorProfile = firstJoinedRow(o.tailor_profiles)
        const name = displayText(tailorProfile?.display_name, 'Tailor')
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
          garmentType: displayText(o.garment_type, 'Order'),
          stage: o.stage,
          createdAt: o.created_at,
          lastMessage: displayNullableText(last?.body),
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

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (filter === 'archive' && archiveDirectoryOpen) {
          setArchiveDirectoryOpen(false)
          setExpandedArchiveTailor(null)
          return true
        }
        if (filter === 'open' && expandedOpenTailor) {
          setExpandedOpenTailor(null)
          return true
        }
        if (filter !== 'open') {
          setFilter('open')
          setExpandedOpenTailor(null)
          setArchiveDirectoryOpen(false)
          setExpandedArchiveTailor(null)
          return true
        }
        return false
      })

      return () => subscription.remove()
    }, [archiveDirectoryOpen, expandedOpenTailor, filter])
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
  const openGroups = groupConversationsByTailor(openConversations)
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
        onPress={() =>
          router.push({
            pathname: '/(customer)/messages/[orderId]',
            params: { orderId: item.orderId, historyChain: appendToHistory(undefined, '/(customer)/messages') },
          })
        }
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

  function renderConversationGroup(item: ConversationGroup, mode: 'open' | 'archive') {
    const expanded =
      mode === 'open'
        ? expandedOpenTailor === item.tailorName
        : expandedArchiveTailor === item.tailorName
    const unread = item.threads.reduce((sum, thread) => sum + thread.unreadCount, 0)
    const latest = item.threads[0]
    if (!latest) return null
    const singleThread = item.threads.length === 1
    const threadLabel = mode === 'open' ? 'active order' : 'past thread'
    const preview = singleThread
      ? orderPreview(latest.stage, latest.garmentType, latest.orderKind)
      : `${item.threads.length} ${threadLabel}${item.threads.length === 1 ? '' : 's'}`

    return (
      <View style={styles.archiveGroupCard}>
        <TouchableOpacity
          style={styles.archiveGroupRow}
          activeOpacity={0.75}
          onPress={() => {
            if (singleThread && latest) {
              router.push({
                pathname: '/(customer)/messages/[orderId]',
                params: { orderId: latest.orderId, historyChain: appendToHistory(undefined, '/(customer)/messages') },
              })
              return
            }
            if (mode === 'open') {
              setExpandedOpenTailor(expanded ? null : item.tailorName)
            } else {
              setExpandedArchiveTailor(expanded ? null : item.tailorName)
            }
          }}
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
              <Text style={[styles.name, unread > 0 && styles.nameBold]} numberOfLines={1}>
                {item.tailorName}
              </Text>
              <Feather
                name={singleThread ? 'chevron-right' : expanded ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={Colors.midGrey}
              />
            </View>
            <View style={styles.contentBottom}>
              <Text style={styles.preview} numberOfLines={1}>
                {preview}
              </Text>
              {unread > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </TouchableOpacity>
        {!singleThread && expanded ? (
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
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        <View style={styles.filterTabs}>
          {[
            { key: 'open' as FilterTab, label: 'Open', badge: openConversations.reduce((sum, c) => sum + c.unreadCount, 0) },
            { key: 'archive' as FilterTab, label: 'Archive', badge: archivedConversations.reduce((sum, c) => sum + c.unreadCount, 0) },
            { key: 'support' as FilterTab, label: 'Support', badge: 0 },
          ].map(({ key, label, badge }) => (
            <TouchableOpacity
              key={key}
              style={[styles.filterTab, filter === key && styles.filterTabActive]}
              onPress={() => {
                setFilter(key)
                setExpandedOpenTailor(null)
                if (key !== 'archive') {
                  setArchiveDirectoryOpen(false)
                  setExpandedArchiveTailor(null)
                }
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === key }}
              accessibilityLabel={`${label} messages`}
            >
              <Text style={[styles.filterLabel, filter === key && styles.filterLabelActive]} numberOfLines={1}>
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
            return renderConversationGroup(item, 'archive')
          }}
        />
        ) : (
        <FlatList
          data={openGroups}
          keyExtractor={(group) => group.tailorName}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.needleGreen}
            />
          }
          contentContainerStyle={openGroups.length === 0 ? styles.emptyContainer : styles.listContent}
          ListHeaderComponent={
            <View>
              {openGroups.some((group) => group.threads.length > 1) ? (
                <View style={styles.archiveIntro}>
                  <Text style={styles.archiveIntroTitle}>Grouped by tailor</Text>
                  <Text style={styles.archiveIntroText}>
                    Multiple live orders with the same tailor stay together. Open a tailor to choose the exact order thread.
                  </Text>
                </View>
              ) : null}
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
          renderItem={({ item }) => renderConversationGroup(item, 'open')}
        />
        )
      )}
    </SafeAreaView>
  )
}

function SupportView({ onOpenMessages }: { onOpenMessages: () => void }) {
  const SUPPORT_EMAIL = CONTACTS.support
  type SupportTopicKey = 'order' | 'payments' | 'report'
  type QuickAnswerKey = 'late' | 'refund' | 'no_response'

  const [selectedTopic, setSelectedTopic] = useState<SupportTopicKey | null>(null)
  const [expandedQuickAnswer, setExpandedQuickAnswer] = useState<QuickAnswerKey | null>(null)

  const quickAnswers: {
    key: QuickAnswerKey
    title: string
    answer: string
    actionLabel?: string
    onAction?: () => void
  }[] = [
    {
      key: 'late',
      title: 'My order is late',
      answer:
        'Open the order thread and ask your tailor for a production update. Most delays resolve there. If you have not heard back within 48 hours, email support with the order name.',
    },
    {
      key: 'refund',
      title: 'I need a refund',
      answer:
        'Refund requests are reviewed with the original order and payment record. Email support with the order name and what changed after checkout.',
      actionLabel: 'Email support',
      onAction: () => { void openSupportEmail('Refund request') },
    },
    {
      key: 'no_response',
      title: 'My tailor is not responding',
      answer:
        'Give tailors up to 48 hours to reply on working days. If your deadline is at risk, email support with the order name and the last message timestamp.',
      actionLabel: 'Email support',
      onAction: () => { void openSupportEmail('Unresponsive tailor') },
    },
  ]

  const supportTopics: {
    key: SupportTopicKey
    icon: keyof typeof Feather.glyphMap
    title: string
    body: string
    details: string[]
    primaryLabel: string
    onPrimary: () => void
  }[] = [
    {
      key: 'order',
      icon: 'package',
      title: 'Order help',
      body: 'Quotes, production updates, pickup, and delivery questions belong in the order thread so the tailor and support team share the same record.',
      details: [
        'Open the order conversation for any question tied to a live order.',
        'Use the order detail screen for timelines, payments, and photos.',
      ],
      primaryLabel: 'Open order threads',
      onPrimary: onOpenMessages,
    },
    {
      key: 'payments',
      icon: 'credit-card',
      title: 'Payments and refunds',
      body: 'Include the order name, receipt, and what changed after checkout when you contact support.',
      details: [
        'Payment questions stay tied to the order before support steps in.',
        'Refund reviews need the original order and payment provider record.',
      ],
      primaryLabel: 'Email support',
      onPrimary: () => { void openSupportEmail('Payment or refund help') },
    },
    {
      key: 'report',
      icon: 'flag',
      title: 'Report a problem',
      body: 'For bugs, account issues, or anything that feels off — email support with the screen name, steps, and screenshots if helpful.',
      details: [
        'For active orders, keep the order thread updated first.',
        'For bugs or account issues, include the screen name and steps to reproduce.',
      ],
      primaryLabel: 'Email support',
      onPrimary: () => { void openSupportEmail('Report a problem') },
    },
  ]

  async function openSupportEmail(subject?: string) {
    const fallbackSubject = subject ?? 'Drapeon support request'
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(fallbackSubject)}`
    const supported = await Linking.canOpenURL(url)
    if (!supported) {
      Alert.alert(
        'Unable to open email',
        `Please email ${SUPPORT_EMAIL} directly with the subject "${fallbackSubject}". If this is about a live order, keep the order thread updated in Drapeon too.`
      )
      return
    }
    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert(
        'Unable to open email',
        `Please email ${SUPPORT_EMAIL} directly with the subject "${fallbackSubject}". If this is about a live order, keep the order thread updated in Drapeon too.`
      )
    }
  }

  async function openSupportWhatsApp() {
    const url = buildWhatsAppSupportUrl('Hi Drapeon, I need customer support.')
    const supported = await Linking.canOpenURL(url)
    if (!supported) {
      Alert.alert(
        'Unable to open WhatsApp',
        `Please message Drapeon on WhatsApp, or email ${SUPPORT_EMAIL} if this is about an account issue.`,
      )
      return
    }
    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert(
        'Unable to open WhatsApp',
        `Please message Drapeon on WhatsApp, or email ${SUPPORT_EMAIL} if this is about an account issue.`,
      )
    }
  }

  return (
    <ScrollView
      style={styles.supportScroll}
      contentContainerStyle={styles.supportContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.supportHeader}>
        <View style={styles.supportHeaderIcon}>
          <Feather name="headphones" size={26} color={Colors.needleGreen} />
        </View>
        <Text style={styles.supportHeaderTitle}>How can we help?</Text>
        <Text style={styles.supportHeaderSub}>
          For live orders, start from the order thread. For everything else, we're here.
        </Text>
      </View>

      <View style={styles.supportGroup}>
        <Text style={styles.supportGroupLabel}>Common questions</Text>
        <View style={styles.supportCard}>
          {quickAnswers.map((qa, index) => {
            const isOpen = expandedQuickAnswer === qa.key
            const isLast = index === quickAnswers.length - 1
            return (
              <View key={qa.key}>
                <TouchableOpacity
                  style={[styles.supportCardRow, (isLast && !isOpen) && styles.supportCardRowLast]}
                  onPress={() => setExpandedQuickAnswer(isOpen ? null : qa.key)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.supportCardRowTitle, isOpen && styles.supportCardRowTitleActive]}>
                    {qa.title}
                  </Text>
                  <Feather
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={isOpen ? Colors.needleGreen : Colors.midGrey}
                  />
                </TouchableOpacity>
                {isOpen ? (
                  <View style={[styles.supportExpandBody, isLast && styles.supportExpandBodyLast]}>
                    <Text style={styles.supportExpandText}>{qa.answer}</Text>
                    {qa.actionLabel && qa.onAction ? (
                      <TouchableOpacity style={styles.supportExpandAction} onPress={qa.onAction} activeOpacity={0.8}>
                        <Text style={styles.supportExpandActionText}>{qa.actionLabel}</Text>
                        <Feather name="arrow-right" size={14} color={Colors.needleGreen} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
              </View>
            )
          })}
        </View>
      </View>

      <View style={styles.supportGroup}>
        <Text style={styles.supportGroupLabel}>Get help with</Text>
        <View style={styles.supportCard}>
          {supportTopics.map((topic, index) => {
            const isOpen = selectedTopic === topic.key
            const isLast = index === supportTopics.length - 1
            return (
              <View key={topic.key}>
                <TouchableOpacity
                  style={[styles.supportCardRow, (isLast && !isOpen) && styles.supportCardRowLast]}
                  onPress={() => setSelectedTopic(isOpen ? null : topic.key)}
                  activeOpacity={0.75}
                >
                  <View style={styles.supportTopicRowIcon}>
                    <Feather name={topic.icon} size={16} color={Colors.needleGreen} />
                  </View>
                  <Text style={[styles.supportCardRowTitle, isOpen && styles.supportCardRowTitleActive]}>
                    {topic.title}
                  </Text>
                  <Feather
                    name={isOpen ? 'chevron-up' : 'chevron-right'}
                    size={16}
                    color={isOpen ? Colors.needleGreen : Colors.midGrey}
                  />
                </TouchableOpacity>
                {isOpen ? (
                  <View style={[styles.supportExpandBody, isLast && styles.supportExpandBodyLast]}>
                    <Text style={styles.supportExpandText}>{topic.body}</Text>
                    <View style={styles.supportTopicChecks}>
                      {topic.details.map((detail) => (
                        <View key={detail} style={styles.supportTopicCheckRow}>
                          <Feather name="check-circle" size={14} color={Colors.needleGreen} />
                          <Text style={styles.supportTopicCheckText}>{detail}</Text>
                        </View>
                      ))}
                    </View>
                    <TouchableOpacity style={styles.supportTopicCta} onPress={topic.onPrimary} activeOpacity={0.82}>
                      <Text style={styles.supportTopicCtaText}>{topic.primaryLabel}</Text>
                      <Feather name="arrow-right" size={15} color={Colors.textInverse} />
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            )
          })}
        </View>
      </View>

      <View style={styles.supportGroup}>
        <Text style={styles.supportGroupLabel}>Get in touch</Text>
        <TouchableOpacity
          style={styles.contactPrimary}
          activeOpacity={0.82}
          onPress={() => { void openSupportEmail() }}
        >
          <View style={styles.contactPrimaryIcon}>
            <Feather name="mail" size={20} color={Colors.textInverse} />
          </View>
          <View style={styles.contactCopy}>
            <Text style={styles.contactPrimaryTitle}>Email support</Text>
            <Text style={styles.contactPrimarySub}>Usually within a few hours</Text>
          </View>
          <Feather name="arrow-right" size={18} color={Colors.textInverse} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.contactSecondary}
          activeOpacity={0.82}
          onPress={() => { void openSupportWhatsApp() }}
        >
          <View style={styles.contactSecondaryIcon}>
            <Feather name="message-circle" size={20} color={Colors.needleGreen} />
          </View>
          <View style={styles.contactCopy}>
            <Text style={styles.contactSecondaryTitle}>WhatsApp</Text>
            <Text style={styles.contactSecondarySub}>Fastest for quick help</Text>
          </View>
          <Feather name="arrow-right" size={18} color={Colors.needleGreen} />
        </TouchableOpacity>
      </View>
    </ScrollView>
  )
}

function groupConversationsByTailor(items: ConversationItem[]): ConversationGroup[] {
  const groups = new Map<string, ConversationItem[]>()
  for (const item of items) {
    const key = item.tailorName || 'Tailor'
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return Array.from(groups.entries())
    .map(([tailorName, threads]) => ({ tailorName, threads }))
    .sort((a, b) => {
      const aUnread = a.threads.reduce((sum, thread) => sum + thread.unreadCount, 0)
      const bUnread = b.threads.reduce((sum, thread) => sum + thread.unreadCount, 0)
      if (aUnread > 0 && bUnread === 0) return -1
      if (bUnread > 0 && aUnread === 0) return 1
      const aLatest = Math.max(
        ...a.threads.map((thread) => new Date(thread.lastMessageAt ?? thread.createdAt).getTime())
      )
      const bLatest = Math.max(
        ...b.threads.map((thread) => new Date(thread.lastMessageAt ?? thread.createdAt).getTime())
      )
      return bLatest - aLatest
    })
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

  filterTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.boneDeep,
    borderRadius: Radius.lg,
    padding: 4,
    gap: 4,
  },
  filterTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: Radius.md,
    backgroundColor: Colors.boneDeep,
    minHeight: 44,
    justifyContent: 'center',
  },
  filterTabActive: { backgroundColor: Colors.needleGreen },
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

  listContent: { paddingBottom: Spacing.xxxl },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
    backgroundColor: Colors.white,
    gap: 12,
  },
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
  supportHeader: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  supportHeaderIcon: {
    width: 54,
    height: 54,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportHeaderTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
  },
  supportHeaderSub: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
    textAlign: 'center',
  },
  supportGroup: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  supportGroupLabel: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  supportCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  supportCardRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
  },
  supportCardRowLast: { borderBottomWidth: 0 },
  supportCardRowTitle: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
    lineHeight: 20,
  },
  supportCardRowTitleActive: { color: Colors.needleGreen },
  supportExpandBody: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
  },
  supportExpandBodyLast: { borderBottomWidth: 0 },
  supportExpandText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
  supportExpandAction: {
    alignSelf: 'flex-start',
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  supportExpandActionText: {
    fontSize: FontSize.sm,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  supportTopicRowIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportTopicChecks: { gap: Spacing.xs },
  supportTopicCheckRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    alignItems: 'flex-start',
  },
  supportTopicCheckText: {
    flex: 1,
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 18,
  },
  supportTopicCta: {
    minHeight: 44,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  supportTopicCtaText: {
    fontSize: FontSize.sm,
    color: Colors.textInverse,
    fontWeight: FontWeight.semibold,
  },
  contactPrimary: {
    minHeight: 72,
    borderRadius: Radius.lg,
    backgroundColor: Colors.needleGreen,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    ...Shadow.sm,
  },
  contactPrimaryIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactCopy: { flex: 1, gap: 3 },
  contactPrimaryTitle: {
    fontSize: FontSize.md,
    color: Colors.textInverse,
    fontWeight: FontWeight.bold,
  },
  contactPrimarySub: {
    fontSize: FontSize.xs,
    color: Colors.textInverse,
    opacity: 0.86,
  },
  contactSecondary: {
    minHeight: 68,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  contactSecondaryIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactSecondaryTitle: {
    fontSize: FontSize.md,
    color: Colors.ink,
    fontWeight: FontWeight.bold,
  },
  contactSecondarySub: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
  },
})
