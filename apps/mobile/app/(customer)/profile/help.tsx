/**
 * Get Help
 *
 * Help centre for customers — FAQ accordion, direct contact options,
 * and a link to the full website help centre.
 *
 * External links (Help Centre, WhatsApp) will resolve to drapeon.co pages
 * once the website is built.
 */

import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert,
} from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { DRAPE_CUSTOMER_GUIDE_TOPICS, DRAPE_HELP_FAQ } from '@drape/shared'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { goBackOrFallback } from '@/lib/navigation'

// ─── FAQ data ─────────────────────────────────────────────────────────────────

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "How do I track my order?",
    a: "Go to the Orders tab. You'll see real-time updates for every stage from cutting through to delivery. You'll also receive a push notification each time your tailor advances your order.",
  },
  {
    q: "Can I cancel or change my order?",
    a: "Before accepting a custom quote you can walk away with no charge. For ready-made, ask Drapeon to review cancellation before the seller starts preparing the order. Once preparation, pickup, or dispatch has started, cancellation is no longer automatic and support may need to review the next step.",
  },
  {
    q: "How does payment work?",
    a: "For custom, you pay only after reviewing and accepting your tailor's quote. For ready-made, you pay in checkout, including Drapeon's standard delivery or shipping fee if needed. Payment stays protected while the order is in progress, then releases under Drapeon's settlement rules once the handoff is confirmed and the order is closed out in the app.",
  },
  {
    q: "What if my garment doesn't fit?",
    a: "Raise a concern from the order screen before marking the order complete. Keep all communication in Drapeon so the full history stays visible while our team reviews what happened and helps mediate the next step.",
  },
  {
    q: "Can I get a refund or exchange on ready-made?",
    a: "If the wrong item arrives, the item is damaged, or Drapeon dispatch fails, raise it in Drapeon before you finish the order so support can review a refund or exchange. Change-of-mind return is not automatic once the seller has started preparing the order or the handoff has started.",
  },
  {
    q: "How are tailors verified?",
    a: "Every tailor on Drapeon submits a government-issued ID and a portfolio before going live. Our ops team manually reviews each application. Verified tailors display a badge on their profile.",
  },
  {
    q: "How do I become a tailor on Drapeon?",
    a: "Visit drapeon.co/tailors to apply. You'll need to provide your portfolio, a valid ID, and details about your specialism. Once approved you can start receiving orders.",
  },
  {
    q: "Are my measurements safe?",
    a: "Yes. Your measurements are stored securely and are only shared with a tailor when you actively start an order with them. You can update or delete them at any time from your profile.",
  },
  {
    q: "How do I update my profile photo or name?",
    a: "Tap your avatar on the Profile tab to upload a new photo. To change your display name, go to Profile → Account settings → Personal information.",
  },
  ...DRAPE_HELP_FAQ.map((item) => ({ q: item.question, a: item.answer })),
]

const GUIDE_TOPICS: Array<{
  icon: React.ComponentProps<typeof Feather>['name']
  title: string
  body: string
}> = DRAPE_CUSTOMER_GUIDE_TOPICS.map((topic) => ({
  icon: topic.icon as React.ComponentProps<typeof Feather>['name'],
  title: topic.title,
  body: topic.body,
}))

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HelpScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  function goBack() {
    goBackOrFallback(router, navigation, '/(customer)/profile')
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
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Drapeon guide</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Customer guide</Text>
          </View>
          <Text style={styles.heroTitle}>Everything you need to order with confidence.</Text>
          <Text style={styles.heroSub}>
            Start here for finding tailors, fit setup, protected payments, handoff, and support paths.
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
            <Text style={styles.helpCentreSub}>Browse our full guides and tutorials on drapeon.co</Text>
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
              sub="support@drapeon.co · we reply within 24h"
              onPress={() => { void openExternal('mailto:support@drapeon.co?subject=Drapeon%20support%20request') }}
            />
            <View style={styles.divider} />
            <ContactRow
              icon="message-circle"
              title="WhatsApp"
              sub="Chat with the team directly"
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
    Alert.alert('Unable to open link', 'Please email support@drapeon.co directly with the subject "Drapeon support request". If this is about a live order, keep the order thread updated in Drapeon too.')
    return
  }

  if (url.startsWith('https://wa.me/')) {
    Alert.alert('Unable to open link', 'Please open WhatsApp and message us directly, or email support@drapeon.co with the subject "Drapeon support request". Keep the live order as the source of truth while you wait.')
    return
  }

  if (url.startsWith('https://')) {
    Alert.alert('Unable to open link', `Please visit ${url} manually.`)
    return
  }

  Alert.alert('Unable to open link', 'Please try again in a moment or email support@drapeon.co directly with the subject "Drapeon support request". If this is tied to a live order, keep the updates in Drapeon first.')
}

// ─── FaqItem ─────────────────────────────────────────────────────────────────

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

// ─── ContactRow ──────────────────────────────────────────────────────────────

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

// ─── Styles ──────────────────────────────────────────────────────────────────

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
    fontWeight: FontWeight.bold,
    color: Colors.ink,
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
    lineHeight: 20,
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

  // Help centre CTA
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

  // Contact rows
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
    width: 36, height: 36, borderRadius: Radius.sm,
    backgroundColor: Colors.needleGreenLight, alignItems: 'center', justifyContent: 'center',
  },
  contactTitle: { fontSize: FontSize.md, fontWeight: FontWeight.medium, color: Colors.ink },
  contactSub: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },

  // FAQ
  faqItem: {
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.lightGrey,
  },
  faqLast: { borderBottomWidth: 0 },
  faqHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: 12,
  },
  faqQuestion: { flex: 1, fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink, lineHeight: 20 },
  faqAnswer: {
    fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20,
    paddingHorizontal: 12, paddingBottom: 12,
  },
})
