import { useCallback, useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Modal, ActivityIndicator, Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { tailorOrderHint, tailorOrderStageLabel } from '@/lib/order-flow'
import { deriveTailorReadiness } from '@/lib/tailor-readiness'
import { loadPayoutAccountStatus, type TailorPayoutStatus } from '@/lib/payout-setup'
import { formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'
import { useRefreshOnFocus, useTailorDashboard } from '@/lib/queries'
import { getTimeOfDayGreeting } from '@/lib/time-of-day'
import type { TailorStockAlert } from '@/lib/ready-made-stock'
import { DRAPE_VISION_ROUTE, type DrapeVisionMode } from '@/constants/drapeVision'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import type { OrderStage } from '@drape/shared/order-machine'
import { MANUAL_BANK_ENTRY_NOTE } from '@drape/shared/payout-setup'
import { stageColor } from '@/lib/stageColors'

const HOME_BG = Colors.bone
const PRIMARY_GREEN = Colors.needleGreen
const CHARCOAL = Colors.ink
const MUTED_GREY = Colors.midGrey

type Availability = 'OPEN' | 'LIMITED' | 'FULLY_BOOKED'
const AVAIL_OPTIONS: { value: Availability; label: string; desc: string; color: string }[] = [
  { value: 'OPEN', label: 'Open for orders', desc: 'Customers can find and book you normally.', color: Colors.success },
  { value: 'LIMITED', label: 'Limited availability', desc: 'You appear in search but with a notice. Take on select orders only.', color: Colors.warning },
  { value: 'FULLY_BOOKED', label: 'Fully booked', desc: 'Hidden from new bookings. Existing orders are unaffected.', color: Colors.error },
]
type DashboardStats = {
  activeOrders: number
  pendingQuotes: number
  itemInquiries: number
  completedOrders: number
  monthEarnings: number
  monthEarningsByCurrency: Array<{ currency: string; amount: number }>
  avgRating: number
  tier: string | null
  displayName: string
  availability: Availability
  currency: string
  isLive: boolean
  idVerificationStatus: string
  profileId: string | null
  profileCompleted: boolean
  stripeAccountId: string | null
  paystackAccountId: string | null
  payoutCurrency: string | null
  payoutProvider: 'PAYSTACK' | 'STRIPE' | null
  payoutReverificationRequired: boolean | null
  payoutAccountVerified: boolean | null
  payoutAccountType: 'PAYSTACK' | 'STRIPE_CONNECT' | null
  paystackRecipientCode: string | null
  stripeConnectAccountId: string | null
}

type ActiveOrderRow = {
  id: string
  reference: string
  garmentType: string
  orderKind: 'CUSTOM' | 'READY_MADE'
  stage: OrderStage
  customerName: string
  estimatedDate: string | null
  quotedAmount: number | null
}

type StockAlertRow = TailorStockAlert


export default function TailorDashboard() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [refreshing, setRefreshing] = useState(false)
  const [availModal, setAvailModal] = useState(false)
  const [availSaving, setAvailSaving] = useState(false)
  const [payoutStatus, setPayoutStatus] = useState<TailorPayoutStatus | null>(null)
  const [payoutStatusLoading, setPayoutStatusLoading] = useState(true)
  const [payoutStatusError, setPayoutStatusError] = useState('')
  const [timeOfDay, setTimeOfDay] = useState(() => getTimeOfDayGreeting())
  const {
    data: dashboardData,
    isLoading,
    isError,
    refetch,
  } = useTailorDashboard(user?.id, user?.user_metadata?.display_name ?? '')

  const stats = (dashboardData?.stats ?? null) as DashboardStats | null
  const orders = (dashboardData?.orders ?? []) as ActiveOrderRow[]
  const stockAlerts = (dashboardData?.stockAlerts ?? []) as StockAlertRow[]
  const dashboardCurrency = (stats?.currency ?? 'GBP') as CurrencyCode
  const readinessInput = stats && payoutStatus
    ? {
      ...stats,
      payoutCurrency: payoutStatus.payoutCurrency,
      payoutProvider: payoutStatus.payoutProvider,
      payoutReverificationRequired: payoutStatus.payoutReverificationRequired,
      payoutAccountVerified: payoutStatus.payoutAccountVerified,
      payoutAccountType: payoutStatus.payoutAccountType,
      paystackRecipientCode: payoutStatus.paystackRecipientCode,
      stripeConnectAccountId: payoutStatus.stripeConnectAccountId,
    }
    : stats
  const readiness = deriveTailorReadiness(readinessInput)

  const loadPayoutSummary = useCallback(async () => {
    if (!userId) {
      setPayoutStatus(null)
      setPayoutStatusLoading(false)
      return
    }

    setPayoutStatusLoading(true)
    const result = await loadPayoutAccountStatus()
    if (result.error || !result.profile) {
      setPayoutStatus(null)
      setPayoutStatusError(result.error ?? 'Could not load payout status.')
      setPayoutStatusLoading(false)
      return
    }

    setPayoutStatus(result.profile)
    setPayoutStatusError('')
    setPayoutStatusLoading(false)
  }, [userId])

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadPayoutSummary()
    }, 0)
    return () => clearTimeout(timer)
  }, [loadPayoutSummary])

  useEffect(() => {
    const updateGreeting = () => setTimeOfDay(getTimeOfDayGreeting())
    updateGreeting()
    const timer = setInterval(updateGreeting, 60_000)
    return () => clearInterval(timer)
  }, [])

  function openDrapeVision(mode: Extract<DrapeVisionMode, 'tailor_client_scan' | 'garment_qc' | 'size_guide_scan'>) {
    router.push({
      pathname: DRAPE_VISION_ROUTE,
      params: { mode, returnTo: '/(tailor)' },
    } as never)
  }

  useRefreshOnFocus(() => {
    setTimeOfDay(getTimeOfDayGreeting())
    void refetch()
    void loadPayoutSummary()
  })

  async function onRefresh() {
    setRefreshing(true)
    await Promise.all([refetch(), loadPayoutSummary()])
    setRefreshing(false)
  }

  async function setAvailability(value: Availability) {
    if (!user?.id) return
    setAvailSaving(true)
    const { error } = await supabase
      .from('tailor_profiles')
      .update({ availability: value })
      .eq('user_id', user.id)
    if (error) {
      Alert.alert(
        'Error',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. We could not update your availability yet. Retry when the signal improves.'
          : 'Could not update your availability right now. Please try again in a moment.',
      )
      setAvailSaving(false)
      return
    }
    await refetch()
    setAvailSaving(false)
    setAvailModal(false)
  }

  const availColor = {
    OPEN: Colors.success, LIMITED: Colors.warning, FULLY_BOOKED: Colors.error,
  }[stats?.availability ?? 'OPEN']
  const firstName = stats?.displayName?.split(' ')[0] ?? '…'
  const availabilityTitle = stats?.availability === 'OPEN'
    ? 'Available for orders'
    : stats?.availability === 'LIMITED'
      ? 'Limited availability'
      : 'On a break'
  const availabilityTileHint = stats?.availability === 'OPEN'
    ? 'Customers can book and shop.'
    : stats?.availability === 'LIMITED'
      ? 'Visible with a slower-reply notice.'
      : 'New bookings paused; active orders remain.'
  const pendingWorkCount = (stats?.pendingQuotes ?? 0) + (stats?.itemInquiries ?? 0)
  const payoutSnapshot = stats
    ? payoutSummary(stats, payoutStatus, payoutStatusLoading, payoutStatusError)
    : null
  const payoutTileTitle = payoutSnapshot?.tone === 'verified'
    ? 'Payout ready'
    : payoutSnapshot?.title
  const payoutTileHint = payoutSnapshot?.tone === 'verified'
    ? `${payoutSnapshot.title} · ${payoutSnapshot.detail}`
    : payoutSnapshot?.detail
  const topStockAlert = stockAlerts[0] ?? null
  const highlightedOrder = orders[0] ?? null
  const todayFocus = (() => {
    if ((stats?.pendingQuotes ?? 0) > 0) {
      return {
        tone: 'warning' as const,
        eyebrow: 'Today',
        title: `${stats?.pendingQuotes} quote${stats?.pendingQuotes === 1 ? '' : 's'} waiting`,
        body: 'Send clear pricing or request a consultation before the customer cools off.',
        meta: 'Orders need your reply',
      }
    }
    if ((stats?.itemInquiries ?? 0) > 0) {
      return {
        tone: 'warning' as const,
        eyebrow: 'Today',
        title: `${stats?.itemInquiries} shop ${stats?.itemInquiries === 1 ? 'inquiry' : 'inquiries'}`,
        body: 'Answer fit, pickup, delivery, or stock questions from your shop.',
        meta: 'Messages need your reply',
      }
    }
    if (highlightedOrder) {
      return {
        tone: 'default' as const,
        eyebrow: 'Today',
        title: highlightedOrder.garmentType,
        body: tailorOrderHint(highlightedOrder.stage, highlightedOrder.orderKind) ?? tailorOrderStageLabel(highlightedOrder.stage, highlightedOrder.orderKind),
        meta: `${highlightedOrder.customerName} · #${highlightedOrder.reference}`,
      }
    }
    if (topStockAlert) {
      return {
        tone: topStockAlert.severity === 'sold_out' ? 'warning' as const : 'default' as const,
        eyebrow: 'Today',
        title: topStockAlert.headline,
        body: topStockAlert.detail,
        meta: 'Shop inventory signal',
      }
    }
    return {
      tone: readiness.tone,
      eyebrow: 'Today',
      title: readiness.title,
      body: readiness.body,
      meta: readiness.payoutProviderLabel ? `Payout path: ${readiness.payoutProviderLabel}` : 'No urgent work right now',
    }
  })()
  const primaryActionLabel = (stats?.pendingQuotes ?? 0) > 0
    ? 'Review quotes'
    : (stats?.itemInquiries ?? 0) > 0
      ? 'Reply to inquiries'
      : (stats?.activeOrders ?? 0) > 0
        ? 'Open active orders'
        : topStockAlert
          ? 'Review stock'
          : readiness.actionLabel ?? 'Manage availability'

  function openPrimaryDashboardAction() {
    if ((stats?.pendingQuotes ?? 0) > 0 || (stats?.itemInquiries ?? 0) > 0 || (stats?.activeOrders ?? 0) > 0) {
      router.navigate('/(tailor)/orders')
      return
    }
    if (topStockAlert) {
      router.push('/(tailor)/shop')
      return
    }
    if (!readiness.payoutReady && readiness.identityVerified) {
      router.push({ pathname: '/(tailor)/profile/payout-setup', params: { returnTo: '/(tailor)' } } as never)
      return
    }
    if (readiness.actionLabel === 'Review live profile') {
      router.push('/(tailor)/profile/edit')
      return
    }
    if (readiness.actionLabel) {
      router.push('/(tailor)/profile/setup')
      return
    }
    setAvailModal(true)
  }
  if (isLoading && !dashboardData) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']} testID="tailor-home-screen">
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Tailor dashboard</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading your dashboard…</Text>
            <Text style={styles.stateHint}>
              We’re pulling together orders, reviews, and business activity so you can start from one clear control surface.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (isError && !dashboardData) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']} testID="tailor-home-screen">
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Tailor dashboard</Text>
            <Text style={styles.stateTitle}>Couldn't load your dashboard.</Text>
            <Text style={styles.stateHint}>
              This screen should give you a calm, reliable view of your order book, availability, and next actions.
            </Text>
            <View style={styles.stateGuideCard}>
              <Text style={styles.stateGuideTitle}>Recovery</Text>
              <Text style={styles.stateGuideText}>
                Refresh here first. If the dashboard still does not load, open Orders first, then Profile if needed, so you can keep working while the overview catches up.
              </Text>
            </View>
            <TouchableOpacity style={styles.retryBtn} onPress={() => { void refetch() }}>
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryErrorBtn} onPress={() => router.push('/(tailor)/orders')}>
              <Text style={styles.secondaryErrorBtnText}>Open orders</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryErrorBtn} onPress={() => router.push('/(tailor)/profile')}>
              <Text style={styles.secondaryErrorBtnText}>Open profile</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="tailor-home-screen">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} />}
      >
        {stats ? (
          <View style={styles.cockpitCard}>
            <View style={styles.cockpitTop}>
              <View style={{ flex: 1 }}>
                <View style={styles.greetingRow}>
                  <View style={[styles.greetingIcon, { backgroundColor: timeOfDay.iconBackground }]}>
                    <Feather name={timeOfDay.icon} size={13} color={timeOfDay.iconColor} />
                  </View>
                  <Text style={styles.greeting}>Tailor cockpit</Text>
                </View>
                <Text style={styles.greetingName}>{timeOfDay.label}, {firstName}</Text>
                <Text style={styles.greetingSub} numberOfLines={2}>
                  Orders, shop signals, and payout readiness in one place.
                </Text>
              </View>
              <LiveStatusBadge isLive={stats.isLive} idStatus={stats.idVerificationStatus} />
            </View>

            <View style={styles.cockpitMetrics}>
              <TouchableOpacity style={styles.cockpitMetric} onPress={() => router.navigate('/(tailor)/orders')}>
                <Text style={styles.cockpitMetricValue}>{stats.activeOrders}</Text>
                <Text style={styles.cockpitMetricLabel}>Active</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cockpitMetric} onPress={() => router.navigate('/(tailor)/orders')}>
                <Text style={[styles.cockpitMetricValue, pendingWorkCount > 0 && styles.cockpitMetricValueAlert]}>
                  {pendingWorkCount}
                </Text>
                <Text style={styles.cockpitMetricLabel}>Needs reply</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cockpitMetric} onPress={() => router.navigate('/(tailor)/earnings')}>
                <Text style={styles.cockpitMetricValue}>
                  {formatAmount(stats.monthEarnings ?? 0, dashboardCurrency, dashboardCurrency, STATIC_FALLBACK_RATES)}
                </Text>
                <Text style={styles.cockpitMetricLabel}>This month</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.cockpitStatusGrid}>
              <TouchableOpacity style={styles.cockpitStatusTile} onPress={() => setAvailModal(true)}>
                <View style={styles.cockpitTileHeader}>
                  <View style={[styles.availDot, { backgroundColor: availColor }]} />
                  <Text style={styles.cockpitTileLabel}>Availability</Text>
                </View>
                <Text style={styles.cockpitTileTitle}>{availabilityTitle}</Text>
                <Text style={styles.cockpitTileHint} numberOfLines={2}>{availabilityTileHint}</Text>
              </TouchableOpacity>

              {payoutSnapshot ? (
                <TouchableOpacity
                  style={styles.cockpitStatusTile}
                  onPress={() => router.push({ pathname: '/(tailor)/profile/payout-setup', params: { returnTo: '/(tailor)' } } as never)}
                >
                  <View style={styles.cockpitTileHeader}>
                    <View style={[styles.payoutMiniBadge, payoutSnapshot.badgeStyle]}>
                      <Text style={[styles.payoutMiniBadgeText, payoutSnapshot.badgeTextStyle]}>{payoutSnapshot.badge}</Text>
                    </View>
                  </View>
                  <Text style={styles.cockpitTileTitle}>{payoutTileTitle}</Text>
                  <Text style={styles.cockpitTileHint} numberOfLines={2}>{payoutTileHint}</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <View
              style={[
                styles.nextMoveCard,
                todayFocus.tone === 'warning' && styles.nextMoveCardWarning,
                todayFocus.tone === 'success' && styles.nextMoveCardSuccess,
              ]}
            >
              <View style={styles.nextMoveMain}>
                <View style={styles.nextMoveCopy}>
                  <Text style={styles.nextMoveEyebrow}>{todayFocus.eyebrow}</Text>
                  <Text style={styles.nextMoveTitle} numberOfLines={2}>{todayFocus.title}</Text>
                  <Text style={styles.nextMoveBody} numberOfLines={2}>{todayFocus.body}</Text>
                  <Text style={styles.nextMoveMeta} numberOfLines={1}>{todayFocus.meta}</Text>
                </View>
                <TouchableOpacity style={styles.cockpitPrimaryButton} onPress={openPrimaryDashboardAction}>
                  <Text style={styles.cockpitPrimaryButtonText}>{primaryActionLabel}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.toolRail}>
              <TouchableOpacity style={styles.toolRailItem} onPress={() => openDrapeVision('tailor_client_scan')}>
                <Feather name="user-check" size={15} color={PRIMARY_GREEN} />
                <Text style={styles.toolRailText}>Scan client</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolRailItem} onPress={() => openDrapeVision('garment_qc')}>
                <Feather name="shield" size={15} color={PRIMARY_GREEN} />
                <Text style={styles.toolRailText}>QC garment</Text>
              </TouchableOpacity>
            </View>

            {orders.length > 0 ? (
              <View style={styles.cockpitQueue}>
                <View style={styles.cockpitQueueHeader}>
                  <Text style={styles.cockpitQueueTitle}>Order queue</Text>
                  <TouchableOpacity onPress={() => router.navigate('/(tailor)/orders')}>
                    <Text style={styles.cockpitQueueLink}>See all</Text>
                  </TouchableOpacity>
                </View>
                {orders.slice(0, 2).map((order) => (
                  <TouchableOpacity
                    key={order.id}
                    style={styles.cockpitOrderRow}
                    onPress={() => router.push({
                      pathname: '/(tailor)/orders/[id]',
                      params: { id: order.id, returnTo: '/(tailor)' },
                    })}
                  >
                    <View style={styles.cockpitOrderCopy}>
                      <Text style={styles.cockpitOrderTitle} numberOfLines={1}>{order.garmentType}</Text>
                      <Text style={styles.cockpitOrderMeta} numberOfLines={1}>{order.customerName} · #{order.reference}</Text>
                    </View>
                    <View style={[styles.stagePill, { backgroundColor: stageColor(order.stage).bg }]}>
                      <Text style={[styles.stageText, { color: stageColor(order.stage).text }]}>
                        {tailorOrderStageLabel(order.stage, order.orderKind)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Availability modal */}
        <Modal visible={availModal} transparent animationType="slide" onRequestClose={() => setAvailModal(false)}>
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setAvailModal(false)}>
            <View
              style={[
                styles.modalSheet,
                { paddingBottom: Math.max(insets.bottom + Spacing.lg, Spacing.xl) },
              ]}
              onStartShouldSetResponder={() => true}
            >
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Your availability</Text>
              <Text style={styles.modalSub}>This controls whether customers can book new orders with you.</Text>
              <ScrollView
                style={styles.modalOptions}
                contentContainerStyle={[
                  styles.modalOptionsContent,
                  { paddingBottom: Math.max(insets.bottom + Spacing.xl, Spacing.xxxl) },
                ]}
                showsVerticalScrollIndicator={false}
              >
                {AVAIL_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.availOption,
                      stats?.availability === opt.value && styles.availOptionActive,
                    ]}
                    onPress={() => !availSaving && setAvailability(opt.value)}
                    disabled={availSaving}
                  >
                    <View style={[styles.availOptionDot, { backgroundColor: opt.color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.availOptionLabel}>{opt.label}</Text>
                      <Text style={styles.availOptionDesc}>{opt.desc}</Text>
                    </View>
                    {stats?.availability === opt.value && (
                      <Text style={styles.availCheck}>✓</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>

      </ScrollView>
    </SafeAreaView>
  )
}

const STATUS_BADGE: Record<string, { label: string; color: string; bg: string; dot: boolean }> = {
  LIVE:          { label: 'Live',          color: Colors.success,    bg: Colors.success + '25',  dot: true },
  PENDING:       { label: 'In review',     color: Colors.warning,    bg: Colors.warning + '22',  dot: false },
  REJECTED:      { label: 'Action needed', color: Colors.error,      bg: Colors.error + '18',    dot: false },
  NOT_SUBMITTED: { label: 'Setup needed',  color: Colors.midGrey,    bg: Colors.lightGrey,       dot: false },
}

function LiveStatusBadge({ isLive, idStatus }: { isLive: boolean; idStatus: string }) {
  const key = isLive ? 'LIVE' : (idStatus in STATUS_BADGE ? idStatus : 'NOT_SUBMITTED')
  const cfg = STATUS_BADGE[key]
  return (
    <View style={[styles.availPill, { backgroundColor: cfg.bg }]}>
      {cfg.dot && <View style={[styles.availDot, { backgroundColor: cfg.color }]} />}
      <Text style={[styles.availLabel, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  )
}

function lastFour(value: string | null | undefined) {
  const digits = value?.replace(/\D+/gu, '').slice(-4) ?? ''
  return digits || null
}

function futureDateLabel(value: string | null | undefined) {
  if (!value) return ''
  const time = Date.parse(value)
  if (!Number.isFinite(time) || time <= Date.now()) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(time))
}

function payoutProviderName(stats: DashboardStats, status?: TailorPayoutStatus | null) {
  const accountType = status?.payoutAccountType ?? stats.payoutAccountType
  const provider = status?.payoutProvider ?? stats.payoutProvider
  if (accountType === 'PAYSTACK' || provider === 'PAYSTACK') return 'Paystack'
  if (accountType === 'STRIPE_CONNECT' || provider === 'STRIPE') return 'Stripe Connect'
  return (status?.payoutCurrency ?? stats.payoutCurrency) ? 'Payout setup' : 'Not selected'
}

function payoutSummary(
  stats: DashboardStats,
  status: TailorPayoutStatus | null,
  loading: boolean,
  error: string,
) {
  const verified = status?.payoutAccountVerified ?? stats.payoutAccountVerified
  const needsReview = status?.payoutReverificationRequired ?? stats.payoutReverificationRequired
  const bankName = status?.payoutBankName ?? null
  const maskedAccount = status?.payoutAccountMasked ?? null
  const holdUntil = futureDateLabel(status?.payoutDestinationHoldUntil)
  const hasSavedDetails =
    !!bankName
    || !!maskedAccount
    || status?.manualBankEntry === true
    || !!stats.paystackRecipientCode
    || !!stats.stripeConnectAccountId
    || !!stats.paystackAccountId
    || !!stats.stripeAccountId
  const last4 = lastFour(maskedAccount)

  if (loading && !status && verified !== true && !hasSavedDetails) {
    return {
      badge: 'Checking',
      badgeStyle: styles.payoutBadgeSetup,
      badgeTextStyle: styles.payoutBadgeTextSetup,
      title: 'Checking payout status',
      detail: 'We are confirming whether your payout account is ready.',
      cta: 'Open payout',
      tone: 'setup' as const,
    }
  }

  if (!status && error) {
    return {
      badge: 'Not set up',
      badgeStyle: styles.payoutBadgeSetup,
      badgeTextStyle: styles.payoutBadgeTextSetup,
      title: 'Payout status unavailable',
      detail: 'Open payout setup to refresh your account status.',
      cta: 'Open payout',
      tone: 'setup' as const,
    }
  }

  if (verified === true && needsReview !== true && holdUntil) {
    return {
      badge: 'Guarded',
      badgeStyle: styles.payoutBadgeReview,
      badgeTextStyle: styles.payoutBadgeTextReview,
      title: bankName ?? payoutProviderName(stats, status),
      detail: `Verified. Payout releases resume after ${holdUntil}.`,
      cta: 'Manage payout',
      tone: 'review' as const,
    }
  }

  if (verified === true && needsReview !== true) {
    return {
      badge: 'Verified',
      badgeStyle: styles.payoutBadgeVerified,
      badgeTextStyle: styles.payoutBadgeTextVerified,
      title: bankName ?? payoutProviderName(stats, status),
      detail: last4 ? `Account ending ${last4}` : 'Payout account verified',
      cta: 'Manage payout',
      tone: 'verified' as const,
    }
  }

  if (needsReview === true || hasSavedDetails) {
    return {
      badge: 'Reverification needed',
      badgeStyle: styles.payoutBadgeReview,
      badgeTextStyle: styles.payoutBadgeTextReview,
      title: bankName ?? payoutProviderName(stats, status),
      detail: bankName && maskedAccount
        ? `${bankName} · ${maskedAccount}`
        : MANUAL_BANK_ENTRY_NOTE,
      cta: 'Review payout',
      tone: 'review' as const,
    }
  }

  return {
    badge: 'Not set up',
    badgeStyle: styles.payoutBadgeSetup,
    badgeTextStyle: styles.payoutBadgeTextSetup,
    title: 'No payout account yet',
    detail: 'Set up payouts before paid orders can release earnings.',
    cta: 'Set up payout',
    tone: 'setup' as const,
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: HOME_BG },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  stateCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    gap: Spacing.md,
    alignItems: 'center',
    ...Shadow.sm,
  },
  stateEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: PRIMARY_GREEN,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  stateTitle: { fontSize: 20, fontWeight: FontWeight.bold, color: CHARCOAL, textAlign: 'center' },
  stateHint: { fontSize: 13, color: Colors.inkLight, textAlign: 'center', lineHeight: 20 },
  stateGuideCard: {
    alignSelf: 'stretch',
    backgroundColor: HOME_BG,
    borderRadius: Radius.md,
    padding: 14,
    gap: 4,
  },
  stateGuideTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: PRIMARY_GREEN,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  stateGuideText: {
    fontSize: 13,
    color: Colors.inkLight,
    textAlign: 'center',
    lineHeight: 18,
  },
  scroll: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.sm,
    paddingBottom: Spacing.xxl,
  },
  cockpitCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 10,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  cockpitTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  cockpitMetrics: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  cockpitMetric: {
    flex: 1,
    minHeight: 58,
    borderRadius: Radius.md,
    backgroundColor: Colors.bone,
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: 'center',
    gap: 1,
  },
  cockpitMetricValue: {
    fontFamily: Fonts.display,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: CHARCOAL,
    lineHeight: 22,
  },
  cockpitMetricValueAlert: { color: Colors.warning },
  cockpitMetricLabel: {
    fontSize: FontSize.xs,
    color: MUTED_GREY,
    lineHeight: 16,
  },
  cockpitStatusGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  cockpitStatusTile: {
    flex: 1,
    minHeight: 88,
    borderRadius: Radius.md,
    backgroundColor: Colors.needleGreenLight,
    padding: 10,
    gap: 3,
  },
  cockpitTileHeader: {
    minHeight: 19,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  cockpitTileLabel: {
    fontSize: FontSize.xs,
    color: Colors.needleGreenDark,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  cockpitTileTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: CHARCOAL,
    lineHeight: 18,
  },
  cockpitTileHint: {
    fontSize: 11,
    color: Colors.inkLight,
    lineHeight: 15,
  },
  payoutMiniBadge: {
    borderRadius: Radius.full,
    paddingHorizontal: 9,
    paddingVertical: 5,
    minHeight: 24,
    justifyContent: 'center',
  },
  payoutMiniBadgeText: {
    fontSize: 10,
    fontWeight: FontWeight.semibold,
  },
  payoutBadgeVerified: {
    backgroundColor: Colors.needleGreenLight,
  },
  payoutBadgeSetup: {
    backgroundColor: Colors.warning + '18',
  },
  payoutBadgeReview: {
    backgroundColor: Colors.errorLight,
  },
  payoutStatusBadgeText: {
    fontSize: 11,
    fontWeight: FontWeight.semibold,
  },
  payoutBadgeTextVerified: {
    color: Colors.needleGreenDark,
  },
  payoutBadgeTextSetup: {
    color: Colors.warning,
  },
  payoutBadgeTextReview: {
    color: Colors.error,
  },
  nextMoveCard: {
    borderRadius: Radius.md,
    padding: 10,
    gap: 6,
    backgroundColor: Colors.bone,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  nextMoveCardWarning: {
    backgroundColor: Colors.warning + '12',
    borderColor: Colors.warning + '30',
  },
  nextMoveCardSuccess: {
    backgroundColor: Colors.needleGreenLight,
    borderColor: Colors.needleGreen + '24',
  },
  nextMoveMain: {
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  nextMoveCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  nextMoveEyebrow: {
    fontSize: FontSize.xs,
    color: PRIMARY_GREEN,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  nextMoveTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: CHARCOAL,
    lineHeight: 18,
  },
  nextMoveBody: {
    fontSize: 11,
    color: Colors.inkLight,
    lineHeight: 15,
  },
  nextMoveMeta: {
    fontSize: 11,
    color: MUTED_GREY,
    lineHeight: 15,
  },
  cockpitPrimaryButton: {
    alignSelf: 'flex-start',
    minWidth: 112,
    maxWidth: 154,
    minHeight: 40,
    borderRadius: Radius.full,
    backgroundColor: PRIMARY_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  cockpitPrimaryButtonText: {
    fontSize: FontSize.sm,
    color: Colors.textInverse,
    fontWeight: FontWeight.semibold,
  },
  trustLink: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 26,
  },
  trustLinkText: {
    fontSize: FontSize.xs,
    color: PRIMARY_GREEN,
    fontWeight: FontWeight.semibold,
  },
  toolRail: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  toolRailItem: {
    flex: 1,
    minHeight: 38,
    borderRadius: Radius.full,
    backgroundColor: Colors.bone,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  toolRailText: { fontSize: 11, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold },
  cockpitQueue: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.lightGrey,
    paddingTop: 9,
    gap: 7,
  },
  cockpitQueueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cockpitQueueTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: PRIMARY_GREEN,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  cockpitQueueLink: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: PRIMARY_GREEN,
  },
  cockpitOrderRow: {
    minHeight: 48,
    borderRadius: Radius.md,
    backgroundColor: Colors.bone,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  cockpitOrderCopy: { flex: 1, minWidth: 0 },
  cockpitOrderTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: CHARCOAL,
    lineHeight: 16,
  },
  cockpitOrderMeta: {
    fontSize: 11,
    color: MUTED_GREY,
    lineHeight: 15,
  },

  greetingRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 2 },
  greetingIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  greeting: { fontSize: 12, color: Colors.inkLight, fontWeight: FontWeight.medium },
  greetingName: { fontSize: 21, fontWeight: FontWeight.bold, color: CHARCOAL, letterSpacing: 0, lineHeight: 25, fontFamily: Fonts.display },
  greetingSub: { marginTop: 2, fontSize: 12, color: Colors.inkLight, lineHeight: 16, maxWidth: 280 },

  availPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.white,
    borderRadius: Radius.full,
    paddingHorizontal: 9,
    paddingVertical: 4,
    minHeight: 30,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  availDot: { width: 7, height: 7, borderRadius: 4 },
  availLabel: { fontSize: 11, fontWeight: FontWeight.medium, color: Colors.inkLight },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.white, borderTopLeftRadius: Radius.md, borderTopRightRadius: Radius.md,
    padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.xl,
    maxHeight: '78%',
  },
  modalOptions: { marginHorizontal: -2 },
  modalOptionsContent: { gap: Spacing.sm, paddingHorizontal: 2, paddingBottom: Spacing.xl },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.lightGrey,
    alignSelf: 'center', marginBottom: Spacing.sm,
  },
  modalTitle: { fontSize: 18, fontWeight: FontWeight.bold, color: CHARCOAL, fontFamily: Fonts.display },
  modalSub: { fontSize: 13, color: Colors.inkLight, marginTop: -4, lineHeight: 18 },
  availOption: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    minHeight: 44,
    padding: 12, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.lightGrey,
  },
  availOptionActive: { borderColor: PRIMARY_GREEN, backgroundColor: Colors.needleGreenLight },
  availOptionDot: { width: 10, height: 10, borderRadius: 5 },
  availOptionLabel: { fontSize: 14, fontWeight: FontWeight.semibold, color: CHARCOAL },
  availOptionDesc: { fontSize: 11, color: MUTED_GREY, marginTop: 2, lineHeight: 15 },
  availCheck: { fontSize: 18, color: PRIMARY_GREEN, fontWeight: FontWeight.bold },

  stockWatchCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.warning + '30',
    ...Shadow.sm,
  },
  stockWatchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  stockWatchEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.warning,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  stockWatchLink: { fontSize: 13, fontWeight: FontWeight.semibold, color: PRIMARY_GREEN },
  stockWatchRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  stockWatchDot: { width: 10, height: 10, borderRadius: Radius.full, marginTop: 5 },
  stockWatchDotWarning: { backgroundColor: Colors.warning },
  stockWatchDotCritical: { backgroundColor: Colors.error },
  stockWatchTextWrap: { flex: 1, gap: 2 },
  stockWatchTitle: { fontSize: 13, fontWeight: FontWeight.semibold, color: CHARCOAL, lineHeight: 17 },
  stockWatchDetail: { fontSize: 12, color: Colors.inkLight, lineHeight: 17 },
  retryBtn: {
    backgroundColor: PRIMARY_GREEN,
    borderRadius: Radius.full,
    paddingVertical: 12,
    paddingHorizontal: Spacing.xxxl,
    minHeight: 44,
    justifyContent: 'center',
  },
  retryBtnText: { color: Colors.textInverse, fontSize: 13, fontWeight: FontWeight.semibold },
  secondaryErrorBtn: {
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingVertical: 12,
    paddingHorizontal: Spacing.xl,
    minHeight: 44,
    justifyContent: 'center',
  },
  secondaryErrorBtnText: { color: CHARCOAL, fontSize: 13, fontWeight: FontWeight.medium },

  section: { gap: 8 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: FontWeight.semibold, color: CHARCOAL, fontFamily: Fonts.display },
  sectionLink: { fontSize: 13, color: PRIMARY_GREEN, fontWeight: FontWeight.medium, minHeight: 44, includeFontPadding: false },

  emptyOrders: { gap: 8, alignItems: 'center', paddingVertical: Spacing.lg },
  emptyOrdersBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  emptyOrdersBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: PRIMARY_GREEN,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  emptyText: { fontSize: 15, fontWeight: FontWeight.semibold, color: CHARCOAL },
  emptyHint: { fontSize: 13, color: MUTED_GREY, textAlign: 'center', lineHeight: 18 },
  emptyActions: {
    marginTop: Spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    justifyContent: 'center',
  },
  shareBtn: {
    backgroundColor: PRIMARY_GREEN,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  shareBtnSecondary: {
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: PRIMARY_GREEN,
  },
  shareBtnText: { fontSize: 13, fontWeight: FontWeight.semibold, color: Colors.textInverse },
  shareBtnTextSecondary: { color: PRIMARY_GREEN },

  orderRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: Colors.white, borderRadius: Radius.md, padding: 12, minHeight: 78, ...Shadow.sm,
  },
  orderRowLeft: { gap: 2 },
  orderGarment: { fontSize: 15, fontWeight: FontWeight.semibold, color: CHARCOAL, lineHeight: 19 },
  orderCustomer: { fontSize: 13, color: Colors.inkLight, lineHeight: 17 },
  orderHint: { fontSize: 12, color: PRIMARY_GREEN, fontWeight: FontWeight.medium, marginTop: 4, lineHeight: 16 },
  orderRowRight: { alignItems: 'flex-end', gap: 4 },
  stagePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full, minHeight: 24, justifyContent: 'center' },
  stageText: { fontSize: 11, fontWeight: FontWeight.semibold },
  orderDue: { fontSize: 11, color: MUTED_GREY },
})
