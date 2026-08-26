import { useCallback, useEffect, useState } from 'react'
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { COMMERCIAL_ADJUSTMENT_LABELS, type CommercialAdjustmentType } from '@drape/shared'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'
import { invokeFunction, supabase } from '@/lib/supabase'
import { readFunctionErrorMessage } from '@/lib/function-errors'
import { useOrderPaymentFlow } from '@/lib/payments'

type AdjustmentRow = {
  id: string
  reference: string
  order_id: string
  adjustment_type: CommercialAdjustmentType
  status: 'PROPOSED' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'PAYMENT_PENDING' | 'PAID' | 'OPS_REVIEW' | 'COMPLETED'
  proposed_by_role: 'CUSTOMER' | 'TAILOR' | 'OPS'
  summary: string
  reason: string
  responsibility: string
  amount_delta: number
  currency: CurrencyCode
  original_deadline: string | null
  proposed_deadline: string | null
  requires_payment: boolean
  created_at: string
}

type FabricAdjustmentLink = {
  adjustment_id: string
  requested_release_amount: number
  remaining_allowance_snapshot: number
  shortfall_amount: number
  material_advance_id: string | null
}

const STATUS_LABELS: Record<AdjustmentRow['status'], string> = {
  PROPOSED: 'Decision needed',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  CANCELLED: 'Cancelled',
  PAYMENT_PENDING: 'Payment needed',
  PAID: 'Paid',
  OPS_REVIEW: 'Drapeon review',
  COMPLETED: 'Completed',
}

function money(value: number, currency: CurrencyCode) {
  return formatAmount(Math.abs(value), currency, currency, STATIC_FALLBACK_RATES)
}

function dateTime(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(date)
}

function Detail({ label, value }: { label: string; value: string }) {
  return <View style={styles.detail}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>
}

export function CommercialAdjustmentCard({ orderId, actorRole, onChanged }: {
  orderId: string
  actorRole: 'CUSTOMER' | 'TAILOR'
  onChanged?: () => void | Promise<void>
}) {
  const [adjustment, setAdjustment] = useState<AdjustmentRow | null>(null)
  const [fabricLink, setFabricLink] = useState<FabricAdjustmentLink | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const { startCommercialAdjustmentPayment } = useOrderPaymentFlow()

  const refresh = useCallback(async () => {
    const { data } = await supabase.from('commercial_adjustments')
      .select('id, reference, order_id, adjustment_type, status, proposed_by_role, summary, reason, responsibility, amount_delta, currency, original_deadline, proposed_deadline, requires_payment, created_at')
      .eq('order_id', orderId).order('created_at', { ascending: false }).limit(1).maybeSingle()
    const next = (data as AdjustmentRow | null) ?? null
    setAdjustment(next)
    if (next?.id) {
      const { data: link } = await supabase.from('fabric_release_adjustment_links')
        .select('adjustment_id, requested_release_amount, remaining_allowance_snapshot, shortfall_amount, material_advance_id')
        .eq('adjustment_id', next.id).maybeSingle()
      setFabricLink((link as FabricAdjustmentLink | null) ?? null)
    } else setFabricLink(null)
    setLoading(false)
  }, [orderId])

  useEffect(() => { void refresh() }, [refresh])

  async function run(action: 'respond' | 'complete', body: Record<string, unknown>, label: string) {
    if (!adjustment || busy) return
    setBusy(label)
    const { error } = await invokeFunction('commercial-adjustment-action', { body: { action, adjustmentId: adjustment.id, ...body } })
    setBusy(null)
    if (error) {
      Alert.alert('Change not updated', await readFunctionErrorMessage(error, 'Drapeon could not safely update this order change.'))
      return
    }
    await refresh()
    await onChanged?.()
  }

  async function pay() {
    if (!adjustment || busy) return
    setBusy('pay')
    const result = await startCommercialAdjustmentPayment({ orderId, adjustmentId: adjustment.id })
    setBusy(null)
    if (!result.ok) {
      if (result.reason !== 'cancelled') Alert.alert('Payment not completed', result.message)
      return
    }
    await refresh()
    await onChanged?.()
  }

  if (loading) return null
  if (!adjustment) return null

  const counterpartDecision = adjustment.status === 'PROPOSED' && adjustment.proposed_by_role !== actorRole
  const proposerCancel = adjustment.status === 'PROPOSED' && adjustment.proposed_by_role === actorRole
  const canComplete = actorRole === 'TAILOR'
    && ['ACCEPTED', 'PAID'].includes(adjustment.status)
    && ['SCOPE', 'MATERIAL', 'RUSH_WORK', 'FIT_REVISION', 'CORRECTION', 'OTHER_REVIEWED'].includes(adjustment.adjustment_type)
  const deadline = dateTime(adjustment.proposed_deadline)

  return (
    <View style={styles.card} accessible accessibilityLabel={`Order change: ${COMMERCIAL_ADJUSTMENT_LABELS[adjustment.adjustment_type]}`}>
      <View style={styles.header}>
        <View style={styles.icon}><Feather name="edit-3" size={18} color={Colors.needleGreen} /></View>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>Order change · {adjustment.reference}</Text>
          <Text style={styles.title}>{COMMERCIAL_ADJUSTMENT_LABELS[adjustment.adjustment_type]}</Text>
        </View>
        <View style={styles.status}><Text style={styles.statusText}>{STATUS_LABELS[adjustment.status]}</Text></View>
      </View>
      <Text style={styles.summary}>{adjustment.summary}</Text>
      <Text style={styles.reason}>{adjustment.reason}</Text>
      <View style={styles.details}>
        {fabricLink ? <Detail label="Supplier cost" value={money(fabricLink.requested_release_amount, adjustment.currency)} /> : null}
        {fabricLink ? <Detail label="Allowance already protected" value={money(fabricLink.remaining_allowance_snapshot, adjustment.currency)} /> : null}
        {fabricLink ? <Detail label="Fabric shortfall before tax" value={money(fabricLink.shortfall_amount, adjustment.currency)} /> : null}
        <Detail label="Price impact" value={adjustment.amount_delta === 0 ? 'No change' : `${adjustment.amount_delta > 0 ? '+' : '−'}${money(adjustment.amount_delta, adjustment.currency)}`} />
        {deadline ? <Detail label="Proposed deadline" value={deadline} /> : null}
        <Detail label="Responsibility" value={adjustment.responsibility.charAt(0) + adjustment.responsibility.slice(1).toLowerCase()} />
      </View>
      {fabricLink ? <Text style={styles.fabricNote}>{fabricLink.material_advance_id ? 'Payment confirmed. The exact fabric release is now waiting in the protected approval lane.' : 'Accepting does not release funds. The fabric claim opens only after the additional payment is provider-confirmed.'}</Text> : null}
      {counterpartDecision ? (
        <View style={styles.actions}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Accept order change" style={styles.primary} disabled={!!busy} onPress={() => run('respond', { decision: 'ACCEPTED' }, 'accept')}>
            <Text style={styles.primaryText}>{busy === 'accept' ? 'Saving…' : adjustment.requires_payment ? 'Accept and continue to payment' : 'Accept change'}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Decline order change" style={styles.secondary} disabled={!!busy} onPress={() => run('respond', { decision: 'DECLINED' }, 'decline')}>
            <Text style={styles.secondaryText}>Decline</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {proposerCancel ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel order change proposal" style={styles.secondary} disabled={!!busy} onPress={() => run('respond', { decision: 'CANCELLED' }, 'cancel')}><Text style={styles.secondaryText}>Cancel proposal</Text></TouchableOpacity> : null}
      {actorRole === 'CUSTOMER' && adjustment.status === 'PAYMENT_PENDING' ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Pay approved order change" style={styles.primary} disabled={!!busy} onPress={pay}><Text style={styles.primaryText}>{busy === 'pay' ? 'Opening checkout…' : `Pay ${money(adjustment.amount_delta, adjustment.currency)}`}</Text></TouchableOpacity> : null}
      {canComplete ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Mark approved order change complete" style={styles.primary} disabled={!!busy} onPress={() => run('complete', {}, 'complete')}><Text style={styles.primaryText}>{busy === 'complete' ? 'Saving…' : 'Mark added work complete'}</Text></TouchableOpacity> : null}
      <Text style={styles.footnote}>The accepted order stays intact. This proposal, decision, payment, and deadline are recorded separately for both parties and Drapeon Ops.</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  loading: { paddingVertical: Spacing.md, alignItems: 'center' },
  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.lightGrey, padding: Spacing.lg, gap: Spacing.sm, ...Shadow.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 38, height: 38, borderRadius: Radius.full, backgroundColor: Colors.needleGreenLight, alignItems: 'center', justifyContent: 'center' },
  headingCopy: { flex: 1 },
  eyebrow: { color: Colors.needleGreen, fontSize: FontSize.xs, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.4 },
  title: { color: Colors.ink, fontSize: FontSize.lg, fontWeight: FontWeight.bold, marginTop: 2 },
  status: { backgroundColor: Colors.boneDeep, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  statusText: { color: Colors.ink, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  summary: { color: Colors.ink, fontSize: FontSize.md, fontWeight: FontWeight.semibold, lineHeight: 23 },
  reason: { color: Colors.inkLight, fontSize: FontSize.sm, lineHeight: 21 },
  details: { backgroundColor: Colors.bone, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.xs },
  detail: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  detailLabel: { flex: 1, color: Colors.inkLight, fontSize: FontSize.sm },
  detailValue: { flexShrink: 1, color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, textAlign: 'right' },
  actions: { gap: Spacing.sm, marginTop: Spacing.xs },
  primary: { minHeight: 48, borderRadius: Radius.full, backgroundColor: Colors.needleGreen, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg },
  primaryText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: FontWeight.bold, textAlign: 'center' },
  secondary: { minHeight: 46, borderRadius: Radius.full, backgroundColor: Colors.bone, borderWidth: 1, borderColor: Colors.lightGrey, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg },
  secondaryText: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  footnote: { color: Colors.midGrey, fontSize: FontSize.xs, lineHeight: 18, marginTop: Spacing.xs },
  fabricNote: { color: Colors.needleGreen, backgroundColor: Colors.needleGreenLight, borderRadius: Radius.md, padding: Spacing.sm, fontSize: FontSize.xs, lineHeight: 18 },
})
