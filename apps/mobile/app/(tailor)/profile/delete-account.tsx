import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, TextInput, Linking,
} from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { requestAccountDeletion } from '@/lib/account-deletion'
import { useAuth } from '@/lib/auth'
import { issueReauthProof } from '@/lib/reauth-proof'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { CONTACTS } from '@drape/shared'
import { goBackOrFallback } from '@/lib/navigation'

export default function TailorDeleteAccountScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const [reason, setReason] = useState('')
  const [confirmationText, setConfirmationText] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [activeOrderCount, setActiveOrderCount] = useState<number | null>(null)
  const canSubmit = confirmationText.trim() === 'DELETE' && password.length > 0

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

  async function handleSubmit() {
    if (submitting) return
    if (confirmationText.trim() !== 'DELETE') {
      Alert.alert('Confirmation required', 'Type DELETE to confirm this account deletion request.')
      return
    }
    if (!password) {
      Alert.alert('Password required', 'Enter your current password before submitting this deletion request.')
      return
    }
    if (!user?.email) {
      Alert.alert('Session expired', 'Please sign in again before submitting this deletion request.')
      return
    }
    setSubmitting(true)
    const proofResult = await issueReauthProof({
      password,
      purpose: 'ACCOUNT_DELETION',
    })
    if (proofResult.error || !proofResult.proof) {
      setSubmitting(false)
      Alert.alert('Password check failed', proofResult.error ?? 'Confirm your password again before continuing.')
      return
    }

    const result = await requestAccountDeletion({
      reason,
      confirmationText: confirmationText.trim(),
      reauthProof: proofResult.proof,
    })
    setSubmitting(false)

    if (result.error) {
      Alert.alert(
        'Could not submit request',
        `${result.error} You can try again or email the privacy team directly.`,
      )
      return
    }

    setActiveOrderCount(result.activeOrderCount ?? null)
    setSubmitted(true)
  }

  function goBack() {
    goBackOrFallback(router, navigation, '/(tailor)/profile/privacy' as never)
  }

  if (submitted) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={goBack} accessibilityRole="button" accessibilityLabel="Back to privacy settings">
            <Feather name="arrow-left" size={20} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Delete account</Text>
        </View>

        <View style={styles.body}>
          <View style={styles.heroCard}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>Request received</Text>
            </View>
            <Text style={styles.heroTitle}>Your deletion request is now in Drape.</Text>
            <Text style={styles.heroCopy}>
              We sent a receipt to your account email. {activeOrderCount && activeOrderCount > 0 ? `We found ${activeOrderCount} active order${activeOrderCount === 1 ? '' : 's'}, so Drape will resolve open transactions before deletion or anonymization.` : 'We may contact you if we need confirmation.'} Some records may be retained where required for security, active transactions, legal obligations, or claims handling.
            </Text>
          </View>

          <View style={styles.noteCard}>
            <Text style={styles.noteTitle}>Need to follow up?</Text>
            <Text style={styles.noteCopy}>Email {CONTACTS.privacy} from your account email if anything about the request changes or you need to add more context.</Text>
          </View>

          <TouchableOpacity style={styles.actionBtn} onPress={goBack} accessibilityRole="button" accessibilityLabel="Back to privacy settings">
            <Text style={styles.actionBtnText}>Back to privacy</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack} accessibilityRole="button" accessibilityLabel="Back to privacy settings">
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Delete account</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Deletion request</Text>
          </View>
          <Text style={styles.heroTitle}>Start an account deletion request.</Text>
          <Text style={styles.heroCopy}>
            This does not behave like an instant total wipe. Drape may retain limited records where required for security, fraud prevention, active transactions, legal obligations, or claims handling.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>What happens next</Text>
          <Text style={styles.sectionCopy}>Your account can be restricted and queued for deletion review. If you have active orders, payouts, disputes, or legal retention obligations, Drape resolves those before final deletion or anonymization.</Text>
          <View style={styles.divider} />
          <Text style={styles.sectionTitle}>Account email</Text>
          <Text style={styles.accountValue}>{user?.email ?? 'No account email available in-app'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Reason for deletion</Text>
          <Text style={styles.sectionCopy}>Optional, but helpful for support and privacy handling.</Text>
          <TextInput
            style={styles.reasonInput}
            value={reason}
            onChangeText={setReason}
            multiline
            placeholder="Tell us why you want to close your account"
            placeholderTextColor={Colors.midGrey}
            maxLength={300}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{reason.trim().length}/300</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Confirm deletion request</Text>
          <Text style={styles.sectionCopy}>Type DELETE, then confirm your current password. This keeps an unlocked phone from starting a deletion request by accident.</Text>
          <TextInput
            style={styles.textInput}
            value={confirmationText}
            onChangeText={setConfirmationText}
            placeholder="Type DELETE"
            placeholderTextColor={Colors.midGrey}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <View style={styles.passwordWrap}>
            <TextInput
              style={styles.passwordInput}
              value={password}
              onChangeText={setPassword}
              placeholder="Current password"
              placeholderTextColor={Colors.midGrey}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.eyeBtn}
              onPress={() => setShowPassword((value) => !value)}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide current password' : 'Show current password'}
            >
              <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color={Colors.midGrey} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.noteCard}>
          <Text style={styles.noteTitle}>Best use</Text>
          <Text style={styles.noteCopy}>Use this flow when you want Drape to process account closure and deletion. It is not an instant wipe while active orders, payouts, support cases, or legal retention obligations may still be open.</Text>
        </View>

        <TouchableOpacity
          style={[styles.actionBtn, (!canSubmit || submitting) && { opacity: 0.55 }]}
          onPress={handleSubmit}
          disabled={submitting || !canSubmit}
          accessibilityRole="button"
          accessibilityLabel="Submit account deletion request"
        >
          {submitting ? <ActivityIndicator color={Colors.textInverse} /> : <Text style={styles.actionBtnText}>Submit deletion request</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => {
            void openExternalUrl(
              `mailto:${CONTACTS.privacy}?subject=${encodeURIComponent('Drape tailor account deletion request')}`,
              `Please email ${CONTACTS.privacy} from your account email if you cannot complete the request in-app.`,
            )
          }}
          accessibilityRole="button"
          accessibilityLabel="Email Drape privacy team instead"
        >
          <Text style={styles.secondaryBtnText}>Email privacy team instead</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
  },
  backBtn: {
    width: 44, height: 44, borderRadius: Radius.full,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    ...Shadow.sm,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: 'Georgia' },
  body: { padding: Spacing.lg, paddingBottom: 32, gap: Spacing.md, flexGrow: 1 },
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    backgroundColor: Colors.errorLight,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  heroBadgeText: {
    fontSize: FontSize.xs,
    color: Colors.error,
    fontWeight: FontWeight.semibold,
  },
  heroTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, lineHeight: 28, fontFamily: 'Georgia' },
  heroCopy: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },
  sectionCopy: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  accountValue: { fontSize: FontSize.md, color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.lightGrey },
  reasonInput: {
    minHeight: 120,
    borderRadius: Radius.lg,
    backgroundColor: Colors.bone,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    padding: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.ink,
  },
  textInput: {
    borderRadius: Radius.lg,
    backgroundColor: Colors.bone,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    padding: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.ink,
  },
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.lg,
    backgroundColor: Colors.bone,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  passwordInput: {
    flex: 1,
    padding: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.ink,
  },
  eyeBtn: {
    width: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  charCount: { fontSize: FontSize.xs, color: Colors.midGrey, textAlign: 'right' },
  noteCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  noteTitle: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  noteCopy: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  actionBtn: {
    backgroundColor: Colors.error,
    borderRadius: Radius.lg,
    padding: 12,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textInverse },
  secondaryBtn: {
    borderRadius: Radius.lg,
    padding: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  secondaryBtnText: { fontSize: FontSize.md, fontWeight: FontWeight.medium, color: Colors.ink },
})
