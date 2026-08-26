import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { taxCollectionPromise, type TaxCollectionMode, type TaxResponsibleParty } from '@drape/shared'
import { supabase } from '@/lib/supabase'
import { formatAmount, type CurrencyCode } from '@/lib/currency'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

type TaxSummary = {
  currency: string | null
  tax_amount: number | null
  import_tax_amount: number | null
  duty_amount: number | null
  tax_collection_mode: TaxCollectionMode | null
  tax_responsible_party: TaxResponsibleParty | null
}

export function TaxDecisionSummaryCard({ orderId }: { orderId: string }) {
  const [summary, setSummary] = useState<TaxSummary | null>(null)
  useEffect(() => {
    let active = true
    void supabase.from('orders')
      .select('currency,tax_amount,import_tax_amount,duty_amount,tax_collection_mode,tax_responsible_party')
      .eq('id', orderId).maybeSingle()
      .then(({ data }) => { if (active) setSummary(data as TaxSummary | null) })
    return () => { active = false }
  }, [orderId])
  if (!summary?.tax_collection_mode || !summary.tax_responsible_party) return null
  const copy = taxCollectionPromise({
    collectionMode: summary.tax_collection_mode,
    responsibleParty: summary.tax_responsible_party,
  })
  const currency = (summary.currency ?? 'USD') as CurrencyCode
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.body}>{copy.body}</Text>
      {summary.tax_collection_mode === 'COLLECTED_AT_CHECKOUT' ? (
        <View style={styles.amounts}>
          <Text style={styles.body}>Import tax {formatAmount(summary.import_tax_amount ?? 0, currency, currency, {})}</Text>
          <Text style={styles.body}>Duty {formatAmount(summary.duty_amount ?? 0, currency, currency, {})}</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.lightGrey, backgroundColor: Colors.white, padding: Spacing.lg, gap: Spacing.xs },
  title: { color: Colors.ink, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  body: { color: Colors.inkLight, fontSize: FontSize.sm, lineHeight: 20 },
  amounts: { marginTop: Spacing.xs, gap: 2 },
})
