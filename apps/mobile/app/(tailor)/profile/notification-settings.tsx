/**
 * Notification Settings (Tailor)
 *
 * Push notification preferences stored in user_metadata.notif_prefs.
 */

import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Switch, ActivityIndicator, Alert,
} from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { goBackOrFallback } from '@/lib/navigation'

type NotifPrefs = {
  newOrders: boolean
  messages: boolean
  paymentReleased: boolean
  lowStockAlerts: boolean
  reviews: boolean
  platformUpdates: boolean
}

const DEFAULT_PREFS: NotifPrefs = {
  newOrders: true,
  messages: true,
  paymentReleased: true,
  lowStockAlerts: true,
  reviews: true,
  platformUpdates: false,
}

function PrefRow({
  icon, title, description, value, onChange, disabled,
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  title: string
  description: string
  value: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <View style={styles.prefRow}>
      <Feather name={icon} size={20} color={Colors.inkLight} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.prefTitle}>{title}</Text>
        <Text style={styles.prefDesc}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: Colors.lightGrey, true: Colors.needleGreen }}
        thumbColor={Colors.textInverse}
      />
    </View>
  )
}

export default function TailorNotificationSettingsScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const stored = user?.user_metadata?.notif_prefs
    if (stored) {
      const timer = setTimeout(() => {
        const legacy = stored as Partial<NotifPrefs> & { promotions?: boolean }
        setPrefs({
          ...DEFAULT_PREFS,
          ...legacy,
          platformUpdates: typeof legacy.platformUpdates === 'boolean'
            ? legacy.platformUpdates
            : legacy.promotions ?? DEFAULT_PREFS.platformUpdates,
        })
      }, 0)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [user?.user_metadata?.notif_prefs])

  async function toggle(key: keyof NotifPrefs, value: boolean) {
    const previous = prefs
    const updated = { ...prefs, [key]: value }
    setPrefs(updated)
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ data: { notif_prefs: updated } })
    setSaving(false)
    if (error) {
      setPrefs(previous)
      Alert.alert(
        'Error',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. We could not save your notification settings yet. Retry when the signal improves.'
          : 'Could not save your notification settings right now. Please try again in a moment.',
      )
    }
  }

  function goBack() {
    goBackOrFallback(router, navigation, '/(tailor)/profile/account-settings')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notification settings</Text>
        {saving && <ActivityIndicator size="small" color={Colors.midGrey} style={{ marginLeft: 'auto' }} />}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <Text style={styles.intro}>
          Choose which routine updates reach you. Critical account, safety, support, and dispute alerts may still be sent.
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Orders</Text>
          <View style={styles.card}>
            <PrefRow
              icon="shopping-bag"
              title="New order requests"
              description="Alert when a customer requests an order from you."
              value={prefs.newOrders}
              onChange={(v) => toggle('newOrders', v)}
              disabled={saving}
            />
            <View style={styles.divider} />
            <PrefRow
              icon="dollar-sign"
              title="Payment released"
              description="Alert when Drape releases earnings or a payout needs your attention."
              value={prefs.paymentReleased}
              onChange={(v) => toggle('paymentReleased', v)}
              disabled={saving}
            />
            <View style={styles.divider} />
            <PrefRow
              icon="alert-circle"
              title="Low stock alerts"
              description="Alerts when ready-made inventory is almost sold out."
              value={prefs.lowStockAlerts}
              onChange={(v) => toggle('lowStockAlerts', v)}
              disabled={saving}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Communication</Text>
          <View style={styles.card}>
            <PrefRow
              icon="message-circle"
              title="Messages"
              description="Push alerts for new messages from customers."
              value={prefs.messages}
              onChange={(v) => toggle('messages', v)}
              disabled={saving}
            />
            <View style={styles.divider} />
            <PrefRow
              icon="star"
              title="New reviews"
              description="Alert when a customer leaves a review on a completed order."
              value={prefs.reviews}
              onChange={(v) => toggle('reviews', v)}
              disabled={saving}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Drape</Text>
          <View style={styles.card}>
            <PrefRow
              icon="zap"
              title="Platform updates"
              description="Drape announcements, policy changes, and tailoring tips."
              value={prefs.platformUpdates}
              onChange={(v) => toggle('platformUpdates', v)}
              disabled={saving}
            />
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
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
  },
  backBtn: {
    width: 44, height: 44, borderRadius: Radius.full,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    ...Shadow.sm,
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display },
  body: { padding: Spacing.lg, paddingBottom: Spacing.md, gap: Spacing.sm },
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 12,
    gap: 6,
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
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    lineHeight: 24,
    fontFamily: Fonts.display,
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
  },
  guideEyebrow: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  guideTitle: {
    fontSize: FontSize.md,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
    lineHeight: 22,
  },
  guideCopy: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 21,
  },
  intro: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  section: { gap: 6 },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.lightGrey, marginHorizontal: Spacing.md },
  hint: { fontSize: 11, color: Colors.midGrey, lineHeight: 16, paddingHorizontal: 2 },
  prefRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    padding: 10,
  },
  prefTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink, marginBottom: 3 },
  prefDesc: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 17 },
})
