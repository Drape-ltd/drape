import { useEffect, useMemo, useState } from 'react'
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { presentProviderDispute, settlementStatusLabel, summarizeSettlement, type ProviderDisputeStatus, type SettlementTrancheStatus } from '@drape/shared'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { formatAmount, type CurrencyCode } from '@/lib/currency'
import { invokeFunction, supabase } from '@/lib/supabase'

type ApiTranche = { id: string; code: string; sequence: number; basis_points: number; amount: number; currency: string; status: SettlementTrancheStatus; eligible_at: string | null; released_at: string | null; blocked_reason: string | null }
type ApiProviderDispute = { status: ProviderDisputeStatus; amount: number; currency: string; evidence_due_at: string | null; money_movement_blocked: boolean; updated_at: string }
type SettlementResponse = { ok: boolean; legacy?: boolean; plan: { method: string; currency: string; entitlement_amount: number; seller_subtotal_amount?: number | null; excluded_fabric_allowance_amount?: number; material_recovery_offset_amount?: number; status: string; frozen_reason: string | null } | null; tranches: ApiTranche[]; providerDisputes?: ApiProviderDispute[] }

const titleFor = (code: string) => ({ SHIP_CUSTODY_70: 'Accepted for delivery', SHIP_DELIVERY_20: 'Delivery settled', SHIP_PROTECTION_10: 'Protection window complete', LOCAL_HANDOFF_80: 'Handoff confirmed', LOCAL_SETTLED_20: 'Handoff settled' }[code] ?? 'Settlement stage')
const money = (amount: number, currency: string) => formatAmount(amount, currency as CurrencyCode, currency as CurrencyCode, {})

export function SettlementProgressCard({ orderId, actorRole }: { orderId: string; actorRole: 'CUSTOMER' | 'TAILOR' }) {
  const [result, setResult] = useState<SettlementResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let active = true
    const refresh = () => {
      void invokeFunction<SettlementResponse>('settlement-action', { body: { action: 'refresh', orderId } }).then(({ data }) => {
        if (active) { setResult(data ?? null); setLoading(false) }
      }).catch(() => { if (active) setLoading(false) })
    }
    refresh()
    const channel = supabase.channel(`settlement-progress:${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'provider_disputes', filter: `order_id=eq.${orderId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_settlement_plans', filter: `order_id=eq.${orderId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_settlement_tranches', filter: `order_id=eq.${orderId}` }, refresh)
      .subscribe()
    return () => { active = false; void supabase.removeChannel(channel) }
  }, [orderId])
  const summary = useMemo(() => summarizeSettlement((result?.tranches ?? []).map((item) => ({ amount: item.amount, status: item.status }))), [result])
  if (loading) return null
  if (!result?.plan || result.legacy || result.tranches.length === 0) return null
  const frozen = result.plan.status === 'FROZEN'
  const providerDispute = result.providerDisputes?.find((item) => item.money_movement_blocked) ?? result.providerDisputes?.[0]
  const disputePresentation = providerDispute ? presentProviderDispute({ status: providerDispute.status, amount: providerDispute.amount, currency: providerDispute.currency, evidenceDueAt: providerDispute.evidence_due_at, moneyMovementBlocked: providerDispute.money_movement_blocked }) : null
  const triggerLabel = actorRole === 'TAILOR' ? 'Earnings release' : 'Payment protection'
  const compactLabel = actorRole === 'TAILOR' ? 'Earnings' : 'Protection'
  const triggerStatus = frozen
    ? 'Paused'
    : actorRole === 'TAILOR'
      ? `${money(summary.released, result.plan.currency)} released`
      : `${money(summary.protected, result.plan.currency)} protected`
  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Open ${triggerLabel.toLowerCase()} details`}
        style={styles.trigger}
        activeOpacity={0.82}
        onPress={() => setOpen(true)}
      >
        <Feather name={frozen ? 'pause-circle' : 'shield'} size={13} color={Colors.needleGreenDark} />
        <Text style={styles.triggerText}>{compactLabel}</Text>
      </TouchableOpacity>
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderCopy}>
              <Text style={styles.eyebrow}>{triggerLabel}</Text>
              <Text style={styles.modalTitle}>{frozen ? 'Release paused for review' : triggerStatus}</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Close ${triggerLabel.toLowerCase()} details`} style={styles.closeButton} onPress={() => setOpen(false)}>
              <Feather name="x" size={22} color={Colors.ink} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
            <View style={styles.card}>
      {disputePresentation ? (
        <View style={[styles.review, disputePresentation.tone === 'success' && styles.reviewSuccess]}>
          <Text style={styles.reviewLabel}>{disputePresentation.label}</Text>
          <Text style={styles.reviewTitle}>{disputePresentation.title}</Text>
          <Text style={styles.reviewBody}>{disputePresentation.body}</Text>
          {disputePresentation.deadline ? <Text style={styles.reviewDeadline}>Provider evidence due {new Date(disputePresentation.deadline).toLocaleString()}</Text> : null}
        </View>
      ) : null}
      <View style={styles.heading}>
        <View style={styles.icon}><Feather name={frozen ? 'pause' : 'shield'} size={17} color={Colors.needleGreen} /></View>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>{actorRole === 'TAILOR' ? 'Earnings release' : 'Tailor payment protection'}</Text>
          <Text style={styles.title}>{frozen ? 'Release paused for review' : `${money(summary.released, result.plan.currency)} released`}</Text>
          <Text style={styles.help}>{frozen ? 'Unreleased money stays protected while Drapeon reviews the open concern.' : actorRole === 'TAILOR' ? `${money(summary.eligible, result.plan.currency)} is ready for Drapeon review. ${money(summary.protected, result.plan.currency)} remains protected.` : `${money(summary.protected, result.plan.currency)} remains protected until verified handoff milestones are complete.`}</Text>
        </View>
      </View>
      <View style={styles.track}><View style={[styles.progress, { width: `${summary.total > 0 ? Math.round(summary.released / summary.total * 100) : 0}%` }]} /></View>
      {(result.plan.excluded_fabric_allowance_amount ?? 0) > 0 ? (
        <View style={styles.exclusion}>
          <Text style={styles.exclusionText}>Fabric allowance is paid through approved material releases, not a second time here.</Text>
          <Text style={styles.exclusionAmount}>{money(result.plan.excluded_fabric_allowance_amount ?? 0, result.plan.currency)} excluded</Text>
          {(result.plan.material_recovery_offset_amount ?? 0) > 0 ? <Text style={styles.exclusionText}>{money(result.plan.material_recovery_offset_amount ?? 0, result.plan.currency)} recovered for the customer’s unused-value refund.</Text> : null}
        </View>
      ) : null}
      <View style={styles.list}>
        {result.tranches.map((item) => (
          <View key={item.id} style={styles.row}>
            <View style={[styles.dot, item.status === 'RELEASED' && styles.dotDone, item.status === 'BLOCKED' && styles.dotBlocked]} />
            <View style={styles.flex}><Text style={styles.rowTitle}>{titleFor(item.code)}</Text><Text style={styles.rowMeta}>{settlementStatusLabel(item.status)}</Text></View>
            <Text style={styles.amount}>{money(item.amount, item.currency)}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.foot}>Ready or label-created states do not release money. Drapeon uses verified custody, delivery, or authenticated collection evidence.</Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  loading: { paddingVertical: Spacing.md, alignItems: 'center' },
  trigger: { alignSelf: 'flex-start', minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: Spacing.xs, paddingHorizontal: Spacing.xs, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.lightGrey, backgroundColor: Colors.white },
  triggerText: { color: Colors.needleGreenDark, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  modalSafe: { flex: 1, backgroundColor: Colors.bone },
  modalHeader: { minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, paddingHorizontal: Spacing.xl, borderBottomWidth: 1, borderBottomColor: Colors.lightGrey, backgroundColor: Colors.white },
  modalHeaderCopy: { flex: 1 },
  modalTitle: { color: Colors.ink, fontSize: FontSize.lg, fontWeight: FontWeight.bold, marginTop: 2 },
  closeButton: { width: 44, height: 44, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bone },
  modalContent: { padding: Spacing.xl, paddingBottom: Spacing.xxxl },
  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.lightGrey, padding: Spacing.lg, gap: Spacing.md, ...Shadow.sm },
  heading: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' }, flex: { flex: 1 },
  icon: { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.needleGreenLight, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: Colors.needleGreen, fontSize: FontSize.xs, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: .5 },
  title: { color: Colors.ink, fontSize: FontSize.md, fontWeight: FontWeight.bold, marginTop: 2 },
  help: { color: Colors.inkLight, fontSize: FontSize.xs, lineHeight: 18, marginTop: 4 },
  track: { height: 6, borderRadius: Radius.full, backgroundColor: Colors.lightGrey, overflow: 'hidden' }, progress: { height: '100%', backgroundColor: Colors.needleGreen },
  exclusion: { borderWidth: 1, borderColor: Colors.lightGrey, borderRadius: Radius.md, backgroundColor: Colors.bone, padding: Spacing.sm, gap: 3 },
  exclusionText: { color: Colors.inkLight, fontSize: FontSize.xs, lineHeight: 17 },
  exclusionAmount: { color: Colors.ink, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  list: { gap: Spacing.xs }, row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.lightGrey, paddingTop: Spacing.sm },
  dot: { width: 9, height: 9, borderRadius: Radius.full, backgroundColor: Colors.midGrey }, dotDone: { backgroundColor: Colors.needleGreen }, dotBlocked: { backgroundColor: Colors.kanteRust },
  rowTitle: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.semibold }, rowMeta: { color: Colors.inkLight, fontSize: FontSize.xs, marginTop: 2 }, amount: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  foot: { color: Colors.midGrey, fontSize: FontSize.xs, lineHeight: 17 },
  review: { borderWidth: 1, borderColor: Colors.kanteRust, borderRadius: Radius.md, backgroundColor: Colors.bone, padding: Spacing.md, gap: 4 },
  reviewSuccess: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  reviewLabel: { color: Colors.kanteRust, fontSize: FontSize.xs, fontWeight: FontWeight.bold, textTransform: 'uppercase', letterSpacing: .4 },
  reviewTitle: { color: Colors.ink, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  reviewBody: { color: Colors.inkLight, fontSize: FontSize.xs, lineHeight: 18 },
  reviewDeadline: { color: Colors.ink, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
})
