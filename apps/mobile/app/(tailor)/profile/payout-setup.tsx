import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import * as ExpoLinking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import { Button, Input, RemoteImage } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { goBackOrReturnTo } from '@/lib/navigation'
import {
  MANUAL_BANK_COUNTRIES,
  MANUAL_BANK_ENTRY_NOTE,
  MANUAL_BANK_ENTRY_OPTION_LABEL,
  normalizeSwiftBic,
  validateManualBankEntry,
  type ManualBankEntryField,
  type ManualBankEntryFieldErrors,
} from '@drape/shared/payout-setup'
import {
  confirmPaystackPayoutAccount,
  listPaystackPayoutBanks,
  loadPayoutAccountStatus,
  type PaystackBankDirectory,
  refreshStripeConnectPayoutStatus,
  startStripeConnectOnboarding,
  submitManualBankEntry,
  type PaystackBank,
  type PaystackVerification,
  type PayoutSetupCurrency,
  type PayoutSetupProvider,
  type TailorPayoutStatus,
  verifyPaystackPayoutAccount,
} from '@/lib/payout-setup'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

type SetupStep = 'INTRO' | 'CURRENCY' | 'CONNECT' | 'SUCCESS'

type StripeRefreshAccount = {
  provider: 'STRIPE'
  stripeConnectAccountId: string
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
  payoutAccountVerified: boolean
  payoutReverificationRequired: boolean
  payoutAccountVerifiedAt: string | null
  payoutCountryCode: string | null
}

type CurrencyOption = {
  code: PayoutSetupCurrency
  name: string
  provider: PayoutSetupProvider
  flag: string
  providerBadge: string
  countryCode: string
  countryLabel: string
}

const CURRENCY_OPTIONS: CurrencyOption[] = [
  { code: 'NGN', name: 'Nigerian Naira', provider: 'PAYSTACK', flag: 'NG', providerBadge: 'Paystack', countryCode: 'NG', countryLabel: 'Nigeria' },
  { code: 'GHS', name: 'Ghanaian Cedi', provider: 'PAYSTACK', flag: 'GH', providerBadge: 'Paystack', countryCode: 'GH', countryLabel: 'Ghana' },
  { code: 'KES', name: 'Kenyan Shilling', provider: 'PAYSTACK', flag: 'KE', providerBadge: 'Paystack', countryCode: 'KE', countryLabel: 'Kenya' },
  { code: 'USD', name: 'US Dollar', provider: 'STRIPE', flag: 'US', providerBadge: 'Stripe', countryCode: 'US', countryLabel: 'United States' },
  { code: 'GBP', name: 'British Pound', provider: 'STRIPE', flag: 'GB', providerBadge: 'Stripe', countryCode: 'GB', countryLabel: 'United Kingdom' },
  { code: 'EUR', name: 'Euro', provider: 'STRIPE', flag: 'EU', providerBadge: 'Stripe', countryCode: 'IE', countryLabel: 'Ireland' },
  { code: 'CAD', name: 'Canadian Dollar', provider: 'STRIPE', flag: 'CA', providerBadge: 'Stripe', countryCode: 'CA', countryLabel: 'Canada' },
]

function optionForCurrency(currency: PayoutSetupCurrency) {
  return CURRENCY_OPTIONS.find((option) => option.code === currency) ?? CURRENCY_OPTIONS[0]
}

function providerForCurrency(currency: PayoutSetupCurrency): PayoutSetupProvider {
  return optionForCurrency(currency).provider
}

function providerLabel(provider: PayoutSetupProvider | 'STRIPE_CONNECT' | null | undefined) {
  if (provider === 'PAYSTACK') return 'Paystack'
  return 'Stripe Connect'
}

function isUnavailableEnvironmentError(message: string) {
  const normalized = message.trim().toLowerCase()
  return normalized.includes('not available in this environment')
    || normalized.includes('deploy the latest payout function')
}

function formatMaskedAccount(value: string | null | undefined) {
  if (!value) return 'Saved on your profile'
  const rawLast4 = value.replace(/\D+/gu, '').slice(-4)
  if (!rawLast4) return value
  return `Ending in ${rawLast4}`
}

function isFutureTime(value: string | null | undefined) {
  if (!value) return false
  const time = Date.parse(value)
  return Number.isFinite(time) && time > Date.now()
}

function formatGuardDate(value: string | null | undefined) {
  if (!value) return ''
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(time))
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  )
}

function StepChip({ number, label, active, complete }: { number: number; label: string; active: boolean; complete: boolean }) {
  return (
    <View style={[styles.stepChip, active && styles.stepChipActive, complete && styles.stepChipComplete]}>
      <View style={[styles.stepNumber, (active || complete) && styles.stepNumberActive]}>
        <Text style={[styles.stepNumberText, (active || complete) && styles.stepNumberTextActive]}>{complete ? '✓' : number}</Text>
      </View>
      <Text style={[styles.stepChipText, active && styles.stepChipTextActive]}>{label}</Text>
    </View>
  )
}

function bankInitials(name: string) {
  const words = name
    .trim()
    .split(/\s+/u)
    .filter((word) => !['bank', 'of', 'the', 'for'].includes(word.toLowerCase()))
  const first = words[0]?.[0] ?? name[0] ?? 'B'
  const second = words[1]?.[0] ?? ''
  return `${first}${second}`.toUpperCase()
}

function BankLogo({
  bank,
  failed,
  onError,
}: {
  bank: PaystackBank
  failed: boolean
  onError: () => void
}) {
  if (bank.logoUrl && !failed) {
    return (
      <RemoteImage
        uri={bank.logoUrl}
        style={styles.bankLogoImage}
        contentFit="contain"
        transition={120}
        surface="payout_bank_logo"
        onLoadError={onError}
        fallback={(
          <View style={styles.bankLogoFallback}>
            <Text style={styles.bankLogoFallbackText}>{bankInitials(bank.name)}</Text>
          </View>
        )}
        accessibilityIgnoresInvertColors
      />
    )
  }

  return (
    <View style={styles.bankLogoFallback}>
      <Text style={styles.bankLogoFallbackText}>{bankInitials(bank.name)}</Text>
    </View>
  )
}

function BenefitRow({ icon, title, body }: { icon: React.ComponentProps<typeof Feather>['name']; title: string; body: string }) {
  return (
    <View style={styles.benefitRow}>
      <View style={styles.benefitIcon}>
        <Feather name={icon} size={16} color={Colors.needleGreen} />
      </View>
      <View style={styles.benefitBody}>
        <Text style={styles.benefitTitle}>{title}</Text>
        <Text style={styles.benefitText}>{body}</Text>
      </View>
    </View>
  )
}

export default function TailorPayoutSetupScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>()
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [successScale] = useState(() => new Animated.Value(0.72))

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [status, setStatus] = useState<TailorPayoutStatus | null>(null)
  const [activeStep, setActiveStep] = useState<SetupStep>('INTRO')
  const [editingVerifiedAccount, setEditingVerifiedAccount] = useState(false)
  const [selectedCurrency, setSelectedCurrency] = useState<PayoutSetupCurrency>('USD')
  const [countryCode, setCountryCode] = useState('US')
  const [submitting, setSubmitting] = useState(false)
  const [fieldError, setFieldError] = useState('')
  const [stripeStatus, setStripeStatus] = useState<StripeRefreshAccount | null>(null)

  const [banks, setBanks] = useState<PaystackBank[]>([])
  const [bankDirectory, setBankDirectory] = useState<PaystackBankDirectory | null>(null)
  const [banksLoading, setBanksLoading] = useState(false)
  const [banksLoadedFor, setBanksLoadedFor] = useState<string | null>(null)
  const [bankSearch, setBankSearch] = useState('')
  const [selectedBank, setSelectedBank] = useState<PaystackBank | null>(null)
  const [accountNumber, setAccountNumber] = useState('')
  const [verification, setVerification] = useState<PaystackVerification | null>(null)
  const [manualBankMode, setManualBankMode] = useState(false)
  const [manualBankName, setManualBankName] = useState('')
  const [manualBankCountryCode, setManualBankCountryCode] = useState('US')
  const [manualSwiftBic, setManualSwiftBic] = useState('')
  const [manualAccountNumber, setManualAccountNumber] = useState('')
  const [manualAccountName, setManualAccountName] = useState('')
  const [manualCountryOpen, setManualCountryOpen] = useState(false)
  const [manualFieldErrors, setManualFieldErrors] = useState<ManualBankEntryFieldErrors>({})
  const [failedBankLogos, setFailedBankLogos] = useState<Record<string, true>>({})

  const selectedOption = optionForCurrency(selectedCurrency)
  const provider = providerForCurrency(selectedCurrency)
  const connectStepLabel = provider === 'PAYSTACK'
    ? manualBankMode
      ? 'Review'
      : verification
        ? 'Confirm'
        : 'Bank'
    : 'Stripe'
  const manualBankCountry = useMemo(
    () => MANUAL_BANK_COUNTRIES.find((country) => country.code === manualBankCountryCode) ?? null,
    [manualBankCountryCode],
  )
  const filteredBanks = useMemo(() => {
    const query = bankSearch.trim().toLowerCase()
    if (!query) return banks.slice(0, 40)
    return banks.filter((bank) => bank.name.toLowerCase().includes(query)).slice(0, 40)
  }, [bankSearch, banks])

  const showVerifiedSummary =
    status?.payoutAccountVerified === true
    && status.payoutReverificationRequired !== true
    && !editingVerifiedAccount
    && activeStep !== 'SUCCESS'
  const showManualPendingSummary =
    status?.manualBankEntry === true
    && status.payoutAccountVerified !== true
    && !editingVerifiedAccount
    && activeStep !== 'SUCCESS'
  const payoutChangeLocked = isFutureTime(status?.payoutAccountChangeLockedUntil)
  const payoutDestinationHoldActive = isFutureTime(status?.payoutDestinationHoldUntil)
  const environmentUnavailable = isUnavailableEnvironmentError(loadError)
  const successIsManualPending =
    status?.manualBankEntry === true
    && status.payoutAccountVerified !== true

  const load = useCallback(async () => {
    if (!userId) {
      setLoadError('Please sign in again before opening payout setup.')
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError('')
    const result = await loadPayoutAccountStatus()
    if (result.error || !result.profile) {
      setLoadError(result.error ?? 'We could not load your payout setup right now.')
      setLoading(false)
      return
    }

    const nextStatus = result.profile
    const nextOption = optionForCurrency(nextStatus.payoutCurrency)
    setStatus(nextStatus)
    setSelectedCurrency(nextStatus.payoutCurrency)
    setCountryCode(nextStatus.payoutCountryCode ?? nextOption.countryCode)
    setLoading(false)
  }, [userId])

  const handleLoadBanks = useCallback(async () => {
    if (provider !== 'PAYSTACK') return
    setBanksLoading(true)
    setFieldError('')
    const result = await listPaystackPayoutBanks({
      payoutCurrency: selectedCurrency as 'NGN' | 'GHS' | 'KES',
      countryCode,
    })
    setBanksLoading(false)
    if (result.error || !result.directory) {
      setFieldError(result.error ?? 'We could not load the bank list right now.')
      return
    }
    setBankDirectory(result.directory)
    setBanks(result.directory.banks)
    setBanksLoadedFor(`${selectedCurrency}:${countryCode}`)
  }, [countryCode, provider, selectedCurrency])

  useEffect(() => {
    const timer = setTimeout(() => {
      void load()
    }, 0)
    return () => clearTimeout(timer)
  }, [load])

  useEffect(() => {
    if (activeStep !== 'SUCCESS') return
    successScale.setValue(0.72)
    Animated.spring(successScale, {
      toValue: 1,
      useNativeDriver: true,
      tension: 70,
      friction: 8,
    }).start()
  }, [activeStep, successScale])

  useEffect(() => {
    const timer = setTimeout(() => {
      const option = optionForCurrency(selectedCurrency)
      setCountryCode(option.countryCode)
      setBankSearch('')
      setSelectedBank(null)
      setVerification(null)
      setFieldError('')
      setStripeStatus(null)
      setBanks([])
      setBankDirectory(null)
      setBanksLoadedFor(null)
      setAccountNumber('')
      setManualBankMode(false)
      setManualBankName('')
      setManualBankCountryCode(option.countryCode)
      setManualSwiftBic('')
      setManualAccountNumber('')
      setManualAccountName('')
      setManualCountryOpen(false)
      setManualFieldErrors({})
      setFailedBankLogos({})
    }, 0)
    return () => clearTimeout(timer)
  }, [selectedCurrency])

  useEffect(() => {
    if (activeStep !== 'CONNECT' || provider !== 'PAYSTACK') return
    const key = `${selectedCurrency}:${countryCode}`
    if (banksLoadedFor === key || banksLoading) return
    const timer = setTimeout(() => {
      void handleLoadBanks()
    }, 0)
    return () => clearTimeout(timer)
  }, [
    activeStep,
    banksLoadedFor,
    banksLoading,
    countryCode,
    handleLoadBanks,
    provider,
    selectedCurrency,
  ])

  function goBack() {
    goBackOrReturnTo(router, navigation, returnTo, '/(tailor)/profile' as never)
  }

  function startSetupFlow() {
    if (payoutChangeLocked) {
      Alert.alert(
        'Payout change cooling down',
        `For account safety, payout destination changes are limited for a short period. You can change this again after ${formatGuardDate(status?.payoutAccountChangeLockedUntil)}.`,
      )
      return
    }
    setEditingVerifiedAccount(true)
    setActiveStep('CURRENCY')
    setFieldError('')
  }

  async function handleVerifyPaystack() {
    if (!selectedBank) {
      setFieldError('Choose a bank before verifying the account number.')
      return
    }
    if (!accountNumber.trim()) {
      setFieldError('Enter the account number before verifying.')
      return
    }

    setSubmitting(true)
    setFieldError('')
    const result = await verifyPaystackPayoutAccount({
      payoutCurrency: selectedCurrency as 'NGN' | 'GHS' | 'KES',
      countryCode,
      bankCode: selectedBank.code,
      bankName: selectedBank.name,
      accountNumber,
    })
    setSubmitting(false)

    if (result.error || !result.verification) {
      setFieldError(result.error ?? 'We could not verify this account number right now.')
      return
    }

    setVerification(result.verification)
  }

  function clearManualFieldError(field: ManualBankEntryField) {
    if (!manualFieldErrors[field]) return
    setManualFieldErrors((current) => {
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  function handleSelectListedBank(bank: PaystackBank) {
    setManualBankMode(false)
    setManualCountryOpen(false)
    setSelectedBank(bank)
    setVerification(null)
    setFieldError('')
    setManualFieldErrors({})
  }

  function handleSelectManualBank() {
    setManualBankMode(true)
    setManualCountryOpen(false)
    setSelectedBank(null)
    setVerification(null)
    setFieldError('')
    setManualFieldErrors({})
  }

  async function handleSubmitManualBank() {
    const validation = validateManualBankEntry({
      payoutCurrency: selectedCurrency,
      bankName: manualBankName,
      bankCountryCode: manualBankCountryCode,
      swiftBic: manualSwiftBic,
      accountNumber: manualAccountNumber,
      accountName: manualAccountName,
    })

    if (!validation.ok) {
      setManualFieldErrors(validation.fieldErrors)
      setFieldError(validation.message)
      return
    }

    setSubmitting(true)
    setFieldError('')
    setManualFieldErrors({})
    const result = await submitManualBankEntry(validation.value)
    setSubmitting(false)

    if (result.error || !result.account) {
      setFieldError(result.error ?? 'We could not submit these manual bank details right now.')
      return
    }

    setStatus(result.account)
    await load()
    setEditingVerifiedAccount(false)
    setActiveStep('SUCCESS')
  }

  async function handleConfirmPaystack() {
    if (!selectedBank || !verification) {
      setFieldError('Verify the bank account before saving it.')
      return
    }

    setSubmitting(true)
    setFieldError('')
    const result = await confirmPaystackPayoutAccount({
      payoutCurrency: selectedCurrency as 'NGN' | 'GHS' | 'KES',
      countryCode,
      bankCode: selectedBank.code,
      bankName: selectedBank.name,
      accountNumber,
      accountName: verification.resolvedAccountName,
    })
    setSubmitting(false)

    if (result.error || !result.account) {
      setFieldError(result.error ?? 'We could not save this payout account right now.')
      return
    }

    setStatus(result.account)
    setEditingVerifiedAccount(false)
    setActiveStep('SUCCESS')
    void load()
  }

  async function handleStartStripe() {
    setSubmitting(true)
    setFieldError('')
    const returnUrl = ExpoLinking.createURL('')
    const result = await startStripeConnectOnboarding({
      payoutCurrency: selectedCurrency as 'USD' | 'GBP' | 'EUR' | 'CAD',
      countryCode,
      returnUrl,
      refreshUrl: returnUrl,
    })

    if (result.error || !result.onboarding) {
      setSubmitting(false)
      setFieldError(result.error ?? 'We could not start Stripe onboarding right now.')
      return
    }

    const browserResult = await WebBrowser.openAuthSessionAsync(result.onboarding.url, returnUrl)
    if (browserResult.type !== 'success') {
      setSubmitting(false)
      Alert.alert('Stripe setup paused', 'You can come back and finish Stripe onboarding whenever you are ready.')
      return
    }

    const refresh = await refreshStripeConnectPayoutStatus()
    setSubmitting(false)
    if (refresh.error || !refresh.account) {
      setFieldError(refresh.error ?? 'We could not refresh the Stripe payout status yet.')
      return
    }

    setStripeStatus(refresh.account as StripeRefreshAccount)
    await load()
    if (refresh.account.payoutAccountVerified) {
      setEditingVerifiedAccount(false)
      setActiveStep('SUCCESS')
      return
    }

    Alert.alert(
      'More Stripe details still needed',
      'Stripe still needs more information before payouts can be enabled. You can reopen Stripe to finish the remaining steps.',
    )
  }

  function handleFlowBack() {
    if (activeStep === 'CONNECT') {
      setActiveStep('CURRENCY')
      return
    }
    if (activeStep === 'CURRENCY') {
      if (editingVerifiedAccount) {
        setEditingVerifiedAccount(false)
        setActiveStep('INTRO')
        setFieldError('')
        return
      }
      setActiveStep('INTRO')
      return
    }
    goBack()
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={goBack}>
            <Feather name="arrow-left" size={20} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Payout setup</Text>
        </View>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Payments & payouts</Text>
            <ActivityIndicator color={Colors.needleGreen} />
            <Text style={styles.stateTitle}>Loading your payout setup…</Text>
            <Text style={styles.stateHint}>We’re checking your current payout path and verification status first.</Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={goBack}>
            <Feather name="arrow-left" size={20} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Payout setup</Text>
        </View>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>
              {environmentUnavailable ? 'Payout setup unavailable' : 'Payments & payouts'}
            </Text>
            <Text style={styles.stateTitle}>
              {environmentUnavailable ? 'We could not open payout setup right now.' : 'Couldn’t load this yet.'}
            </Text>
            <Text style={styles.stateHint}>
              {environmentUnavailable
                ? 'Your account is fine. Try again in a moment, or contact support if this keeps happening.'
                : loadError}
            </Text>
            {environmentUnavailable ? (
              <View style={styles.inlineInfoCard}>
                <Feather name="tool" size={16} color={Colors.needleGreen} />
                <Text style={styles.inlineInfoText}>
                  Payout setup is protected so incomplete or unavailable bank checks do not save partial account details.
                </Text>
              </View>
            ) : null}
            <Button label={environmentUnavailable ? 'Go back' : 'Try again'} onPress={environmentUnavailable ? goBack : () => { void load() }} />
            {environmentUnavailable ? (
              <Button label="Try again" variant="secondary" onPress={() => { void load() }} />
            ) : null}
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (activeStep === 'SUCCESS' && status) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={goBack}>
            <Feather name="arrow-left" size={20} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Payout setup</Text>
        </View>
        <View style={styles.stepRow}>
          <StepChip number={1} label="Intro" active={false} complete />
          <StepChip number={2} label="Currency" active={false} complete />
          <StepChip number={3} label={connectStepLabel} active={false} complete />
          <StepChip number={4} label="Done" active complete={false} />
        </View>
        <View style={styles.successWrap}>
          <Animated.View style={[
            styles.successOrb,
            successIsManualPending && styles.successOrbPending,
            { transform: [{ scale: successScale }] },
          ]}>
            <Feather name={successIsManualPending ? 'clock' : 'check'} size={38} color={Colors.textInverse} />
          </Animated.View>
          <Text style={styles.successTitle}>
            {successIsManualPending ? 'Manual bank details submitted' : "You're all set to get paid"}
          </Text>
          <Text style={styles.successBody}>
            {successIsManualPending
              ? MANUAL_BANK_ENTRY_NOTE
              : 'Your payout account is verified. Earnings from completed orders will be sent automatically after the 72-hour delivery window closes.'}
          </Text>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>
              {successIsManualPending ? 'Pending verification summary' : 'Verified account summary'}
            </Text>
            <SummaryRow label="Payout method" value={status.payoutBankName ? `${status.payoutBankName} · ${formatMaskedAccount(status.payoutAccountMasked)}` : providerLabel(status.payoutAccountType)} />
            <SummaryRow label="Payout currency" value={status.payoutCurrency} />
            <SummaryRow label="Provider" value={successIsManualPending ? 'Ops verification' : providerLabel(status.payoutAccountType)} />
            {successIsManualPending ? <SummaryRow label="Status" value="Pending review" /> : null}
            {!successIsManualPending && payoutDestinationHoldActive ? (
              <SummaryRow label="Release guard" value={`Payouts resume after ${formatGuardDate(status.payoutDestinationHoldUntil)}`} />
            ) : null}
          </View>

          {!successIsManualPending ? (
            <View style={styles.successChecklist}>
              <View style={styles.successCheckRow}>
                <Feather name="check-circle" size={17} color={Colors.needleGreen} />
                <Text style={styles.successCheckText}>Paid orders can release to this account after delivery.</Text>
              </View>
              <View style={styles.successCheckRow}>
                <Feather name="check-circle" size={17} color={Colors.needleGreen} />
                <Text style={styles.successCheckText}>Your dashboard will show this payout path at a glance.</Text>
              </View>
            </View>
          ) : null}

          <Button label="Go back" onPress={goBack} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={handleFlowBack}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payout setup</Text>
      </View>

      {(showVerifiedSummary || showManualPendingSummary) && status ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.body}
        >
          <View style={styles.heroCard}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>
                {showManualPendingSummary ? 'Manual bank review' : 'Verified payout account'}
              </Text>
            </View>
            <Text style={styles.heroTitle}>
              {showManualPendingSummary ? 'Your manual bank details are with ops.' : 'Your payout path is ready.'}
            </Text>
            <Text style={styles.heroCopy}>
              {showManualPendingSummary
                ? MANUAL_BANK_ENTRY_NOTE
                : 'Drapeon will only release earnings to a verified payout account. You can change this later, but changing payout currency or provider will require verification again.'}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>
              {showManualPendingSummary ? 'Pending payout details' : 'Saved payout details'}
            </Text>
            <SummaryRow label="Provider" value={showManualPendingSummary ? 'Manual ops verification' : providerLabel(status.payoutAccountType)} />
            <SummaryRow label="Payout currency" value={status.payoutCurrency} />
            {status.payoutBankName ? <SummaryRow label="Bank" value={status.payoutBankName} /> : null}
            {status.payoutAccountName ? <SummaryRow label="Account name" value={status.payoutAccountName} /> : null}
            <SummaryRow label="Account" value={formatMaskedAccount(status.payoutAccountMasked)} />
            {showManualPendingSummary ? <SummaryRow label="Status" value="Pending review" /> : null}
            {payoutDestinationHoldActive ? (
              <SummaryRow label="Release guard" value={`Payouts resume after ${formatGuardDate(status.payoutDestinationHoldUntil)}`} />
            ) : null}
            {payoutChangeLocked ? (
              <SummaryRow label="Next change" value={formatGuardDate(status.payoutAccountChangeLockedUntil)} />
            ) : null}
          </View>

          <Button
            label={payoutChangeLocked ? 'Payout change cooling down' : 'Change payout setup'}
            variant="secondary"
            disabled={payoutChangeLocked}
            onPress={startSetupFlow}
          />
          {payoutChangeLocked ? (
            <Text style={styles.guardHint}>
              You can update this destination again after {formatGuardDate(status.payoutAccountChangeLockedUntil)}. Contact support if your bank account is closed or compromised before then.
            </Text>
          ) : null}
          <Button label="Go back" onPress={goBack} />
        </ScrollView>
      ) : (
        <>
          <View style={styles.stepRow}>
            <StepChip number={1} label="Intro" active={activeStep === 'INTRO'} complete={activeStep !== 'INTRO'} />
            <StepChip number={2} label="Currency" active={activeStep === 'CURRENCY'} complete={activeStep === 'CONNECT' || activeStep === 'SUCCESS'} />
            <StepChip number={3} label={connectStepLabel} active={activeStep === 'CONNECT'} complete={activeStep === 'SUCCESS'} />
            <StepChip number={4} label="Done" active={activeStep === 'SUCCESS'} complete={false} />
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.body}
          >
            {activeStep === 'INTRO' ? (
              <>
                <View style={styles.heroCard}>
                  <View style={styles.heroBadge}>
                    <Text style={styles.heroBadgeText}>Payments & payouts</Text>
                  </View>
                  <Text style={styles.heroTitle}>Get paid for your work</Text>
                  <Text style={styles.heroCopy}>
                    Set up your payout account to receive earnings when orders are completed.
                  </Text>
                </View>

                <View style={styles.card}>
                  <BenefitRow
                    icon="clock"
                    title="Payments release automatically after delivery"
                    body="Drapeon only releases earnings after delivery is confirmed and the dispute window closes."
                  />
                  <BenefitRow
                    icon="credit-card"
                    title="Funds go directly to your bank account"
                    body="Payout currency decides the provider for this account."
                  />
                  <BenefitRow
                    icon="shield"
                    title="Secure and verified"
                    body="Your payout details are verified before Drapeon unlocks paid work or future releases."
                  />
                </View>
              </>
            ) : null}

            {activeStep === 'CURRENCY' ? (
              <>
                <View style={styles.heroCard}>
                  <View style={styles.heroBadge}>
                    <Text style={styles.heroBadgeText}>Step 2</Text>
                  </View>
                  <Text style={styles.heroTitle}>How would you like to be paid?</Text>
                  <Text style={styles.heroCopy}>
                    Your earnings will be sent in this currency to your bank account. You can change it later, but you’ll need to verify the account again.
                  </Text>
                </View>

                <View style={styles.currencyList}>
                  {CURRENCY_OPTIONS.map((option) => {
                    const active = selectedCurrency === option.code
                    return (
                      <TouchableOpacity
                        key={option.code}
                        style={[styles.currencyCard, active && styles.currencyCardActive]}
                        onPress={() => setSelectedCurrency(option.code)}
                        activeOpacity={0.8}
                      >
                        <View style={styles.currencyCardTop}>
                          <Text style={styles.currencyFlag}>{option.flag}</Text>
                          <View style={styles.providerBadge}>
                            <Text style={styles.providerBadgeText}>{option.providerBadge}</Text>
                          </View>
                        </View>
                        <Text style={styles.currencyCode}>{option.code}</Text>
                        <Text style={styles.currencyName}>{option.name}</Text>
                        <Text style={styles.currencyMeta}>{option.countryLabel}</Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </>
            ) : null}

            {activeStep === 'CONNECT' ? (
              <>
                <View style={styles.heroCard}>
                  <View style={styles.heroBadge}>
                    <Text style={styles.heroBadgeText}>{provider === 'PAYSTACK' ? 'Step 3A' : 'Step 3B'}</Text>
                  </View>
                  <Text style={styles.heroTitle}>
                    {provider === 'PAYSTACK' ? 'Enter your bank details' : 'Connect your bank account'}
                  </Text>
                  <Text style={styles.heroCopy}>
                    {provider === 'PAYSTACK'
                      ? 'We’ll verify the account number first, then create your payout recipient only after you confirm the resolved name.'
                      : 'We use Stripe to send payments securely to your bank account. You’ll be taken to Stripe’s secure setup and then returned here.'}
                  </Text>
                </View>

                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Payout summary</Text>
                  <SummaryRow label="Payout currency" value={selectedCurrency} />
                  <SummaryRow label="Provider" value={providerLabel(provider)} />
                  <SummaryRow label="Country" value={provider === 'PAYSTACK' ? selectedOption.countryLabel : countryCode} />
                </View>

                {provider === 'PAYSTACK' ? (
                  <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Bank verification</Text>
                    <Text style={styles.sectionCopy}>Pick your bank, enter the account number, and verify it before saving.</Text>

                    {banksLoading && !banks.length ? (
                      <View style={styles.inlineInfoCard}>
                        <ActivityIndicator color={Colors.needleGreen} />
                        <Text style={styles.inlineInfoText}>Loading supported banks…</Text>
                      </View>
                    ) : null}

                    {bankDirectory?.source === 'fallback' && bankDirectory.warning ? (
                      <View style={styles.inlineInfoCard}>
                        <Feather name="alert-circle" size={16} color={Colors.warning} />
                        <Text style={styles.inlineInfoText}>{bankDirectory.warning}</Text>
                      </View>
                    ) : null}

                    {banks.length > 0 ? (
                      <Input
                        label="Bank name"
                        value={bankSearch}
                        onChangeText={setBankSearch}
                        placeholder="Search for your bank"
                      />
                    ) : (
                      <Button
                        label={banksLoading ? 'Loading banks…' : 'Load supported banks'}
                        variant="secondary"
                        loading={banksLoading}
                        onPress={() => { void handleLoadBanks() }}
                      />
                    )}

                    {banks.length === 0 && !banksLoading ? (
                      <Button
                        label={MANUAL_BANK_ENTRY_OPTION_LABEL}
                        variant="secondary"
                        onPress={handleSelectManualBank}
                      />
                    ) : null}

                    {selectedBank && !manualBankMode ? (
                      <View style={styles.selectedBankCard}>
                        <Text style={styles.selectedBankLabel}>Selected bank</Text>
                        <Text style={styles.selectedBankName}>{selectedBank.name}</Text>
                      </View>
                    ) : null}

                    {manualBankMode ? (
                      <View style={styles.selectedBankCard}>
                        <Text style={styles.selectedBankLabel}>Manual bank entry</Text>
                        <Text style={styles.selectedBankName}>{MANUAL_BANK_ENTRY_OPTION_LABEL}</Text>
                      </View>
                    ) : null}

                    {banks.length > 0 ? (
                      <View style={styles.bankList}>
                        <ScrollView
                          nestedScrollEnabled
                          keyboardShouldPersistTaps="handled"
                          showsVerticalScrollIndicator
                          style={styles.bankListScroll}
                        >
                          {filteredBanks.length > 0 ? (
                            filteredBanks.map((bank) => (
                              <TouchableOpacity
                                key={`${bank.code}:${bank.name}`}
                                style={[styles.bankRow, !manualBankMode && selectedBank?.code === bank.code && styles.bankRowActive]}
                                onPress={() => handleSelectListedBank(bank)}
                              >
                                <View style={styles.bankRowContent}>
                                  <BankLogo
                                    bank={bank}
                                    failed={failedBankLogos[`${bank.code}:${bank.name}`] === true}
                                    onError={() => setFailedBankLogos((current) => ({
                                      ...current,
                                      [`${bank.code}:${bank.name}`]: true,
                                    }))}
                                  />
                                  <View style={{ flex: 1 }}>
                                    <Text style={[styles.bankRowText, !manualBankMode && selectedBank?.code === bank.code && styles.bankRowTextActive]}>
                                      {bank.name}
                                    </Text>
                                    {bank.country || bank.currency ? (
                                      <Text style={styles.bankRowMeta}>{[bank.country, bank.currency].filter(Boolean).join(' · ')}</Text>
                                    ) : null}
                                  </View>
                                </View>
                              </TouchableOpacity>
                            ))
                          ) : (
                            <Text style={styles.emptyBankText}>No listed banks match your search.</Text>
                          )}
                          <TouchableOpacity
                            style={[styles.bankRow, styles.manualBankRow, manualBankMode && styles.bankRowActive]}
                            onPress={handleSelectManualBank}
                          >
                            <View style={styles.manualBankRowContent}>
                              <View style={styles.manualBankIcon}>
                                <Feather name="edit-3" size={14} color={Colors.needleGreen} />
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={[styles.bankRowText, manualBankMode && styles.bankRowTextActive]}>
                                  {MANUAL_BANK_ENTRY_OPTION_LABEL}
                                </Text>
                                <Text style={styles.bankRowMeta}>Enter SWIFT / BIC and account details manually</Text>
                              </View>
                            </View>
                          </TouchableOpacity>
                        </ScrollView>
                      </View>
                    ) : null}

                    {manualBankMode ? (
                      <View style={styles.manualForm}>
                        <View style={styles.inlineInfoCard}>
                          <Feather name="info" size={16} color={Colors.needleGreen} />
                          <Text style={styles.inlineInfoText}>
                            {selectedCurrency === 'NGN'
                              ? 'Manual entry is only for banks missing from the picker. If your bank is listed, go back and choose it from the bank list.'
                              : MANUAL_BANK_ENTRY_NOTE}
                          </Text>
                        </View>

                        {selectedCurrency === 'NGN' ? (
                          <Button
                            label="Back to bank list"
                            variant="secondary"
                            onPress={() => {
                              setManualBankMode(false)
                              setManualCountryOpen(false)
                              setManualFieldErrors({})
                              setFieldError('')
                              setBankSearch('Paystack')
                            }}
                          />
                        ) : null}

                        <Input
                          label="Bank name"
                          required
                          value={manualBankName}
                          onChangeText={(value) => {
                            setManualBankName(value)
                            clearManualFieldError('bankName')
                            setFieldError('')
                          }}
                          error={manualFieldErrors.bankName}
                          placeholder="Enter your bank name"
                        />

                        <View style={styles.countryField}>
                          <Text style={styles.countryLabel}>Bank country <Text style={styles.requiredMark}>*</Text></Text>
                          <TouchableOpacity
                            style={[styles.countrySelector, manualFieldErrors.bankCountryCode && styles.countrySelectorError]}
                            onPress={() => setManualCountryOpen((open) => !open)}
                            activeOpacity={0.8}
                          >
                            <Text style={styles.countrySelectorText}>
                              {manualBankCountry ? manualBankCountry.name : 'Choose bank country'}
                            </Text>
                            <Feather name={manualCountryOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.midGrey} />
                          </TouchableOpacity>
                          {manualFieldErrors.bankCountryCode ? (
                            <Text style={styles.errorText}>{manualFieldErrors.bankCountryCode}</Text>
                          ) : null}
                          {manualCountryOpen ? (
                            <View style={styles.countryList}>
                              <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} style={styles.countryListScroll}>
                                {MANUAL_BANK_COUNTRIES.map((country) => (
                                  <TouchableOpacity
                                    key={country.code}
                                    style={[
                                      styles.countryRow,
                                      manualBankCountryCode === country.code && styles.countryRowActive,
                                    ]}
                                    onPress={() => {
                                      setManualBankCountryCode(country.code)
                                      setManualCountryOpen(false)
                                      clearManualFieldError('bankCountryCode')
                                      setFieldError('')
                                    }}
                                  >
                                    <Text style={[
                                      styles.countryRowText,
                                      manualBankCountryCode === country.code && styles.countryRowTextActive,
                                    ]}>
                                      {country.name}
                                    </Text>
                                    <Text style={styles.countryCodeText}>{country.code}</Text>
                                  </TouchableOpacity>
                                ))}
                              </ScrollView>
                            </View>
                          ) : null}
                        </View>

                        <Input
                          label="SWIFT / BIC code"
                          required
                          value={manualSwiftBic}
                          onChangeText={(value) => {
                            setManualSwiftBic(normalizeSwiftBic(value))
                            clearManualFieldError('swiftBic')
                            setFieldError('')
                          }}
                          error={manualFieldErrors.swiftBic}
                          hint="Use the bank's international SWIFT/BIC, not its Paystack bank code."
                          autoCapitalize="characters"
                          placeholder="8 or 11 characters"
                        />

                        <Input
                          label="Account number"
                          required
                          value={manualAccountNumber}
                          onChangeText={(value) => {
                            setManualAccountNumber(value)
                            clearManualFieldError('accountNumber')
                            setFieldError('')
                          }}
                          error={manualFieldErrors.accountNumber}
                          placeholder="Enter the account number"
                        />

                        <Input
                          label="Account name"
                          required
                          value={manualAccountName}
                          onChangeText={(value) => {
                            setManualAccountName(value)
                            clearManualFieldError('accountName')
                            setFieldError('')
                          }}
                          error={manualFieldErrors.accountName}
                          placeholder="Enter the account holder name"
                        />

                        <Button
                          label={submitting ? 'Submitting for review…' : 'Submit for verification'}
                          loading={submitting}
                          onPress={() => { void handleSubmitManualBank() }}
                        />
                      </View>
                    ) : (
                      <>
                        <Input
                          label="Account number"
                          value={accountNumber}
                          onChangeText={(value) => {
                            setAccountNumber(value.replace(/\D+/gu, ''))
                            setVerification(null)
                            setFieldError('')
                          }}
                          keyboardType="number-pad"
                          placeholder="Enter the account number"
                        />

                        {!verification ? (
                          <Button
                            label={submitting ? 'Verifying account…' : 'Verify account'}
                            loading={submitting}
                            onPress={() => { void handleVerifyPaystack() }}
                          />
                        ) : (
                          <View style={styles.verifiedCard}>
                            <View style={styles.verifiedHeader}>
                              <View style={styles.verifiedIcon}>
                                <Feather name="check" size={16} color={Colors.textInverse} />
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.verifiedTitle}>Account verified</Text>
                                <Text style={styles.verifiedMeta}>Is this your account?</Text>
                              </View>
                            </View>
                            <Text style={styles.verifiedName}>{verification.resolvedAccountName}</Text>
                            <Text style={styles.verifiedAccountText}>{verification.maskedAccountNumber}</Text>
                            <Button
                              label="Confirm payout account"
                              size="md"
                              loading={submitting}
                              onPress={() => { void handleConfirmPaystack() }}
                            />
                            <TouchableOpacity
                              style={styles.compactActionMenuButton}
                              onPress={() => {
                                setVerification(null)
                                setSelectedBank(null)
                                setBankSearch('')
                              }}
                              activeOpacity={0.82}
                            >
                              <Text style={styles.compactActionMenuText}>Edit bank details</Text>
                              <Feather name="edit-3" size={14} color={Colors.needleGreen} />
                            </TouchableOpacity>
                          </View>
                        )}
                      </>
                    )}

                    {fieldError ? <Text style={styles.errorText}>{fieldError}</Text> : null}
                  </View>
                ) : (
                  <>
                    <View style={styles.card}>
                      <Text style={styles.sectionTitle}>What you’ll need</Text>
                      <Text style={styles.sectionCopy}>Stripe handles the compliance checks for you. Most tailors finish this in about 2 minutes.</Text>
                      <BenefitRow icon="credit-card" title="Your bank account details" body="Stripe will ask where payouts should land." />
                      <BenefitRow icon="file-text" title="Government-issued ID" body="Stripe uses this to verify the account holder securely." />
                      <BenefitRow icon="calendar" title="Your date of birth" body="Stripe may ask for this to complete onboarding." />
                    </View>

                    {stripeStatus && !stripeStatus.payoutAccountVerified ? (
                      <View style={styles.card}>
                        <Text style={styles.sectionTitle}>Still needed from Stripe</Text>
                        <View style={styles.checkRow}>
                          <Feather name={stripeStatus.detailsSubmitted ? 'check-circle' : 'circle'} size={16} color={stripeStatus.detailsSubmitted ? Colors.needleGreen : Colors.midGrey} />
                          <Text style={styles.checkText}>Profile details submitted</Text>
                        </View>
                        <View style={styles.checkRow}>
                          <Feather name={stripeStatus.chargesEnabled ? 'check-circle' : 'circle'} size={16} color={stripeStatus.chargesEnabled ? Colors.needleGreen : Colors.midGrey} />
                          <Text style={styles.checkText}>Charges enabled</Text>
                        </View>
                        <View style={styles.checkRow}>
                          <Feather name={stripeStatus.payoutsEnabled ? 'check-circle' : 'circle'} size={16} color={stripeStatus.payoutsEnabled ? Colors.needleGreen : Colors.midGrey} />
                          <Text style={styles.checkText}>Payouts enabled</Text>
                        </View>
                      </View>
                    ) : null}

                    {fieldError ? <Text style={styles.errorText}>{fieldError}</Text> : null}

                    <Button
                      label={submitting ? 'Opening Stripe…' : 'Continue to Stripe'}
                      loading={submitting}
                      onPress={() => { void handleStartStripe() }}
                    />
                  </>
                )}
              </>
            ) : null}
          </ScrollView>

          {activeStep === 'INTRO' ? (
            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom + Spacing.lg, 84) }]}>
              <Button label="Set up payout account" onPress={() => setActiveStep('CURRENCY')} />
            </View>
          ) : null}

          {activeStep === 'CURRENCY' ? (
            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom + Spacing.lg, 84) }]}>
              <Button label="Continue" onPress={() => setActiveStep('CONNECT')} />
            </View>
          ) : null}
        </>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    ...Shadow.sm,
  },
  headerTitle: {
    flex: 1,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  stateWrap: { flex: 1, justifyContent: 'center', padding: Spacing.xl },
  stateCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    alignItems: 'center',
    ...Shadow.md,
  },
  stateEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  stateTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
    fontFamily: Fonts.display,
  },
  stateHint: { fontSize: FontSize.xs, color: Colors.inkLight, textAlign: 'center', lineHeight: 18 },
  stepRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.sm,
  },
  stepChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  stepChipActive: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreenLight,
  },
  stepChipComplete: {
    borderColor: Colors.needleGreen + '50',
  },
  stepNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.boneDeep,
  },
  stepNumberActive: {
    backgroundColor: Colors.needleGreen,
  },
  stepNumberText: {
    fontSize: 11,
    fontWeight: FontWeight.semibold,
    color: Colors.midGrey,
  },
  stepNumberTextActive: {
    color: Colors.textInverse,
  },
  stepChipText: {
    fontSize: 11,
    color: Colors.midGrey,
    fontWeight: FontWeight.medium,
  },
  stepChipTextActive: {
    color: Colors.needleGreen,
  },
  body: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  heroBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  heroTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    lineHeight: 28,
    fontFamily: Fonts.display,
  },
  heroCopy: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 19,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  sectionTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  sectionCopy: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 18,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    paddingVertical: 2,
  },
  benefitIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
    flexShrink: 0,
  },
  benefitBody: {
    flex: 1,
    gap: 2,
  },
  benefitTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  benefitText: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 17,
  },
  currencyList: {
    gap: Spacing.sm,
  },
  currencyCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  currencyCardActive: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreenLight,
  },
  currencyCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  currencyFlag: {
    fontSize: 22,
  },
  providerBadge: {
    borderRadius: Radius.full,
    backgroundColor: Colors.boneDeep,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
  },
  providerBadgeText: {
    fontSize: 11,
    fontWeight: FontWeight.semibold,
    color: Colors.midGrey,
  },
  currencyCode: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  currencyName: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.medium,
  },
  currencyMeta: {
    fontSize: 11,
    color: Colors.midGrey,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  summaryLabel: {
    fontSize: 11,
    color: Colors.midGrey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryValue: {
    flex: 1,
    fontSize: FontSize.xs,
    color: Colors.ink,
    fontWeight: FontWeight.medium,
    textAlign: 'right',
  },
  inlineInfoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.boneDeep,
    padding: Spacing.md,
  },
  inlineInfoText: {
    flex: 1,
    fontSize: FontSize.xs,
    color: Colors.inkLight,
  },
  guardHint: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 18,
    textAlign: 'center',
  },
  selectedBankCard: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.needleGreenLight,
    gap: 3,
  },
  selectedBankLabel: {
    fontSize: 11,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: FontWeight.semibold,
  },
  selectedBankName: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  bankList: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    overflow: 'hidden',
  },
  bankListScroll: {
    maxHeight: 240,
  },
  bankRow: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  bankRowActive: {
    backgroundColor: Colors.needleGreenLight,
  },
  manualBankRow: {
    backgroundColor: Colors.boneDeep,
  },
  manualBankRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  bankRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  bankLogoImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  bankLogoFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.boneDeep,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  bankLogoFallbackText: {
    fontSize: 11,
    color: Colors.needleGreen,
    fontWeight: FontWeight.bold,
  },
  manualBankIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  bankRowText: {
    fontSize: FontSize.xs,
    color: Colors.ink,
  },
  bankRowMeta: {
    marginTop: 2,
    fontSize: 11,
    color: Colors.midGrey,
    lineHeight: 15,
  },
  bankRowTextActive: {
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  emptyBankText: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: FontSize.xs,
    color: Colors.midGrey,
  },
  manualForm: {
    gap: Spacing.sm,
  },
  countryField: {
    gap: 6,
  },
  countryLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: Colors.midGrey,
  },
  requiredMark: {
    color: Colors.kanteRust,
  },
  countrySelector: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  countrySelectorError: {
    borderColor: Colors.error,
  },
  countrySelectorText: {
    flex: 1,
    fontSize: FontSize.md,
    color: Colors.ink,
  },
  countryList: {
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.md,
    backgroundColor: Colors.white,
    overflow: 'hidden',
  },
  countryListScroll: {
    maxHeight: 220,
  },
  countryRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
  },
  countryRowActive: {
    backgroundColor: Colors.needleGreenLight,
  },
  countryRowText: {
    flex: 1,
    fontSize: FontSize.xs,
    color: Colors.ink,
  },
  countryRowTextActive: {
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  countryCodeText: {
    fontSize: 11,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
  },
  verifiedCard: {
    borderRadius: Radius.md,
    backgroundColor: Colors.needleGreenLight,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '30',
  },
  verifiedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  verifiedIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
  },
  verifiedTitle: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  verifiedMeta: {
    fontSize: 11,
    color: Colors.needleGreenDark,
  },
  verifiedName: {
    fontSize: FontSize.lg,
    color: Colors.ink,
    fontWeight: FontWeight.bold,
    fontFamily: Fonts.display,
  },
  verifiedAccountText: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
  },
  inlineActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  inlineButton: {
    flex: 1,
  },
  compactActionMenuButton: {
    minHeight: 46,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  compactActionMenuText: {
    color: Colors.needleGreen,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  checkText: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
  },
  errorText: {
    fontSize: FontSize.xs,
    color: Colors.error,
    lineHeight: 18,
  },
  footer: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
    backgroundColor: Colors.bone,
  },
  successWrap: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  successOrb: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
    ...Shadow.lg,
  },
  successOrbPending: {
    backgroundColor: Colors.warning,
  },
  successTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
    fontFamily: Fonts.display,
  },
  successBody: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 21,
    textAlign: 'center',
  },
  successChecklist: {
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '30',
  },
  successCheckRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  successCheckText: {
    flex: 1,
    fontSize: FontSize.xs,
    color: Colors.needleGreenDark,
    lineHeight: 18,
    fontWeight: FontWeight.medium,
  },
})
