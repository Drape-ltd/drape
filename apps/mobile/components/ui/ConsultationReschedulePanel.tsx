import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { recommendedSchedulingStartDate, repairSchedulingOptions } from '@drape/shared/call-scheduling-policy'
import { invokeFunction, supabase } from '@/lib/supabase'
import { readFunctionErrorMessage } from '@/lib/function-errors'
import { Colors, Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'
import { Button } from './Button'
import { DrapeDateTimePicker } from './DrapeDateTimePicker'

type ActorRole = 'CUSTOMER' | 'TAILOR'
type RequestRow = {
  id: string
  requested_by: string
  requested_by_role: ActorRole
  proposed_start_at: string
  proposed_start_options: string[] | null
  note: string | null
}

const oneDay = 24 * 60 * 60 * 1000
const defaultTimes = () => [1, 2, 3].map((day) => {
  const value = new Date(Date.now() + day * oneDay)
  value.setMinutes(0, 0, 0)
  return value
})

function formatTime(value: string | Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(typeof value === 'string' ? new Date(value) : value)
}

export function ConsultationReschedulePanel({
  orderId,
  actorRole,
  actorId,
  counterpartName,
  onOpenChat,
  onUpdated,
  onPendingChange,
  onRescheduleRequiredChange,
}: {
  orderId: string
  actorRole: ActorRole
  actorId: string | null | undefined
  counterpartName?: string
  onOpenChat?: () => void
  onUpdated?: () => void
  onPendingChange?: (pending: boolean) => void
  onRescheduleRequiredChange?: (required: boolean) => void
}) {
  const [request, setRequest] = useState<RequestRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'submit' | 'ACCEPTED' | 'DECLINED' | null>(null)
  const [showComposer, setShowComposer] = useState(false)
  const [times, setTimes] = useState<Date[]>(defaultTimes)
  const [pickerIndex, setPickerIndex] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [selectedStartAt, setSelectedStartAt] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const { data: requestData } = await supabase.from('consultation_reschedule_requests')
      .select('id, requested_by, requested_by_role, proposed_start_at, proposed_start_options, note')
      .eq('order_id', orderId).eq('status', 'PENDING').order('created_at', { ascending: false }).limit(1).maybeSingle()
    const nextRequest = (requestData as RequestRow | null) ?? null
    setRequest(nextRequest)
    setSelectedStartAt(nextRequest?.proposed_start_options?.[0] ?? nextRequest?.proposed_start_at ?? null)
    onPendingChange?.(!!nextRequest)
    onRescheduleRequiredChange?.(false)
    setLoading(false)
  }, [onPendingChange, onRescheduleRequiredChange, orderId])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const channel = supabase.channel(`consultation-reschedule:${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultation_reschedule_requests', filter: `order_id=eq.${orderId}` }, () => { void refresh() })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [orderId, refresh])

  const options = useMemo(() => request
    ? (request.proposed_start_options?.length ? request.proposed_start_options : [request.proposed_start_at])
    : [], [request])

  function openComposer(seed?: string[]) {
    setTimes(seed?.length ? seed.slice(0, 3).map((value) => new Date(value)) : defaultTimes())
    setNote('')
    setPickerIndex(null)
    setShowComposer(true)
  }

  async function submitTimes() {
    if (busy || !times.length) return
    const unique = [...new Set(times.map((value) => value.toISOString()))]
    if (unique.length !== times.length || times.some((value) => value.getTime() < Date.now() + 60 * 60 * 1000)) {
      const repaired = repairSchedulingOptions(times, { minLookaheadMinutes: 60 })
      const firstReplacement = repaired.values[repaired.changedIndexes[0]]
      Alert.alert(
        'Use available times?',
        `${repaired.changedIndexes.length === 1 ? 'One option is' : 'Some options are'} too soon or repeated. The next valid choice is ${formatTime(firstReplacement)}.`,
        [
          { text: 'Keep editing', style: 'cancel' },
          {
            text: 'Use suggestions',
            onPress: () => {
              setTimes(repaired.values)
              setPickerIndex(null)
            },
          },
        ],
      )
      return
    }
    setBusy('submit')
    try {
      const body = request && request.requested_by !== actorId
        ? { action: 'counter', orderId, requestId: request.id, proposedStartAt: unique[0], alternativeStartAts: unique.slice(1), note: note.trim() || undefined }
        : { action: 'request', orderId, proposedStartAt: unique[0], alternativeStartAts: unique.slice(1), note: note.trim() || undefined }
      const { data, error } = await invokeFunction<{ ok?: boolean }>('consultation-reschedule-action', { body })
      if (error || !data?.ok) throw new Error(error ? await readFunctionErrorMessage(error, 'Could not send these times.') : 'Could not send these times.')
      setShowComposer(false)
      Alert.alert('Times sent', `${counterpartName || (actorRole === 'TAILOR' ? 'The customer' : 'The tailor')} can choose one or suggest another time. The fee stays protected.`)
      await refresh()
      onUpdated?.()
    } catch (error) {
      Alert.alert('Could not send times', await readFunctionErrorMessage(error, 'Try again in a moment.'))
    } finally {
      setBusy(null)
    }
  }

  async function respond(decision: 'ACCEPTED' | 'DECLINED') {
    if (!request || busy) return
    setBusy(decision)
    try {
      const { data, error } = await invokeFunction<{ ok?: boolean }>('consultation-reschedule-action', {
        body: { action: 'respond', orderId, requestId: request.id, decision, selectedStartAt: decision === 'ACCEPTED' ? selectedStartAt : undefined },
      })
      if (error || !data?.ok) throw new Error(error ? await readFunctionErrorMessage(error, 'Could not save this decision.') : 'Could not save this decision.')
      Alert.alert(decision === 'ACCEPTED' ? 'New time confirmed' : 'Current time kept', decision === 'ACCEPTED' ? 'The booking and reminders are updated for both of you.' : 'You can coordinate and suggest other times.')
      await refresh()
      onUpdated?.()
    } catch (error) {
      Alert.alert('Could not update time', await readFunctionErrorMessage(error, 'Try again in a moment.'))
    } finally {
      setBusy(null)
    }
  }

  if (loading) return null
  const mine = request?.requested_by === actorId
  return (
    <>
      {request ? (
        <View style={styles.card}>
          <Text style={styles.eyebrow}>CONSULTATION</Text>
          <Text style={styles.title}>{mine ? 'Times sent' : 'Choose a new time'}</Text>
          <Text style={styles.hint}>{mine ? `Waiting for ${counterpartName || (actorRole === 'TAILOR' ? 'the customer' : 'the tailor')}. The fee stays protected.` : 'Select one option, or suggest times that work better.'}</Text>
          <View style={styles.options}>
            {options.map((value) => {
              const selected = selectedStartAt === value
              return (
                <TouchableOpacity key={value} disabled={mine} style={[styles.option, selected && !mine && styles.optionSelected]} onPress={() => setSelectedStartAt(value)}>
                  {!mine ? <View style={[styles.radio, selected && styles.radioSelected]} /> : <Feather name="clock" size={17} color={Colors.needleGreen} />}
                  <Text style={styles.optionText}>{formatTime(value)}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
          {request.note ? <Text style={styles.note}>{request.note}</Text> : null}
          {!mine ? (
            <View style={styles.actions}>
              <Button label="Confirm selected time" onPress={() => { void respond('ACCEPTED') }} loading={busy === 'ACCEPTED'} disabled={!!busy || !selectedStartAt} />
              <Button label="Suggest other times" variant="secondary" onPress={() => openComposer(options)} disabled={!!busy} />
            </View>
          ) : onOpenChat ? <Button label="Open chat" variant="secondary" onPress={onOpenChat} /> : null}
        </View>
      ) : null}

      <Modal visible={showComposer} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowComposer(false)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowComposer(false)} accessibilityLabel="Close time options"><Feather name="x" size={24} color={Colors.ink} /></TouchableOpacity>
            <Text style={styles.modalTitle}>Propose times</Text><View style={{ width: 24 }} />
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalHint}>Choose up to 3 times. They’ll appear in the other person’s timezone.</Text>
            {times.map((value, index) => (
              <View key={`${index}-${value.toISOString()}`} style={styles.timeRow}>
                <TouchableOpacity style={styles.timeButton} onPress={() => setPickerIndex(index)}>
                  <Text style={styles.timeLabel}>{index === 0 ? 'Preferred' : `Option ${index + 1}`}</Text>
                  <Text style={styles.timeValue}>{formatTime(value)}</Text>
                </TouchableOpacity>
                {index > 0 ? <TouchableOpacity style={styles.removeTime} onPress={() => setTimes((current) => current.filter((_, itemIndex) => itemIndex !== index))} accessibilityLabel={`Remove option ${index + 1}`}><Feather name="x" size={20} color={Colors.error} /></TouchableOpacity> : null}
              </View>
            ))}
            {times.length < 3 ? <Button label="Add another time" variant="secondary" onPress={() => setTimes((current) => [...current, new Date(current[current.length - 1].getTime() + oneDay)])} /> : null}
            {pickerIndex != null ? (
              <View style={styles.pickerWrap}>
                <DrapeDateTimePicker value={times[pickerIndex]} mode="datetime" minimumDate={recommendedSchedulingStartDate({ minLookaheadMinutes: 60 })} onChange={(_event, value) => {
                  if (Platform.OS === 'android') setPickerIndex(null)
                  if (value) setTimes((current) => current.map((item, index) => index === pickerIndex ? value : item))
                }} />
                {Platform.OS === 'ios' ? <Button label="Done" variant="secondary" onPress={() => setPickerIndex(null)} /> : null}
              </View>
            ) : null}
            <TextInput value={note} onChangeText={setNote} maxLength={300} placeholder="Note (optional)" placeholderTextColor={Colors.midGrey} style={styles.input} />
            <Button label="Send times" onPress={() => { void submitTimes() }} loading={busy === 'submit'} disabled={!!busy} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: Colors.needleGreenLight, borderRadius: Radius.lg, backgroundColor: Colors.bone, padding: Spacing.lg, gap: Spacing.sm },
  eyebrow: { fontFamily: Fonts.bodyBold, fontSize: FontSize.xs, color: Colors.needleGreenDark, letterSpacing: 1.1 },
  title: { fontFamily: Fonts.display, fontSize: FontSize.xl, color: Colors.ink },
  hint: { fontFamily: Fonts.body, fontSize: FontSize.sm, color: Colors.midGrey, lineHeight: 21 },
  options: { gap: Spacing.sm, marginTop: Spacing.xs },
  option: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, borderWidth: 1, borderColor: Colors.lightGrey, borderRadius: Radius.md, backgroundColor: Colors.surface },
  optionSelected: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: Colors.lightGrey, backgroundColor: Colors.surface },
  radioSelected: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreen },
  optionText: { flex: 1, fontFamily: Fonts.bodyBold, fontSize: FontSize.sm, color: Colors.ink },
  note: { fontFamily: Fonts.body, fontSize: FontSize.sm, color: Colors.ink, padding: Spacing.sm, backgroundColor: Colors.surface, borderRadius: Radius.sm },
  actions: { gap: Spacing.sm, marginTop: Spacing.xs },
  whyButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, alignSelf: 'flex-start', paddingVertical: Spacing.xs },
  whyText: { color: Colors.needleGreen, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  whyDetail: { color: Colors.midGrey, fontSize: FontSize.xs, lineHeight: 18 },
  modal: { flex: 1, backgroundColor: Colors.bone },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.lightGrey },
  modalTitle: { fontFamily: Fonts.bodyBold, fontSize: FontSize.lg, color: Colors.ink },
  modalContent: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  modalHint: { color: Colors.midGrey, fontSize: FontSize.sm, lineHeight: 21 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  timeButton: { flex: 1, minHeight: 68, justifyContent: 'center', paddingHorizontal: Spacing.md, borderWidth: 1, borderColor: Colors.lightGrey, borderRadius: Radius.md, backgroundColor: Colors.surface },
  timeLabel: { color: Colors.midGrey, fontSize: FontSize.xs },
  timeValue: { color: Colors.ink, fontFamily: Fonts.bodyBold, fontSize: FontSize.sm, marginTop: 3 },
  removeTime: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface },
  pickerWrap: { gap: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.surface },
  input: { minHeight: 52, paddingHorizontal: Spacing.md, borderWidth: 1, borderColor: Colors.lightGrey, borderRadius: Radius.md, backgroundColor: Colors.surface, color: Colors.ink, fontSize: FontSize.md },
})
