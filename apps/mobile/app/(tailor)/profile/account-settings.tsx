/**
 * Account Settings (Tailor)
 *
 * Airbnb-style flat navigation list for tailor account settings.
 */

import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

function NavRow({
  icon, label, sublabel, last, onPress, pending,
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  label: string
  sublabel?: string
  last?: boolean
  onPress: () => void
  pending?: boolean
}) {
  return (
    <TouchableOpacity
      style={[styles.row, last && styles.rowLast, pending && styles.rowPending]}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <Feather name={icon} size={20} color={Colors.inkLight} style={{ width: 24 }} />
      <View style={{ flex: 1 }}>
        <View style={styles.rowTitleWrap}>
          <Text style={styles.rowLabel}>{label}</Text>
          {pending ? <Text style={styles.pendingPill}>Soon</Text> : null}
        </View>
        {sublabel ? <Text style={styles.rowSub}>{sublabel}</Text> : null}
      </View>
      <Feather name={pending ? 'clock' : 'chevron-right'} size={16} color={Colors.midGrey} />
    </TouchableOpacity>
  )
}

function comingSoon(feature: string) {
  Alert.alert(feature, 'This setting is planned, but it is not available in the app yet.')
}

export default function TailorAccountSettingsScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const version = '1.0.0'

  function goBack() {
    if (navigation.canGoBack()) router.back()
    else router.replace('/(tailor)/profile')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Account settings</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Tailor account</Text>
          </View>
          <Text style={styles.heroTitle}>Protect the business side of your Drape presence.</Text>
          <Text style={styles.heroSub}>
            Keep your login, notifications, and future payout settings in order so your client
            experience stays dependable as orders grow.
          </Text>
        </View>

        <View style={styles.guideCard}>
          <Text style={styles.guideEyebrow}>Available now</Text>
          <Text style={styles.guideTitle}>Keep your login, contact details, and alerts current so client work keeps moving cleanly.</Text>
          <Text style={styles.guideCopy}>
            Settings marked <Text style={styles.guideSoon}>Soon</Text> are still on the way, but the account controls above already shape how reliably you operate inside Drape.
          </Text>
        </View>

        {/* ── Personal & security ── */}
        <View style={styles.group}>
          <NavRow
            icon="user"
            label="Personal information"
            sublabel="Name, phone number"
            onPress={() => router.push('/(tailor)/profile/personal-info')}
          />
          <View style={styles.divider} />
          <NavRow
            icon="shield"
            label="Login & security"
            sublabel="Password, Face ID / fingerprint"
            onPress={() => router.push('/(tailor)/profile/login-security')}
          />
        </View>

        {/* ── Preferences ── */}
        <View style={styles.group}>
          <NavRow
            icon="bell"
            label="Notifications"
            sublabel="Push alerts for orders, messages, quotes"
            onPress={() => router.push('/(tailor)/profile/notification-settings')}
          />
          <View style={styles.divider} />
          <NavRow
            icon="credit-card"
            label="Payments & payouts"
            sublabel="Coming soon"
            pending
            onPress={() => comingSoon('Payments & payouts')}
          />
          <View style={styles.divider} />
          <NavRow
            icon="file-text"
            label="Taxes"
            sublabel="Coming soon"
            pending
            onPress={() => comingSoon('Taxes')}
          />
        </View>

        {/* ── Accessibility ── */}
        <View style={styles.group}>
          <NavRow
            icon="globe"
            label="Translation"
            sublabel="Coming soon"
            pending
            onPress={() => comingSoon('Translation')}
          />
          <View style={styles.divider} />
          <NavRow
            icon="eye"
            label="Accessibility"
            sublabel="Coming soon"
            pending
            last
            onPress={() => comingSoon('Accessibility')}
          />
        </View>

        <Text style={styles.version}>Drape v{version}</Text>

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

  body: { padding: Spacing.xl, paddingBottom: 64, gap: Spacing.md },
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
  guideSoon: {
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },

  group: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.lightGrey, marginLeft: Spacing.xl + 24 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.lg,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.lg,
  },
  rowPending: { opacity: 0.88 },
  rowLast: { borderBottomWidth: 0 },
  rowTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rowLabel: { fontSize: FontSize.md, color: Colors.ink },
  rowSub: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },
  pendingPill: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    backgroundColor: Colors.bone,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },

  version: { fontSize: FontSize.xs, color: Colors.midGrey, textAlign: 'center', marginTop: Spacing.sm },
})
