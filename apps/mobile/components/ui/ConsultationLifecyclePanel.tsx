import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { deriveConsultationCancellation } from '@drape/shared'
import { Colors, Fonts, FontSize, Radius, Spacing } from '@/constants/theme'
import { readFunctionErrorMessage } from '@/lib/function-errors'
import { invokeFunction, supabase } from '@/lib/supabase'
import { BottomSheetScaffold } from './BottomSheetScaffold'

type Role = 'CUSTOMER' | 'TAILOR'
type Booking = { id: string; status: string; scheduled_start_at: string; fee_mode: string; fee_amount: number | null; fee_currency: string | null; payment_status: string; settlement_status: string; earned_amount: number; refunded_amount: number }

function money(amount: number, currency: string | null) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency ?? 'USD' }).format(amount / 100)
}

export function ConsultationLifecyclePanel({ orderId, actorRole, onUpdated }: { orderId: string; actorRole: Role; onUpdated?: () => void }) {
  const [booking, setBooking] = useState<Booking | null>(null)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [attendanceOutcome, setAttendanceOutcome] = useState<string | null>(null)
  const [verifiedOverlapSeconds, setVerifiedOverlapSeconds] = useState(0)
  const refresh = useCallback(async () => {
    const { data } = await supabase.from('consultation_bookings').select('id,status,scheduled_start_at,fee_mode,fee_amount,fee_currency,payment_status,settlement_status,earned_amount,refunded_amount').eq('order_id', orderId).order('created_at', { ascending: false }).limit(1).maybeSingle()
    const next = (data as Booking | null) ?? null
    setBooking(next)
    if (next?.id) {
      const { data: evidence } = await supabase.from('consultation_attendance_evidence').select('derived_outcome,verified_overlap_seconds').eq('booking_id', next.id).maybeSingle()
      setAttendanceOutcome(evidence?.derived_outcome ?? null)
      setVerifiedOverlapSeconds(evidence?.verified_overlap_seconds ?? 0)
    } else {
      setAttendanceOutcome(null)
      setVerifiedOverlapSeconds(0)
    }
  }, [orderId])
  useEffect(() => {
    void refresh()
    const channel = supabase.channel(`consultation-lifecycle:${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultation_bookings', filter: `order_id=eq.${orderId}` }, () => { void refresh() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultation_attendance_evidence', filter: `order_id=eq.${orderId}` }, () => { void refresh() })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [orderId, refresh])
  const decision = useMemo(() => {
    if (!booking) return null
    try { return deriveConsultationCancellation({ actorRole, scheduledStartAt: booking.scheduled_start_at, feeAmount: booking.fee_amount ?? 0 }) } catch { return null }
  }, [actorRole, booking])
  async function cancelConsultation() {
    if (!booking || !decision || reason.trim().length < 2 || busy) return
    setBusy(true)
    try {
      const { data, error } = await invokeFunction<{ ok?: boolean; error?: string; refundPending?: boolean }>('consultation-lifecycle-action', { body: { action: 'cancel', bookingId: booking.id, reason: reason.trim(), idempotencyKey: `consultation-cancel:${booking.id}:${Date.now()}` } })
      if (error || !data?.ok) throw new Error(data?.error ?? await readFunctionErrorMessage(error, 'Could not cancel this consultation.'))
      setOpen(false); setReason(''); await refresh(); onUpdated?.()
      Alert.alert('Consultation cancelled', data.refundPending ? 'The order stays open. The refund is processing to the original payment method.' : 'The order stays open for the next quote step.')
    } catch (error) { Alert.alert('Could not cancel consultation', await readFunctionErrorMessage(error, 'Try again in a moment.')) } finally { setBusy(false) }
  }
  if (!booking) return null
  const statusCopy: Record<string, string> = { HELD: 'Consultation fee protected until the call outcome is verified.', REFUND_PENDING: 'Refund processing to the original payment method.', PARTIALLY_REFUNDED: 'Partial refund completed; the earned portion is being settled.', REFUNDED: 'Consultation fee refunded to the customer.', EARNED: 'Attendance verified. Tailor payment is being released.', RELEASE_PENDING: 'Tailor payment is processing.', RELEASED: 'Consultation fee released to the tailor.', OPS_REVIEW: 'Drapeon is reviewing the call evidence before money moves.', FAILED: 'Drapeon Ops is resolving a payment issue.' }
  const attendanceSettled = attendanceOutcome === 'ATTENDED' || verifiedOverlapSeconds >= 300 || ['EARNED', 'RELEASE_PENDING', 'RELEASED'].includes(booking.settlement_status)
  const canCancel = booking.status === 'CONFIRMED' && !!decision && !decision.requiresReview && !attendanceSettled
  return <>
    <View style={styles.card}>{statusCopy[booking.settlement_status] ? <Text style={styles.status}>{statusCopy[booking.settlement_status]}</Text> : null}{canCancel ? <TouchableOpacity onPress={() => setOpen(true)} accessibilityRole="button"><Text style={styles.link}>Cancel consultation</Text></TouchableOpacity> : null}</View>
    <BottomSheetScaffold visible={open} title="Cancel consultation" subtitle="The order and chat stay open." scrollable snapPoints={['82%']} enableDynamicSizing={false} onDismiss={() => { if (!busy) { setOpen(false); setReason('') } }} destructiveAction={{ label: 'Confirm cancellation', onPress: () => { void cancelConsultation() }, loading: busy, disabled: reason.trim().length < 2, tone: 'destructive' }} secondaryAction={{ label: 'Keep consultation', onPress: () => { setOpen(false); setReason('') }, disabled: busy, tone: 'secondary' }}>
      <View style={styles.sheet}>
        {decision && booking.fee_mode === 'PAID' ? <View style={styles.summary}><Text style={styles.summaryTitle}>{actorRole === 'TAILOR' || decision.refundAmount === booking.fee_amount ? 'Full refund' : 'Late cancellation'}</Text><Text style={styles.summaryText}>Customer refund: {money(decision.refundAmount, booking.fee_currency)}</Text>{decision.tailorEarnedAmount > 0 ? <Text style={styles.summaryText}>Tailor earns: {money(decision.tailorEarnedAmount, booking.fee_currency)}</Text> : null}<Text style={styles.summaryHint}>Refunds return through the customer’s original payment provider.</Text></View> : <Text style={styles.summaryText}>No fee will move.</Text>}
        <Text style={styles.label}>Why are you cancelling?</Text><TextInput value={reason} onChangeText={setReason} placeholder="Add a short reason" multiline maxLength={500} style={styles.input} placeholderTextColor={Colors.midGrey} />
      </View>
    </BottomSheetScaffold>
  </>
}

const styles = StyleSheet.create({ card: { gap: Spacing.sm, paddingHorizontal: Spacing.xs }, status: { fontFamily: Fonts.body, fontSize: FontSize.sm, color: Colors.midGrey, lineHeight: 21 }, link: { fontFamily: Fonts.bodyBold, fontSize: FontSize.sm, color: Colors.needleGreenDark }, sheet: { gap: Spacing.md }, summary: { borderWidth: 1, borderColor: Colors.needleGreenLight, borderRadius: Radius.md, backgroundColor: Colors.bone, padding: Spacing.md, gap: Spacing.xs }, summaryTitle: { fontFamily: Fonts.bodyBold, fontSize: FontSize.md, color: Colors.ink }, summaryText: { fontFamily: Fonts.body, fontSize: FontSize.md, color: Colors.ink }, summaryHint: { fontFamily: Fonts.body, fontSize: FontSize.sm, color: Colors.midGrey, lineHeight: 20 }, label: { fontFamily: Fonts.bodyBold, fontSize: FontSize.sm, color: Colors.ink }, input: { minHeight: 96, borderWidth: 1, borderColor: Colors.lightGrey, borderRadius: Radius.md, backgroundColor: Colors.white, padding: Spacing.md, fontFamily: Fonts.body, fontSize: FontSize.md, color: Colors.ink, textAlignVertical: 'top' } })
