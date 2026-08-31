import { useCallback, useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, TextInput, Linking, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import {
  getAccountDeletionRequestStatus,
  issueProviderDeletionProof,
  preferredDeletionReauthProvider,
  requestAccountDeletion,
  type AccountDeletionRequestState,
} from '@/lib/account-deletion'
import { useAuth } from '@/lib/auth'
import { issueReauthProof } from '@/lib/reauth-proof'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { CONTACTS } from '@drape/shared'
import { goBackOrReturnTo, pickSafeReturnTo } from '@/lib/navigation'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { KeyboardAwareScrollView } from '@/components/ui'

export default function DeleteAccountScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const params = useLocalSearchParams<{ returnTo?: string; historyChain?: string }>()
  const { user, reauthenticateWithProvider } = useAuth()
  const [reason, setReason] = useState('')
  const [confirmationText, setConfirmationText] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [requestState, setRequestState] = useState<AccountDeletionRequestState | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)
  const providers = Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : []
  const providerReauth = preferredDeletionReauthProvider(providers)
  const canSubmit = confirmationText.trim() === 'DELETE' && (providerReauth !== null || password.length > 0) && !statusError
  const fallbackRoute = '/(customer)/profile/account-settings' as const
  const returnTo = pickSafeReturnTo(params.historyChain, params.returnTo, fallbackRoute) ?? fallbackRoute
  const returnLabel = returnTo.includes('/privacy') ? 'privacy settings' : 'account settings'

  const loadStatus = useCallback(async () => {
    setStatusLoading(true)
    const result = await getAccountDeletionRequestStatus()
    setStatusLoading(false)
    setStatusError(result.error)
    if (!result.error) setRequestState(result.request)
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

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
    if (!providerReauth && !password) {
      Alert.alert('Password required', 'Enter your current password before submitting this deletion request.')
      return
    }
    if (!user?.email) {
      Alert.alert('Session expired', 'Please sign in again before submitting this deletion request.')
      return
    }
    setSubmitting(true)
    let appleAuthorizationCode: string | null | undefined
    if (providerReauth) {
      const providerResult = await reauthenticateWithProvider(providerReauth)
      if (providerResult.error) {
        setSubmitting(false)
        Alert.alert('Sign-in check failed', providerResult.error)
        return
      }
      appleAuthorizationCode = providerReauth === 'apple' ? providerResult.authorizationCode : null
      if (providerReauth === 'apple' && !appleAuthorizationCode) {
        setSubmitting(false)
        Alert.alert('Apple confirmation incomplete', 'Apple did not return the authorization needed to disconnect your account. Please try again.')
        return
      }
    }
    const proofResult = providerReauth
      ? await issueProviderDeletionProof(providerReauth)
      : await issueReauthProof({ password, purpose: 'ACCOUNT_DELETION' })
    if (proofResult.error || !proofResult.proof) {
      setSubmitting(false)
      Alert.alert('Identity check failed', proofResult.error ?? 'Confirm your identity again before continuing.')
      return
    }

    const result = await requestAccountDeletion({
      reason,
      confirmationText: confirmationText.trim(),
      reauthProof: proofResult.proof,
      appleAuthorizationCode: appleAuthorizationCode ?? undefined,
    })
    setSubmitting(false)

    if (result.error) {
      Alert.alert(
        'Could not submit request',
        `${result.error} You can try again or email the privacy team directly.`
      )
      return
    }

    if (result.request) {
      setRequestState(result.request)
    } else {
      await loadStatus()
    }
  }

  function goBack() {
    goBackOrReturnTo(router, navigation, returnTo, fallbackRoute)
  }

  useContextualBackHandler(goBack)

  if (statusLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={goBack} accessibilityRole="button" accessibilityLabel={`Back to ${returnLabel}`}>
            <Feather name="arrow-left" size={20} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Delete account</Text>
        </View>
        <View style={styles.loadingState}>
          <ActivityIndicator color={Colors.needleGreen} />
          <Text style={styles.sectionCopy}>Checking for an existing deletion request…</Text>
        </View>
      </SafeAreaView>
    )
  }

  if (requestState) {
    const submittedAt = new Date(requestState.createdAt)
    const submittedLabel = Number.isNaN(submittedAt.getTime())
      ? requestState.createdAt
      : submittedAt.toLocaleString()
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={goBack} accessibilityRole="button" accessibilityLabel={`Back to ${returnLabel}`}>
            <Feather name="arrow-left" size={20} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Delete account</Text>
        </View>

        <View style={styles.body}>
          <View style={styles.heroCard}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>Request received</Text>
            </View>
            <Text style={styles.heroTitle}>Your deletion request is now in Drapeon.</Text>
            <Text style={styles.heroCopy}>
              Your request is recorded. We’ll send updates by email and in-app notification as it moves through review. {requestState.activeOrderCount > 0 ? `We found ${requestState.activeOrderCount} active order${requestState.activeOrderCount === 1 ? '' : 's'}, so Drapeon will resolve open transactions before deletion or anonymization.` : 'We may contact you if we need confirmation.'}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Request receipt</Text>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Status</Text><Text style={styles.detailValue}>{requestState.status.replaceAll('_', ' ')}</Text></View>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Submitted</Text><Text style={styles.detailValue}>{submittedLabel}</Text></View>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Active orders</Text><Text style={styles.detailValue}>{requestState.activeOrderCount}</Text></View>
            <Text style={styles.requestId}>Request {requestState.id}</Text>
          </View>

          <View style={styles.noteCard}>
            <Text style={styles.noteTitle}>Need to follow up?</Text>
            <Text style={styles.noteCopy}>Email {CONTACTS.privacy} from your account email if anything about the request changes.</Text>
          </View>

          <TouchableOpacity style={styles.actionBtn} onPress={goBack} accessibilityRole="button" accessibilityLabel={`Back to ${returnLabel}`}>
            <Text style={styles.actionBtnText}>Back to {returnLabel}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  if (statusError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={goBack} accessibilityRole="button" accessibilityLabel={`Back to ${returnLabel}`}>
            <Feather name="arrow-left" size={20} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Delete account</Text>
        </View>
        <View style={styles.body}>
          <View style={styles.statusWarning}>
            <Text style={styles.noteTitle}>We couldn’t confirm your request status</Text>
            <Text style={styles.noteCopy}>Drapeon will not start another deletion request until this check succeeds.</Text>
          </View>
          <TouchableOpacity style={styles.actionBtn} onPress={() => void loadStatus()} accessibilityRole="button" accessibilityLabel="Retry deletion request status check">
            <Text style={styles.actionBtnText}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={goBack} accessibilityRole="button" accessibilityLabel={`Back to ${returnLabel}`}>
            <Text style={styles.secondaryBtnText}>Back to {returnLabel}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack} accessibilityRole="button" accessibilityLabel={`Back to ${returnLabel}`}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Delete account</Text>
      </View>

      <KeyboardAvoidingView style={styles.keyboardAvoider} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <KeyboardAwareScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Deletion request</Text>
          </View>
          <Text style={styles.heroTitle}>Start an account deletion request.</Text>
          <Text style={styles.heroCopy}>
            This does not behave like an instant total wipe. Drapeon may retain limited records where required for security, fraud prevention, active transactions, legal obligations, or claims handling.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>What happens next</Text>
          <Text style={styles.sectionCopy}>Your account can be restricted and queued for deletion review. If you have active orders, Drapeon resolves refunds, disputes, and legally required records before final deletion or anonymization.</Text>
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
            accessibilityLabel="Optional reason for deleting account"
          />
          <Text style={styles.charCount}>{reason.trim().length}/300</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Confirm deletion request</Text>
          <Text style={styles.sectionCopy}>Type DELETE, then {providerReauth ? `continue with ${providerReauth === 'apple' ? 'Apple' : 'Google'}` : 'confirm your current password'}. This keeps an unlocked phone from starting a deletion request by accident.</Text>
          <TextInput
            style={styles.textInput}
            value={confirmationText}
            onChangeText={setConfirmationText}
            placeholder="Type DELETE"
            placeholderTextColor={Colors.midGrey}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Type DELETE to confirm account deletion request"
          />
          {!providerReauth ? <View style={styles.passwordWrap}>
            <TextInput
              style={styles.passwordInput}
              value={password}
              onChangeText={setPassword}
              placeholder="Current password"
              placeholderTextColor={Colors.midGrey}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
              autoComplete="current-password"
              accessibilityLabel="Current password"
            />
            <TouchableOpacity
              style={styles.eyeBtn}
              onPress={() => setShowPassword((value) => !value)}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide current password' : 'Show current password'}
            >
              <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color={Colors.midGrey} />
            </TouchableOpacity>
          </View> : null}
        </View>

        <View style={styles.noteCard}>
          <Text style={styles.noteTitle}>Before deletion</Text>
          <Text style={styles.noteCopy}>Use this flow when you want Drapeon to process account closure and deletion. It is not an instant wipe while money movement, support, or legal retention obligations may still be open.</Text>
        </View>

        <TouchableOpacity
          style={[styles.actionBtn, (!canSubmit || submitting) && styles.actionBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitting || !canSubmit}
          accessibilityRole="button"
          accessibilityLabel="Submit account deletion request"
          accessibilityState={{ disabled: submitting || !canSubmit, busy: submitting }}
        >
          {submitting ? <ActivityIndicator color={Colors.textInverse} /> : <Text style={[styles.actionBtnText, !canSubmit && styles.actionBtnTextDisabled]}>{providerReauth ? `Continue with ${providerReauth === 'apple' ? 'Apple' : 'Google'}` : 'Submit deletion request'}</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => {
            void openExternalUrl(
              `mailto:${CONTACTS.privacy}?subject=${encodeURIComponent('Drapeon account deletion request')}`,
              `Please email ${CONTACTS.privacy} if you cannot complete the request in-app.`,
            )
          }}
          accessibilityRole="button"
          accessibilityLabel="Email Drapeon privacy team instead"
        >
          <Text style={styles.secondaryBtnText}>Email privacy team instead</Text>
        </TouchableOpacity>
      </KeyboardAwareScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  keyboardAvoider: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
  },
  backBtn: {
    width: 44, height: 44, borderRadius: Radius.full,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    ...Shadow.sm,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display },
  body: { padding: Spacing.lg, paddingBottom: Spacing.md, gap: Spacing.md, flexGrow: 1 },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.lg },
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
  heroTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, lineHeight: 28, fontFamily: Fonts.display },
  heroCopy: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  sectionCopy: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.md },
  detailLabel: { fontSize: FontSize.sm, color: Colors.midGrey },
  detailValue: { flex: 1, fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold, textAlign: 'right', textTransform: 'capitalize' },
  requestId: { fontSize: FontSize.xs, color: Colors.midGrey },
  statusWarning: { backgroundColor: Colors.errorLight, borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
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
    fontSize: FontSize.sm,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
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
  actionBtnDisabled: {
    backgroundColor: Colors.disabledFill,
  },
  actionBtnText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textInverse },
  actionBtnTextDisabled: { color: Colors.disabledText },
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
