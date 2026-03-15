/**
 * Shown to users who sign in via Google/Apple for the first time — they
 * don't have a role yet. They pick CUSTOMER or TAILOR here, then we write
 * it to auth metadata and Supabase's onboarding trigger picks it up.
 */
import { useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme'

type Role = 'CUSTOMER' | 'TAILOR'

export default function RoleSelectScreen() {
  const [role, setRole] = useState<Role>('CUSTOMER')
  const [loading, setLoading] = useState(false)

  async function confirm() {
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ data: { role } })
    if (error) {
      Alert.alert('Error', error.message)
      setLoading(false)
      return
    }
    // Force a session refresh so RouteGuard picks up the new role immediately
    await supabase.auth.refreshSession()
    setLoading(false)
    // RouteGuard will redirect once role is set in the session
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.heading}>One more thing</Text>
        <Text style={styles.sub}>How will you use Drape?</Text>

        <View style={styles.roleRow}>
          <TouchableOpacity
            style={[styles.roleCard, role === 'CUSTOMER' && styles.roleCardActive]}
            onPress={() => setRole('CUSTOMER')}
          >
            <Text style={styles.roleEmoji}>👔</Text>
            <Text style={[styles.roleLabel, role === 'CUSTOMER' && styles.roleLabelActive]}>
              I'm a customer
            </Text>
            <Text style={styles.roleHint}>I want custom clothing</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.roleCard, role === 'TAILOR' && styles.roleCardActive]}
            onPress={() => setRole('TAILOR')}
          >
            <Text style={styles.roleEmoji}>🧵</Text>
            <Text style={[styles.roleLabel, role === 'TAILOR' && styles.roleLabelActive]}>
              I'm a tailor
            </Text>
            <Text style={styles.roleHint}>I make custom clothing</Text>
          </TouchableOpacity>
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
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bone },
  content: { flex: 1, padding: Spacing.xl, gap: Spacing.xl, justifyContent: 'center' },
  heading: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink },
  sub: { fontSize: FontSize.md, color: Colors.inkLight, marginTop: -Spacing.md },
  roleRow: { flexDirection: 'row', gap: Spacing.md },
  roleCard: {
    flex: 1,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  roleCardActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  roleEmoji: { fontSize: 28 },
  roleLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.inkLight, textAlign: 'center' },
  roleLabelActive: { color: Colors.needleGreen },
  roleHint: { fontSize: FontSize.xs, color: Colors.midGrey, textAlign: 'center' },
  btn: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
})
