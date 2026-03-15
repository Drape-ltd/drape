import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

type MeasurementProfile = {
  chest: number | null
  waist: number | null
  hips: number | null
  shoulderWidth: number | null
  inseam: number | null
  sleeveLength: number | null
  neckCircumference: number | null
  height: number | null
  unit: 'in' | 'cm'
  fitStyle: string | null
  garmentContext: string | null
  bodyShape: string | null
  fitFlags: string[]
  bodyNote: string | null
}

const MEASUREMENT_LABELS: Array<{ key: keyof MeasurementProfile; label: string }> = [
  { key: 'chest', label: 'Chest' },
  { key: 'waist', label: 'Waist' },
  { key: 'hips', label: 'Hips' },
  { key: 'shoulderWidth', label: 'Shoulder width' },
  { key: 'inseam', label: 'Inseam' },
  { key: 'sleeveLength', label: 'Sleeve length' },
  { key: 'neckCircumference', label: 'Neck' },
  { key: 'height', label: 'Height' },
]

const GARMENT_CONTEXT_LABELS: Record<string, string> = {
  MENSWEAR: 'Menswear cuts',
  WOMENSWEAR: 'Womenswear cuts',
  BOTH: 'Both',
  PREFER_NOT: 'Prefer not to say',
}

const BODY_SHAPE_LABELS: Record<string, string> = {
  RECTANGLE: 'Rectangle',
  BROAD_SHOULDERS: 'Broad shoulders',
  FULL_HIPS: 'Full hips',
  DEFINED_WAIST: 'Defined waist',
  FULL_MIDSECTION: 'Full midsection',
  ATHLETIC: 'Athletic / muscular',
  PREFER_NOT: 'Prefer not to say',
}

export default function CustomerProfileScreen() {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const [measurements, setMeasurements] = useState<MeasurementProfile | null>(null)
  const [loading, setLoading] = useState(true)

  const displayName = user?.user_metadata?.display_name ?? ''
  const email = user?.email ?? ''

  useFocusEffect(
    useCallback(() => {
      async function load() {
        const { data } = await supabase
          .from('customer_profiles')
          .select('measurements')
          .eq('user_id', user?.id)
          .single()

        setMeasurements(data?.measurements ? (data.measurements as MeasurementProfile) : null)
        setLoading(false)
      }
      load()
    }, [user?.id]),
  )

  const filledCount = measurements
    ? MEASUREMENT_LABELS.filter(({ key }) => measurements[key] !== null && measurements[key] !== undefined).length
    : 0
  const profileComplete = filledCount >= 4 && !!measurements?.garmentContext && !!measurements?.bodyShape

  async function handleSignOut() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ])
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: Spacing.xxxl }}>
        <View style={styles.content}>
          {/* Identity */}
          <View style={styles.identityCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{displayName}</Text>
              <Text style={styles.email}>{email}</Text>
            </View>
          </View>

          {/* Measurement profile card */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Measurement profile</Text>
              <TouchableOpacity onPress={() => router.push('/(customer)/profile/measurements')}>
                <Text style={styles.editLink}>{measurements ? 'Edit' : 'Set up'}</Text>
              </TouchableOpacity>
            </View>

            {!measurements || filledCount === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No measurements yet</Text>
                <Text style={styles.emptyHint}>
                  Add your measurements once and they'll attach to every order automatically.
                </Text>
                <Button
                  label="Set up measurements"
                  onPress={() => router.push('/(customer)/profile/measurements')}
                />
              </View>
            ) : (
              <View style={styles.measureCard}>
                {/* Completeness bar */}
                <View style={styles.completenessRow}>
                  <Text style={styles.completenessLabel}>{filledCount}/8 measurements</Text>
                  <View style={styles.completenessBar}>
                    <View style={[styles.completenessProgress, { width: `${(filledCount / 8) * 100}%` }]} />
                  </View>
                </View>

                {/* Measurements grid */}
                <View style={styles.measureGrid}>
                  {MEASUREMENT_LABELS.map(({ key, label }) => {
                    const val = measurements[key]
                    return (
                      <View key={key} style={styles.measureItem}>
                        <Text style={styles.measureLabel}>{label}</Text>
                        <Text style={[styles.measureValue, !val && styles.measureValueEmpty]}>
                          {val ? `${val} ${measurements.unit}` : '—'}
                        </Text>
                      </View>
                    )
                  })}
                </View>

                {/* Fit style */}
                {measurements.fitStyle && (
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Fit style</Text>
                    <Text style={styles.metaValue}>{measurements.fitStyle}</Text>
                  </View>
                )}

                {/* Layer 2 — garment context */}
                {measurements.garmentContext && (
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Cut context</Text>
                    <Text style={styles.metaValue}>
                      {GARMENT_CONTEXT_LABELS[measurements.garmentContext] ?? measurements.garmentContext}
                    </Text>
                  </View>
                )}

                {/* Layer 3 — body shape */}
                {measurements.bodyShape && (
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Body shape</Text>
                    <Text style={styles.metaValue}>
                      {BODY_SHAPE_LABELS[measurements.bodyShape] ?? measurements.bodyShape}
                    </Text>
                  </View>
                )}

                {/* Layer 4 — fit flags */}
                {measurements.fitFlags?.length > 0 && (
                  <View style={styles.fitFlagsSection}>
                    <Text style={styles.metaLabel}>Fit flags</Text>
                    <View style={styles.flagsWrap}>
                      {measurements.fitFlags.map((flag) => (
                        <View key={flag} style={styles.flagChip}>
                          <Text style={styles.flagText}>{flag.replace(/_/g, ' ').toLowerCase()}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Body note */}
                {measurements.bodyNote && (
                  <View style={styles.bodyNote}>
                    <Text style={styles.bodyNoteText}>"{measurements.bodyNote}"</Text>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Account actions */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Account</Text>
            <View style={styles.actionList}>
              <TouchableOpacity style={styles.actionRow} onPress={handleSignOut} accessibilityLabel="Sign out">
                <Text style={styles.actionLabel}>Sign out</Text>
                <Text style={styles.actionChevron}>→</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.xl },

  identityCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.lg,
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, ...Shadow.sm,
  },
  avatar: {
    width: 56, height: 56, borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.white },
  name: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  email: { fontSize: FontSize.sm, color: Colors.midGrey, marginTop: 2 },

  section: { gap: Spacing.md },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  editLink: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  emptyCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.xl, gap: Spacing.md, alignItems: 'center', ...Shadow.sm,
  },
  emptyTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 20 },

  measureCard: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.lg, ...Shadow.sm },

  completenessRow: { gap: Spacing.xs },
  completenessLabel: { fontSize: FontSize.xs, color: Colors.midGrey },
  completenessBar: { height: 4, backgroundColor: Colors.lightGrey, borderRadius: 2 },
  completenessProgress: { height: '100%', backgroundColor: Colors.needleGreen, borderRadius: 2 },

  measureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  measureItem: {
    width: '47%', backgroundColor: Colors.bone, borderRadius: Radius.sm,
    padding: Spacing.md, gap: 2,
  },
  measureLabel: { fontSize: FontSize.xs, color: Colors.midGrey },
  measureValue: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  measureValueEmpty: { color: Colors.lightGrey },

  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaLabel: { fontSize: FontSize.sm, color: Colors.inkLight },
  metaValue: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink },

  fitFlagsSection: { gap: Spacing.sm },
  flagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  flagChip: {
    paddingHorizontal: Spacing.md, paddingVertical: 4,
    backgroundColor: Colors.kanteRustLight, borderRadius: Radius.full,
  },
  flagText: { fontSize: FontSize.xs, color: Colors.kanteRust, fontWeight: FontWeight.medium },

  bodyNote: {
    backgroundColor: Colors.bone, borderRadius: Radius.md,
    padding: Spacing.md, borderLeftWidth: 3, borderLeftColor: Colors.needleGreen,
  },
  bodyNoteText: { fontSize: FontSize.sm, color: Colors.inkLight, fontStyle: 'italic', lineHeight: 20 },

  actionList: { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm },
  actionRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.lightGrey,
  },
  actionLabel: { fontSize: FontSize.md, color: Colors.error },
  actionChevron: { fontSize: FontSize.md, color: Colors.midGrey },
})
