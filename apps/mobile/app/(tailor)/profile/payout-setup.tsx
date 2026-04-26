import { useEffect, useMemo, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Linking,
} from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { CONTACTS } from '@drape/shared'
import { Button, Input } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { goBackOrFallback } from '@/lib/navigation'
import { supabase } from '@/lib/supabase'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { loadLatestPayoutSetupRequest, submitPayoutSetupRequest, type PayoutSetupProvider, type TailorPayoutSetupRequest } from '@/lib/payout-setup'
import { payoutSetupCopy, suggestedPayoutProvider } from '@/lib/tailor-readiness'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

type LoadState = {
  currency: string
  displayName: string
  request: TailorPayoutSetupRequest | null
}

export default function TailorPayoutSetupScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [loadState, setLoadState] = useState<LoadState>({ currency: 'GBP', displayName: 'Your tailor profile', request: null })

  const [provider, setProvider] = useState<PayoutSetupProvider>('STRIPE')
  const [country, setCountry] = useState('')
  const [accountHolderName, setAccountHolderName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [payoutDetails, setPayoutDetails] = useState('')
  const [note, setNote] = useState('')
  const [fieldError, setFieldError] = useState('')

  const payoutCopy = useMemo(() => payoutSetupCopy(loadState.currency), [loadState.currency])

  function goBack() {
    goBackOrFallback(router, navigation, '/(tailor)/profile/trust-access' as never)
  }

  async function openEmailFallback() {
    const url = `mailto:${CONTACTS.payouts}?subject=${encodeURIComponent(`Drape payout setup: ${loadState.currency} via ${provider}`)}`
    const supported = await Linking.canOpenURL(url)
    if (!supported) {
      Alert.alert('Unable to open email', `Please email ${CONTACTS.payouts} directly from your mail app.`)
      return
    }

    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert('Unable to open email', `Please email ${CONTACTS.payouts} directly from your mail app.`)
    }
  }

  async function load() {
    if (!user?.id) {
      setLoadError('Please sign in again before opening payout setup.')
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError('')

    try {
      const [profileRes, request] = await Promise.all([
        supabase
          .from('tailor_profiles')
          .select('display_name, currency')
          .eq('user_id', user.id)
          .maybeSingle(),
        loadLatestPayoutSetupRequest(user.id),
      ])

      if (profileRes.error) throw profileRes.error

      const profile = profileRes.data as any
      const currency = profile?.currency ?? 'GBP'
      const suggestedProvider = suggestedPayoutProvider(currency)

      setLoadState({
        currency,
        displayName: profile?.display_name ?? 'Your tailor profile',
        request,
      })
      setProvider(suggestedProvider === 'Paystack' ? 'PAYSTACK' : 'STRIPE')
      if (!accountHolderName.trim() && profile?.display_name) setAccountHolderName(profile.display_name)
    } catch (error) {
      setLoadError(
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Retry when the signal improves to load payout setup.'
          : 'We could not load payout setup right now.',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [user?.id])

  async function handleSubmit() {
    if (submitting) return
    if (!country.trim() || !accountHolderName.trim() || payoutDetails.trim().length < 12) {
      setFieldError('Add your country, account holder name, and enough payout detail so Drape can link the right account.')
      return
    }

    setSubmitting(true)
    const result = await submitPayoutSetupRequest({
      provider,
      currency: loadState.currency,
      country,
      accountHolderName,
      businessName,
      payoutDetails,
      note,
    })
    setSubmitting(false)

    if (result.error) {
      setFieldError(result.error)
      return
    }

    if (result.alreadyPending) {
      Alert.alert('Already pending', 'Drape already has a payout setup request open for this tailor profile.')
      void load()
      return
    }

    setSubmitted(true)
    void load()
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
            <Text style={styles.stateEyebrow}>Payout setup</Text>
            <ActivityIndicator color={Colors.needleGreen} />
            <Text style={styles.stateTitle}>Loading your payout setup...</Text>
            <Text style={styles.stateHint}>We’re checking the seller profile, currency path, and any existing payout request first.</Text>
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
            <Text style={styles.stateEyebrow}>Payout setup</Text>
            <Text style={styles.stateTitle}>Couldn't load this yet.</Text>
            <Text style={styles.stateHint}>{loadError}</Text>
            <Button label="Try again" onPress={() => { void load() }} />
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (submitted || ['PENDING', 'IN_REVIEW'].includes(loadState.request?.status ?? '')) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={goBack}>
            <Feather name="arrow-left" size={20} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Payout setup</Text>
        </View>

        <View style={styles.body}>
          <View style={styles.heroCard}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>
                {loadState.request?.status === 'IN_REVIEW' ? 'In review' : 'Request received'}
              </Text>
            </View>
            <Text style={styles.heroTitle}>Your payout setup is now with Drape.</Text>
            <Text style={styles.heroCopy}>
              We now have a structured payout request on file for {loadState.displayName}. Paid work stays blocked until this gets linked cleanly to the seller profile.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Current payout path</Text>
            <Text style={styles.sectionCopy}>
              {loadState.request?.provider === 'PAYSTACK' ? 'Paystack' : 'Stripe'} for {loadState.request?.currency ?? loadState.currency}
            </Text>
            <Text style={styles.sectionCopy}>Status: {loadState.request?.status ?? 'PENDING'}</Text>
            {loadState.request?.createdAt ? (
              <Text style={styles.mutedText}>Submitted {new Date(loadState.request.createdAt).toLocaleString()}</Text>
            ) : null}
          </View>

          <View style={styles.noteCard}>
            <Text style={styles.noteTitle}>Need to add context?</Text>
            <Text style={styles.noteCopy}>If the provider or bank details change before Drape finishes linking them, email {CONTACTS.payouts} from your account email and mention this payout request.</Text>
          </View>

          <Button label="Back to trust & access" onPress={() => router.replace('/(tailor)/profile/trust-access' as never)} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payout setup</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Structured next step</Text>
          </View>
          <Text style={styles.heroTitle}>{payoutCopy.title}</Text>
          <Text style={styles.heroCopy}>{payoutCopy.body}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Suggested provider</Text>
          <View style={styles.providerRow}>
            {(['STRIPE', 'PAYSTACK'] as const).map((item) => {
              const active = provider === item
              return (
                <TouchableOpacity
                  key={item}
                  style={[styles.providerChip, active && styles.providerChipActive]}
                  onPress={() => setProvider(item)}
                >
                  <Text style={[styles.providerChipText, active && styles.providerChipTextActive]}>
                    {item === 'PAYSTACK' ? 'Paystack' : 'Stripe'}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
          <Text style={styles.sectionCopy}>Main selling currency: {loadState.currency}. Use the provider you expect Drape to link for this seller profile.</Text>
        </View>

        <Input
          label="Country"
          value={country}
          onChangeText={(text) => {
            setCountry(text)
            if (fieldError) setFieldError('')
          }}
          placeholder="e.g. Nigeria"
        />

        <Input
          label="Account holder name"
          value={accountHolderName}
          onChangeText={(text) => {
            setAccountHolderName(text)
            if (fieldError) setFieldError('')
          }}
          placeholder="John Doe"
        />

        <Input
          label="Business name"
          value={businessName}
          onChangeText={setBusinessName}
          placeholder="Optional"
        />

        <Input
          label="Payout details"
          value={payoutDetails}
          onChangeText={(text) => {
            setPayoutDetails(text)
            if (fieldError) setFieldError('')
          }}
          multiline
          numberOfLines={5}
          placeholder="Example: Access Bank, account ending 4451, recipient code already created in Paystack. Or Stripe connected account email."
          hint="Include enough detail for Drape to match the right payout account without guessing."
        />

        <Input
          label="Note"
          value={note}
          onChangeText={setNote}
          multiline
          numberOfLines={4}
          placeholder="Optional context for payouts support"
        />

        {fieldError ? <Text style={styles.errorText}>{fieldError}</Text> : null}

        <Button
          label={submitting ? 'Submitting...' : 'Submit payout setup'}
          onPress={() => { void handleSubmit() }}
          loading={submitting}
          disabled={submitting}
        />
        <Button label="Email payouts instead" variant="secondary" onPress={() => { void openEmailFallback() }} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: Radius.full,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    ...Shadow.sm,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink },
  body: { padding: Spacing.xl, paddingBottom: 64, gap: Spacing.lg, flexGrow: 1 },
  stateWrap: { flex: 1, padding: Spacing.xl },
  stateCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  stateEyebrow: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  stateTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 22 },
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
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
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  heroTitle: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink, lineHeight: 34 },
  heroCopy: { fontSize: FontSize.md, color: Colors.inkLight, lineHeight: 24 },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  sectionCopy: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 22 },
  mutedText: { fontSize: FontSize.xs, color: Colors.midGrey },
  providerRow: { flexDirection: 'row', gap: Spacing.md, flexWrap: 'wrap' },
  providerChip: {
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.white,
  },
  providerChipActive: {
    backgroundColor: Colors.needleGreenLight,
    borderColor: Colors.needleGreen,
  },
  providerChipText: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.medium },
  providerChipTextActive: { color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  noteCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  noteTitle: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  noteCopy: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 21 },
  errorText: { fontSize: FontSize.sm, color: Colors.kanteRust },
})
