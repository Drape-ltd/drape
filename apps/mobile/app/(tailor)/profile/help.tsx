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
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { CONTACTS, DRAPE_TAILOR_GUIDE_TOPICS } from '@drape/shared'
import { goBackOrFallback } from '@/lib/navigation'

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "How do customers book me?",
    a: "Once your profile is live, customers can find you in search, view your portfolio, and send a booking request. You'll receive a notification and see it in your Orders tab under 'Awaiting quote'. Respond within 48 hours to maintain your response rating.",
  },
  {
    q: "How do I send a quote to a customer?",
    a: "Open the order from your Orders tab, review the customer's brief and measurements, then tap 'Send quote'. Enter your price, estimated completion date, and any notes. The customer receives a notification and has 48 hours to accept.",
  },
  {
    q: "When do I get paid?",
    a: "Customer payment stays protected while the order is active. Once the customer completes the handoff and closes the order out in Drapeon, the payout can move forward under your payout setup and Drapeon's platform fee terms.",
  },
  {
    q: "How do delivery and shipping work now?",
    a: "Standard delivery and shipping are Drapeon-managed. You prepare the order, mark it ready for Drapeon dispatch, and Drapeon ops takes over the normal dispatch handoff. Use pickup only for direct collection, and use support if something needs a rush or exception path.",
  },
  {
    q: "What if I need to cancel a paid order?",
    a: "Before irreversible work or handoff starts, request cancellation review from the order so Drapeon can review the right refund or next-step path. Do not mark an order complete, delivered, or collected if you already know you cannot fulfil it.",
  },
  {
    q: "How does ID verification work?",
    a: "Upload a government-issued ID photo during profile setup. Our team manually reviews each submission, and this typically takes 1 to 2 business days. Once approved, your profile goes through a final review before going live.",
  },
  {
    q: "Can I set my own availability?",
    a: "Yes. On the Dashboard, tap your availability pill to switch between Open (full bookings), Limited (select orders), or Fully Booked (hidden from new bookings). Existing orders are always unaffected.",
  },
  {
    q: "What happens if a customer raises a dispute?",
    a: "You'll be notified immediately. Respond through Messages, keep the full conversation inside Drapeon, and share any context that helps explain what happened. If the concern is not resolved directly, our team reviews the order history and next steps from there.",
  },
  {
    q: "How do I build my reputation on Drapeon?",
    a: "Respond to quotes quickly, communicate clearly, and deliver quality work on time. Completed orders generate star ratings and reviews that appear on your public profile. These drive your ranking in search results.",
  },
  {
    q: "What if Drapeon pauses my access or asks for more information?",
    a: "Open Trust & access from Account settings first. Drapeon should separate fixable setup or payout holds from active review states. Use the verification or payouts inbox when the next step depends on those teams, and use tailor support if the status still looks wrong after you've fixed the requirement.",
  },
  {
    q: "Can I work with international customers?",
    a: "Yes. Enable shipping on your profile and keep your location accurate. Drapeon handles the standard shipping fee logic and dispatch ownership for standard flows, while your order quote still covers the garment work itself.",
  },
]

const GUIDE_TOPICS: Array<{
  icon: React.ComponentProps<typeof Feather>['name']
  title: string
  body: string
}> = DRAPE_TAILOR_GUIDE_TOPICS.map((topic) => ({
  icon: topic.icon as React.ComponentProps<typeof Feather>['name'],
  title: topic.title,
  body: topic.body,
}))

export default function TailorHelpScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  function goBack() {
    goBackOrFallback(router, navigation, '/(tailor)/profile')
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
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Drapeon guide</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Tailor guide</Text>
          </View>
          <Text style={styles.heroTitle}>Everything you need to work cleanly on Drapeon.</Text>
          <Text style={styles.heroSub}>
            Start here for orders, quotes, production updates, payout readiness, verification, and support paths.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick guide</Text>
          <View style={styles.card}>
            {GUIDE_TOPICS.map((topic, i) => (
              <GuideTopic
                key={topic.title}
                icon={topic.icon}
                title={topic.title}
                body={topic.body}
                last={i === GUIDE_TOPICS.length - 1}
              />
            ))}
          </View>
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
            <Text style={styles.helpCentreTitle}>Full guide library</Text>
            <Text style={styles.helpCentreSub}>Detailed tailor tutorials on drapeon.co</Text>
          </View>
          <Feather name="external-link" size={16} color={Colors.midGrey} />
        </TouchableOpacity>

        {/* ── Contact us ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact us</Text>
          <View style={styles.card}>
            <ContactRow
              icon="shield"
              title="Trust & access"
              sub="See fix, review, and support paths in-app"
              onPress={() => router.push('/(tailor)/profile/trust-access' as never)}
            />
            <View style={styles.divider} />
            <ContactRow
              icon="mail"
              title="Email support"
              sub={`${CONTACTS.tailors} · we reply within 24h`}
              onPress={() => { void openExternal(`mailto:${CONTACTS.tailors}?subject=Tailor%20support%20request`) }}
            />
            <View style={styles.divider} />
            <ContactRow
              icon="check-circle"
              title="Verification review"
              sub={`${CONTACTS.verify} · ID and review follow-up`}
              onPress={() => { void openExternal(`mailto:${CONTACTS.verify}?subject=Drapeon%20verification%20review%20follow-up`) }}
            />
            <View style={styles.divider} />
            <ContactRow
              icon="credit-card"
              title="Payout help"
              sub={`${CONTACTS.payouts} · payout readiness and provider issues`}
              onPress={() => { void openExternal(`mailto:${CONTACTS.payouts}?subject=Drapeon%20payout%20readiness%20question`) }}
            />
            <View style={styles.divider} />
            <ContactRow
              icon="message-circle"
              title="WhatsApp"
              sub="Chat with the tailor success team"
              onPress={() => { void openExternal('https://wa.me/message/drapeon') }}
            />
            <View style={styles.divider} />
            <ContactRow
              icon="download"
              title="Request your data"
              sub={`${CONTACTS.privacy} · identity verification may be required`}
              onPress={() => { void openExternal(`mailto:${CONTACTS.privacy}?subject=Drapeon%20tailor%20data%20access%20request`) }}
            />
            <View style={styles.divider} />
            <ContactRow
              icon="trash-2"
              title="Account deletion"
              sub={`${CONTACTS.privacy} · request-based review, not instant wipe`}
              onPress={() => { void openExternal(`mailto:${CONTACTS.privacy}?subject=Drapeon%20tailor%20account%20deletion%20request`) }}
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
    const inbox = url.includes(CONTACTS.privacy) ? CONTACTS.privacy : CONTACTS.tailors
    Alert.alert('Unable to open link', `Please email ${inbox} directly from your mail app. If this is about a live order, keep the order thread updated in Drapeon too.`)
    return
  }

  if (url.startsWith('https://wa.me/')) {
    Alert.alert('Unable to open link', `Please open WhatsApp and message us directly, or email ${CONTACTS.tailors} with the subject "Tailor support request". Keep the live order as the source of truth while you wait.`)
    return
  }

  if (url.startsWith('https://')) {
    Alert.alert('Unable to open link', `Please visit ${url} manually.`)
    return
  }

  Alert.alert('Unable to open link', `Please try again in a moment or email ${CONTACTS.tailors} directly with the subject "Tailor support request". If this is tied to a live order, keep the updates in Drapeon first.`)
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

function GuideTopic({
  icon, title, body, last,
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  title: string
  body: string
  last?: boolean
}) {
  return (
    <View style={[styles.guideTopic, last && styles.contactRowLast]}>
      <View style={styles.contactIcon}>
        <Feather name={icon} size={18} color={Colors.needleGreen} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.contactTitle}>{title}</Text>
        <Text style={styles.contactSub}>{body}</Text>
      </View>
    </View>
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
  headerTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display },
  body: { padding: Spacing.lg, paddingBottom: Spacing.md, gap: Spacing.md },
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
  heroTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, lineHeight: 28, fontFamily: Fonts.display },
  heroSub: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  supportGuideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
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
    fontSize: FontSize.md,
    color: Colors.ink,
    fontWeight: FontWeight.bold,
    lineHeight: 22,
    fontFamily: Fonts.display,
  },
  supportGuideBody: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
  networkGuideCard: {
    backgroundColor: Colors.boneDeep,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  networkGuideTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  networkGuideBody: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 22,
  },
  contactGuideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
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
    padding: Spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    borderWidth: 1, borderColor: Colors.needleGreen + '30',
    ...Shadow.sm,
  },
  helpCentreIcon: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
  },
  helpCentreTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  helpCentreSub: { fontSize: FontSize.sm, color: Colors.inkLight, marginTop: 2, lineHeight: 18 },

  section: { gap: Spacing.sm },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },

  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.lightGrey, marginHorizontal: Spacing.md },

  contactRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.lightGrey,
  },
  guideTopic: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
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
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: 12,
  },
  faqQuestion: { flex: 1, fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink, lineHeight: 20 },
  faqAnswer: {
    fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20,
    paddingHorizontal: 12, paddingBottom: 12,
  },
})
