/**
 * Get Help — Tailor
 *
 * Help centre for tailors: FAQ, contact options, policies.
 */

import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert,
} from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "How do I receive my first order?",
    a: "Once your profile is live, customers can find you in search and send a booking request. You'll receive a notification and see it in your Orders tab under 'Awaiting quote'. Respond within 48 hours to maintain your response rating.",
  },
  {
    q: "How do I send a quote to a customer?",
    a: "Open the order from your Orders tab, review the customer's brief and measurements, then tap 'Send quote'. Enter your price, estimated completion date, and any notes. The customer receives a notification and has 48 hours to accept.",
  },
  {
    q: "When do I get paid?",
    a: "Customer payment stays protected while the order is active. Once the customer completes the handoff and closes the order out in Drape, the payout can move forward under your payout setup and Drape's platform fee terms.",
  },
  {
    q: "How does ID verification work?",
    a: "Upload a government-issued ID photo during profile setup. Our team manually reviews each submission — this typically takes 1–2 business days. Once approved your profile goes through a final review before going live.",
  },
  {
    q: "Can I set my own availability?",
    a: "Yes. On the Dashboard, tap your availability pill to switch between Open (full bookings), Limited (select orders), or Fully Booked (hidden from new bookings). Existing orders are always unaffected.",
  },
  {
    q: "What happens if a customer raises a dispute?",
    a: "You'll be notified immediately. Respond through Messages, keep the full conversation inside Drape, and share any context that helps explain what happened. If the concern is not resolved directly, our team reviews the order history and next steps from there.",
  },
  {
    q: "How do I build my reputation on Drape?",
    a: "Respond to quotes quickly, communicate clearly, and deliver quality work on time. Completed orders generate star ratings and reviews that appear on your public profile — these drive your ranking in search results.",
  },
  {
    q: "Can I work with international customers?",
    a: "Yes. Enable 'Ships internationally' in your profile setup. Be clear in your quotes about postage costs and estimated delivery times. Currency is set per order based on your profile's default currency.",
  },
]

export default function TailorHelpScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  function goBack() {
    router.replace('/(tailor)/profile')
  }

  function toggleFaq(i: number) {
    setOpenIndex(openIndex === i ? null : i)
  }

  async function openExternal(url: string) {
    const supported = await Linking.canOpenURL(url)
    if (!supported) {
      alertOpenFailed(url)
      return
    }

    try {
      await Linking.openURL(url)
    } catch {
      alertOpenFailed(url)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Get help</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: Spacing.xl, paddingBottom: 64, gap: Spacing.xl }}>
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Tailor support</Text>
          </View>
          <Text style={styles.heroTitle}>Help with orders, payouts, verification, and client communication.</Text>
          <Text style={styles.heroSub}>
            Use this space when something needs clarification or escalation. We’ll help you keep work moving and resolve issues cleanly inside Drape.
          </Text>
        </View>

        <View style={styles.supportGuideCard}>
          <View style={styles.supportGuideBadge}>
            <Text style={styles.supportGuideBadgeText}>Best next step</Text>
          </View>
          <Text style={styles.supportGuideTitle}>Keep live work inside the order and message thread whenever you can.</Text>
          <Text style={styles.supportGuideBody}>
            Quotes, consultations, production updates, and concerns are easiest to resolve from the active order. Come here when you need policy clarity, account help, or an escalation.
          </Text>
        </View>

        <View style={styles.contactGuideCard}>
          <Text style={styles.contactGuideTitle}>Contact us when…</Text>
          <Text style={styles.contactGuideBody}>
            you need policy clarification, escalation help, verification guidance, or support once the normal order flow is no longer enough.
          </Text>
        </View>

        {/* ── Visit Help Centre ── */}
        <TouchableOpacity
          style={styles.helpCentreCard}
          onPress={() => { void openExternal('https://drapeon.co/help') }}
          activeOpacity={0.8}
        >
          <View style={styles.helpCentreIcon}>
            <Feather name="globe" size={24} color={Colors.needleGreen} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.helpCentreTitle}>Visit Help Centre</Text>
            <Text style={styles.helpCentreSub}>Full tailor guides and tutorials on drapeon.co</Text>
          </View>
          <Feather name="external-link" size={16} color={Colors.midGrey} />
        </TouchableOpacity>

        {/* ── Contact us ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact us</Text>
          <View style={styles.card}>
            <ContactRow
              icon="mail"
              title="Email support"
              sub="tailors@drapeon.co · we reply within 24h"
              onPress={() => { void openExternal('mailto:tailors@drapeon.co?subject=Tailor%20support%20request') }}
            />
            <View style={styles.divider} />
            <ContactRow
              icon="message-circle"
              title="WhatsApp"
              sub="Chat with the tailor success team"
              onPress={() => { void openExternal('https://wa.me/message/drapeon') }}
              last
            />
          </View>
        </View>

        {/* ── FAQ ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Common questions</Text>
          <View style={styles.card}>
            {FAQ.map((item, i) => (
              <FaqItem
                key={i}
                question={item.q}
                answer={item.a}
                open={openIndex === i}
                last={i === FAQ.length - 1}
                onPress={() => toggleFaq(i)}
              />
            ))}
          </View>
        </View>

        {/* ── Policies ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Policies</Text>
          <View style={styles.card}>
            <ContactRow
              icon="file-text"
              title="Terms of service"
              sub="drapeon.co/terms"
              onPress={() => { void openExternal('https://drapeon.co/terms') }}
            />
            <View style={styles.divider} />
            <ContactRow
              icon="shield"
              title="Privacy policy"
              sub="drapeon.co/privacy"
              onPress={() => { void openExternal('https://drapeon.co/privacy') }}
              last
            />
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  )
}

function alertOpenFailed(url: string) {
  if (url.startsWith('mailto:')) {
    Alert.alert('Unable to open link', 'Please email tailors@drapeon.co directly with the subject "Tailor support request".')
    return
  }

  if (url.startsWith('https://wa.me/')) {
    Alert.alert('Unable to open link', 'Please open WhatsApp and message us directly, or email tailors@drapeon.co with the subject "Tailor support request".')
    return
  }

  if (url.startsWith('https://')) {
    Alert.alert('Unable to open link', `Please visit ${url} manually.`)
    return
  }

  Alert.alert('Unable to open link', 'Please try again in a moment or email tailors@drapeon.co directly with the subject "Tailor support request".')
}

function FaqItem({
  question, answer, open, last, onPress,
}: {
  question: string
  answer: string
  open: boolean
  last: boolean
  onPress: () => void
}) {
  return (
    <View style={[styles.faqItem, last && styles.faqLast]}>
      <TouchableOpacity style={styles.faqHeader} onPress={onPress} activeOpacity={0.7}>
        <Text style={styles.faqQuestion}>{question}</Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.midGrey} />
      </TouchableOpacity>
      {open && (
        <Text style={styles.faqAnswer}>{answer}</Text>
      )}
    </View>
  )
}

function ContactRow({
  icon, title, sub, last, onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  title: string
  sub: string
  last?: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      style={[styles.contactRow, last && styles.contactRowLast]}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <View style={styles.contactIcon}>
        <Feather name={icon} size={18} color={Colors.needleGreen} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.contactTitle}>{title}</Text>
        <Text style={styles.contactSub}>{sub}</Text>
      </View>
      <Feather name="chevron-right" size={16} color={Colors.midGrey} />
    </TouchableOpacity>
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
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
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
  heroTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, lineHeight: 30 },
  heroSub: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 22 },
  supportGuideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  supportGuideBadge: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    backgroundColor: Colors.bone,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  supportGuideBadgeText: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    fontWeight: FontWeight.semibold,
  },
  supportGuideTitle: {
    fontSize: FontSize.lg,
    color: Colors.ink,
    fontWeight: FontWeight.bold,
    lineHeight: 26,
  },
  supportGuideBody: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 22,
  },
  contactGuideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  contactGuideTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  contactGuideBody: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },

  helpCentreCard: {
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    borderWidth: 1, borderColor: Colors.needleGreen + '30',
    ...Shadow.sm,
  },
  helpCentreIcon: {
    width: 48, height: 48, borderRadius: Radius.md,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
  },
  helpCentreTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  helpCentreSub: { fontSize: FontSize.sm, color: Colors.inkLight, marginTop: 2, lineHeight: 18 },

  section: { gap: Spacing.sm },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },

  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.lightGrey, marginHorizontal: Spacing.lg },

  contactRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.lightGrey,
  },
  contactRowLast: { borderBottomWidth: 0 },
  contactIcon: {
    width: 38, height: 38, borderRadius: Radius.md,
    backgroundColor: Colors.needleGreenLight, alignItems: 'center', justifyContent: 'center',
  },
  contactTitle: { fontSize: FontSize.md, fontWeight: FontWeight.medium, color: Colors.ink },
  contactSub: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },

  faqItem: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.lightGrey },
  faqLast: { borderBottomWidth: 0 },
  faqHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.lg,
  },
  faqQuestion: { flex: 1, fontSize: FontSize.md, fontWeight: FontWeight.medium, color: Colors.ink, lineHeight: 22 },
  faqAnswer: {
    fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 22,
    paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg,
  },
})
