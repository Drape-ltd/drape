import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import {
  OPS_PARTIAL_REFUND_ORDER_OUTCOME_COPY,
  refundProviderTimingCopy,
  type OpsPartialRefundOrderOutcome,
} from '@drape/shared'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { supabase } from '@/lib/supabase'

type RefundResolution = {
  id: string
  amount: number
  currency: string
  status: string
  order_outcome: OpsPartialRefundOrderOutcome
  resume_stage: string | null
  provider_reference: string | null
  failure_summary: string | null
  created_at: string
  updated_at: string
}

function statusCopy(status: string) {
  if (status === 'SUCCEEDED') return { title: 'Refund sent', icon: 'check-circle' as const, tone: 'success' as const }
  if (['FAILED', 'BLOCKED'].includes(status)) return { title: 'Refund needs review', icon: 'alert-circle' as const, tone: 'warning' as const }
  if (status === 'PROCESSING') return { title: 'Refund processing', icon: 'clock' as const, tone: 'neutral' as const }
  return { title: 'Refund awaiting approval', icon: 'shield' as const, tone: 'neutral' as const }
}

function formatAmount(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount / 100)
  } catch {
    return `${currency} ${(amount / 100).toFixed(2)}`
  }
}

function readExpectedAt(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null
  const record = response as Record<string, unknown>
  if (typeof record.expected_at === 'string') return record.expected_at
  const latest = record.latest_refund_event
  if (latest && typeof latest === 'object') {
    const data = (latest as Record<string, unknown>).data
    if (data && typeof data === 'object' && typeof (data as Record<string, unknown>).expected_at === 'string') {
      return (data as Record<string, unknown>).expected_at as string
    }
  }
  return null
}

export function OpsRefundStatusCard({ orderId, actorRole }: { orderId: string; actorRole: 'CUSTOMER' | 'TAILOR' }) {
  const [resolution, setResolution] = useState<RefundResolution | null>(null)
  const [payment, setPayment] = useState<{ provider: string | null; provider_response: unknown } | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const [{ data: resolutionData }, { data: paymentData }] = await Promise.all([
      supabase.from('order_refund_resolutions')
        .select('id,amount,currency,status,order_outcome,resume_stage,provider_reference,failure_summary,created_at,updated_at')
        .eq('order_id', orderId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('order_payments')
        .select('provider,provider_response').eq('order_id', orderId).eq('phase', 'INITIAL_ORDER')
        .in('status', ['SUCCEEDED', 'PARTIAL_REFUND', 'REFUNDED']).order('created_at', { ascending: true }).limit(1).maybeSingle(),
    ])
    setResolution(resolutionData as RefundResolution | null)
    setPayment(paymentData as { provider: string | null; provider_response: unknown } | null)
    setLoading(false)
  }, [orderId])

  useEffect(() => {
    const initialRefresh = setTimeout(() => { void refresh() }, 0)
    const channel = supabase.channel(`refund-status:${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_refund_resolutions', filter: `order_id=eq.${orderId}` }, () => { void refresh() })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'order_payments', filter: `order_id=eq.${orderId}` }, () => { void refresh() })
      .subscribe()
    return () => { clearTimeout(initialRefresh); void supabase.removeChannel(channel) }
  }, [orderId, refresh])

  if (loading) return null
  if (!resolution) return null
  const status = statusCopy(resolution.status)
  const timing = refundProviderTimingCopy({ provider: payment?.provider, audience: actorRole, expectedAt: readExpectedAt(payment?.provider_response) })
  const outcome = OPS_PARTIAL_REFUND_ORDER_OUTCOME_COPY[resolution.order_outcome]
  const resume = resolution.resume_stage?.toLowerCase().replaceAll('_', ' ')

  return (
    <View style={[styles.card, status.tone === 'warning' && styles.warningCard]} accessibilityRole="summary">
      <View style={styles.heading}>
        <View style={[styles.icon, status.tone === 'warning' && styles.warningIcon]}><Feather name={status.icon} size={19} color={status.tone === 'warning' ? Colors.error : Colors.needleGreen} /></View>
        <View style={styles.headingCopy}>
          <Text style={styles.title}>{status.title}</Text>
          <Text style={styles.amount}>{formatAmount(resolution.amount, resolution.currency)}</Text>
        </View>
      </View>
      <View style={styles.divider} />
      <Text style={styles.label}>{timing.label}</Text>
      <Text style={styles.body}>{timing.detail}</Text>
      <Text style={styles.label}>What happens to this order</Text>
      <Text style={styles.body}>{outcome.label}{resume && resolution.order_outcome === 'CONTINUE_ORDER' ? ` · resumes at ${resume}` : ''}</Text>
      {actorRole === 'TAILOR' ? <Text style={styles.note}>Customer refunds follow the customer’s payment provider. Your payout provider is handled separately.</Text> : null}
      {resolution.failure_summary ? <Text style={styles.error}>{resolution.failure_summary}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  loading: { paddingVertical: Spacing.md, alignItems: 'center' },
  card: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.lightGrey, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm, ...Shadow.sm },
  warningCard: { borderColor: Colors.error + '55' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headingCopy: { flex: 1, gap: 2 },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.needleGreenLight },
  warningIcon: { backgroundColor: Colors.error + '12' },
  title: { color: Colors.ink, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  amount: { color: Colors.inkLight, fontSize: FontSize.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.lightGrey, marginVertical: Spacing.xs },
  label: { color: Colors.needleGreen, fontSize: FontSize.xs, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.7, marginTop: Spacing.xs },
  body: { color: Colors.inkLight, fontSize: FontSize.sm, lineHeight: 21 },
  note: { color: Colors.midGrey, fontSize: FontSize.xs, lineHeight: 18, marginTop: Spacing.xs },
  error: { color: Colors.error, fontSize: FontSize.sm, lineHeight: 20 },
})
