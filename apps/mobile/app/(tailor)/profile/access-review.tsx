import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, TextInput, Linking,
} from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { CONTACTS } from '@drape/shared'
import { useAuth } from '@/lib/auth'
import { requestSellerAccessReview } from '@/lib/seller-access-review'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { goBackOrFallback } from '@/lib/navigation'

export default function TailorAccessReviewScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

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
    if (note.trim().length < 10) {
      Alert.alert('Add more detail', 'Please share a short explanation so support knows what looks wrong about your seller access state.')
      return
    }

    setSubmitting(true)
    const result = await requestSellerAccessReview(note)
    setSubmitting(false)

    if (result.error) {
      Alert.alert(
        'Could not submit request',
        `${result.error} You can try again or email support directly.`,
      )
      return
    }

    setSubmitted(true)
  }

  function goBack() {
    goBackOrFallback(router, navigation, '/(tailor)/profile/trust-access' as never)
  }

  if (submitted) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={goBack}>
            <Feather name="arrow-left" size={20} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Request review</Text>
        </View>

        <View style={styles.body}>
          <View style={styles.heroCard}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>Request received</Text>
            </View>
            <Text style={styles.heroTitle}>Your seller access review request is now in Drape.</Text>
            <Text style={styles.heroCopy}>
              Support can now review the context you submitted. If more evidence is needed, they can follow up from the account email on file.
            </Text>
          </View>

          <View style={styles.noteCard}>
            <Text style={styles.noteTitle}>Need to add evidence?</Text>
            <Text style={styles.noteCopy}>Email {CONTACTS.tailors} from {user?.email ?? 'your account email'} if you need to add more context after submitting.</Text>
          </View>

          <TouchableOpacity style={styles.actionBtn} onPress={goBack}>
            <Text style={styles.actionBtnText}>Back to trust & access</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Request review</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Low-bandwidth support</Text>
          </View>
          <Text style={styles.heroTitle}>Ask for a human review of your seller access state.</Text>
          <Text style={styles.heroCopy}>
            Use this when you think your current access state needs human review or you need to add context that the current checks do not capture yet.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Account email</Text>
          <Text style={styles.accountValue}>{user?.email ?? 'No account email available in-app'}</Text>
          <View style={styles.divider} />
          <Text style={styles.sectionTitle}>What helps most</Text>
          <Text style={styles.sectionCopy}>Share the problem, what you already fixed, and what result you expected. Keep it factual so support can review it faster.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Review request</Text>
          <Text style={styles.sectionCopy}>Required. This becomes part of the durable trust and support trail.</Text>
          <TextInput
            style={styles.noteInput}
            value={note}
            onChangeText={setNote}
            multiline
            placeholder="Example: My payout account is connected, but paid quotes still look blocked. I already retried setup and refreshed the app."
            placeholderTextColor={Colors.midGrey}
            maxLength={300}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{note.trim().length}/300</Text>
        </View>

        <View style={styles.noteCard}>
          <Text style={styles.noteTitle}>Best use</Text>
          <Text style={styles.noteCopy}>Use this for a real review request. If you only need to finish setup, fix the requirement first and come back only if the state still looks wrong.</Text>
        </View>

        <View style={styles.noteCard}>
          <Text style={styles.noteTitle}>What ops sees</Text>
          <Text style={styles.noteCopy}>Your note is turned into a tracked internal case with your current payout and trust context attached, so keep the summary concise and factual.</Text>
        </View>

        <TouchableOpacity
          style={[styles.actionBtn, submitting && { opacity: 0.7 }]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.actionBtnText}>Submit review request</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => {
            void openExternalUrl(
              `mailto:${CONTACTS.tailors}?subject=${encodeURIComponent('Drape seller access review request')}`,
              `Please email ${CONTACTS.tailors} from your account email if you cannot complete the request in-app.`,
            )
          }}
        >
          <Text style={styles.secondaryBtnText}>Email support instead</Text>
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
    backgroundColor: Colors.needleGreenLight,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  heroBadgeText: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  heroTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, lineHeight: 28, fontFamily: 'Georgia' },
  heroCopy: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 18 },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },
  sectionCopy: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 18 },
  accountValue: { fontSize: FontSize.md, color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.lightGrey },
  noteInput: {
    minHeight: 120,
    borderRadius: Radius.lg,
    backgroundColor: Colors.bone,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    padding: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.ink,
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
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.lg,
    padding: 12,
    alignItems: 'center',
  },
  actionBtnText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.white },
  secondaryBtn: {
    borderRadius: Radius.lg,
    padding: 12,
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  secondaryBtnText: { fontSize: FontSize.md, fontWeight: FontWeight.medium, color: Colors.ink },
})
