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
import { goBackOrFallback } from '@/lib/navigation'

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
    goBackOrFallback(router, navigation, '/(customer)/profile')
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Profile preview</Text>
            <Text style={styles.stateTitle}>Loading your profile…</Text>
            <Text style={styles.stateHint}>Loading what tailors see.</Text>
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
            <Text style={styles.stateHint}>Try again, or open your profile first.</Text>
            <TouchableOpacity onPress={() => { void loadProfile() }}>
              <Text style={styles.emptyLink}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={goBack}>
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

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 36, gap: Spacing.lg }}>
        <View style={styles.nextCard}>
          <Text style={styles.nextEyebrow}>Profile preview</Text>
          <Text style={styles.nextTitle}>This is what tailors see when you place a brief.</Text>
          <Text style={styles.nextBody}>Keep this clean and current so fit conversations start from the right baseline.</Text>
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
                        {val ? `${val} ${unit}` : 'Not added'}
                      </Text>
                    </View>
                  )
                })}
              </View>
            </View>
          )}
        </View>

        <TouchableOpacity style={styles.primaryAction} onPress={() => router.push('/(customer)/profile/measurements')}>
          <Text style={styles.primaryActionText}>{measurements ? 'Update measurements' : 'Add measurements'}</Text>
        </TouchableOpacity>

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
  headerTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: 'Georgia' },
  nextCard: {
    backgroundColor: Colors.boneDeep,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  nextEyebrow: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  nextTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    lineHeight: 21,
    fontFamily: 'Georgia',
  },
  nextBody: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },

  card: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, gap: Spacing.sm, ...Shadow.sm },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatar: {
    width: 44, height: 44, borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.needleGreen },
  name: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },
  meta: { fontSize: FontSize.sm, color: Colors.midGrey, marginTop: 2 },
  infoNote: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },

  section: { gap: Spacing.sm },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },

  emptyCard: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm, ...Shadow.sm,
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
  emptyText: { fontSize: FontSize.md, color: Colors.midGrey, fontFamily: 'Georgia' },
  emptyHint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 21 },
  emptyLink: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },
  secondaryLink: { fontSize: FontSize.sm, color: Colors.midGrey },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.sm, padding: Spacing.lg },
  stateCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
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
  stateTitle: { fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.bold, textAlign: 'center', fontFamily: 'Georgia' },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 19 },

  measureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  measureCell: {
    width: '48%', backgroundColor: Colors.bone, borderRadius: Radius.sm,
    padding: 10, gap: 2,
  },
  measureLabel: { fontSize: FontSize.xs, color: Colors.midGrey },
  measureValue: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  primaryAction: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  primaryActionText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.white },
})
