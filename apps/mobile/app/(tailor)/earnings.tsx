import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Share,
  Modal,
  Pressable,
} from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { appendToHistory, goBackOrFallback, resetTo } from '@/lib/navigation'
import { useAuth } from '@/lib/auth'
import {
  buildTailorTransactionsCsv,
  fetchTailorEarningsDashboard,
  type TailorEarningsDashboardData,
  type TailorPayoutHistoryRecord,
  type TailorTransactionStatus,
} from '@/lib/money-history'
import { formatAmount, type CurrencyCode } from '@/lib/currency'
import { useRefreshOnFocus } from '@/lib/queries'
import { DrapeStatusChip } from '@/components/ui'
import {
  payoutBlockRecovery,
  type PayoutBlockedReason,
} from '@drape/shared'

type StatusFilter = 'ALL' | TailorTransactionStatus
type RangeFilter = 'ALL' | '30D' | '90D' | '365D'

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'AVAILABLE', label: 'Available' },
  { key: 'RELEASED', label: 'Released' },
  { key: 'IN_TRANSIT', label: 'In transit' },
  { key: 'PAID_OUT', label: 'Paid out' },
  { key: 'BLOCKED', label: 'Blocked' },
  { key: 'FAILED', label: 'Failed' },
]

const RANGE_FILTERS: Array<{ key: RangeFilter; label: string }> = [
  { key: '30D', label: '30 days' },
  { key: '90D', label: '90 days' },
  { key: '365D', label: '1 year' },
  { key: 'ALL', label: 'All time' },
]

function money(amount: number, currency: string) {
  return formatAmount(amount, currency as CurrencyCode, currency as CurrencyCode, {})
}

function withinRange(date: string, range: RangeFilter) {
  if (range === 'ALL') return true
  const ms =
    range === '30D'
      ? 30 * 24 * 60 * 60 * 1000
      : range === '90D'
        ? 90 * 24 * 60 * 60 * 1000
        : 365 * 24 * 60 * 60 * 1000
  return Date.parse(date) >= Date.now() - ms
}

function payoutMethodLabel(data: TailorEarningsDashboardData) {
  if (data.payoutProvider === 'PAYSTACK' && data.payoutBankName && data.payoutAccountMasked) {
    return `${data.payoutBankName} · ${data.payoutAccountMasked}`
  }
  if (data.payoutProvider === 'PAYSTACK' && data.payoutBankName) return data.payoutBankName
  if (!data.payoutProvider) return 'Payout account setup pending'
  return data.payoutProvider === 'PAYSTACK' ? 'Verified Paystack account' : 'Verified Stripe Connect account'
}

function payoutReviewMessage(row: TailorPayoutHistoryRecord) {
  if (row.status === 'FAILED' || row.status === 'REVERSED' || row.status === 'CANCELED') {
    return 'Drapeon ops is reviewing this payout. You do not need to change your bank details unless support asks.'
  }

  if (row.blockedReason) return payoutBlockRecovery(row.blockedReason as PayoutBlockedReason).nextStep

  return null
}

function blockedPayoutAction(row: TailorPayoutHistoryRecord) {
  if (!row.blockedReason) return null
  const recovery = payoutBlockRecovery(row.blockedReason as PayoutBlockedReason)
  if (recovery.destination === 'PAYOUT_SETUP') {
    return { label: recovery.ctaLabel, pathname: '/(tailor)/profile/payout-setup' as const }
  }
  if ((recovery.destination === 'ORDER' || recovery.destination === 'OPS_REVIEW') && row.orderId) {
    return { label: recovery.ctaLabel, pathname: '/(tailor)/orders/[id]' as const }
  }
  return null
}

export default function TailorEarningsScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const userId = user?.id
  const [data, setData] = useState<TailorEarningsDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>('ALL')
  const [filterSheet, setFilterSheet] = useState<'status' | 'range' | null>(null)
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    if (!userId) {
      setData(null)
      setLoading(false)
      return
    }

    try {
      const result = await fetchTailorEarningsDashboard(userId)
      setData(result)
      setError(null)
    } catch (fetchError) {
      const diagnostic = fetchError as {
        message?: string
        code?: string
        details?: string
        hint?: string
      }
      console.warn('[tailor-earnings] load failed', {
        message: diagnostic?.message ?? 'Unknown earnings load error',
        code: diagnostic?.code ?? null,
        details: diagnostic?.details ?? null,
        hint: diagnostic?.hint ?? null,
      })
      setError(fetchError instanceof Error ? fetchError.message : 'Could not load earnings.')
    }
  }, [userId])

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true)
      void load().finally(() => setLoading(false))
    }, 0)
    return () => clearTimeout(timer)
  }, [load])

  useRefreshOnFocus(() => {
    void load()
  }, 0)

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  function goBack() {
    goBackOrFallback(router, navigation, '/(tailor)')
  }

  const filteredTransactions = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (data?.transactions ?? []).filter((row) => {
      if (statusFilter !== 'ALL' && row.status !== statusFilter) return false
      if (!withinRange(row.date, rangeFilter)) return false
      if (!needle) return true
      return [
        row.reference,
        row.orderId,
        row.customerFirstName,
        row.title,
      ].some((value) => value.toLowerCase().includes(needle))
    })
  }, [data?.transactions, rangeFilter, search, statusFilter])

  const hasActiveFilters = statusFilter !== 'ALL' || rangeFilter !== 'ALL' || search.trim().length > 0

  function clearFilters() {
    setSearch('')
    setStatusFilter('ALL')
    setRangeFilter('ALL')
  }

  async function exportCsv() {
    if (!filteredTransactions.length || exporting) return

    setExporting(true)
    try {
      const csv = buildTailorTransactionsCsv(filteredTransactions)
      const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory
      if (!baseDir) {
        throw new Error('No writable directory available for CSV export.')
      }
      const fileUri = `${baseDir}drape-earnings-${Date.now()}.csv`
      await FileSystem.writeAsStringAsync(fileUri, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      })
      await Share.share({
        url: fileUri,
        message: `Drapeon earnings export\n${fileUri}`,
      })
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : 'Could not export CSV.')
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Payments & payouts</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading earnings history…</Text>
            <Text style={styles.stateHint}>
              We’re pulling your settled order earnings, protected balances, and payout ledger together.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (!data) {
    const unavailable = Boolean(error)
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Payments & payouts</Text>
            <Text style={styles.stateTitle}>
              {unavailable ? 'Earnings are temporarily unavailable.' : 'Tailor earnings are not available yet.'}
            </Text>
            <Text style={styles.stateHint}>
              {unavailable
                ? 'Your verified payout setup has not changed. Refresh to load the latest order income and payout activity.'
                : 'Complete your tailor profile before taking paid work. Payout setup is managed separately.'}
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => unavailable ? void load() : router.replace('/(tailor)')}
            >
              <Text style={styles.primaryBtnText}>{unavailable ? 'Try again' : 'Back to dashboard'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  const summaryCurrency = data.summaryCurrency ?? data.payoutCurrency
  const showCurrencyReview = data.hasMixedCurrencies || data.hasPayoutCurrencyMismatch

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} />}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Payments & payouts</Text>
          <TouchableOpacity style={styles.exportBtn} onPress={() => void exportCsv()} disabled={exporting || filteredTransactions.length === 0}>
            <Feather name="download" size={16} color={Colors.needleGreen} />
          </TouchableOpacity>
        </View>

        {!data.payoutReady ? (
          <View style={styles.warningCard}>
            <Text style={styles.warningTitle}>
              {data.payoutReverificationRequired ? 'Reconnect your payout account' : 'Payout account still required'}
            </Text>
            <Text style={styles.warningBody}>
              Drapeon will not release earnings until your payout account is verified. Orders can still settle into a protected balance, but withdrawals stay blocked until setup is complete.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push({ pathname: '/(tailor)/profile/payout-setup', params: { returnTo: '/(tailor)/earnings', historyChain: appendToHistory(undefined, '/(tailor)/earnings') } } as never)}>
              <Text style={styles.primaryBtnText}>{data.payoutReverificationRequired ? 'Reconnect payout account' : 'Finish payout setup'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.summaryCard}>
          <Text style={styles.summaryEyebrow}>Eligible order earnings</Text>
          <Text style={styles.summaryValue}>{money(data.availableForPayout, summaryCurrency)}</Text>
          <Text style={styles.summaryHint}>
            {showCurrencyReview
              ? `This summary is shown in the order's locked earning currency, ${summaryCurrency}. Your payout account is set to ${data.payoutCurrency}, so Drapeon will not silently convert it.`
              : 'Eligible for payout now. Each order below shows what the customer paid, deductions, and your net earnings.'}
          </Text>
          <View style={styles.summaryBreakdown}>
            <MoneySummaryLine label="Pending release" value={money(data.pendingEarnings, summaryCurrency)} />
            <MoneySummaryLine label="Order earnings paid" value={money(data.alreadyPaidOut, summaryCurrency)} />
            <MoneySummaryLine label="Total seller allocation" value={money(data.totalEarnings, summaryCurrency)} strong />
          </View>
          <View style={styles.summaryMetaCard}>
            <Text style={styles.summaryMetaLabel}>Payout method</Text>
            <Text style={styles.summaryMetaValue}>{payoutMethodLabel(data)}</Text>
            <Text style={styles.summaryMetaHint}>Current payout route: {data.payoutProvider === 'PAYSTACK' ? 'Paystack' : data.payoutProvider === 'STRIPE' ? 'Stripe Connect' : 'Not configured yet'}</Text>
          </View>
        </View>

        {showCurrencyReview ? (
          <View style={styles.currencyNoticeCard}>
            <Text style={styles.currencyNoticeTitle}>Currency review needed before payout</Text>
            <Text style={styles.currencyNoticeText}>
              Some earnings were paid in a different currency from your payout account. They stay locked to the order currency until ops approves an original-currency payout or a conversion.
            </Text>
            {data.currencySummaries.length > 0 ? (
              <View style={styles.currencyBreakdownList}>
                {data.currencySummaries.map((row) => (
                  <View key={row.currency} style={styles.currencyBreakdownRow}>
                    <Text style={styles.currencyBreakdownLabel}>{row.currency}</Text>
                    <Text style={styles.currencyBreakdownValue}>{money(row.totalEarnings, row.currency)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.controlsCard}>
          <Text style={styles.sectionTitle}>Transaction history</Text>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by order ID, reference, customer, or garment"
            placeholderTextColor={Colors.midGrey}
            style={styles.searchInput}
          />
          {hasActiveFilters ? (
            <TouchableOpacity style={styles.clearFiltersBtn} onPress={clearFilters} activeOpacity={0.75}>
              <Text style={styles.clearFiltersText}>Clear filters</Text>
            </TouchableOpacity>
          ) : null}
          <View style={styles.filterPanel}>
            <TouchableOpacity
              style={styles.filterSelectRow}
              onPress={() => setFilterSheet('status')}
              accessibilityRole="button"
              accessibilityLabel="Choose transaction status filter"
            >
              <View>
                <Text style={styles.filterSelectLabel}>Status</Text>
                <Text style={styles.filterSelectValue}>
                  {STATUS_FILTERS.find((filter) => filter.key === statusFilter)?.label ?? 'All'}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={Colors.inkLight} />
            </TouchableOpacity>
            <View style={styles.filterDivider} />
            <TouchableOpacity
              style={styles.filterSelectRow}
              onPress={() => setFilterSheet('range')}
              accessibilityRole="button"
              accessibilityLabel="Choose transaction date range"
            >
              <View>
                <Text style={styles.filterSelectLabel}>Date range</Text>
                <Text style={styles.filterSelectValue}>
                  {RANGE_FILTERS.find((filter) => filter.key === rangeFilter)?.label ?? 'All time'}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={Colors.inkLight} />
            </TouchableOpacity>
          </View>
          <Text style={styles.controlsHint}>
            Rows keep customer-paid and tailor-earning currencies separate. Export includes both values for reconciliation, and Drapeon never silently converts payout money.
          </Text>
        </View>

        {error ? (
          <View style={styles.inlineErrorCard}>
            <Text style={styles.inlineErrorTitle}>Something needs attention</Text>
            <Text style={styles.inlineErrorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          {filteredTransactions.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{(data.transactions ?? []).length === 0 ? 'No transactions yet.' : 'No transactions match this filter.'}</Text>
              <Text style={styles.emptyText}>
                {(data.transactions ?? []).length === 0
                  ? 'Completed orders will appear here with payout status, fees, tax, and net earnings once they settle.'
                  : 'Try adjusting your date range, status, or search terms to find the order you need.'}
              </Text>
            </View>
          ) : (
            filteredTransactions.map((row) => {
              return (
                <TouchableOpacity
                  key={row.orderId}
                  style={styles.transactionCard}
                  onPress={() =>
                    router.navigate({
                      pathname: '/(tailor)/orders/[id]',
                      params: {
                        id: row.orderId,
                        historyChain: appendToHistory(undefined, '/(tailor)/earnings'),
                      },
                    })
                  }
                  activeOpacity={0.78}
                >
                  <View style={styles.rowTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{row.title}</Text>
                      <Text style={styles.rowMeta}>
                        #{row.reference} · {row.customerFirstName} · {new Date(row.date).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </Text>
                    </View>
                    <DrapeStatusChip value={row.status} domain="payment" />
                  </View>

                  <View style={styles.moneyBreakdown}>
                    <MoneyLine label="Customer paid" value={money(row.orderAmount, row.orderCurrency)} />
                    <MoneyLine label="Platform fee" value={money(row.platformFeeAmount, row.taxCurrency)} />
                    <MoneyLine label="Tax collected" value={money(row.taxAmount, row.taxCurrency)} />
                    <MoneyLine label="Net earnings" value={money(row.netAmount, row.netCurrency)} strong />
                  </View>
                  {row.convertedFromOriginal ? (
                    <Text style={styles.currencyContextText}>
                      Customer originally paid {money(row.originalOrderAmount, row.originalOrderCurrency)}. These figures are shown in {row.orderCurrency} using the locked order FX rate.
                    </Text>
                  ) : null}
                  {row.netCurrency !== data.payoutCurrency ? (
                    <Text style={styles.currencyContextText}>
                      Locked in {row.netCurrency}. Ops must approve payout in the original currency or convert it into {data.payoutCurrency}.
                    </Text>
                  ) : null}

                  {row.statusReason ? <Text style={styles.reasonText}>{row.statusReason}</Text> : null}
                </TouchableOpacity>
              )
            })
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payout history</Text>
          {data.payouts.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No payouts have been triggered yet.</Text>
              <Text style={styles.emptyText}>
                Once Drapeon releases a completed order, the provider reference and settlement status will appear here.
              </Text>
            </View>
          ) : (
            data.payouts.map((row) => {
              const reviewMessage = payoutReviewMessage(row)
              const recoveryAction = blockedPayoutAction(row)
              return (
                <View key={row.id} style={styles.payoutCard}>
                  <View style={styles.rowTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{money(row.amount, row.currency)}</Text>
                      <Text style={styles.payoutPurpose}>{row.purposeLabel}</Text>
                      <Text style={styles.rowMeta}>
                        {row.provider} · {row.providerReference ?? 'Awaiting provider reference'}
                      </Text>
                    </View>
                    <DrapeStatusChip value={row.deliveryState} label={row.deliveryLabel} domain="payout" />
                  </View>
                  <Text style={styles.rowMeta}>{payoutMethodLabel(data)}</Text>
                  <Text style={styles.reasonText}>{row.deliveryExplanation}</Text>
                  {row.expectedAt && row.deliveryState === 'BANK_PAYOUT_PENDING' ? (
                    <Text style={styles.rowMeta}>
                      Estimated bank arrival {new Date(row.expectedAt).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </Text>
                  ) : null}
                  <Text style={styles.rowMeta}>
                    {row.orderReference ? `Order #${row.orderReference} · ` : ''}
                    Initiated {new Date(row.initiatedAt).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </Text>
                  {row.completedAt ? (
                    <Text style={styles.rowMeta}>
                      Completed {new Date(row.completedAt).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </Text>
                  ) : null}
                  {row.failedAt ? (
                    <Text style={styles.rowMeta}>
                      Failed {new Date(row.failedAt).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </Text>
                  ) : null}
                  {reviewMessage ? <Text style={styles.reasonText}>{reviewMessage}</Text> : null}
                  {recoveryAction ? (
                    <TouchableOpacity
                      style={styles.recoveryButton}
                      onPress={() => resetTo(router, {
                        pathname: recoveryAction.pathname,
                        params: recoveryAction.pathname.includes('[id]')
                          ? { id: row.orderId ?? '', returnTo: '/(tailor)/earnings' }
                          : { returnTo: '/(tailor)/earnings' },
                      } as never)}
                      accessibilityRole="button"
                      accessibilityLabel={`${recoveryAction.label} for ${row.orderReference ?? 'this payout'}`}
                    >
                      <Text style={styles.recoveryButtonText}>{recoveryAction.label}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              )
            })
          )}
        </View>

        {data.bankActivity.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Stripe bank activity</Text>
            <Text style={styles.sectionHint}>
              Stripe can combine several released earnings into one bank payout. These provider-confirmed events are shown separately when they cannot be matched safely to one order.
            </Text>
            {data.bankActivity.map((row) => (
              <View key={row.id} style={styles.payoutCard}>
                <View style={styles.rowTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>
                      {row.amount !== null && row.currency ? money(row.amount, row.currency) : 'Stripe bank payout'}
                    </Text>
                    <Text style={styles.rowMeta}>{row.bankPayoutReference ?? 'Provider reference pending'}</Text>
                  </View>
                  <DrapeStatusChip value={row.status} label={row.label} domain="payout" />
                </View>
                <Text style={styles.reasonText}>{row.explanation}</Text>
                {row.expectedAt && ['PENDING', 'IN_TRANSIT'].includes(row.status) ? (
                  <Text style={styles.rowMeta}>Estimated arrival {new Date(row.expectedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                ) : null}
                {row.failureMessage ? <Text style={styles.reasonText}>{row.failureMessage}</Text> : null}
                <Text style={styles.rowMeta}>Updated {new Date(row.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <EarningsFilterSheet
        visible={filterSheet !== null}
        title={filterSheet === 'status' ? 'Transaction status' : 'Date range'}
        options={filterSheet === 'status' ? STATUS_FILTERS : RANGE_FILTERS}
        selectedKey={filterSheet === 'status' ? statusFilter : rangeFilter}
        onClose={() => setFilterSheet(null)}
        onSelect={(key) => {
          if (filterSheet === 'status') {
            setStatusFilter(key as StatusFilter)
          } else {
            setRangeFilter(key as RangeFilter)
          }
          setFilterSheet(null)
        }}
      />
    </SafeAreaView>
  )
}

function EarningsFilterSheet({
  visible,
  title,
  options,
  selectedKey,
  onSelect,
  onClose,
}: {
  visible: boolean
  title: string
  options: Array<{ key: string; label: string }>
  selectedKey: string
  onSelect: (key: string) => void
  onClose: () => void
}) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <TouchableOpacity style={styles.sheetCloseBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close filter picker">
              <Feather name="x" size={20} color={Colors.ink} />
            </TouchableOpacity>
          </View>
          <View style={styles.sheetOptionList}>
            {options.map((option) => {
              const active = selectedKey === option.key
              return (
                <TouchableOpacity
                  key={option.key}
                  style={styles.sheetOption}
                  onPress={() => onSelect(option.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.sheetOptionText, active && styles.sheetOptionTextActive]}>{option.label}</Text>
                  {active ? <Feather name="check" size={20} color={Colors.needleGreen} /> : null}
                </TouchableOpacity>
              )
            })}
          </View>
        </View>
      </View>
    </Modal>
  )
}

function MoneyLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.moneyLine}>
      <Text style={styles.moneyLabel}>{label}</Text>
      <Text style={strong ? styles.moneyValueStrong : styles.moneyValue}>{value}</Text>
    </View>
  )
}

function MoneySummaryLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.summaryBreakdownRow}>
      <Text style={styles.summaryBreakdownLabel}>{label}</Text>
      <Text style={[styles.summaryBreakdownValue, strong && styles.summaryBreakdownValueStrong]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  scroll: { flex: 1 },
  content: { paddingBottom: Spacing.xxxl },
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
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  stateTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
  },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 21 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  back: { width: 60, color: Colors.needleGreen, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display },
  exportBtn: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.warning + '55',
    ...Shadow.sm,
  },
  warningTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  warningBody: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 21 },
  pendingReleaseCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '25',
    padding: Spacing.md,
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
  },
  pendingReleaseIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingReleaseCopy: { flex: 1, gap: 4 },
  pendingReleaseTitle: {
    fontSize: FontSize.md,
    color: Colors.needleGreenDark,
    fontWeight: FontWeight.bold,
    fontFamily: Fonts.display,
  },
  pendingReleaseText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  primaryBtn: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  primaryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse },
  summaryCard: {
    marginHorizontal: Spacing.lg,
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  summaryEyebrow: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.72)',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    fontWeight: FontWeight.semibold,
  },
  summaryValue: { fontSize: 30, fontWeight: FontWeight.bold, color: Colors.textInverse, letterSpacing: -0.6, fontFamily: Fonts.display },
  summaryHint: { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.84)', lineHeight: 18 },
  summaryBreakdown: {
    marginTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.24)',
    paddingTop: Spacing.xs,
    gap: 5,
  },
  summaryBreakdownRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  summaryBreakdownLabel: { color: 'rgba(255,255,255,0.76)', fontSize: FontSize.xs },
  summaryBreakdownValue: { color: Colors.textInverse, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  summaryBreakdownValueStrong: { fontWeight: FontWeight.bold },
  summaryMetaCard: {
    marginTop: Spacing.xs,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.12)',
    padding: Spacing.sm,
    gap: 2,
  },
  summaryMetaLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.76)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: FontWeight.semibold,
  },
  summaryMetaValue: {
    fontSize: FontSize.sm,
    color: Colors.textInverse,
    fontWeight: FontWeight.semibold,
  },
  summaryMetaHint: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.76)',
    lineHeight: 16,
  },
  currencyNoticeCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.kanteRustLight,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  currencyNoticeTitle: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  currencyNoticeText: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 18,
  },
  currencyBreakdownList: {
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
    paddingTop: Spacing.sm,
  },
  currencyBreakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.md,
  },
  currencyBreakdownLabel: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
  },
  currencyBreakdownValue: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  statsGrid: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  breakdownCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  breakdownRail: {
    flexDirection: 'row',
    gap: 4,
    height: 12,
    borderRadius: Radius.full,
    overflow: 'hidden',
    backgroundColor: Colors.boneDeep,
  },
  breakdownSegmentPending: {
    backgroundColor: Colors.kanteRust,
  },
  breakdownSegmentAvailable: {
    backgroundColor: Colors.needleGreenDark,
  },
  breakdownSegmentPaid: {
    backgroundColor: Colors.needleGreen,
  },
  breakdownLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  breakdownLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  breakdownDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  breakdownDotPending: {
    backgroundColor: Colors.kanteRust,
  },
  breakdownDotAvailable: {
    backgroundColor: Colors.needleGreenDark,
  },
  breakdownDotPaid: {
    backgroundColor: Colors.needleGreen,
  },
  breakdownLegendText: {
    fontSize: 11,
    color: Colors.midGrey,
  },
  statCard: {
    width: '47%',
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 4,
    ...Shadow.sm,
  },
  statLabel: { fontSize: FontSize.xs, color: Colors.midGrey, textTransform: 'uppercase', letterSpacing: 0.6 },
  statValue: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display },
  statHint: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 16 },
  controlsCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  section: { marginHorizontal: Spacing.lg, marginTop: Spacing.md, gap: Spacing.sm },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  sectionHint: { color: Colors.inkLight, fontSize: FontSize.sm, lineHeight: 21 },
  searchInput: {
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.md,
    backgroundColor: Colors.bone,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    fontSize: FontSize.sm,
    color: Colors.ink,
    minHeight: 44,
  },
  clearFiltersBtn: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
  },
  clearFiltersText: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    fontWeight: FontWeight.medium,
  },
  filterPanel: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  filterSelectRow: {
    minHeight: 58,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  filterDivider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.lightGrey, marginLeft: Spacing.md },
  filterSelectLabel: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  filterSelectValue: { marginTop: 2, fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(26,26,24,0.35)' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 48,
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.lightGrey,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: FontSize.lg, color: Colors.ink, fontWeight: FontWeight.bold, fontFamily: Fonts.display },
  sheetCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: Colors.bone,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetOptionList: { gap: 2 },
  sheetOption: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
  },
  sheetOptionText: { fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.medium },
  sheetOptionTextActive: { color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  controlsHint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  inlineErrorCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    backgroundColor: Colors.errorLight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: 4,
  },
  inlineErrorTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.error },
  inlineErrorText: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  emptyCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  emptyTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 19 },
  transactionCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  payoutCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 6,
    ...Shadow.sm,
  },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  rowTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  payoutPurpose: {
    marginTop: 3,
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  rowMeta: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18, marginTop: 2 },
  moneyBreakdown: {
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
    paddingTop: Spacing.sm,
    gap: 8,
  },
  moneyLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.md },
  currencyContextText: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 16 },
  moneyLabel: { fontSize: FontSize.sm, color: Colors.inkLight, flex: 1 },
  moneyValue: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.medium },
  moneyValueStrong: { fontSize: FontSize.md, color: Colors.needleGreenDark, fontWeight: FontWeight.bold },
  reasonText: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  recoveryButton: {
    alignSelf: 'flex-start',
    marginTop: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.needleGreen,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  recoveryButtonText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
})
