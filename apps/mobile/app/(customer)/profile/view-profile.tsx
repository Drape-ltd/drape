/**
 * View Profile
 *
 * Shows the customer a summary of how their profile looks to tailors —
 * essentially the information that accompanies every order brief.
 */

import { useCallback, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native'
import { useFocusEffect, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

type Measurements = Record<string, unknown>

const LABELS: Record<string, string> = {
  chest: 'Chest', waist: 'Waist', hips: 'Hips', shoulderWidth: 'Shoulder width',
  inseam: 'Inseam', sleeveLength: 'Sleeve length', neckCircumference: 'Neck', height: 'Height',
}

export default function ViewProfileScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const [measurements, setMeasurements] = useState<Measurements | null>(null)
  const [createdAt, setCreatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  async function loadProfile() {
    setFetchError(false)
    setLoading(true)
    setMeasurements(null)
    setCreatedAt(null)
    try {
      const { data, error } = await supabase
        .from('customer_profiles')
        .select('measurements, created_at')
        .eq('user_id', user?.id)
        .maybeSingle()

      if (error) {
        setFetchError(true)
        setMeasurements(null)
        setCreatedAt(null)
        return
      }

      setMeasurements(data?.measurements ?? null)
      setCreatedAt(data?.created_at ?? null)
    } catch {
      setFetchError(true)
      setMeasurements(null)
      setCreatedAt(null)
    } finally {
      setLoading(false)
    }
  }

  const displayName = user?.user_metadata?.display_name ?? ''
  const initials = displayName
    .split(' ')
    .map((p: string) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'

  useFocusEffect(
    useCallback(() => {
      void loadProfile()
    }, [user?.id])
  )

  const memberSince = createdAt
    ? new Date(createdAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : null

  const unit = (measurements?.unit as string) ?? 'cm'
  const measureKeys = ['chest', 'waist', 'hips', 'shoulderWidth', 'inseam', 'sleeveLength', 'neckCircumference', 'height']

  function goBack() {
    if (navigation.canGoBack()) router.back()
    else router.replace('/(customer)/profile')
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Profile preview</Text>
            <Text style={styles.stateTitle}>Loading your profile…</Text>
            <Text style={styles.stateHint}>
              We’re pulling together the version of you that tailors see when you start a brief.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Profile preview</Text>
            <Text style={styles.stateTitle}>Couldn't load your profile preview.</Text>
            <Text style={styles.stateHint}>
              This screen should help you understand exactly what tailors see before they quote your order.
            </Text>
            <View style={styles.stateGuideCard}>
              <Text style={styles.stateGuideTitle}>Best recovery move</Text>
              <Text style={styles.stateGuideText}>
                Refresh here first. If it still fails, open your profile first, then measurements if needed, or return to the previous step so you can keep your details accurate before the next brief.
              </Text>
            </View>
            <TouchableOpacity onPress={() => { void loadProfile() }}>
              <Text style={styles.emptyLink}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.replace('/(customer)/profile')}>
              <Text style={styles.emptyLink}>Open profile</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.replace('/(customer)/profile/measurements')}>
              <Text style={styles.emptyLink}>Open measurements</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={goBack}>
              <Text style={styles.secondaryLink}>Go back</Text>
            </TouchableOpacity>
          </View>
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
        <Text style={styles.headerTitle}>Your public profile</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: Spacing.xl, paddingBottom: 64, gap: Spacing.xl }}>
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Tailor-facing profile</Text>
          </View>
          <Text style={styles.heroTitle}>This is the version of you that travels with every brief.</Text>
          <Text style={styles.heroSub}>
            Tailors use this snapshot to understand your fit, identity, and readiness before
            they quote your order.
          </Text>
        </View>

        <View style={styles.guideCard}>
          <Text style={styles.guideEyebrow}>Best use</Text>
          <Text style={styles.guideTitle}>Think of this as the trust snapshot a tailor sees before saying yes.</Text>
          <Text style={styles.guideCopy}>
            Keeping this profile accurate helps quotes feel faster, fit conversations feel clearer, and first-time orders feel less uncertain.
          </Text>
        </View>

        {/* Identity card */}
        <View style={styles.card}>
          <View style={styles.identityRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{displayName}</Text>
              {memberSince && <Text style={styles.meta}>Member since {memberSince}</Text>}
            </View>
          </View>
          <Text style={styles.infoNote}>
            This is how tailors see you when you submit an order.
          </Text>
        </View>

        {/* Measurements */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Measurements shared with tailors</Text>
          {!measurements ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyBadge}>
                <Text style={styles.emptyBadgeText}>Fit profile</Text>
              </View>
              <Feather name="sliders" size={22} color={Colors.midGrey} />
              <Text style={styles.emptyText}>No measurements added yet</Text>
              <Text style={styles.emptyHint}>
                Add your measurements once so future briefs feel faster and tailors can quote with more confidence.
              </Text>
              <TouchableOpacity onPress={() => router.push('/(customer)/profile/measurements')}>
                <Text style={styles.emptyLink}>Add measurements →</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={[styles.card, { padding: Spacing.md }]}>
              <View style={styles.measureGrid}>
                {measureKeys.map((k) => {
                  const val = measurements[k]
                  return (
                    <View key={k} style={styles.measureCell}>
                      <Text style={styles.measureLabel}>{LABELS[k]}</Text>
                      <Text style={[styles.measureValue, !val && { color: Colors.lightGrey }]}>
                        {val ? `${val} ${unit}` : '—'}
                      </Text>
                    </View>
                  )
                })}
              </View>
            </View>
          )}
        </View>

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
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  guideEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.midGrey,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  guideTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    lineHeight: 22,
  },
  guideCopy: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 21,
  },

  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.md, ...Shadow.sm },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatar: {
    width: 52, height: 52, borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.needleGreen },
  name: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  meta: { fontSize: FontSize.sm, color: Colors.midGrey, marginTop: 2 },
  infoNote: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },

  section: { gap: Spacing.md },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },

  emptyCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.xl, alignItems: 'center', gap: Spacing.md, ...Shadow.sm,
  },
  emptyBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  emptyBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  emptyText: { fontSize: FontSize.md, color: Colors.midGrey },
  emptyHint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 21 },
  emptyLink: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },
  secondaryLink: { fontSize: FontSize.sm, color: Colors.midGrey },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.md, padding: Spacing.xl },
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
  stateTitle: { fontSize: FontSize.lg, color: Colors.ink, fontWeight: FontWeight.bold, textAlign: 'center' },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 21 },
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

  measureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  measureCell: {
    width: '47%', backgroundColor: Colors.bone, borderRadius: Radius.sm,
    padding: Spacing.md, gap: 2,
  },
  measureLabel: { fontSize: FontSize.xs, color: Colors.midGrey },
  measureValue: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
})
