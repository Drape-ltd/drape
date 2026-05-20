/**
 * Shown to users who sign in via Google/Apple for the first time — they
 * don't have a role yet. They pick CUSTOMER or TAILOR here, then we write
 * it to auth metadata and Supabase's onboarding trigger picks it up.
 */
import { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { syncUserRow } from '@/lib/syncUserRow'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { AuthEntryHeader } from '@/components/auth/AuthEntryHeader'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme'

type Role = 'CUSTOMER' | 'TAILOR'

export default function RoleSelectScreen() {
  const { user, signOut } = useAuth()
  const [role, setRole] = useState<Role>('CUSTOMER')
  const [loading, setLoading] = useState(false)
  const accountEmail = typeof user?.email === 'string' ? user.email : null

  async function confirm() {
    const displayName =
      typeof user?.user_metadata?.display_name === 'string' &&
      user.user_metadata.display_name.trim().length > 0
        ? user.user_metadata.display_name
        : typeof user?.user_metadata?.full_name === 'string' &&
            user.user_metadata.full_name.trim().length > 0
          ? user.user_metadata.full_name
          : typeof user?.user_metadata?.name === 'string' &&
              user.user_metadata.name.trim().length > 0
            ? user.user_metadata.name
            : null

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ data: { role } })
    if (error) {
      Alert.alert(
        'Could not save your role',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. We could not save your role yet. Retry when the signal improves.'
          : 'We could not save your role right now. Please try again in a moment.'
      )
      setLoading(false)
      return
    }
    await syncUserRow({ userId: user?.id, role, displayName })
    // Force a session refresh so RouteGuard picks up the new role immediately
    const { error: refreshError } = await supabase.auth.refreshSession()
    if (refreshError) {
      Alert.alert(
        'Role saved',
        'Your role was updated, but the session did not refresh cleanly. Please sign in again if the app does not move on.'
      )
    }
    setLoading(false)
    // RouteGuard will redirect once role is set in the session
  }

  async function switchAccount() {
    if (loading) return
    setLoading(true)
    try {
      await signOut()
    } catch {
      Alert.alert('Sign out failed', 'Please try again to switch accounts.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <AuthEntryHeader
          eyebrow="Almost there"
          title="Choose how you’ll use Drape first."
          body="This sets up your first dashboard. You can switch later from account settings."
          showWordmark={false}
        />

        <View style={styles.roleRow}>
          <TouchableOpacity
            style={[styles.roleCard, role === 'CUSTOMER' && styles.roleCardActive]}
            onPress={() => setRole('CUSTOMER')}
            accessibilityRole="button"
            accessibilityLabel="Use Drape as a customer"
            accessibilityState={{ selected: role === 'CUSTOMER' }}
          >
            <View style={[styles.roleIconWrap, role === 'CUSTOMER' && styles.roleIconWrapActive]}>
              <Ionicons
                name="person-outline"
                size={24}
                color={role === 'CUSTOMER' ? Colors.needleGreen : Colors.ink}
              />
            </View>
            <View style={styles.roleTextWrap}>
              <Text style={[styles.roleLabel, role === 'CUSTOMER' && styles.roleLabelActive]}>
                Customer
              </Text>
              <Text style={styles.roleHint}>Discover tailors, place orders, and track them.</Text>
            </View>
            <View style={[styles.roleCheck, role === 'CUSTOMER' && styles.roleCheckActive]}>
              <Text
                style={[styles.roleCheckText, role === 'CUSTOMER' && styles.roleCheckTextActive]}
              >
                ✓
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.roleCard, role === 'TAILOR' && styles.roleCardActive]}
            onPress={() => setRole('TAILOR')}
            accessibilityRole="button"
            accessibilityLabel="Use Drape as a tailor"
            accessibilityState={{ selected: role === 'TAILOR' }}
          >
            <View style={[styles.roleIconWrap, role === 'TAILOR' && styles.roleIconWrapActive]}>
              <Ionicons
                name="cut-outline"
                size={24}
                color={role === 'TAILOR' ? Colors.needleGreen : Colors.ink}
              />
            </View>
            <View style={styles.roleTextWrap}>
              <Text style={[styles.roleLabel, role === 'TAILOR' && styles.roleLabelActive]}>
                Tailor
              </Text>
              <Text style={styles.roleHint}>Receive briefs, send quotes, and manage orders.</Text>
            </View>
            <View style={[styles.roleCheck, role === 'TAILOR' && styles.roleCheckActive]}>
              <Text style={[styles.roleCheckText, role === 'TAILOR' && styles.roleCheckTextActive]}>
                ✓
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.actionCard}>
          <View style={styles.nextCard}>
            <Text style={styles.nextEyebrow}>Next</Text>
            <Text style={styles.nextTitle}>You’ll go into setup for this side of Drape.</Text>
            {accountEmail ? <Text style={styles.nextMeta}>{accountEmail}</Text> : null}
          </View>
          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={confirm}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Continue to setup"
          >
            {loading ? (
              <ActivityIndicator color={Colors.textInverse} />
            ) : (
              <Text style={styles.btnText}>Continue</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.altAction}
            onPress={() => {
              void switchAccount()
            }}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Use a different account"
          >
            <Text style={styles.altActionText}>Use a different account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bone },
  content: { flexGrow: 1, padding: Spacing.xl, gap: Spacing.xl, justifyContent: 'center' },
  roleRow: { gap: Spacing.md },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    gap: Spacing.md,
  },
  roleCardActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  roleIconWrap: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Colors.bone,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleIconWrapActive: {
    backgroundColor: Colors.needleGreenLight,
  },
  roleTextWrap: { flex: 1, gap: 2 },
  roleLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  roleLabelActive: { color: Colors.needleGreen },
  roleHint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  roleCheck: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  roleCheckActive: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreen,
  },
  roleCheckText: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.bold,
  },
  roleCheckTextActive: {
    color: Colors.textInverse,
  },
  actionCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  nextCard: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.sm,
    gap: 4,
  },
  nextEyebrow: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  nextTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    lineHeight: 21,
    fontFamily: Fonts.display,
  },
  nextMeta: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    lineHeight: 18,
  },
  btn: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: Colors.textInverse, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  altAction: { alignItems: 'center', paddingVertical: Spacing.sm },
  altActionText: { color: Colors.inkLight, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
})
