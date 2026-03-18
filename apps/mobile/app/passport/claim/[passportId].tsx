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
import { supabase } from '@/lib/supabase'
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
    fetchPreview()
  }, [passportId])

  async function fetchPreview() {
    setPreview({ status: 'loading' })
    const { data, error } = await supabase.functions.invoke('claim-passport', {
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
  }

  async function handleClaim() {
    if (!session?.access_token) {
      router.push('/(auth)/welcome')
      return
    }
    setClaiming(true)
    const { data, error } = await supabase.functions.invoke('claim-passport', {
      body: { passportId, action: 'claim' },
    })
    if (error || !data?.success) {
      setClaiming(false)
      setPreview({ status: 'error', message: data?.error ?? 'Failed to claim passport.' })
      return
    }
    setClaimed(true)
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
        </View>
      </SafeAreaView>
    )
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  if (preview.status === 'loading') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.needleGreen} />
          <Text style={styles.loadingText}>Loading passport…</Text>
        </View>
      </SafeAreaView>
    )
  }

  // ── Error ──────────────────────────────────────────────────────────────────

  if (preview.status === 'error') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <View style={styles.errorIcon}>
            <Feather name="alert-circle" size={28} color={Colors.kanteRust} />
          </View>
          <Text style={styles.errorHeading}>Couldn't load passport</Text>
          <Text style={styles.errorSub}>{preview.message}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={fetchPreview}>
            <Text style={styles.primaryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // ── Ready ──────────────────────────────────────────────────────────────────

  const { clientName, tailorName, measurementCount, alreadyClaimed, expired } = preview

  const canClaim = !alreadyClaimed && !expired && !!session

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

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
            <Feather name="clock" size={14} color="#856404" />
            <Text style={[styles.statusText, { color: '#856404' }]}>
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
                ? <ActivityIndicator size="small" color={Colors.white} />
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
  row:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.md },
  rowLabel:  { fontSize: FontSize.sm, color: Colors.midGrey },
  rowValue:  { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, flexShrink: 1, textAlign: 'right', marginLeft: Spacing.md },
  divider:   { height: 1, backgroundColor: Colors.lightGrey },

  statusBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.lg,
  },
  statusInfo: { backgroundColor: Colors.needleGreenLight },
  statusWarn: { backgroundColor: '#FFF3CD' },
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
    color: Colors.white,
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

  errorIcon: {
    width: 64, height: 64, borderRadius: Radius.full,
    backgroundColor: '#FEE2E2',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  errorHeading: {
    fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink,
    textAlign: 'center', marginBottom: Spacing.sm,
  },
  errorSub: {
    fontSize: FontSize.sm, color: Colors.midGrey,
    textAlign: 'center', lineHeight: 20, marginBottom: Spacing.xl,
  },

  loadingText: {
    marginTop: Spacing.md,
    fontSize: FontSize.sm,
    color: Colors.midGrey,
  },
})
