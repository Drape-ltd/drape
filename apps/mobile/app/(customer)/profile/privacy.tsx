/**
 * Privacy
 *
 * Lets customers understand and control how their data is used on Drape.
 * Mirrors Airbnb's "Privacy" section — toggles for personalisation,
 * marketing, and analytics, plus data export / account deletion.
 *
 * Preferences are stored in Supabase auth user_metadata so they follow
 * the user across devices without any extra table.
 */

import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Switch, Alert, ActivityIndicator, Linking,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

type PrivacyPrefs = {
  marketingEmails: boolean
  personalisation: boolean
  analyticsSharing: boolean
}

const DEFAULT_PREFS: PrivacyPrefs = {
  marketingEmails: true,
  personalisation: true,
  analyticsSharing: true,
}

export default function PrivacyScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const [prefs, setPrefs] = useState<PrivacyPrefs>(DEFAULT_PREFS)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const stored = user?.user_metadata?.privacy_prefs
    if (stored) setPrefs({ ...DEFAULT_PREFS, ...stored })
  }, [user?.user_metadata?.privacy_prefs])

  async function toggle(key: keyof PrivacyPrefs, value: boolean) {
    const updated = { ...prefs, [key]: value }
    setPrefs(updated)
    setSaving(true)
    await supabase.auth.updateUser({ data: { privacy_prefs: updated } })
    setSaving(false)
  }

  function handleRequestData() {
    Linking.openURL('mailto:support@drapeon.co?subject=Data%20export%20request&body=Please%20send%20me%20a%20copy%20of%20all%20data%20Drape%20holds%20about%20me.')
  }

  function handleDeleteAccount() {
    Alert.alert(
      'Delete account',
      'This will permanently delete your Drape account and all associated data. This cannot be undone.\n\nWe will process your request within 30 days.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Request deletion',
          style: 'destructive',
          onPress: () => {
            Linking.openURL('mailto:support@drapeon.co?subject=Account%20deletion%20request&body=Please%20delete%20my%20Drape%20account%20and%20all%20associated%20data.')
            Alert.alert(
              'Request sent',
              "We've opened a deletion request email. Send it from your registered address and our team will process it within 30 days.",
            )
          },
        },
      ],
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy</Text>
        {saving && <ActivityIndicator size="small" color={Colors.midGrey} style={{ marginLeft: 'auto' }} />}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: Spacing.xl, paddingBottom: 64, gap: Spacing.xl }}>

        {/* ── Intro ── */}
        <Text style={styles.intro}>
          Control how Drape uses your information. Your measurements are always private and only shared with a tailor when you start an order.
        </Text>

        {/* ── Data & personalisation ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Data & personalisation</Text>
          <View style={styles.card}>
            <ToggleRow
              icon="sliders"
              title="Personalised recommendations"
              description="Allow Drape to tailor search results and tailor suggestions based on your activity."
              value={prefs.personalisation}
              onChange={(v) => toggle('personalisation', v)}
            />
            <View style={styles.divider} />
            <ToggleRow
              icon="bar-chart-2"
              title="Analytics & improvement"
              description="Help us improve the app by sharing anonymous usage data such as which screens you visit."
              value={prefs.analyticsSharing}
              onChange={(v) => toggle('analyticsSharing', v)}
            />
          </View>
        </View>

        {/* ── Communications ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Communications</Text>
          <View style={styles.card}>
            <ToggleRow
              icon="mail"
              title="Marketing emails"
              description="Receive updates about new tailors, seasonal collections, and exclusive offers from Drape."
              value={prefs.marketingEmails}
              onChange={(v) => toggle('marketingEmails', v)}
            />
          </View>
          <Text style={styles.hint}>
            You will always receive transactional emails about your orders regardless of this setting.
          </Text>
        </View>

        {/* ── Your data ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your data</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.linkRow} onPress={handleRequestData} activeOpacity={0.6}>
              <View style={styles.linkRowLeft}>
                <Feather name="download" size={20} color={Colors.inkLight} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.linkTitle}>Download my data</Text>
                  <Text style={styles.linkSub}>Request a copy of all information Drape holds about you (GDPR Art. 15).</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={16} color={Colors.midGrey} />
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity style={styles.linkRow} onPress={() => Linking.openURL('https://drapeon.co/privacy')} activeOpacity={0.6}>
              <View style={styles.linkRowLeft}>
                <Feather name="file-text" size={20} color={Colors.inkLight} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.linkTitle}>Privacy policy</Text>
                  <Text style={styles.linkSub}>Read our full privacy policy on our website.</Text>
                </View>
              </View>
              <Feather name="external-link" size={14} color={Colors.midGrey} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Danger zone ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.linkRow} onPress={handleDeleteAccount} activeOpacity={0.6}>
              <View style={styles.linkRowLeft}>
                <Feather name="trash-2" size={20} color={Colors.error} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.linkTitle, { color: Colors.error }]}>Delete my account</Text>
                  <Text style={styles.linkSub}>Permanently remove your account and all data. This cannot be undone.</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={16} color={Colors.midGrey} />
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  )
}

// ─── ToggleRow ────────────────────────────────────────────────────────────────

function ToggleRow({
  icon, title, description, value, onChange,
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  title: string
  description: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <View style={styles.toggleRow}>
      <Feather name={icon} size={20} color={Colors.inkLight} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={styles.toggleDesc}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: Colors.lightGrey, true: Colors.needleGreen }}
        thumbColor={Colors.white}
      />
    </View>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

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

  intro: {
    fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 22,
  },

  section: { gap: Spacing.sm },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },

  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.lightGrey, marginHorizontal: Spacing.lg },
  hint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18, paddingHorizontal: 2 },

  toggleRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    padding: Spacing.lg,
  },
  toggleTitle: { fontSize: FontSize.md, fontWeight: FontWeight.medium, color: Colors.ink, marginBottom: 4 },
  toggleDesc: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },

  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.lg,
  },
  linkRowLeft: { flex: 1, flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  linkTitle: { fontSize: FontSize.md, fontWeight: FontWeight.medium, color: Colors.ink, marginBottom: 2 },
  linkSub: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
})
