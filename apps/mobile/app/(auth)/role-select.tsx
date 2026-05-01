/**
 * Shown to users who sign in via Google/Apple for the first time — they
 * don't have a role yet. They pick CUSTOMER or TAILOR here, then we write
 * it to auth metadata and Supabase's onboarding trigger picks it up.
 */
import { useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { syncUserRow } from '@/lib/syncUserRow'
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme'

type Role = 'CUSTOMER' | 'TAILOR'

export default function RoleSelectScreen() {
  const { user, signOut } = useAuth()
  const [role, setRole] = useState<Role>('CUSTOMER')
  const [loading, setLoading] = useState(false)

  async function confirm() {
    const displayName =
      (typeof user?.user_metadata?.display_name === 'string' && user.user_metadata.display_name.trim().length > 0
        ? user.user_metadata.display_name
        : typeof user?.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim().length > 0
          ? user.user_metadata.full_name
          : typeof user?.user_metadata?.name === 'string' && user.user_metadata.name.trim().length > 0
            ? user.user_metadata.name
            : null)

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ data: { role } })
    if (error) {
      Alert.alert('Error', error.message)
      setLoading(false)
      return
    }
    await syncUserRow({ userId: user?.id, role, displayName })
    // Force a session refresh so RouteGuard picks up the new role immediately
    const { error: refreshError } = await supabase.auth.refreshSession()
    if (refreshError) {
      Alert.alert('Role saved', 'Your role was updated, but the session did not refresh cleanly. Please sign in again if the app does not move on.')
    }
    setLoading(false)
    // RouteGuard will redirect once role is set in the session
  }

  async function useDifferentAccount() {
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
      <View style={styles.content}>
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Choose your side</Text>
          </View>
          <Text style={styles.heading}>How will you use Drape first?</Text>
          <Text style={styles.sub}>Pick the side you want to start with now. You’ll go straight into setup for that experience and can switch later inside your account.</Text>
        </View>

        <View style={styles.roleRow}>
          <TouchableOpacity
            style={[styles.roleCard, role === 'CUSTOMER' && styles.roleCardActive]}
            onPress={() => setRole('CUSTOMER')}
          >
            <View style={[styles.roleIconWrap, role === 'CUSTOMER' && styles.roleIconWrapActive]}>
              <Text style={styles.roleEmoji}>👔</Text>
            </View>
            <View style={styles.roleTextWrap}>
              <Text style={[styles.roleLabel, role === 'CUSTOMER' && styles.roleLabelActive]}>
                Customer
              </Text>
              <Text style={styles.roleHint}>Discover tailors, place orders, and track them.</Text>
            </View>
            <View style={[styles.roleCheck, role === 'CUSTOMER' && styles.roleCheckActive]}>
              <Text style={[styles.roleCheckText, role === 'CUSTOMER' && styles.roleCheckTextActive]}>✓</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.roleCard, role === 'TAILOR' && styles.roleCardActive]}
            onPress={() => setRole('TAILOR')}
          >
            <View style={[styles.roleIconWrap, role === 'TAILOR' && styles.roleIconWrapActive]}>
              <Text style={styles.roleEmoji}>🧵</Text>
            </View>
            <View style={styles.roleTextWrap}>
              <Text style={[styles.roleLabel, role === 'TAILOR' && styles.roleLabelActive]}>
                Tailor
              </Text>
              <Text style={styles.roleHint}>Receive briefs, send quotes, and manage orders.</Text>
            </View>
            <View style={[styles.roleCheck, role === 'TAILOR' && styles.roleCheckActive]}>
              <Text style={[styles.roleCheckText, role === 'TAILOR' && styles.roleCheckTextActive]}>✓</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.actionCard}>
          <View style={styles.nextCard}>
            <Text style={styles.nextEyebrow}>Next</Text>
            <Text style={styles.nextTitle}>You’ll go into setup for this side of Drape.</Text>
          </View>
          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={confirm}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color={Colors.white} />
              : <Text style={styles.btnText}>Continue</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.altAction}
            onPress={() => { void useDifferentAccount() }}
            disabled={loading}
          >
            <Text style={styles.altActionText}>Use a different account</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bone },
  content: { flex: 1, padding: Spacing.xl, gap: Spacing.lg, justifyContent: 'center' },
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  heroBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  heading: { fontSize: 30, fontWeight: FontWeight.bold, color: Colors.ink, lineHeight: 34, letterSpacing: -0.4, fontFamily: 'Georgia' },
  sub: { fontSize: FontSize.md, color: Colors.inkLight, lineHeight: 22 },
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
  roleEmoji: { fontSize: 28 },
  roleIconWrap: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Colors.bone,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleIconWrapActive: {
    backgroundColor: '#EAF6F1',
  },
  roleTextWrap: { flex: 1, gap: 2 },
  roleLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },
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
    color: Colors.white,
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
    letterSpacing: 0.6,
  },
  nextTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    lineHeight: 21,
    fontFamily: 'Georgia',
  },
  btn: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  altAction: { alignItems: 'center', paddingVertical: Spacing.sm },
  altActionText: { color: Colors.inkLight, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
})
