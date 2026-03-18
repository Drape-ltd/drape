/**
 * Get Help — Tailor
 *
 * Help centre for tailors: FAQ, contact options, policies.
 */

import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking,
} from 'react-native'
import { useRouter } from 'expo-router'
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
    a: "Payment is held securely until the customer marks the order complete or it is auto-released 7 days after delivery. Funds are then transferred to your connected Stripe or Paystack account, minus Drape's platform fee.",
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
    a: "You'll be notified immediately. Respond to the customer through Messages and try to reach a resolution. If unresolved, our team reviews both sides and may mediate a partial or full refund. Keep all communication within Drape.",
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
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  function toggleFaq(i: number) {
    setOpenIndex(openIndex === i ? null : i)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
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
              onPress={() => Linking.openURL('mailto:tailors@drapeon.co?subject=Tailor%20support%20request')}
            />
            <View style={styles.divider} />
            <ContactRow
              icon="message-circle"
              title="WhatsApp"
              sub="Chat with the tailor success team"
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
