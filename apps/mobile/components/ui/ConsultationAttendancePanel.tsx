import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { consultationAttendanceEvidenceCopy, consultationAttendanceResolutionCopy } from '@drape/shared'
import { invokeFunction, supabase } from '@/lib/supabase'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

type ActorRole = 'CUSTOMER' | 'TAILOR'
type Booking = { id: string; scheduled_start_at: string; scheduled_end_at: string; status: string }
type Evidence = { derived_outcome: string; verified_overlap_seconds: number; provider_evidence_complete: boolean }
type ResponseCode = 'AGREE_NO_CALL' | 'I_ATTENDED' | 'CONNECTION_ISSUE' | 'OTHER'
type Review = { status: string; reported_by_role: ActorRole; reported_reason: string; counterparty_due_at: string; evidence_outcome_at_report: string; counterparty_response_code: ResponseCode | null; resolution_code: string | null }

const RESPONSE_OPTIONS: Array<{ code: ResponseCode; title: string; hint: string }> = [
  { code: 'AGREE_NO_CALL', title: 'The call did not happen', hint: 'Keep the fee protected and choose another time.' },
  { code: 'I_ATTENDED', title: 'I joined and waited', hint: 'Drapeon will compare this with the call activity.' },
  { code: 'CONNECTION_ISSUE', title: 'I had a connection issue', hint: 'Add a short explanation for review.' },
  { code: 'OTHER', title: 'Something else happened', hint: 'Explain what happened from your side.' },
]

function label(value: string) {
  return value.toLowerCase().replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase())
}

export function ConsultationAttendancePanel({ orderId, actorRole }: { orderId: string; actorRole: ActorRole }) {
  const [booking, setBooking] = useState<Booking | null>(null)
  const [evidence, setEvidence] = useState<Evidence | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [modalAction, setModalAction] = useState<'report' | 'respond' | null>(null)
  const [responseCode, setResponseCode] = useState<ResponseCode | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data: bookingRow } = await supabase
      .from('consultation_bookings')
      .select('id, scheduled_start_at, scheduled_end_at, status')
      .eq('order_id', orderId)
      .in('status', ['CONFIRMED', 'COMPLETED', 'NO_SHOW'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const nextBooking = bookingRow as Booking | null
    setBooking(nextBooking)
    if (!nextBooking) return
    const [evidenceResult, reviewResult] = await Promise.all([
      supabase.from('consultation_attendance_evidence').select('derived_outcome, verified_overlap_seconds, provider_evidence_complete').eq('booking_id', nextBooking.id).maybeSingle(),
      supabase.from('consultation_attendance_reviews').select('status, reported_by_role, reported_reason, counterparty_due_at, evidence_outcome_at_report, counterparty_response_code, resolution_code').eq('booking_id', nextBooking.id).maybeSingle(),
    ])
    setEvidence(evidenceResult.data as Evidence | null)
    if (reviewResult.error) {
      // Keep an already-submitted report visible while a newly added response
      // field is rolling out. A read failure must never restore the report CTA.
      const fallback = await supabase
        .from('consultation_attendance_reviews')
        .select('status, reported_by_role, reported_reason, counterparty_due_at, evidence_outcome_at_report, resolution_code')
        .eq('booking_id', nextBooking.id)
        .maybeSingle()
      setReview(fallback.data ? { ...(fallback.data as Omit<Review, 'counterparty_response_code'>), counterparty_response_code: null } : null)
    } else {
      setReview(reviewResult.data as Review | null)
    }
  }, [orderId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!booking?.id) return
    const channel = supabase
      .channel(`consultation-attendance:${booking.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'consultation_attendance_reviews', filter: `booking_id=eq.${booking.id}` },
        () => { void load() },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [booking?.id, load])
  if (!booking) return null
  const activeBooking = booking

  const reportWindowOpen = Date.now() >= new Date(activeBooking.scheduled_start_at).getTime() + 15 * 60_000
  const canRespond = review?.status === 'COUNTERPARTY_REVIEW' && review.reported_by_role !== actorRole
  const isReporter = review?.reported_by_role === actorRole
  const evidenceCopy = consultationAttendanceEvidenceCopy(review?.evidence_outcome_at_report)
  const resolutionCopy = consultationAttendanceResolutionCopy(review?.resolution_code)
  const displayedEvidenceCopy = review?.status === 'OPS_REVIEW'
    ? {
        title: 'Both responses received',
        detail: 'Drapeon is comparing both reports with the call activity. No action is needed from you right now.',
      }
    : evidenceCopy
  const cardTitle = review
    ? review.status === 'COUNTERPARTY_REVIEW'
      ? (isReporter ? 'Attendance report sent' : 'Attendance response needed')
      : review.status === 'OPS_REVIEW' ? 'Attendance under review'
        : resolutionCopy.title
    : 'Consultation attendance'
  const statusText = review
    ? review.status === 'COUNTERPARTY_REVIEW'
      ? (canRespond ? 'Your response is needed' : `Waiting for ${review.reported_by_role === 'CUSTOMER' ? 'tailor' : 'customer'} response`)
      : review.status === 'OPS_REVIEW' ? 'Drapeon review in progress'
        : review.status === 'RESOLVED' ? resolutionCopy.status : label(review.status)
    : evidence?.derived_outcome === 'ATTENDED' ? 'Provider-confirmed attendance' : 'Attendance record available after the call'

  // Once Ops has chosen rescheduling, the reschedule panel becomes the one
  // authoritative action surface. The attendance reason remains available
  // there behind "Why was this rescheduled?" instead of rendering two cards.
  if (review?.status === 'RESOLVED' && review.resolution_code === 'RESCHEDULE_REQUIRED') return null

  async function submit() {
    const responseNeedsNote = responseCode === 'CONNECTION_ISSUE' || responseCode === 'OTHER'
    if (!modalAction || (modalAction === 'report' && text.trim().length < 10) || (modalAction === 'respond' && (!responseCode || (responseNeedsNote && text.trim().length < 2)))) {
      setError(modalAction === 'report' ? 'Explain what happened in at least 10 characters.' : !responseCode ? 'Choose what happened from your side.' : 'Add a short explanation.')
      return
    }
    setBusy(true)
    setError('')
    const { data, error: actionError } = await invokeFunction<{ ok?: boolean; result?: { nextAction?: string } }>('consultation-attendance-action', {
      body: modalAction === 'report'
        ? { action: 'report', bookingId: activeBooking.id, reason: text.trim(), idempotencyKey: `attendance:${activeBooking.id}:${actorRole}` }
        : { action: 'respond', bookingId: activeBooking.id, responseCode: responseCode!, response: text.trim() || undefined },
    })
    setBusy(false)
    if (actionError) {
      setError(actionError.message || 'This attendance update could not be submitted. Refresh and try again.')
      return
    }
    const submittedAction = modalAction
    setModalAction(null)
    setText('')
    setResponseCode(null)
    await load()
    Alert.alert(
      submittedAction === 'report' ? 'Report sent' : data?.result?.nextAction === 'RESCHEDULE' ? 'Choose another time' : 'Response sent to Drapeon',
      submittedAction === 'report'
        ? 'The other person has 24 hours to respond. The fee stays protected.'
        : data?.result?.nextAction === 'RESCHEDULE'
          ? 'Both of you confirmed the call did not happen. The fee stays protected while a new time is agreed.'
          : 'Money remains frozen while Drapeon compares both accounts with the call activity.',
    )
  }

  return (
    <>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.icon}><Feather name="shield" size={16} color={Colors.needleGreen} /></View>
          <View style={styles.body}>
            <Text style={styles.title}>{cardTitle}</Text>
            <Text style={styles.hint}>{statusText}</Text>
          </View>
        </View>
        {evidence?.provider_evidence_complete ? (
          <Text style={styles.evidence}>Call records show {Math.floor(evidence.verified_overlap_seconds / 60)} min of overlap. Opening the room alone does not count as attendance.</Text>
        ) : null}
        {review ? (
          <View style={styles.evidenceSummary}>
            <View style={styles.reviewPill}><Text style={styles.reviewPillText}>{displayedEvidenceCopy.title}</Text></View>
            <Text style={styles.evidenceDetail}>{displayedEvidenceCopy.detail}</Text>
          </View>
        ) : null}
        {review ? (
          <View style={styles.reportBox}>
            <Text style={styles.reportLabel}>{review.reported_by_role === 'CUSTOMER' ? 'Customer report' : 'Tailor report'}</Text>
            <Text style={styles.reportText}>{review.reported_reason}</Text>
            {review.status === 'COUNTERPARTY_REVIEW' ? <Text style={styles.dueText}>Respond by {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(review.counterparty_due_at))}</Text> : null}
          </View>
        ) : null}
        {canRespond ? (
          <TouchableOpacity style={styles.secondaryButton} onPress={() => { setResponseCode(null); setText(''); setModalAction('respond') }}>
            <Text style={styles.secondaryButtonText}>Respond and continue</Text>
          </TouchableOpacity>
        ) : !review && reportWindowOpen ? (
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setModalAction('report')}>
            <Text style={styles.secondaryButtonText}>Report an attendance issue</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={styles.safety}>
          {!review
            ? 'Reports never move money automatically.'
            : review.status === 'COUNTERPARTY_REVIEW'
              ? (isReporter ? 'No further action is needed from you right now. The fee stays protected while the other person responds.' : 'Your response determines whether you reschedule together or Drapeon reviews the call activity.')
              : review.status === 'OPS_REVIEW'
                ? 'The fee stays protected. Both accounts will be notified when Drapeon records the outcome.'
                : resolutionCopy.detail}
        </Text>
      </View>

      <Modal visible={modalAction != null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalAction(null)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setModalAction(null)} accessibilityLabel="Close attendance form"><Feather name="x" size={24} color={Colors.ink} /></TouchableOpacity>
            <Text style={styles.modalTitle}>{modalAction === 'report' ? 'Report attendance' : 'Respond to report'}</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalHint}>{modalAction === 'report' ? 'Explain who joined, how long you waited, and any connection issue. Call activity is attached automatically.' : 'Share what happened from your side. Drapeon will compare this with the call activity.'}</Text>
            {modalAction === 'respond' ? (
              <View style={styles.responseOptions}>
                {RESPONSE_OPTIONS.map((option) => (
                  <TouchableOpacity key={option.code} style={[styles.responseOption, responseCode === option.code && styles.responseOptionSelected]} onPress={() => { setResponseCode(option.code); setError('') }}>
                    <View style={[styles.radio, responseCode === option.code && styles.radioSelected]} />
                    <View style={styles.responseOptionBody}>
                      <Text style={styles.responseOptionTitle}>{option.title}</Text>
                      <Text style={styles.responseOptionHint}>{option.hint}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder={modalAction === 'respond' ? 'Add a note (optional unless more context is needed)' : 'What happened?'}
              placeholderTextColor={Colors.midGrey}
              multiline
              autoFocus
              maxLength={1000}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <TouchableOpacity style={styles.primaryButton} onPress={() => void submit()} disabled={busy}>
              {busy ? <ActivityIndicator color={Colors.textInverse} /> : <Text style={styles.primaryButtonText}>Submit for review</Text>}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  card: { marginTop: Spacing.md, padding: Spacing.lg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.lightGrey, backgroundColor: Colors.surface },
  headerRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.needleGreenLight },
  body: { flex: 1 }, title: { color: Colors.ink, fontSize: FontSize.md, fontWeight: FontWeight.bold }, hint: { color: Colors.inkLight, marginTop: 2 },
  evidence: { color: Colors.inkLight, marginTop: Spacing.md, lineHeight: 20 },
  reviewPill: { alignSelf: 'flex-start', marginTop: Spacing.md, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: Radius.full, backgroundColor: Colors.needleGreenLight },
  reviewPillText: { color: Colors.needleGreen, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },
  evidenceSummary: { marginTop: Spacing.md },
  evidenceDetail: { color: Colors.inkLight, fontSize: FontSize.xs, lineHeight: 18, marginTop: Spacing.sm },
  reportBox: { marginTop: Spacing.md, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.bone },
  reportLabel: { color: Colors.needleGreenDark, fontSize: FontSize.xs, fontWeight: FontWeight.bold, textTransform: 'uppercase', letterSpacing: 0.8 },
  reportText: { color: Colors.ink, fontSize: FontSize.sm, lineHeight: 20, marginTop: 6 },
  dueText: { color: Colors.midGrey, fontSize: FontSize.xs, marginTop: Spacing.sm },
  safety: { color: Colors.midGrey, fontSize: FontSize.xs, lineHeight: 17, marginTop: Spacing.sm },
  secondaryButton: { marginTop: Spacing.md, minHeight: 44, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.needleGreen, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: Colors.needleGreen, fontWeight: FontWeight.bold },
  modal: { flex: 1, backgroundColor: Colors.bone, padding: Spacing.lg },
  modalContent: { paddingBottom: Spacing.xxxl },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, modalTitle: { color: Colors.ink, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  modalHint: { color: Colors.inkLight, lineHeight: 22, marginTop: Spacing.xl },
  responseOptions: { gap: Spacing.sm, marginTop: Spacing.lg },
  responseOption: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.lightGrey, backgroundColor: Colors.surface },
  responseOptionSelected: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: Colors.lightGrey, backgroundColor: Colors.surface },
  radioSelected: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreen },
  responseOptionBody: { flex: 1 },
  responseOptionTitle: { color: Colors.ink, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  responseOptionHint: { color: Colors.inkLight, fontSize: FontSize.sm, lineHeight: 19, marginTop: 2 },
  input: { minHeight: 150, marginTop: Spacing.lg, borderWidth: 1, borderColor: Colors.lightGrey, borderRadius: Radius.lg, padding: Spacing.md, color: Colors.ink, backgroundColor: Colors.surface, textAlignVertical: 'top' },
  error: { color: Colors.error, marginTop: Spacing.sm },
  primaryButton: { minHeight: 52, marginTop: Spacing.lg, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.needleGreen },
  primaryButtonText: { color: Colors.textInverse, fontWeight: FontWeight.bold, fontSize: FontSize.md },
})
