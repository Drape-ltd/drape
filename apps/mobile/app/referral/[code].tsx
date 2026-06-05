import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '@/lib/auth'
import { invokeFunction } from '@/lib/supabase'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

type PreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      referrerName: string
      completedOrderCount: number
      alreadyClaimedByYou: boolean
      claimedBySomeoneElse: boolean
    }

export default function ReferralClaimScreen() {
  const { code } = useLocalSearchParams<{ code: string }>()
  const referralCode = Array.isArray(code) ? code[0] : code
  const router = useRouter()
  const { session } = useAuth()
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' })
  const [claiming, setClaiming] = useState(false)

  useEffect(() => {
    if (!session?.access_token || !referralCode) {
      return
    }

    let cancelled = false

    async function load() {
      setPreview({ status: 'loading' })
      const { data, error } = await invokeFunction<{
        referrerName?: string
        completedOrderCount?: number
        alreadyClaimedByYou?: boolean
        claimedBySomeoneElse?: boolean
        error?: string
      }>('referral-action', { body: { action: 'preview', referralCode } })

      if (cancelled) return
      if (error || !data) {
        setPreview({ status: 'error', message: data?.error ?? 'This referral link could not be opened.' })
        return
      }

      setPreview({
        status: 'ready',
        referrerName: data.referrerName ?? 'A Drapeon customer',
        completedOrderCount: data.completedOrderCount ?? 0,
        alreadyClaimedByYou: data.alreadyClaimedByYou === true,
        claimedBySomeoneElse: data.claimedBySomeoneElse === true,
      })
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [referralCode, session?.access_token])

  async function handleClaim() {
    if (!referralCode || claiming) return
    setClaiming(true)
    const { data, error } = await invokeFunction<{ ok?: boolean; error?: string }>('referral-action', {
      body: { action: 'claim', referralCode },
    })
    setClaiming(false)

    if (error || !data?.ok) {
      const message = error
        ? isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. We could not claim the referral yet.'
          : await readFunctionErrorMessage(error, 'We could not claim this referral right now.')
        : data?.error ?? 'We could not claim this referral right now.'
      Alert.alert('Referral not claimed', message)
      return
    }

    Alert.alert(
      'Referral claimed',
      'Tailors can now see that you were referred through Drapeon when you place your next custom order.',
      [{ text: 'Find tailors', onPress: () => router.replace('/(customer)') }],
    )
  }

  if (!session?.access_token) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Drapeon referral</Text>
            <Text style={styles.title}>Sign in to claim this referral.</Text>
            <Text style={styles.copy}>
              We attach referral context to your account, not the device, so tailors can see it on
              future order briefs.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/(auth)/welcome')}>
              <Text style={styles.primaryBtnText}>Sign in or create account</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (!referralCode) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <View style={styles.card}>
            <Feather name="alert-circle" size={28} color={Colors.kanteRust} />
            <Text style={styles.title}>Referral unavailable</Text>
            <Text style={styles.copy}>This referral link is missing its referral code.</Text>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace('/(customer)')}>
              <Text style={styles.secondaryBtnText}>Go to home</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (preview.status === 'loading') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.needleGreen} />
          <Text style={styles.copy}>Opening referral...</Text>
        </View>
      </SafeAreaView>
    )
  }

  if (preview.status === 'error') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <View style={styles.card}>
            <Feather name="alert-circle" size={28} color={Colors.kanteRust} />
            <Text style={styles.title}>Referral unavailable</Text>
            <Text style={styles.copy}>{preview.message}</Text>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace('/(customer)')}>
              <Text style={styles.secondaryBtnText}>Go to home</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <Text style={styles.eyebrow}>Drapeon referral</Text>
          <Text style={styles.title}>{preview.referrerName} invited you to Drapeon.</Text>
          <Text style={styles.copy}>
            Claiming this referral gives future tailors helpful trust context while you build your
            own Drapeon history.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>What tailors may see</Text>
          <InfoRow label="Referred by" value={preview.referrerName} />
          <InfoRow
            label="Their Drapeon history"
            value={`${preview.completedOrderCount} completed ${preview.completedOrderCount === 1 ? 'order' : 'orders'}`}
          />
          <Text style={styles.smallCopy}>
            Referral trust is context only. Tailors still review your brief, measurements, timeline,
            and payment protection normally.
          </Text>
        </View>

        {preview.alreadyClaimedByYou ? (
          <View style={styles.successCard}>
            <Feather name="check" size={20} color={Colors.needleGreen} />
            <Text style={styles.successText}>This referral is already attached to your account.</Text>
          </View>
        ) : preview.claimedBySomeoneElse ? (
          <View style={styles.warningCard}>
            <Text style={styles.warningText}>This referral has already been claimed.</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.primaryBtn, claiming && styles.disabledBtn]}
            onPress={handleClaim}
            disabled={claiming}
          >
            {claiming ? (
              <ActivityIndicator color={Colors.textInverse} />
            ) : (
              <Text style={styles.primaryBtnText}>Claim referral</Text>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  scroll: { padding: Spacing.lg, gap: Spacing.md },
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  eyebrow: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  title: { fontSize: FontSize.xl, color: Colors.ink, fontWeight: FontWeight.bold, fontFamily: Fonts.display, lineHeight: 30 },
  copy: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 21 },
  smallCopy: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  sectionTitle: { fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.semibold, fontFamily: Fonts.display },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  infoLabel: { color: Colors.midGrey, fontSize: FontSize.sm },
  infoValue: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.medium, flex: 1, textAlign: 'right' },
  primaryBtn: {
    minHeight: 50,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  primaryBtnText: { color: Colors.textInverse, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  secondaryBtn: {
    minHeight: 48,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  secondaryBtnText: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  disabledBtn: { opacity: 0.6 },
  successCard: {
    borderRadius: Radius.lg,
    backgroundColor: Colors.needleGreenLight,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  successText: { color: Colors.needleGreen, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, flex: 1 },
  warningCard: { borderRadius: Radius.lg, backgroundColor: Colors.statusPendingBg, padding: Spacing.md },
  warningText: { color: Colors.ink, fontSize: FontSize.sm, lineHeight: 20 },
})
