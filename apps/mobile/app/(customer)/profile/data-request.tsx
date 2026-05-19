import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Linking, TextInput,
} from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useAuth } from '@/lib/auth'
import { requestDataAccess } from '@/lib/data-access'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { CONTACTS } from '@drape/shared'
import { goBackOrFallback } from '@/lib/navigation'

export default function DataRequestScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const [note, setNote] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [opening, setOpening] = useState(false)

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

  async function handleRequestDataEmail() {
    if (opening) return
    setOpening(true)

    const bodyLines = [
      'Hi Drape,',
      '',
      'I would like to request a copy of the data you hold about my account.',
      '',
      `Account email: ${user?.email ?? 'not available in-app'}`,
      '',
      'Please let me know if you need any additional identity verification before releasing sensitive information.',
    ]

    await openExternalUrl(
      `mailto:${CONTACTS.privacy}?subject=${encodeURIComponent('Drape data access request')}&body=${encodeURIComponent(bodyLines.join('\n'))}`,
      `Please email ${CONTACTS.privacy} with the subject "Drape data access request".`,
    )

    setOpening(false)
  }

  async function handleSubmitRequest() {
    if (opening) return
    setOpening(true)
    const result = await requestDataAccess(note)
    setOpening(false)

    if (result.error) {
      Alert.alert(
        'Could not submit request',
        `${result.error} You can try again or email the privacy team directly.`,
      )
      return
    }

    setSubmitted(true)
  }

  function goBack() {
    goBackOrFallback(router, navigation, '/(customer)/profile/privacy')
  }

  if (submitted) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={goBack}>
            <Feather name="arrow-left" size={20} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Data request</Text>
        </View>

        <View style={styles.body}>
          <View style={styles.heroCard}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>Request received</Text>
            </View>
            <Text style={styles.heroTitle}>Your data request is now in Drape.</Text>
            <Text style={styles.heroCopy}>
              The privacy team can now pick this up from the in-app request trail. We may still verify identity before releasing anything sensitive.
            </Text>
          </View>

          <View style={styles.noteCard}>
            <Text style={styles.noteTitle}>Need to add context?</Text>
            <Text style={styles.noteCopy}>Email {CONTACTS.privacy} from your account email if you need to add more detail after submitting.</Text>
          </View>

          <TouchableOpacity style={styles.actionBtn} onPress={goBack}>
            <Text style={styles.actionBtnText}>Back to privacy</Text>
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
        <Text style={styles.headerTitle}>Data request</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Access request</Text>
          </View>
          <Text style={styles.heroTitle}>Request a copy of your Drape data.</Text>
          <Text style={styles.heroCopy}>
            We can route a formal data-access request to the privacy inbox. For security, we may verify identity before releasing anything sensitive.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>What you can already control in-app</Text>
          <Text style={styles.sectionCopy}>Name, phone number, measurements, and privacy preferences can be updated directly without a formal request.</Text>
          <View style={styles.divider} />
          <Text style={styles.sectionTitle}>What this request is for</Text>
          <Text style={styles.sectionCopy}>A broader copy of the data tied to your account, including profile data and order-related account records where sharing is appropriate.</Text>
          <View style={styles.divider} />
          <Text style={styles.sectionTitle}>Account email</Text>
          <Text style={styles.accountValue}>{user?.email ?? 'No account email available in-app'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Extra context</Text>
          <Text style={styles.sectionCopy}>Optional, but helpful if you want the privacy team to know what you need first.</Text>
          <TextInput
            style={styles.noteInput}
            value={note}
            onChangeText={setNote}
            multiline
            placeholder="Example: I mainly need my profile, order history, and message history."
            placeholderTextColor={Colors.midGrey}
            maxLength={300}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{note.trim().length}/300</Text>
        </View>

        <View style={styles.noteCard}>
          <Text style={styles.noteTitle}>Best use</Text>
          <Text style={styles.noteCopy}>Use this if you want a copy of your account data. If you only need to correct something, it is usually faster to update it directly in Drape.</Text>
        </View>

        <TouchableOpacity
          style={[styles.actionBtn, opening && { opacity: 0.7 }]}
          onPress={handleSubmitRequest}
          disabled={opening}
        >
          {opening ? <ActivityIndicator color={Colors.textInverse} /> : <Text style={styles.actionBtnText}>Submit data request</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => { void handleRequestDataEmail() }}
          disabled={opening}
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
  actionBtnText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textInverse },
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
