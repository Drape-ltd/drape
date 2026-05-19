import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Modal, ActivityIndicator, Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { inviteCustomerFromTailor, shareTailorProfile } from '@/lib/invite'
import { tailorOrderHint, tailorOrderStageLabel } from '@/lib/order-flow'
import { deriveTailorReadiness } from '@/lib/tailor-readiness'
import { loadPayoutAccountStatus, type TailorPayoutStatus } from '@/lib/payout-setup'
import { formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'
import { useRefreshOnFocus, useTailorDashboard } from '@/lib/queries'
import type { TailorStockAlert } from '@/lib/ready-made-stock'
import { DRAPE_VISION_ROUTE, type DrapeVisionMode } from '@/constants/drapeVision'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
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
const DASHBOARD_GUIDE_KEY = 'drape_tailor_dashboard_best_use_dismissed'

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
  const { user, signOut } = useAuth()
  const [refreshing, setRefreshing] = useState(false)
  const [availModal, setAvailModal] = useState(false)
  const [availSaving, setAvailSaving] = useState(false)
  const [showGuide, setShowGuide] = useState(true)
  const [payoutStatus, setPayoutStatus] = useState<TailorPayoutStatus | null>(null)
  const [payoutStatusLoading, setPayoutStatusLoading] = useState(true)
  const [payoutStatusError, setPayoutStatusError] = useState('')
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
  const monthCurrencyReviewHint = stats ? monthEarningsReviewHint(stats) : null
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

  useEffect(() => {
    AsyncStorage.getItem(DASHBOARD_GUIDE_KEY)
      .then((value) => {
        if (value === '1') setShowGuide(false)
      })
      .catch(() => {})
  }, [])

  async function loadPayoutSummary() {
    if (!user?.id) {
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
  }

  useEffect(() => {
    void loadPayoutSummary()
  }, [user?.id])

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  })()

  function openDrapeVision(mode: Extract<DrapeVisionMode, 'tailor_client_scan' | 'garment_qc' | 'size_guide_scan'>) {
    router.push({
      pathname: DRAPE_VISION_ROUTE,
      params: { mode, returnTo: '/(tailor)' },
    } as never)
  }

  useRefreshOnFocus(() => {
    void refetch()
    void loadPayoutSummary()
  })

  async function onRefresh() {
    setRefreshing(true)
    await Promise.all([refetch(), loadPayoutSummary()])
    setRefreshing(false)
  }

  async function dismissGuide() {
    setShowGuide(false)
    try {
      await AsyncStorage.setItem(DASHBOARD_GUIDE_KEY, '1')
    } catch {}
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
              <Text style={styles.stateGuideTitle}>Best recovery move</Text>
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
        {showGuide ? (
          <View style={styles.guideCard}>
            <View style={styles.guideHeader}>
              <Text style={styles.guideEyebrow}>Best use</Text>
              <TouchableOpacity onPress={() => { void dismissGuide() }} hitSlop={8}>
                <Text style={styles.guideClose}>×</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.guideTitle}>Check quotes first, then anything waiting on your reply or update.</Text>
          </View>
        ) : null}

        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>{greeting}</Text>
            <Text style={styles.greetingName}>{stats?.displayName?.split(' ')[0] ?? '…'}</Text>
          </View>
          <View style={styles.headerRight}>
            {stats && (
              <TouchableOpacity style={styles.availPill} onPress={() => setAvailModal(true)}>
                <View style={[styles.availDot, { backgroundColor: availColor }]} />
                <Text style={styles.availLabel}>
                  {stats.availability === 'OPEN' ? 'Open' : stats.availability === 'LIMITED' ? 'Limited' : 'Fully booked'}
                </Text>
              </TouchableOpacity>
            )}
            {stats && <LiveStatusBadge isLive={stats.isLive} idStatus={stats.idVerificationStatus} />}
          </View>
        </View>

        {stats ? (
          <View
            style={[
              styles.readinessCard,
              readiness.tone === 'success'
                ? styles.readinessCardSuccess
                : readiness.tone === 'warning'
                  ? styles.readinessCardWarning
                  : null,
            ]}
          >
            <Text style={styles.readinessTitle}>{readiness.title}</Text>
            <Text style={styles.readinessBody}>{readiness.body}</Text>
            {readiness.payoutProviderLabel ? (
              <Text style={styles.readinessMeta}>Payout path detected: {readiness.payoutProviderLabel}</Text>
            ) : null}
            {!readiness.payoutReady && readiness.identityVerified ? (
              <TouchableOpacity style={styles.readinessLink} onPress={() => router.push({ pathname: '/(tailor)/profile/payout-setup', params: { returnTo: '/(tailor)' } } as never)}>
                <Text style={styles.readinessLinkText}>{readiness.actionLabel ?? 'Set up payout account'}</Text>
              </TouchableOpacity>
            ) : readiness.actionLabel === 'Review live profile' ? (
              <TouchableOpacity style={styles.readinessLink} onPress={() => router.push('/(tailor)/profile/edit')}>
                <Text style={styles.readinessLinkText}>Review live profile</Text>
              </TouchableOpacity>
            ) : readiness.actionLabel ? (
              <TouchableOpacity style={styles.readinessLink} onPress={() => router.push('/(tailor)/profile/setup')}>
                <Text style={styles.readinessLinkText}>{readiness.actionLabel}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.readinessSecondaryLink} onPress={() => router.push('/(tailor)/profile/trust-access' as never)}>
              <Text style={styles.readinessSecondaryLinkText}>See trust & access</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {stats ? (
          <PayoutSummaryCard
            stats={stats}
            status={payoutStatus}
            loading={payoutStatusLoading}
            error={payoutStatusError}
            onPress={() => router.push({ pathname: '/(tailor)/profile/payout-setup', params: { returnTo: '/(tailor)' } } as never)}
          />
        ) : null}

        <View style={styles.visionPanel}>
          <View style={styles.visionPanelHeader}>
            <View style={styles.visionPanelIcon}>
              <Feather name="aperture" size={18} color={PRIMARY_GREEN} />
            </View>
            <View style={styles.visionPanelCopy}>
              <Text style={styles.visionPanelTitle}>Drape Vision</Text>
              <Text style={styles.visionPanelText}>Client scans, garment QC, and ready-made size guides stay close to your daily workflow.</Text>
            </View>
          </View>
          <View style={styles.visionActionRow}>
            <TouchableOpacity style={styles.visionAction} onPress={() => openDrapeVision('tailor_client_scan')}>
              <Feather name="user-check" size={15} color={PRIMARY_GREEN} />
              <Text style={styles.visionActionText}>Scan client</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.visionAction} onPress={() => openDrapeVision('garment_qc')}>
              <Feather name="shield" size={15} color={PRIMARY_GREEN} />
              <Text style={styles.visionActionText}>QC garment</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Availability modal */}
        <Modal visible={availModal} transparent animationType="slide" onRequestClose={() => setAvailModal(false)}>
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setAvailModal(false)}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Your availability</Text>
              <Text style={styles.modalSub}>This controls whether customers can book new orders with you.</Text>
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
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Pending quote alert */}
        {(stats?.pendingQuotes ?? 0) > 0 && (
          <TouchableOpacity
            style={styles.alertCard}
            onPress={() => router.navigate('/(tailor)/orders')}
          >
            <View style={styles.alertDot} />
            <Text style={styles.alertText}>
              {stats!.pendingQuotes} order{stats!.pendingQuotes > 1 ? 's' : ''} waiting for your quote
            </Text>
            <Text style={styles.alertCta}>Review →</Text>
          </TouchableOpacity>
        )}

        {(stats?.itemInquiries ?? 0) > 0 && (
          <TouchableOpacity
            style={styles.alertCard}
            onPress={() => router.navigate('/(tailor)/orders')}
          >
            <View style={styles.alertDot} />
            <Text style={styles.alertText}>
              {stats!.itemInquiries} ready-made inquir{stats!.itemInquiries > 1 ? 'ies' : 'y'} waiting for your reply
            </Text>
            <Text style={styles.alertCta}>Reply →</Text>
          </TouchableOpacity>
        )}

        {stockAlerts.length > 0 && (
          <TouchableOpacity style={styles.stockWatchCard} onPress={() => router.push('/(tailor)/shop')}>
            <View style={styles.stockWatchHeader}>
              <Text style={styles.stockWatchEyebrow}>Stock watch</Text>
              <Text style={styles.stockWatchLink}>Open shop →</Text>
            </View>
            {stockAlerts.map((alert) => (
              <View key={alert.itemId} style={styles.stockWatchRow}>
                <View
                  style={[
                    styles.stockWatchDot,
                    alert.severity === 'sold_out' ? styles.stockWatchDotCritical : styles.stockWatchDotWarning,
                  ]}
                />
                <View style={styles.stockWatchTextWrap}>
                  <Text style={styles.stockWatchTitle}>{alert.headline}</Text>
                  <Text style={styles.stockWatchDetail}>{alert.detail}</Text>
                </View>
              </View>
            ))}
          </TouchableOpacity>
        )}

        {/* Stats grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statsRow}>
            <TouchableOpacity onPress={() => router.push('/(tailor)/orders?tab=active' as never)} style={{ flex: 1 }}>
              <StatCard label="Active orders" value={String(stats?.activeOrders ?? 0)} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/(tailor)/orders?tab=active' as never)} style={{ flex: 1 }}>
              <StatCard
                label={(stats?.pendingQuotes ?? 0) > 0 ? 'Awaiting quote' : 'Item inquiries'}
                value={String((stats?.pendingQuotes ?? 0) > 0 ? (stats?.pendingQuotes ?? 0) : (stats?.itemInquiries ?? 0))}
                accent={((stats?.pendingQuotes ?? 0) > 0 ? (stats?.pendingQuotes ?? 0) : (stats?.itemInquiries ?? 0)) > 0}
              />
            </TouchableOpacity>
          </View>
          <View style={styles.statsRow}>
            <TouchableOpacity onPress={() => router.navigate('/(tailor)/earnings')} style={{ flex: 1 }}>
              <StatCard
                label={monthCurrencyReviewHint ? `This month (${dashboardCurrency})` : 'This month'}
                value={formatAmount(
                  stats?.monthEarnings ?? 0,
                  dashboardCurrency,
                  dashboardCurrency,
                  STATIC_FALLBACK_RATES
                )}
                hint={monthCurrencyReviewHint ?? undefined}
              />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/(tailor)/profile/reviews' as never)} style={{ flex: 1 }}>
              <StatCard
                label="Rating"
                value={stats?.avgRating ? `${stats.avgRating.toFixed(1)} ★` : 'No rating'}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Active orders list */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Active orders</Text>
            <TouchableOpacity onPress={() => router.navigate('/(tailor)/orders')}>
              <Text style={styles.sectionLink}>See all →</Text>
            </TouchableOpacity>
          </View>

          {orders.length === 0 ? (
            <View style={styles.emptyOrders}>
              <View style={styles.emptyOrdersBadge}>
                <Text style={styles.emptyOrdersBadgeText}>Order book</Text>
              </View>
              <Text style={styles.emptyText}>No active orders yet</Text>
              {stats?.completedOrders ? (
                <Text style={styles.emptyHint}>You’re caught up. Finished work still lives in Orders and Earnings.</Text>
              ) : stats?.isLive ? (
                <>
                  <Text style={styles.emptyHint}>Share your profile to attract your first clients.</Text>
                  {stats.profileId && (
                    <View style={styles.emptyActions}>
                      <TouchableOpacity style={styles.shareBtn} onPress={() => shareTailorProfile(stats.profileId!, stats.displayName)}>
                        <Text style={styles.shareBtnText}>Share my profile</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.shareBtn, styles.shareBtnSecondary]}
                        onPress={() => inviteCustomerFromTailor(stats.profileId!, stats.displayName)}
                      >
                        <Text style={[styles.shareBtnText, styles.shareBtnTextSecondary]}>Invite a customer</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              ) : !readiness.payoutReady && readiness.identityVerified ? (
                <>
                  <Text style={styles.emptyHint}>{readiness.body}</Text>
                  <TouchableOpacity style={styles.shareBtn} onPress={() => router.push({ pathname: '/(tailor)/profile/payout-setup', params: { returnTo: '/(tailor)' } } as never)}>
                    <Text style={styles.shareBtnText}>{readiness.actionLabel ?? 'Set up payout account'}</Text>
                  </TouchableOpacity>
                </>
              ) : stats?.idVerificationStatus === 'PENDING' ? (
                <Text style={styles.emptyHint}>Your profile is under review. You'll start receiving orders once verified.</Text>
              ) : stats?.idVerificationStatus === 'REJECTED' ? (
                <>
                  <Text style={styles.emptyHint}>Your verification was declined. Update your ID to go live.</Text>
                  <TouchableOpacity style={styles.shareBtn} onPress={() => router.navigate('/(tailor)/profile/setup')}>
                    <Text style={styles.shareBtnText}>Resubmit verification</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.emptyHint}>Complete your profile and go live to start receiving orders.</Text>
                  <TouchableOpacity style={styles.shareBtn} onPress={() => router.navigate('/(tailor)/profile/setup')}>
                    <Text style={styles.shareBtnText}>Complete profile</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          ) : (
            orders.slice(0, 5).map((order) => (
              <TouchableOpacity
                key={order.id}
                style={styles.orderRow}
                onPress={() => router.push({
                  pathname: '/(tailor)/orders/[id]',
                  params: { id: order.id, returnTo: '/(tailor)' },
                })}
              >
                <View style={styles.orderRowLeft}>
                  <Text style={styles.orderGarment}>{order.garmentType}</Text>
                  <Text style={styles.orderCustomer}>{order.customerName}</Text>
                  {tailorOrderHint(order.stage, order.orderKind) && (
                    <Text style={styles.orderHint}>{tailorOrderHint(order.stage, order.orderKind)}</Text>
                  )}
                </View>
                <View style={styles.orderRowRight}>
                  <View style={[styles.stagePill, { backgroundColor: stageColor(order.stage).bg }]}>
                    <Text style={[styles.stageText, { color: stageColor(order.stage).text }]}>
                      {tailorOrderStageLabel(order.stage, order.orderKind)}
                    </Text>
                  </View>
                  {order.estimatedDate && (
                    <Text style={styles.orderDue}>
                      Due {new Date(order.estimatedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
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

function StatCard({ label, value, accent, hint }: { label: string; value: string; accent?: boolean; hint?: string }) {
  return (
    <View style={[styles.statCard, accent && styles.statCardAccent]}>
      <Text style={[styles.statValue, accent && styles.statValueAccent]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
    </View>
  )
}

function monthEarningsReviewHint(stats: DashboardStats) {
  const displayCurrency = stats.currency.toUpperCase()
  const otherCurrencies = (stats.monthEarningsByCurrency ?? [])
    .filter((row) => row.amount > 0 && row.currency.toUpperCase() !== displayCurrency)

  if (otherCurrencies.length === 0) return null

  const amounts = otherCurrencies
    .map((row) =>
      formatAmount(
        row.amount,
        row.currency as CurrencyCode,
        row.currency as CurrencyCode,
        STATIC_FALLBACK_RATES,
      ),
    )
    .join(' + ')

  return `Also ${amounts} under currency review`
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

function PayoutSummaryCard({
  stats,
  status,
  loading,
  error,
  onPress,
}: {
  stats: DashboardStats
  status: TailorPayoutStatus | null
  loading: boolean
  error: string
  onPress: () => void
}) {
  const summary = payoutSummary(stats, status, loading, error)
  const payoutCurrency = status?.payoutCurrency ?? stats.payoutCurrency
  return (
    <TouchableOpacity
      style={[
        styles.payoutSummaryCard,
        summary.tone === 'verified'
          ? styles.payoutSummaryVerified
          : summary.tone === 'review'
            ? styles.payoutSummaryReview
            : styles.payoutSummarySetup,
      ]}
      onPress={onPress}
      activeOpacity={0.78}
    >
      <View style={styles.payoutSummaryHeader}>
        <View style={[styles.payoutStatusBadge, summary.badgeStyle]}>
          <Text style={[styles.payoutStatusBadgeText, summary.badgeTextStyle]}>{summary.badge}</Text>
        </View>
        <Text style={styles.payoutSummaryCta}>{summary.cta} →</Text>
      </View>
      <View style={styles.payoutSummaryBody}>
        <View style={styles.payoutSummaryIcon}>
          <Text style={styles.payoutSummaryIconText}>{payoutCurrency ?? 'PAY'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.payoutSummaryTitle}>{summary.title}</Text>
          <Text style={styles.payoutSummaryDetail}>{summary.detail}</Text>
          <Text style={styles.payoutSummaryMeta}>
            {[payoutCurrency, payoutProviderName(stats, status)].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  )
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
  content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.md, paddingBottom: Spacing.xxl },
  heroCard: {
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
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 12,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  guideHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  guideEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: PRIMARY_GREEN,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  guideClose: { fontSize: 18, lineHeight: 18, color: MUTED_GREY, paddingHorizontal: 4, minWidth: 44, minHeight: 44, textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false },
  guideTitle: { fontSize: 13, fontWeight: FontWeight.semibold, color: CHARCOAL, lineHeight: 17 },
  guideText: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  readinessCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 12,
    gap: 5,
    ...Shadow.sm,
  },
  readinessCardWarning: { borderWidth: 1, borderColor: Colors.warning + '35' },
  readinessCardSuccess: { borderWidth: 1, borderColor: Colors.success + '30' },
  readinessTitle: { fontSize: 14, fontWeight: FontWeight.semibold, color: CHARCOAL, lineHeight: 18, fontFamily: 'Georgia' },
  readinessBody: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  readinessMeta: { fontSize: 11, color: MUTED_GREY, lineHeight: 16 },
  readinessLink: { alignSelf: 'flex-start', paddingTop: 2 },
  readinessLinkText: { fontSize: 13, color: PRIMARY_GREEN, fontWeight: FontWeight.medium },
  readinessSecondaryLink: { alignSelf: 'flex-start' },
  readinessSecondaryLinkText: { fontSize: 11, color: MUTED_GREY, fontWeight: FontWeight.medium },
  payoutSummaryCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    ...Shadow.sm,
  },
  payoutSummaryVerified: {
    borderColor: Colors.success + '35',
  },
  payoutSummaryReview: {
    borderColor: Colors.error + '40',
  },
  payoutSummarySetup: {
    borderColor: Colors.warning + '35',
  },
  payoutSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  payoutStatusBadge: {
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minHeight: 26,
    justifyContent: 'center',
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
  payoutSummaryCta: {
    fontSize: 12,
    color: PRIMARY_GREEN,
    fontWeight: FontWeight.semibold,
  },
  payoutSummaryBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  payoutSummaryIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.boneDeep,
  },
  payoutSummaryIconText: {
    fontSize: 11,
    color: PRIMARY_GREEN,
    fontWeight: FontWeight.bold,
  },
  payoutSummaryTitle: {
    fontSize: 15,
    color: CHARCOAL,
    fontWeight: FontWeight.semibold,
    lineHeight: 19,
  },
  payoutSummaryDetail: {
    marginTop: 2,
    fontSize: 12,
    color: Colors.inkLight,
    lineHeight: 17,
  },
  payoutSummaryMeta: {
    marginTop: 4,
    fontSize: 11,
    color: MUTED_GREY,
    lineHeight: 15,
  },
  visionPanel: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 12,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '30',
    ...Shadow.sm,
  },
  visionPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  visionPanelIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  visionPanelCopy: { flex: 1, gap: 2 },
  visionPanelTitle: { fontSize: 14, fontWeight: FontWeight.semibold, color: CHARCOAL, fontFamily: 'Georgia' },
  visionPanelText: { fontSize: 12, color: Colors.inkLight, lineHeight: 17 },
  visionActionRow: { flexDirection: 'row', gap: Spacing.sm },
  visionAction: {
    flex: 1,
    minHeight: 44,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  visionActionText: { fontSize: 12, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.md },
  headerRight: { alignItems: 'flex-end', gap: 8 },
  greeting: { fontSize: 13, color: Colors.inkLight },
  greetingName: { fontSize: 24, fontWeight: FontWeight.bold, color: CHARCOAL, letterSpacing: -0.3, lineHeight: 28, fontFamily: 'Georgia' },

  availPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.white, borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 4, minHeight: 40, ...Shadow.sm,
  },
  availDot: { width: 7, height: 7, borderRadius: 4 },
  availLabel: { fontSize: 12, fontWeight: FontWeight.medium, color: Colors.inkLight },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.white, borderTopLeftRadius: Radius.md, borderTopRightRadius: Radius.md,
    padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.xxl,
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.lightGrey,
    alignSelf: 'center', marginBottom: Spacing.sm,
  },
  modalTitle: { fontSize: 18, fontWeight: FontWeight.bold, color: CHARCOAL, fontFamily: 'Georgia' },
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

  alertCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.warning + '15',
    borderRadius: Radius.md, padding: 14, minHeight: 44,
    borderWidth: 1, borderColor: Colors.warning + '40',
  },
  alertDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.warning, marginTop: 1 },
  alertText: { flex: 1, fontSize: 13, fontWeight: FontWeight.medium, color: CHARCOAL, lineHeight: 18 },
  alertCta: { fontSize: 13, fontWeight: FontWeight.semibold, color: Colors.warning },
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

  statsGrid: { gap: 8 },
  statsRow: { flexDirection: 'row', gap: 8 },
  statCard: {
    flex: 1, backgroundColor: Colors.white,
    borderRadius: Radius.md, padding: 12, gap: 2, ...Shadow.sm,
    minHeight: 84,
    justifyContent: 'center',
  },
  statCardAccent: { backgroundColor: Colors.warning + '15', borderWidth: 1, borderColor: Colors.warning + '40' },
  statValue: { fontSize: 20, fontWeight: FontWeight.bold, color: CHARCOAL, fontFamily: 'Georgia' },
  statValueAccent: { color: Colors.warning },
  statLabel: { fontSize: 11, color: MUTED_GREY, lineHeight: 15 },
  statHint: {
    marginTop: 4,
    fontSize: 10,
    color: Colors.warning,
    lineHeight: 14,
  },

  section: { gap: 8 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: FontWeight.semibold, color: CHARCOAL, fontFamily: 'Georgia' },
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
