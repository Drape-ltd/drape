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
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

// ─── FAQ data ─────────────────────────────────────────────────────────────────

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "How do I track my order?",
    a: "Go to the Orders tab — you'll see real-time updates for every stage from cutting through to delivery. You'll also receive a push notification each time your tailor advances your order.",
  },
  {
    q: "Can I cancel or change my order?",
    a: "Before accepting a quote you can cancel at any time with no charge. Once you've accepted a quote and confirmed payment, please contact your tailor via the Messages tab to discuss changes. Cancellations after confirmation may incur a fee at the tailor's discretion.",
  },
  {
    q: "How does payment work?",
    a: "You pay only after reviewing and accepting your tailor's quote. Payment is held securely and only released to the tailor once you mark the order complete. If anything goes wrong you can raise a dispute.",
  },
  {
    q: "What if my garment doesn't fit?",
    a: "Raise a concern via the order screen before marking it complete. Our team will review the dispute and help mediate a resolution — which could include alterations, a partial refund, or a full refund depending on the circumstances.",
  },
  {
    q: "How are tailors verified?",
    a: "Every tailor on Drape submits a government-issued ID and a portfolio before going live. Our ops team manually reviews each application. Verified tailors display a badge on their profile.",
  },
  {
    q: "How do I become a tailor on Drape?",
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
]

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HelpScreen() {
  const router = useRouter()
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  function toggleFaq(i: number) {
    setOpenIndex(openIndex === i ? null : i)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Get help</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: Spacing.xl, paddingBottom: 64, gap: Spacing.xl }}>

        {/* ── Visit Help Centre ── */}
        <TouchableOpacity
          style={styles.helpCentreCard}
          onPress={() => Linking.openURL('https://drapeon.co/help')}
          activeOpacity={0.8}
        >
          <View style={styles.helpCentreIcon}>
            <Feather name="globe" size={24} color={Colors.needleGreen} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.helpCentreTitle}>Visit Help Centre</Text>
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
              onPress={() => Linking.openURL('mailto:support@drapeon.co?subject=Drape%20support%20request')}
            />
            <View style={styles.divider} />
            <ContactRow
              icon="message-circle"
              title="WhatsApp"
              sub="Chat with the team directly"
              onPress={() => Linking.openURL('https://wa.me/message/drapeon')}
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
              onPress={() => Linking.openURL('https://drapeon.co/terms')}
            />
            <View style={styles.divider} />
            <ContactRow
              icon="shield"
              title="Privacy policy"
              sub="drapeon.co/privacy"
              onPress={() => Linking.openURL('https://drapeon.co/privacy')}
              last
            />
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  )
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

// ─── Styles ──────────────────────────────────────────────────────────────────

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

  // Help centre CTA
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

  // Contact rows
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

  // FAQ
  faqItem: {
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.lightGrey,
  },
  faqLast: { borderBottomWidth: 0 },
  faqHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.lg,
  },
  faqQuestion: { flex: 1, fontSize: FontSize.md, fontWeight: FontWeight.medium, color: Colors.ink, lineHeight: 22 },
  faqAnswer: {
    fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 22,
    paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg,
  },
})
