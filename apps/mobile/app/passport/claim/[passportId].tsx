/**
 * Passport Claim Screen
 *
 * Reachable via deep link: drape.app/passport/claim/<passportId>
 * or in-app navigation to: /passport/claim/<passportId>
 *
 * Flow:
 *  1. On mount — calls Edge Function with action=preview
 *     Shows tailor name, client name, measurement count
 *  2. User taps "Add to my profile" — calls action=claim
 *     On success navigates to /(customer)/profile/measurements
 */
import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

type PreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      clientName: string
      tailorName: string
      measurementCount: number
      alreadyClaimed: boolean
      expired: boolean
    }

export default function PassportClaimScreen() {
  const { passportId } = useLocalSearchParams<{ passportId: string }>()
  const router = useRouter()
  const { session } = useAuth()

  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' })
  const [claiming, setClaiming] = useState(false)
  const [claimed, setClaimed] = useState(false)

  useEffect(() => {
    if (!passportId) {
      setPreview({ status: 'error', message: 'Invalid invite link.' })
      return
    }
    let cancelled = false

    async function load() {
      if (!passportId) return
      setPreview({ status: 'loading' })
      try {
        const { data, error } = await invokeFunction('claim-passport', {
          body: { passportId, action: 'preview' },
        })
        if (cancelled) return
        if (error || !data) {
          setPreview({ status: 'error', message: data?.error ?? 'Could not load passport.' })
          return
        }
        setPreview({
          status: 'ready',
          clientName: data.clientName,
          tailorName: data.tailorName,
          measurementCount: data.measurementCount,
          alreadyClaimed: data.alreadyClaimed ?? false,
          expired: data.expired ?? false,
        })
      } catch {
        if (!cancelled) {
          setPreview({ status: 'error', message: 'Could not load passport.' })
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [passportId])

  async function fetchPreview() {
    if (!passportId) return
    setPreview({ status: 'loading' })
    try {
      const { data, error } = await invokeFunction('claim-passport', {
        body: { passportId, action: 'preview' },
      })
      if (error || !data) {
        setPreview({ status: 'error', message: data?.error ?? 'Could not load passport.' })
        return
      }
      setPreview({
        status: 'ready',
        clientName:       data.clientName,
        tailorName:       data.tailorName,
        measurementCount: data.measurementCount,
        alreadyClaimed:   data.alreadyClaimed ?? false,
        expired:          data.expired ?? false,
      })
    } catch {
      setPreview({ status: 'error', message: 'Could not load passport.' })
    }
  }

  async function handleClaim() {
    if (claiming) return
    if (!session?.access_token) {
      router.push('/(auth)/welcome')
      return
    }
    setClaiming(true)
    try {
      const { data, error } = await invokeFunction('claim-passport', {
        body: { passportId, action: 'claim' },
      })
      if (error || !data?.success) {
        setPreview({ status: 'error', message: data?.error ?? 'Failed to claim passport.' })
        return
      }
      setClaimed(true)
    } catch {
      setClaiming(false)
      setPreview({ status: 'error', message: 'Failed to claim passport.' })
      return
    } finally {
      setClaiming(false)
    }
  }

  // ── Success state ──────────────────────────────────────────────────────────

  if (claimed) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <View style={styles.successIcon}>
            <Feather name="check" size={32} color={Colors.needleGreen} />
          </View>
          <Text style={styles.successHeading}>Measurements added!</Text>
          <Text style={styles.successSub}>
            Your tailor's measurements have been saved to your profile.
          </Text>
          <View style={styles.successGuideCard}>
            <Text style={styles.successGuideTitle}>What this improves</Text>
            <Text style={styles.successGuideText}>
              Future briefs can now start from this fit profile, which makes quoting and tailoring feel more precise from the first step. Review the measurements once, then head into discovery when you are ready to book.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.replace('/(customer)/profile/measurements')}
          >
            <Text style={styles.primaryBtnText}>View my measurements</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.replace('/(customer)')}
          >
            <Text style={styles.secondaryBtnText}>Go to home</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={() => router.replace('/(customer)/profile')}
          >
            <Text style={styles.ghostBtnText}>Open profile</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  if (preview.status === 'loading') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Passport claim</Text>
            <ActivityIndicator size="large" color={Colors.needleGreen} />
            <Text style={styles.stateTitle}>Loading passport…</Text>
            <Text style={styles.stateHint}>
              We’re checking the claim link and measurement preview so you can safely bring this fit profile into your account.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  // ── Error ──────────────────────────────────────────────────────────────────

  if (preview.status === 'error') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Passport claim</Text>
            <View style={styles.errorIcon}>
              <Feather name="alert-circle" size={28} color={Colors.kanteRust} />
            </View>
            <Text style={styles.stateTitle}>Couldn't load passport.</Text>
            <Text style={styles.stateHint}>{preview.message}</Text>
            <View style={styles.stateGuideCard}>
              <Text style={styles.stateGuideTitle}>Best recovery move</Text>
              <Text style={styles.stateGuideText}>
                Try the link once more first. If it still fails, ask your tailor for a fresh passport invite or open your measurements directly so the fit profile stays easy to manage.
              </Text>
            </View>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => { void fetchPreview() }}>
              <Text style={styles.primaryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => router.replace(session ? '/(customer)' : '/(auth)/welcome')}
            >
              <Text style={styles.secondaryBtnText}>{session ? 'Go to home' : 'Go to sign in'}</Text>
            </TouchableOpacity>
            {session ? (
              <TouchableOpacity
                style={styles.ghostBtn}
                onPress={() => router.replace('/(customer)/profile/measurements')}
              >
                <Text style={styles.ghostBtnText}>Open measurements</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </SafeAreaView>
    )
  }

  // ── Ready ──────────────────────────────────────────────────────────────────

  const { clientName, tailorName, measurementCount, alreadyClaimed, expired } = preview

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Measurement passport</Text>
          </View>
          <Text style={styles.heroTitle}>Bring your tailor-measured fit into Drape.</Text>
          <Text style={styles.heroSub}>
            Claiming this passport saves your recorded measurements to your profile so future
            orders start with a stronger fit foundation.
          </Text>
        </View>

        {/* Hero icon */}
        <View style={styles.heroIcon}>
          <Feather name="book-open" size={32} color={Colors.needleGreen} />
        </View>

        <Text style={styles.heading}>Your tailor's measurements</Text>
        <Text style={styles.sub}>
          {tailorName} has shared your measurements with you.
        </Text>

        {/* Details card */}
        <View style={styles.card}>
          <Row label="Client name" value={clientName} />
          <Divider />
          <Row label="Prepared by" value={tailorName} />
          <Divider />
          <Row
            label="Measurements"
            value={`${measurementCount} field${measurementCount !== 1 ? 's' : ''} recorded`}
          />
        </View>

        <View style={styles.guideCard}>
          <Text style={styles.guideTitle}>How claiming works</Text>
          <Text style={styles.guideText}>
            This copies the shared fit passport into your Drape profile so future briefs can start from measurements your tailor already recorded.
          </Text>
        </View>

        {/* Status banners */}
        {alreadyClaimed && (
          <View style={[styles.statusBanner, styles.statusInfo]}>
            <Feather name="info" size={14} color={Colors.needleGreen} />
            <Text style={[styles.statusText, { color: Colors.needleGreen }]}>
              This passport has already been added to an account.
            </Text>
          </View>
        )}
        {expired && !alreadyClaimed && (
          <View style={[styles.statusBanner, styles.statusWarn]}>
            <Feather name="clock" size={14} color={Colors.statusPending} />
            <Text style={[styles.statusText, { color: Colors.statusPending }]}>
              This invite link has expired. Ask your tailor to send a new one.
            </Text>
          </View>
        )}
        {!session && !alreadyClaimed && !expired && (
          <View style={[styles.statusBanner, styles.statusInfo]}>
            <Feather name="log-in" size={14} color={Colors.needleGreen} />
            <Text style={[styles.statusText, { color: Colors.needleGreen }]}>
              Sign in to your Drape account to claim this passport.
            </Text>
          </View>
        )}

        {/* CTA */}
        {!alreadyClaimed && !expired && (
          session ? (
            <TouchableOpacity
              style={[styles.primaryBtn, styles.primaryBtnWide, claiming && styles.primaryBtnDisabled]}
              onPress={handleClaim}
              disabled={claiming}
            >
              {claiming
                ? <ActivityIndicator size="small" color={Colors.textInverse} />
                : <Text style={styles.primaryBtnText}>Add to my profile</Text>
              }
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.primaryBtn, styles.primaryBtnWide]}
              onPress={() => router.push('/(auth)/welcome')}
            >
              <Text style={styles.primaryBtnText}>Sign in to claim</Text>
            </TouchableOpacity>
          )
        )}

        <Text style={styles.footer}>
          Your measurements will be saved to your Drape profile and pre-filled when placing orders.
        </Text>

      </ScrollView>
    </SafeAreaView>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  )
}

function Divider() {
  return <View style={styles.divider} />
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.bone },
  scroll:  { flexGrow: 1, padding: Spacing.xl, paddingBottom: Spacing.xxxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
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
  stateTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
  },
  stateHint: {
    fontSize: FontSize.sm,
    color: Colors.midGrey,
    textAlign: 'center',
    lineHeight: 21,
  },
  stateGuideCard: {
    alignSelf: 'stretch',
    backgroundColor: Colors.bone,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: 4,
  },
  stateGuideTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  stateGuideText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    textAlign: 'center',
    lineHeight: 20,
  },
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    marginBottom: Spacing.lg,
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
    lineHeight: 25,
  },

  heroIcon: {
    width: 72, height: 72, borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: Spacing.lg,
    marginTop: Spacing.xxl,
  },

  heading: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  sub: {
    fontSize: FontSize.sm,
    color: Colors.midGrey,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing.xl,
  },

  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    ...Shadow.sm,
  },
  guideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  guideTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  guideText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
  row:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.md },
  rowLabel:  { fontSize: FontSize.sm, color: Colors.midGrey },
  rowValue:  { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, flexShrink: 1, textAlign: 'right', marginLeft: Spacing.md },
  divider:   { height: 1, backgroundColor: Colors.lightGrey },

  statusBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.lg,
  },
  statusInfo: { backgroundColor: Colors.needleGreenLight },
  statusWarn: { backgroundColor: Colors.statusPendingBg },
  statusText: { fontSize: FontSize.sm, flex: 1, lineHeight: 18 },

  primaryBtn: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.md + 2,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryBtnWide:     { width: '100%', marginTop: Spacing.sm },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textInverse,
  },

  secondaryBtn: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontSize: FontSize.sm,
    color: Colors.midGrey,
  },
  ghostBtn: {
    paddingVertical: Spacing.xs,
    alignItems: 'center',
  },
  ghostBtnText: {
    fontSize: FontSize.sm,
    color: Colors.needleGreen,
    fontWeight: FontWeight.medium,
  },

  footer: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: Spacing.xl,
  },

  // Success / error state icons
  successIcon: {
    width: 72, height: 72, borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  successHeading: {
    fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink,
    textAlign: 'center', marginBottom: Spacing.sm,
  },
  successSub: {
    fontSize: FontSize.sm, color: Colors.midGrey,
    textAlign: 'center', lineHeight: 20, marginBottom: Spacing.xl,
  },
  successGuideCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
    marginBottom: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  successGuideTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  successGuideText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
    textAlign: 'left',
  },

  errorIcon: {
    width: 64, height: 64, borderRadius: Radius.full,
    backgroundColor: Colors.statusErrorBg,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
})
