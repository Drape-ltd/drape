import { useEffect, useState } from 'react'
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { formatAmount, type CurrencyCode } from '@/lib/currency'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { formatTaxRate, taxLinesForReceiptSnapshot } from '@drape/shared'

type ReceiptRow = {
  receipt_number: string
  currency: string
  subtotal_amount: number
  consultation_credit_amount: number
  promotion_amount: number
  platform_fee_amount: number
  tax_amount: number
  import_tax_amount: number
  duty_amount: number
  tax_collection_mode: string | null
  tax_responsible_party: string | null
  shipping_amount: number
  total_amount: number
  tax_jurisdiction: string | null
  protected_tailor_amount: number
  fabric_funding_policy_version: string | null
  tailoring_amount: number | null
  fabric_allowance_amount: number | null
  provider: string
  provider_reference: string
  paid_at: string
}

function money(amount: number, currency: string) {
  return formatAmount(amount, currency as CurrencyCode, currency as CurrencyCode, {})
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={styles.label}>{label}</Text>
      <Text style={strong ? styles.valueStrong : styles.value}>{value}</Text>
    </View>
  )
}

export function CommercialReceiptCard({ orderId, actorRole }: { orderId: string; actorRole: 'CUSTOMER' | 'TAILOR' }) {
  const [receipt, setReceipt] = useState<ReceiptRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      const { data } = await supabase
        .from('commercial_receipts')
        .select('receipt_number, currency, subtotal_amount, consultation_credit_amount, promotion_amount, platform_fee_amount, tax_amount, import_tax_amount, duty_amount, tax_collection_mode, tax_responsible_party, shipping_amount, total_amount, tax_jurisdiction, protected_tailor_amount, fabric_funding_policy_version, tailoring_amount, fabric_allowance_amount, provider, provider_reference, paid_at')
        .eq('order_id', orderId)
        .order('issued_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (active) {
        setReceipt((data as ReceiptRow | null) ?? null)
        setLoading(false)
      }
    })()
    return () => { active = false }
  }, [orderId])

  if (loading) return null
  if (!receipt) return null
  const domesticTaxAmount = Math.max(receipt.tax_amount - receipt.import_tax_amount - receipt.duty_amount, 0)
  const taxLines = taxLinesForReceiptSnapshot({
    taxJurisdiction: receipt.tax_jurisdiction,
    taxAmount: domesticTaxAmount,
  })

  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Open payment receipt ${receipt.receipt_number}`}
        style={styles.trigger}
        activeOpacity={0.82}
        onPress={() => setOpen(true)}
      >
        <Feather name="file-text" size={13} color={Colors.needleGreenDark} />
        <Text style={styles.triggerText}>Receipt</Text>
      </TouchableOpacity>
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.eyebrow}>Payment receipt</Text>
              <Text style={styles.modalTitle}>{receipt.receipt_number}</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close payment receipt"
              style={styles.closeButton}
              onPress={() => setOpen(false)}
            >
              <Feather name="x" size={22} color={Colors.ink} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
            <View style={styles.card}>
              <View style={styles.headingRow}>
                <View style={styles.icon}><Feather name="check" size={18} color={Colors.needleGreen} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.eyebrow}>Payment captured</Text>
                  <Text style={styles.title}>{money(receipt.total_amount, receipt.currency)}</Text>
                </View>
              </View>
              {actorRole === 'CUSTOMER' ? (
                <>
                  {receipt.fabric_funding_policy_version && receipt.tailoring_amount != null && receipt.fabric_allowance_amount != null ? (
                    <>
                      <Line label="Tailoring and construction" value={money(receipt.tailoring_amount + receipt.consultation_credit_amount, receipt.currency)} />
                      <Line label="Protected fabric allowance" value={money(receipt.fabric_allowance_amount, receipt.currency)} />
                    </>
                  ) : <Line label="Tailor work and included materials" value={money(receipt.subtotal_amount + receipt.consultation_credit_amount, receipt.currency)} />}
                  {receipt.consultation_credit_amount > 0 ? <Line label="Consultation fee credit" value={`−${money(receipt.consultation_credit_amount, receipt.currency)}`} /> : null}
                  {receipt.promotion_amount > 0 ? <Line label="Drapeon-funded benefit" value={`−${money(receipt.promotion_amount, receipt.currency)}`} /> : null}
                  {receipt.platform_fee_amount > 0 ? <Line label="Drapeon service fee" value={money(receipt.platform_fee_amount, receipt.currency)} /> : null}
                  <Line label="Fulfillment" value={receipt.shipping_amount > 0 ? money(receipt.shipping_amount, receipt.currency) : 'Free'} />
                  {taxLines.map((line) => (
                    <Line key={line.key} label={line.rateBps > 0 ? `${line.label} (${formatTaxRate(line.rateBps)})` : line.label} value={money(line.amount, receipt.currency)} />
                  ))}
                  {receipt.import_tax_amount > 0 ? <Line label="Import tax" value={money(receipt.import_tax_amount, receipt.currency)} /> : null}
                  {receipt.duty_amount > 0 ? <Line label="Customs duty" value={money(receipt.duty_amount, receipt.currency)} /> : null}
                  {receipt.tax_collection_mode === 'PAYABLE_ON_IMPORT' ? <Text style={styles.help}>Import charges were not collected at checkout and may be payable to customs or the carrier by the responsible importer.</Text> : null}
                  <Line label="Total paid" value={money(receipt.total_amount, receipt.currency)} strong />
                </>
              ) : (
                <>
                  <Line label="Customer paid" value={money(receipt.total_amount, receipt.currency)} />
                  <Line label={receipt.fabric_funding_policy_version ? 'Tailoring protected' : 'Protected tailor amount'} value={money(receipt.protected_tailor_amount, receipt.currency)} strong />
                  {receipt.fabric_funding_policy_version && receipt.fabric_allowance_amount != null ? (
                    <Line label="Fabric allowance held for approved material costs" value={money(receipt.fabric_allowance_amount, receipt.currency)} />
                  ) : null}
                  <Text style={styles.help}>{receipt.fabric_funding_policy_version ? 'The fabric allowance is not earnings. Drapeon releases approved material costs separately and returns any unused allowance to the customer.' : 'Tax, fulfillment, and Drapeon fees are recorded separately and are not deducted from this protected amount.'}</Text>
                </>
              )}
              <Text style={styles.meta}>{receipt.provider === 'COVERAGE' ? 'Drapeon coverage' : receipt.provider} · {receipt.provider_reference}</Text>
              <Text style={styles.help}>This receipt is locked to the captured checkout. Refunds and corrections appear separately.</Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  loading: { paddingVertical: Spacing.lg, alignItems: 'center' },
  trigger: { alignSelf: 'flex-start', minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: Spacing.xs, paddingHorizontal: Spacing.xs, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.lightGrey, backgroundColor: Colors.white },
  triggerText: { color: Colors.needleGreenDark, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  modalSafe: { flex: 1, backgroundColor: Colors.bone },
  modalHeader: { minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, paddingHorizontal: Spacing.xl, borderBottomWidth: 1, borderBottomColor: Colors.lightGrey, backgroundColor: Colors.white },
  modalTitle: { color: Colors.ink, fontSize: FontSize.lg, fontWeight: FontWeight.bold, marginTop: 2 },
  closeButton: { width: 44, height: 44, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bone },
  modalContent: { padding: Spacing.xl, paddingBottom: Spacing.xxxl },
  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.lightGrey, padding: Spacing.lg, gap: Spacing.sm, ...Shadow.sm },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs },
  icon: { width: 36, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.needleGreenLight },
  eyebrow: { color: Colors.needleGreen, fontSize: FontSize.xs, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { color: Colors.ink, fontSize: FontSize.md, fontWeight: FontWeight.bold, marginTop: 2 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.md, paddingVertical: 3 },
  label: { flex: 1, color: Colors.inkLight, fontSize: FontSize.sm, lineHeight: 20 },
  value: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  valueStrong: { color: Colors.ink, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  meta: { color: Colors.midGrey, fontSize: FontSize.xs, marginTop: Spacing.xs },
  help: { color: Colors.inkLight, fontSize: FontSize.xs, lineHeight: 18 },
})
