import { useCallback, useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking, ActivityIndicator,
} from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { CONTACTS, buildWhatsAppSupportUrl } from '@drape/shared'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { appendToHistory, goBackOrFallback } from '@/lib/navigation'
import { deriveTailorAccessGuidance } from '@/lib/tailor-access'
import { payoutSetupCopy, type TailorReadinessInput } from '@/lib/tailor-readiness'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

type TailorAccessRow = {
  profile_completed: boolean | null
  id_verification_status: string | null
  is_live: boolean | null
  ships_internationally: boolean | null
  currency: string | null
  payout_currency: string | null
  payout_provider: 'PAYSTACK' | 'STRIPE' | null
  payout_reverification_required: boolean | null
  payout_account_verified: boolean | null
  payout_account_type: 'PAYSTACK' | 'STRIPE_CONNECT' | null
}

export default function TailorTrustAccessScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const userId = user?.id
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [input, setInput] = useState<TailorReadinessInput | null>(null)
  const [workingCurrency, setWorkingCurrency] = useState<string | null>(null)

  function goBack() {
    goBackOrFallback(router, navigation, '/(tailor)/profile/account-settings')
  }

  async function openEmail(email: string, subject: string) {
    const url = `mailto:${email}?subject=${encodeURIComponent(subject)}`
    const supported = await Linking.canOpenURL(url)
    if (!supported) {
      Alert.alert('Unable to open link', `Please email ${email} directly from your mail app.`)
      return
    }

    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert('Unable to open link', `Please email ${email} directly from your mail app.`)
    }
  }

  async function openWhatsAppSupport() {
    const url = buildWhatsAppSupportUrl('Hi Drapeon, I need tailor support with my account access state.')
    const supported = await Linking.canOpenURL(url)
    if (!supported) {
      Alert.alert('Unable to open link', `Please message Drapeon in WhatsApp, or email ${CONTACTS.tailors} directly from your mail app.`)
      return
    }

    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert('Unable to open link', `Please message Drapeon in WhatsApp, or email ${CONTACTS.tailors} directly from your mail app.`)
    }
  }

  const load = useCallback(async () => {
    if (!userId) {
      setInput(null)
      setLoadError('')
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError('')

    try {
      const { data, error } = await supabase
        .from('tailor_profiles')
        .select('profile_completed, id_verification_status, is_live, ships_internationally, currency, payout_currency, payout_provider, payout_reverification_required, payout_account_verified, payout_account_type')
        .eq('user_id', userId)
        .maybeSingle()

      if (error) throw error
      if (!data) {
        setInput(null)
        setLoadError('We could not find your tailor access state yet. Finish setup first, then retry here.')
        setLoading(false)
        return
      }

      const row = data as TailorAccessRow
      setInput({
        profileCompleted: row.profile_completed ?? false,
        idVerificationStatus: row.id_verification_status ?? 'NOT_SUBMITTED',
        isLive: row.is_live ?? false,
        stripeAccountId: null,
        paystackAccountId: null,
        payoutCurrency: row.payout_currency ?? null,
        payoutProvider: row.payout_provider ?? null,
        payoutReverificationRequired: row.payout_reverification_required ?? null,
        payoutAccountVerified: row.payout_account_verified ?? null,
        payoutAccountType: row.payout_account_type ?? null,
        shipsInternationally: row.ships_internationally ?? false,
      })
      setWorkingCurrency(row.currency ?? null)
    } catch (error) {
      setLoadError(
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Retry when the signal improves to reload your tailor access details.'
          : 'We could not load your tailor access details right now.'
      )
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    const timer = setTimeout(() => {
      void load()
    }, 0)
    return () => clearTimeout(timer)
  }, [load])

  const guidance = deriveTailorAccessGuidance(input)
  const payoutNextStep = payoutSetupCopy(workingCurrency)
  const badgeStyle =
    guidance.state === 'CLEAR'
      ? styles.badgeClear
      : guidance.state === 'UNDER_REVIEW'
        ? styles.badgeReview
        : styles.badgeFix
  const badgeTextStyle =
    guidance.state === 'CLEAR'
      ? styles.badgeTextClear
      : guidance.state === 'UNDER_REVIEW'
        ? styles.badgeTextReview
        : styles.badgeTextFix

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={goBack}>
            <Feather name="arrow-left" size={20} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Trust & access</Text>
        </View>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Seller access</Text>
            <ActivityIndicator color={Colors.needleGreen} />
            <Text style={styles.stateTitle}>Loading access details…</Text>
            <Text style={styles.stateHint}>
              We’re checking your current profile, verification, and payout signals so this page can stay honest.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={goBack}>
            <Feather name="arrow-left" size={20} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Trust & access</Text>
        </View>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Seller access</Text>
            <Text style={styles.stateTitle}>Couldn't load this yet.</Text>
            <Text style={styles.stateHint}>{loadError}</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => { void load() }}>
              <Text style={styles.primaryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={goBack}>
              <Text style={styles.secondaryBtnText}>Back to settings</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Trust & access</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        {/* ── Status + Reason ── */}
        <View style={styles.statusCard}>
          <View style={[styles.badge, badgeStyle]}>
            <Text style={[styles.badgeText, badgeTextStyle]}>
              {guidance.state === 'CLEAR' ? 'Clear' : guidance.state === 'UNDER_REVIEW' ? 'In review' : 'Fix required'}
            </Text>
          </View>
          <Text style={styles.heroTitle}>{guidance.title}</Text>
          <Text style={styles.heroBody}>{guidance.body}</Text>
          <View style={styles.cardDivider} />
          <Text style={styles.sectionEyebrow}>Reason</Text>
          <Text style={styles.sectionTitle}>{guidance.reasonCategory}</Text>
          <Text style={styles.sectionBody}>{guidance.nextStep}</Text>
        </View>

        {/* ── Action card — hidden when clear ── */}
        {guidance.state !== 'CLEAR' && (
          <View style={styles.infoCard}>
            {guidance.blockedCapabilities.length > 0 && (
              <>
                <Text style={styles.sectionEyebrow}>Blocked right now</Text>
                <View style={styles.list}>
                  {guidance.blockedCapabilities.map((item) => (
                    <View key={item} style={styles.listRow}>
                      <Feather name="slash" size={14} color={Colors.kanteRust} />
                      <Text style={styles.listText}>{item}</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.cardDivider} />
              </>
            )}
            {guidance.reasonCategory === 'Payout readiness' && (
              <>
                <Text style={styles.sectionEyebrow}>Payout setup</Text>
                <Text style={styles.sectionTitle}>{payoutNextStep.title}</Text>
                <Text style={styles.sectionBody}>{payoutNextStep.body}</Text>
                <Text style={styles.noteText}>
                  Submit the payout setup inside Drapeon so this blocker is durable and visible. Email is still there if the app path fails, but it should not be your first stop anymore.
                </Text>
                <View style={styles.cardDivider} />
              </>
            )}
            <Text style={styles.sectionEyebrow}>
              {guidance.state === 'UNDER_REVIEW' ? 'While in review' : 'How to fix'}
            </Text>
            <Text style={styles.sectionBody}>
              {guidance.state === 'UNDER_REVIEW'
                ? 'This reads like a review state. The usual next move is to wait or add missing context, not to file a full appeal immediately.'
                : 'This reads like a self-fixable hold first. Fix the requirement in-app when possible, then use support if the result still looks wrong.'}
            </Text>
            {guidance.appealCopy ? <Text style={styles.noteText}>{guidance.appealCopy}</Text> : null}
            <View style={styles.actionBtns}>
              {guidance.reasonCategory === 'Payout readiness' && (
                <TouchableOpacity
                  style={styles.reviewBtn}
                  onPress={() => router.push({ pathname: '/(tailor)/profile/payout-setup', params: { returnTo: '/(tailor)/profile/trust-access', historyChain: appendToHistory(undefined, '/(tailor)/profile/trust-access') } } as never)}
                >
                  <Text style={styles.reviewBtnText}>Start payout setup</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={guidance.reasonCategory === 'Payout readiness' ? styles.ghostBtn : styles.reviewBtn}
                onPress={() => router.push('/(tailor)/profile/access-review' as never)}
              >
                <Text style={guidance.reasonCategory === 'Payout readiness' ? styles.ghostBtnText : styles.reviewBtnText}>
                  Request human review
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Support ── */}
        <View style={styles.infoCard}>
          <Text style={styles.sectionEyebrow}>Need human help?</Text>
          <Text style={styles.sectionBody}>
            Use the inbox that matches the issue so trust, verification, and payout questions do not get lost in the wrong queue.
          </Text>
          <View style={styles.contactRows}>
            {guidance.supportEmail ? (
              <TouchableOpacity
                style={styles.contactRow}
                onPress={() => { void openEmail(guidance.supportEmail!, guidance.supportSubject ?? 'Drapeon tailor access question') }}
              >
                <View style={styles.contactIcon}>
                  <Feather name="mail" size={16} color={Colors.needleGreen} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contactTitle}>{guidance.supportLabel ?? 'Support'}</Text>
                  <Text style={styles.contactSub}>{guidance.supportEmail}</Text>
                </View>
                <Feather name="chevron-right" size={16} color={Colors.midGrey} />
              </TouchableOpacity>
            ) : null}
            {guidance.supportEmail !== CONTACTS.tailors ? (
              <TouchableOpacity
                style={styles.contactRow}
                onPress={() => { void openEmail(CONTACTS.tailors, 'Drapeon tailor support request') }}
              >
                <View style={styles.contactIcon}>
                  <Feather name="help-circle" size={16} color={Colors.needleGreen} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contactTitle}>Tailor support</Text>
                  <Text style={styles.contactSub}>{CONTACTS.tailors}</Text>
                </View>
                <Feather name="chevron-right" size={16} color={Colors.midGrey} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.contactRow, styles.contactRowLast]}
              onPress={() => { void openWhatsAppSupport() }}
            >
              <View style={styles.contactIcon}>
                <Feather name="message-circle" size={16} color={Colors.needleGreen} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.contactTitle}>WhatsApp support</Text>
                <Text style={styles.contactSub}>Message Drapeon directly</Text>
              </View>
              <Feather name="chevron-right" size={16} color={Colors.midGrey} />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
  },
  backBtn: {
    width: 44, height: 44, borderRadius: Radius.full,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    ...Shadow.sm,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display },
  body: { padding: Spacing.lg, paddingBottom: Spacing.md, gap: Spacing.md },
  statusCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.lightGrey,
    marginVertical: 4,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  badgeClear: { backgroundColor: Colors.needleGreenLight },
  badgeReview: { backgroundColor: Colors.statusPendingBg },
  badgeFix: { backgroundColor: Colors.errorLight },
  badgeText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  badgeTextClear: { color: Colors.needleGreen },
  badgeTextReview: { color: Colors.warning },
  badgeTextFix: { color: Colors.kanteRust },
  heroTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, lineHeight: 28, fontFamily: Fonts.display },
  heroBody: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  infoCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  sectionEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  sectionBody: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  list: { gap: Spacing.sm },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  listText: { flex: 1, fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  noteText: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  actionBtns: {
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  reviewBtn: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  reviewBtnText: {
    color: Colors.textInverse,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  ghostBtn: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  ghostBtnText: {
    color: Colors.ink,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
  },
  contactRows: { marginTop: Spacing.xs },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 52,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
  },
  contactRowLast: { borderBottomWidth: 0 },
  contactIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  contactSub: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  stateCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
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
  stateTitle: { fontSize: FontSize.lg, color: Colors.ink, fontWeight: FontWeight.semibold, textAlign: 'center', fontFamily: Fonts.display },
  stateHint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 20 },
  primaryBtn: {
    backgroundColor: Colors.needleGreen,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 12,
    borderRadius: Radius.full,
  },
  primaryBtnText: { color: Colors.textInverse, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  secondaryBtn: {
    backgroundColor: Colors.white,
    borderColor: Colors.lightGrey,
    borderWidth: 1,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 12,
    borderRadius: Radius.full,
  },
  secondaryBtnText: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
})
