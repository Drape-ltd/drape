/**
 * Notification Settings
 *
 * Push notification preferences. Stored in Supabase auth user_metadata
 * under notif_prefs so they follow the user across devices.
 */

import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Switch, ActivityIndicator, Alert, Linking,
} from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import * as Notifications from 'expo-notifications'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { goBackOrFallback } from '@/lib/navigation'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

type NotifPrefs = {
  orderUpdates: boolean
  messages: boolean
  quotes: boolean
  paymentConfirmations: boolean
  promotions: boolean
}

const DEFAULT_PREFS: NotifPrefs = {
  orderUpdates: true,
  messages: true,
  quotes: true,
  paymentConfirmations: true,
  promotions: false,
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
        accessibilityLabel={`${title} notifications`}
        accessibilityHint={value ? 'Double tap to turn this notification type off' : 'Double tap to turn this notification type on'}
        accessibilityState={{ checked: value, disabled }}
        trackColor={{ false: Colors.lightGrey, true: Colors.needleGreen }}
        thumbColor={Colors.textInverse}
      />
    </View>
  )
}

export default function NotificationSettingsScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS)
  const [saving, setSaving] = useState(false)
  const [osGranted, setOsGranted] = useState<boolean | null>(null)

  useEffect(() => {
    Notifications.getPermissionsAsync().then(({ status }) => {
      setOsGranted(status === 'granted')
    }).catch(() => setOsGranted(null))
  }, [])

  useEffect(() => {
    const stored = user?.user_metadata?.notif_prefs
    if (!stored) return undefined
    const timer = setTimeout(() => setPrefs({ ...DEFAULT_PREFS, ...stored }), 0)
    return () => clearTimeout(timer)
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
        'Could not save setting',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. We could not save your notification settings yet. Retry when the signal improves.'
          : 'Could not save your notification settings right now. Please try again in a moment.',
      )
    }
  }

  function goBack() {
    goBackOrFallback(router, navigation, '/(customer)/profile/account-settings')
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

      {osGranted === false && (
        <View style={styles.osDisabledBanner}>
          <Feather name="bell-off" size={16} color={Colors.inkLight} />
          <Text style={styles.osDisabledText}>
            Push notifications are disabled in your device settings. Your preferences below are saved but won't trigger alerts until you re-enable them.
          </Text>
          <TouchableOpacity style={styles.osSettingsBtn} onPress={() => Linking.openSettings()}>
            <Text style={styles.osSettingsBtnText}>Open settings</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <Text style={styles.intro}>
          Choose which routine updates reach you. Critical account, safety, support, and dispute alerts may still be sent.
        </Text>

        {/* ── Order activity ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order activity</Text>
          <View style={styles.card}>
            <PrefRow
              icon="package"
              title="Order updates"
              description="Get notified when your tailor advances your order, including cutting, shipping, ready to collect, and more."
              value={prefs.orderUpdates}
              onChange={(v) => toggle('orderUpdates', v)}
              disabled={saving}
            />
            <View style={styles.divider} />
            <PrefRow
              icon="tag"
              title="New quotes"
              description="Alert when a tailor sends you a price quote to review and accept."
              value={prefs.quotes}
              onChange={(v) => toggle('quotes', v)}
              disabled={saving}
            />
            <View style={styles.divider} />
            <PrefRow
              icon="credit-card"
              title="Payment confirmations"
              description="Payment success, failed-payment, refund, and checkout status alerts."
              value={prefs.paymentConfirmations}
              onChange={(v) => toggle('paymentConfirmations', v)}
              disabled={saving}
            />
          </View>
        </View>

        {/* ── Communication ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Communication</Text>
          <View style={styles.card}>
            <PrefRow
              icon="message-circle"
              title="Messages"
              description="Push alerts for new messages from tailors."
              value={prefs.messages}
              onChange={(v) => toggle('messages', v)}
              disabled={saving}
            />
          </View>
        </View>

        {/* ── Drapeon ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Drapeon</Text>
          <View style={styles.card}>
            <PrefRow
              icon="star"
              title="Promotions & news"
              description="New tailors, seasonal highlights, and exclusive offers from Drapeon."
              value={prefs.promotions}
              onChange={(v) => toggle('promotions', v)}
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

  osDisabledBanner: {
    flexDirection: 'column', gap: Spacing.sm,
    marginHorizontal: Spacing.lg, marginTop: Spacing.sm,
    padding: Spacing.md,
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.lightGrey,
  },
  osDisabledText: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  osSettingsBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  osSettingsBtnText: {
    fontSize: FontSize.xs, fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
  },

  intro: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },

  section: { gap: 6 },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },

  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.lightGrey, marginHorizontal: Spacing.md },
  prefRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    padding: 10,
  },
  prefTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink, marginBottom: 3 },
  prefDesc: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 17 },
})
