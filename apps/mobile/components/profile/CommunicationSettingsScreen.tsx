import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ComponentProps } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as Notifications from 'expo-notifications'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { CommunicationCategory, CommunicationChannel } from '@drape/shared/communications'

import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { useAuth } from '@/lib/auth'
import {
  getCommunicationPreferences,
  setCommunicationPreference,
  setMarketingConsent,
  type CommunicationPreferenceMatrix,
} from '@/lib/communications'
import { goBackOrFallback } from '@/lib/navigation'
import { supabase } from '@/lib/supabase'

type Role = 'customer' | 'tailor'
type OptionalChannel = Exclude<CommunicationChannel, 'IN_APP'>

const MARKETING_CHANNELS: readonly OptionalChannel[] = ['PUSH', 'EMAIL', 'SMS']

const ESSENTIAL_ROWS: Array<{
  category: CommunicationCategory
  icon: ComponentProps<typeof Feather>['name']
  title: string
  description: string
}> = [
  { category: 'PAYMENT', icon: 'credit-card', title: 'Payments and refunds', description: 'Receipts, failed payments, refunds, and protected-funds decisions.' },
  { category: 'PAYOUT', icon: 'dollar-sign', title: 'Earnings and payouts', description: 'Release confirmations, blocked payouts, and recovery steps.' },
  { category: 'SECURITY', icon: 'shield', title: 'Account and safety', description: 'Sign-in, account, privacy, support, and safety actions.' },
  { category: 'SERVICE_STATUS', icon: 'activity', title: 'Service status', description: 'Important incidents, recovery updates, and resolved notices.' },
]

function errorMessage(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  if (/network|fetch|timeout|connection/i.test(text)) {
    return 'Connection looks weak. Pull down to retry; your previous choices are unchanged.'
  }
  return 'Drapeon could not save this choice right now. Please try again.'
}

export default function CommunicationSettingsScreen({ role }: { role: Role }) {
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const [matrix, setMatrix] = useState<CommunicationPreferenceMatrix | null>(null)
  const [consents, setConsents] = useState<Partial<Record<CommunicationChannel, boolean>>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [osGranted, setOsGranted] = useState<boolean | null>(null)
  const [ack, setAck] = useState<string | null>(null)

  const fallback = role === 'customer'
    ? '/(customer)/profile/account-settings'
    : '/(tailor)/profile/account-settings'

  const legacy = useMemo(() => user?.user_metadata?.notif_prefs ?? {}, [user?.user_metadata?.notif_prefs])

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    try {
      const response = await getCommunicationPreferences()
      setMatrix(response.preferences)
      setConsents(Object.fromEntries(
        Object.entries(response.marketingConsents).map(([channel, consent]) => [channel, consent?.granted === true]),
      ))
    } catch (error) {
      Alert.alert('Could not load communication settings', errorMessage(error))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    Notifications.getPermissionsAsync()
      .then(({ status }) => setOsGranted(status === 'granted'))
      .catch(() => setOsGranted(null))
  }, [])

  function enabled(category: CommunicationCategory, channel: CommunicationChannel) {
    return matrix?.[category]?.[channel]?.enabled ?? false
  }

  async function savePreference(
    category: CommunicationCategory,
    channel: CommunicationChannel,
    value: boolean,
    legacyPatch?: (enabled: boolean) => Record<string, boolean>,
  ) {
    if (!matrix) return
    const key = `${category}:${channel}`
    const previous = matrix
    setSavingKey(key)
    setAck(null)
    setMatrix({
      ...matrix,
      [category]: {
        ...matrix[category],
        [channel]: { ...matrix[category][channel], enabled: value },
      },
    })
    try {
      await setCommunicationPreference(category, channel, value)
      if (legacyPatch) {
        await supabase.auth.updateUser({ data: { notif_prefs: { ...legacy, ...legacyPatch(value) } } })
      }
      setAck('Saved')
    } catch (error) {
      setMatrix(previous)
      Alert.alert('Setting not saved', errorMessage(error))
    } finally {
      setSavingKey(null)
    }
  }

  async function saveMarketing(channel: CommunicationChannel, value: boolean) {
    if (!matrix) return
    const previousConsent = consents[channel] === true
    const previousMatrix = matrix
    const key = `PROMOTION:${channel}`
    setSavingKey(key)
    setAck(null)
    setConsents((current) => ({ ...current, [channel]: value }))
    setMatrix({
      ...matrix,
      PROMOTION: {
        ...matrix.PROMOTION,
        [channel]: { ...matrix.PROMOTION[channel], enabled: value },
      },
    })
    try {
      await setMarketingConsent(channel, value)
      await Promise.all([
        setCommunicationPreference('PROMOTION', channel, value),
        setCommunicationPreference('PRODUCT_UPDATE', channel, value),
      ])
      if (channel === 'PUSH') {
        await supabase.auth.updateUser({ data: { notif_prefs: { ...legacy, promotions: value } } })
      }
      setAck(value ? 'Promotional updates enabled' : 'Promotional updates stopped')
    } catch (error) {
      setConsents((current) => ({ ...current, [channel]: previousConsent }))
      setMatrix(previousMatrix)
      Alert.alert('Consent not saved', errorMessage(error))
    } finally {
      setSavingKey(null)
    }
  }

  function row(
    category: CommunicationCategory,
    channel: CommunicationChannel,
    icon: ComponentProps<typeof Feather>['name'],
    title: string,
    description: string,
    legacyPatch?: (enabled: boolean) => Record<string, boolean>,
  ) {
    const key = `${category}:${channel}`
    return (
      <View style={styles.row} key={key}>
        <View style={styles.rowIcon}><Feather name={icon} size={19} color={Colors.needleGreen} /></View>
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>{title}</Text>
          <Text style={styles.rowDescription}>{description}</Text>
        </View>
        {savingKey === key ? <ActivityIndicator color={Colors.needleGreen} /> : (
          <Switch
            value={enabled(category, channel)}
            onValueChange={(value) => void savePreference(category, channel, value, legacyPatch)}
            accessibilityLabel={title}
            accessibilityHint="Double tap to change this communication preference"
            trackColor={{ false: Colors.lightGrey, true: Colors.needleGreen }}
            thumbColor={Colors.textInverse}
          />
        )}
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.backButton}
          onPress={() => goBackOrFallback(router, navigation, fallback)}
        >
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Communications</Text>
          <Text style={styles.headerSubtitle}>Alerts, email, and messages</Text>
        </View>
        {ack ? <Text style={styles.saved}>{ack}</Text> : null}
      </View>

      {osGranted === false ? (
        <View style={styles.deviceBanner}>
          <Feather name="bell-off" size={18} color={Colors.ink} />
          <View style={styles.bannerCopy}>
            <Text style={styles.bannerTitle}>Device alerts are off</Text>
            <Text style={styles.bannerText}>Your choices are saved, but this phone cannot show push alerts until notifications are enabled.</Text>
          </View>
          <TouchableOpacity style={styles.settingsButton} onPress={() => Linking.openSettings()}>
            <Text style={styles.settingsButtonText}>Settings</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {loading && !matrix ? (
        <View style={styles.loading}><ActivityIndicator color={Colors.needleGreen} /><Text style={styles.loadingText}>Loading your choices…</Text></View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={Colors.needleGreen} />}
          contentContainerStyle={styles.body}
        >
          <Text style={styles.intro}>Control routine alerts and optional updates. Important money, safety, account, and service messages always remain available in Drapeon.</Text>

          <View style={styles.section}>
            <Text style={styles.sectionEyebrow}>ROUTINE ALERTS</Text>
            <Text style={styles.sectionTitle}>What should interrupt you?</Text>
            <View style={styles.card}>
              {row('ORDER', 'PUSH', 'package', role === 'tailor' ? 'Order activity' : 'Order progress', role === 'tailor' ? 'New requests, decisions, handoffs, and customer actions.' : 'Quotes, production updates, delivery, and collection actions.', role === 'tailor' ? (value) => ({ newOrders: value, reviews: value }) : (value) => ({ orderUpdates: value, quotes: value }))}
              <View style={styles.divider} />
              {row('MESSAGE', 'PUSH', 'message-circle', 'New messages', `Push alerts when ${role === 'tailor' ? 'customers' : 'tailors'} message you.`, (value) => ({ messages: value }))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionEyebrow}>ESSENTIAL</Text>
            <Text style={styles.sectionTitle}>Always delivered in Drapeon</Text>
            <Text style={styles.sectionDescription}>These protect your account, orders, and money. They cannot be switched off; urgent actions may also use push, email, or SMS.</Text>
            <View style={styles.card}>
              {ESSENTIAL_ROWS.map((item, index) => (
                <View key={item.title}>
                  {index > 0 ? <View style={styles.divider} /> : null}
                  <View style={styles.row}>
                    <View style={styles.rowIcon}><Feather name={item.icon} size={19} color={Colors.needleGreen} /></View>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle}>{item.title}</Text>
                      <Text style={styles.rowDescription}>{item.description}</Text>
                    </View>
                    <View style={styles.requiredPill}><Feather name="lock" size={12} color={Colors.needleGreen} /><Text style={styles.requiredText}>Required</Text></View>
                  </View>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionEyebrow}>OFFERS</Text>
            <Text style={styles.sectionTitle}>Promotions and highlights</Text>
            <Text style={styles.sectionDescription}>Off by default. Each channel needs your permission and can be stopped at any time.</Text>
            <View style={styles.card}>
              {MARKETING_CHANNELS.map((channel, index) => {
                const key = `PROMOTION:${channel}`
                const labels = {
                  PUSH: ['Device alerts', 'Offers and seasonal highlights on this device.', 'bell'],
                  EMAIL: ['Email', 'Occasional promotions sent to your verified email.', 'mail'],
                  SMS: ['Text messages', 'Rare promotional texts; carrier rates may apply.', 'smartphone'],
                } as const
                const [title, description, icon] = labels[channel]
                return (
                  <View key={channel}>
                    {index > 0 ? <View style={styles.divider} /> : null}
                    <View style={styles.row}>
                      <View style={styles.rowIcon}><Feather name={icon} size={19} color={Colors.needleGreen} /></View>
                      <View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowDescription}>{description}</Text></View>
                      {savingKey === key ? <ActivityIndicator color={Colors.needleGreen} /> : (
                        <Switch
                          value={consents[channel] === true && enabled('PROMOTION', channel)}
                          onValueChange={(value) => void saveMarketing(channel, value)}
                          accessibilityLabel={`${title} promotions`}
                          trackColor={{ false: Colors.lightGrey, true: Colors.needleGreen }}
                          thumbColor={Colors.textInverse}
                        />
                      )}
                    </View>
                  </View>
                )
              })}
            </View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: { minHeight: 64, paddingHorizontal: Spacing.lg, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  backButton: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.white, justifyContent: 'center', alignItems: 'center', ...Shadow.sm },
  headerCopy: { flex: 1 },
  headerTitle: { color: Colors.ink, fontFamily: Fonts.display, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  headerSubtitle: { color: Colors.midGrey, fontSize: FontSize.xs, marginTop: 1 },
  saved: { color: Colors.needleGreen, fontSize: FontSize.xs, fontWeight: FontWeight.semibold, maxWidth: 120, textAlign: 'right' },
  deviceBanner: { marginHorizontal: Spacing.lg, marginTop: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.lightGrey, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  bannerCopy: { flex: 1 },
  bannerTitle: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  bannerText: { color: Colors.inkLight, fontSize: FontSize.xs, lineHeight: 18, marginTop: 2 },
  settingsButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.sm },
  settingsButtonText: { color: Colors.needleGreen, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.sm },
  loadingText: { color: Colors.midGrey, fontSize: FontSize.sm },
  body: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: 48, gap: Spacing.xl },
  intro: { color: Colors.inkLight, fontSize: FontSize.sm, lineHeight: 22 },
  section: { gap: Spacing.sm },
  sectionEyebrow: { color: Colors.needleGreen, fontSize: FontSize.xs, fontWeight: FontWeight.bold, letterSpacing: 1.3 },
  sectionTitle: { color: Colors.ink, fontFamily: Fonts.display, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  sectionDescription: { color: Colors.inkLight, fontSize: FontSize.xs, lineHeight: 19 },
  card: { backgroundColor: Colors.white, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.lightGrey, overflow: 'hidden', ...Shadow.sm },
  row: { minHeight: 82, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rowIcon: { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.needleGreenLight, justifyContent: 'center', alignItems: 'center' },
  rowCopy: { flex: 1 },
  rowTitle: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  rowDescription: { color: Colors.inkLight, fontSize: FontSize.xs, lineHeight: 18, marginTop: 3 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.lightGrey, marginLeft: 64 },
  requiredPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.full, backgroundColor: Colors.needleGreenLight, paddingHorizontal: 8, paddingVertical: 6 },
  requiredText: { color: Colors.needleGreen, fontSize: 10, fontWeight: FontWeight.bold },
})
