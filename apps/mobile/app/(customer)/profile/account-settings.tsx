/**
 * Account Settings
 *
 * Airbnb-style flat navigation list. Each row navigates to a dedicated
 * sub-screen or gives the clearest available in-product route.
 */

import { Alert, View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { appendToHistory, goBackOrFallback } from '@/lib/navigation'
import { useAuth } from '@/lib/auth'
import { useCurrency } from '@/lib/currency'

function NavRow({
  icon,
  label,
  sublabel,
  tone = 'default',
  last,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  label: string
  sublabel?: string
  tone?: 'default' | 'destructive'
  last?: boolean
  onPress: () => void
}) {
  const destructive = tone === 'destructive'
  return (
    <TouchableOpacity
      style={[styles.row, last && styles.rowLast]}
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={sublabel ? `${label}. ${sublabel}` : label}
    >
      <Feather name={icon} size={20} color={destructive ? Colors.error : Colors.inkLight} style={styles.rowIcon} />
      <View style={styles.rowContent}>
        <View style={styles.rowTitleWrap}>
          <Text style={[styles.rowLabel, destructive && styles.rowLabelDestructive]}>{label}</Text>
        </View>
        {sublabel ? <Text style={styles.rowSub}>{sublabel}</Text> : null}
      </View>
      <Feather name="chevron-right" size={16} color={Colors.midGrey} />
    </TouchableOpacity>
  )
}

export default function AccountSettingsScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { user, signOut } = useAuth()
  const { currency, loading: currencyLoading } = useCurrency()
  const version = '1.0.0'

  function goBack() {
    goBackOrFallback(router, navigation, '/(customer)/profile')
  }

  function confirmSignOut() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void signOut().catch(() => {
            Alert.alert('Unable to sign out', 'Please try again in a moment.')
          })
        },
      },
    ])
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Account settings</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        {/* ── Personal & security ── */}
        <View style={styles.group}>
          <NavRow
            icon="user"
            label="Personal information"
            sublabel="Name, phone number"
            onPress={() => router.push('/(customer)/profile/personal-info')}
          />
          <View style={styles.divider} />
          <NavRow
            icon="shield"
            label="Login & security"
            sublabel={user?.email ?? 'Email, password, Face ID / fingerprint'}
            onPress={() => router.push('/(customer)/profile/login-security')}
          />
        </View>

        {/* ── Preferences ── */}
        <View style={styles.group}>
          <NavRow
            icon="bell"
            label="Notifications"
            sublabel="Push alerts for orders, messages, quotes"
            onPress={() => router.push('/(customer)/profile/notification-settings')}
          />
          <View style={styles.divider} />
          <NavRow
            icon="globe"
            label="Currency"
            sublabel={
              currencyLoading
                ? 'Loading account default...'
                : `Browsing and new checkout default: ${currency}`
            }
            onPress={() => router.push('/(customer)/profile/currency' as never)}
          />
          <View style={styles.divider} />
          <NavRow
            icon="credit-card"
            label="Payment history"
            sublabel="Transactions, protected orders, and refunds"
            onPress={() => router.push('/(customer)/profile/payments' as never)}
          />
          <View style={styles.divider} />
          <NavRow
            icon="shield"
            label="Privacy"
            sublabel="Data, analytics, and account deletion"
            onPress={() => router.push('/(customer)/profile/privacy' as never)}
          />
        </View>

        {/* ── Account control ── */}
        <View style={styles.group}>
          <NavRow
            icon="trash-2"
            label="Delete account"
            sublabel="Identity confirmation required"
            tone="destructive"
            onPress={() => router.push({
              pathname: '/(customer)/profile/delete-account',
              params: {
                returnTo: '/(customer)/profile/account-settings',
                historyChain: appendToHistory(undefined, '/(customer)/profile/account-settings'),
              },
            } as never)}
          />
          <View style={styles.divider} />
          <NavRow
            icon="log-out"
            label="Sign out"
            sublabel="Clear this device and return to login"
            tone="destructive"
            last
            onPress={confirmSignOut}
          />
        </View>

        {/* ── Version ── */}
        <Text style={styles.version}>Drapeon v{version}</Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.sm,
  },
  headerTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },

  body: { padding: Spacing.lg, paddingBottom: Spacing.md, gap: Spacing.sm },
  group: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.lightGrey,
    marginLeft: Spacing.lg + 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    minHeight: 52,
  },
  rowPending: { opacity: 0.88 },
  rowLast: { borderBottomWidth: 0 },
  rowIcon: { width: 24 },
  rowContent: { flex: 1 },
  rowTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rowLabel: { fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.medium },
  rowLabelDestructive: { color: Colors.error },
  rowSub: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },
  pendingPill: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    backgroundColor: Colors.bone,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },

  version: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
})
