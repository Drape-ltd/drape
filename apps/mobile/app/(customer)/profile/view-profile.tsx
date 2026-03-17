/**
 * View Profile
 *
 * Shows the customer a summary of how their profile looks to tailors —
 * essentially the information that accompanies every order brief.
 */

import { useCallback, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
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
  const { user } = useAuth()
  const [measurements, setMeasurements] = useState<Measurements | null>(null)
  const [createdAt, setCreatedAt] = useState<string | null>(null)

  const displayName = user?.user_metadata?.display_name ?? ''
  const initials = displayName
    .split(' ')
    .map((p: string) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'

  useFocusEffect(
    useCallback(() => {
      supabase
        .from('customer_profiles')
        .select('measurements, created_at')
        .eq('user_id', user?.id)
        .single()
        .then(({ data }) => {
          setMeasurements(data?.measurements ?? null)
          setCreatedAt(data?.created_at ?? null)
        })
    }, [user?.id])
  )

  const memberSince = createdAt
    ? new Date(createdAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : null

  const unit = (measurements?.unit as string) ?? 'cm'
  const measureKeys = ['chest', 'waist', 'hips', 'shoulderWidth', 'inseam', 'sleeveLength', 'neckCircumference', 'height']

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Your public profile</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: Spacing.xl, paddingBottom: 64, gap: Spacing.xl }}>

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
              <Feather name="sliders" size={22} color={Colors.midGrey} />
              <Text style={styles.emptyText}>No measurements added yet</Text>
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
  emptyText: { fontSize: FontSize.md, color: Colors.midGrey },
  emptyLink: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  measureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  measureCell: {
    width: '47%', backgroundColor: Colors.bone, borderRadius: Radius.sm,
    padding: Spacing.md, gap: 2,
  },
  measureLabel: { fontSize: FontSize.xs, color: Colors.midGrey },
  measureValue: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
})
