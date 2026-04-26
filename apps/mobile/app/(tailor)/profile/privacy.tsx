import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Switch, Alert, ActivityIndicator, Linking,
} from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { setAnalyticsConsent } from '@/lib/analytics'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { goBackOrFallback } from '@/lib/navigation'

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

export default function TailorPrivacyScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const [prefs, setPrefs] = useState<PrivacyPrefs>(DEFAULT_PREFS)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const stored = user?.user_metadata?.privacy_prefs
    if (stored) setPrefs({ ...DEFAULT_PREFS, ...stored })
  }, [user?.user_metadata?.privacy_prefs])

  async function toggle(key: keyof PrivacyPrefs, value: boolean) {
    const previous = prefs
    const updated = { ...prefs, [key]: value }
    setPrefs(updated)
    if (key === 'analyticsSharing') {
      setAnalyticsConsent(!!user?.id && value)
    }
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ data: { privacy_prefs: updated } })
    setSaving(false)
    if (error) {
      if (key === 'analyticsSharing') {
        setAnalyticsConsent(!!user?.id && previous.analyticsSharing)
      }
      setPrefs(previous)
      Alert.alert(
        'Error',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. We could not save your privacy settings yet. Retry when the signal improves.'
          : 'Could not save your privacy settings right now. Please try again in a moment.',
      )
    }
  }

  async function openExternalUrl(url: string, fallbackMessage: string) {
    try {
      const supported = await Linking.canOpenURL(url)
      if (!supported) {
        Alert.alert('Unable to open link', fallbackMessage)
        return false
      }

      await Linking.openURL(url)
      return true
    } catch {
      Alert.alert('Unable to open link', fallbackMessage)
      return false
    }
  }

  function goBack() {
    goBackOrFallback(router, navigation, '/(tailor)/profile/account-settings')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy</Text>
        {saving && <ActivityIndicator size="small" color={Colors.midGrey} style={{ marginLeft: 'auto' }} />}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: Spacing.xl, paddingBottom: 64, gap: Spacing.xl }}>
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Privacy control</Text>
          </View>
          <Text style={styles.heroTitle}>Privacy and account controls.</Text>
        </View>

        <Text style={styles.intro}>Tailor identity, payout readiness, and order history need clear handling too.</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Data & personalisation</Text>
          <View style={styles.card}>
            <ToggleRow
              icon="sliders"
              title="Personalised recommendations"
              description="When available, let Drape use your activity to shape recommendations and seller-facing suggestions more thoughtfully."
              value={prefs.personalisation}
              onChange={(v) => toggle('personalisation', v)}
              disabled={saving}
            />
            <View style={styles.divider} />
            <ToggleRow
              icon="bar-chart-2"
              title="Analytics & improvement"
              description="If enabled, Drape may collect product-usage analytics to improve the app. Core crash and reliability diagnostics may still run."
              value={prefs.analyticsSharing}
              onChange={(v) => toggle('analyticsSharing', v)}
              disabled={saving}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Communications</Text>
          <View style={styles.card}>
            <ToggleRow
              icon="mail"
              title="Marketing emails"
              description="Receive updates about new demand, product improvements, and Drape announcements."
              value={prefs.marketingEmails}
              onChange={(v) => toggle('marketingEmails', v)}
              disabled={saving}
            />
          </View>
          <Text style={styles.hint}>
            You will still receive operational emails about orders, verification, and payout-related activity.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your data</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.linkRow} onPress={() => router.push('/(tailor)/profile/data-request' as never)} activeOpacity={0.6}>
              <View style={styles.linkRowLeft}>
                <Feather name="download" size={20} color={Colors.inkLight} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.linkTitle}>Request my data</Text>
                  <Text style={styles.linkSub}>Submit an in-app request for a copy of your data. We may verify identity before sending anything sensitive.</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={16} color={Colors.midGrey} />
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity
              style={styles.linkRow}
              onPress={() => {
                void openExternalUrl(
                  'https://drapeon.co/privacy',
                  'Please visit https://drapeon.co/privacy manually. Your privacy controls here in the app still work while the page is unavailable.',
                )
              }}
              activeOpacity={0.6}
            >
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

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.linkRow} onPress={() => router.push('/(tailor)/profile/delete-account' as never)} activeOpacity={0.6}>
              <View style={styles.linkRowLeft}>
                <Feather name="trash-2" size={20} color={Colors.error} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.linkTitle, { color: Colors.error }]}>Delete my account</Text>
                  <Text style={styles.linkSub}>Start an account deletion request. Some records may be retained where required for legal, security, or transaction reasons.</Text>
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

function ToggleRow({
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
    <View style={styles.toggleRow}>
      <Feather name={icon} size={20} color={Colors.inkLight} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={styles.toggleDesc}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: Colors.lightGrey, true: Colors.needleGreen }}
        thumbColor={Colors.white}
      />
    </View>
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
  intro: { fontSize: FontSize.md, color: Colors.inkLight, lineHeight: 24 },
  section: { gap: Spacing.md },
  sectionTitle: { fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.semibold },
  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.lightGrey, marginHorizontal: Spacing.lg },
  toggleRow: { flexDirection: 'row', gap: Spacing.md, padding: Spacing.lg, alignItems: 'flex-start' },
  toggleTitle: { fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.medium },
  toggleDesc: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 20, marginTop: 2 },
  hint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 20 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  linkRowLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, flex: 1 },
  linkTitle: { fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.medium },
  linkSub: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 20, marginTop: 2 },
})
