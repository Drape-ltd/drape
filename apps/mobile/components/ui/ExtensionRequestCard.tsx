import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { DrapeDateTimePicker } from './DrapeDateTimePicker'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { invokeFunction, supabase } from '@/lib/supabase'
import { readFunctionErrorMessage } from '@/lib/function-errors'
import { Sentry } from '@/lib/sentry'

type OpenExtension = {
  id: string
  reference: string
  status: string
  proposed_deadline: string | null
}

function extensionFloor(currentDeadline?: string | null) {
  const current = currentDeadline ? new Date(currentDeadline) : new Date()
  const validCurrent = Number.isFinite(current.getTime()) ? current : new Date()
  const floor = new Date(Math.max(Date.now(), validCurrent.getTime()))
  floor.setMinutes(floor.getMinutes() + 15, 0, 0)
  return floor
}

function initialProposal(currentDeadline?: string | null) {
  const proposal = extensionFloor(currentDeadline)
  proposal.setDate(proposal.getDate() + 1)
  proposal.setMinutes(Math.ceil(proposal.getMinutes() / 15) * 15, 0, 0)
  return proposal
}

function dateLabel(value: Date | string | null) {
  if (!value) return 'Choose exact date and time'
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Choose exact date and time'
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}

export function ExtensionRequestCard({
  orderId,
  currency,
  currentDeadline,
  allowRequest,
  onChanged,
}: {
  orderId: string
  currency: string
  currentDeadline?: string | null
  allowRequest: boolean
  onChanged?: () => void | Promise<void>
}) {
  const [openExtension, setOpenExtension] = useState<OpenExtension | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [deadline, setDeadline] = useState(() => initialProposal(currentDeadline))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const minimumDate = useMemo(() => extensionFloor(currentDeadline), [currentDeadline])
  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from('commercial_adjustments')
      .select('id, reference, status, proposed_deadline')
      .eq('order_id', orderId)
      .eq('adjustment_type', 'DEADLINE_EXTENSION')
      .in('status', ['PROPOSED', 'ACCEPTED', 'PAYMENT_PENDING', 'PAID', 'OPS_REVIEW'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) {
      Sentry.captureException(error, { extra: { context: 'extension_request_refresh', orderId } })
    }
    setOpenExtension((data as OpenExtension | null) ?? null)
    setLoading(false)
  }, [orderId])

  useEffect(() => { void refresh() }, [refresh])

  async function submit() {
    if (busy) return
    if (reason.trim().length < 10) {
      Alert.alert('Explain the delay', 'Give the customer enough context to decide. Use at least 10 characters.')
      return
    }
    if (deadline.getTime() <= minimumDate.getTime()) {
      Alert.alert('Choose a later deadline', 'The proposed date must be later than the current deadline.')
      return
    }
    setBusy(true)
    const { error } = await invokeFunction('commercial-adjustment-action', {
      body: {
        action: 'propose',
        orderId,
        type: 'DEADLINE_EXTENSION',
        summary: `Request more time until ${dateLabel(deadline)}`,
        reason: reason.trim(),
        responsibility: 'TAILOR',
        amountDelta: 0,
        currency,
        proposedDeadline: deadline.toISOString(),
        evidenceIds: [],
        idempotencyKey: `mobile:extension:${orderId}:${deadline.toISOString()}`,
      },
    })
    setBusy(false)
    if (error) {
      Sentry.captureException(error, { extra: { context: 'extension_request_submit', orderId, proposedDeadline: deadline.toISOString() } })
      Alert.alert('Extension not sent', await readFunctionErrorMessage(error, 'Drapeon could not send this extension request.'))
      return
    }
    setShowForm(false)
    setReason('')
    await refresh()
    await onChanged?.()
  }

  if (loading) return null
  if (openExtension) {
    return (
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.icon}><Feather name="clock" size={18} color={Colors.needleGreen} /></View>
          <View style={styles.copy}>
            <Text style={styles.eyebrow}>Extension · {openExtension.reference}</Text>
            <Text style={styles.title}>Waiting for customer decision</Text>
            <Text style={styles.body}>{dateLabel(openExtension.proposed_deadline)}</Text>
          </View>
        </View>
      </View>
    )
  }
  if (!allowRequest) return null

  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Request more time for this order"
        style={styles.launch}
        onPress={() => setShowForm(true)}
      >
        <View style={styles.icon}><Feather name="clock" size={18} color={Colors.needleGreen} /></View>
        <View style={styles.copy}>
          <Text style={styles.title}>Request more time</Text>
          <Text style={styles.body}>Propose an exact new deadline for the customer to accept or decline.</Text>
        </View>
        <Feather name="chevron-right" size={20} color={Colors.midGrey} />
      </TouchableOpacity>

      <Modal visible={showForm} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowForm(false)}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <SafeAreaView style={styles.flex}>
            <View style={styles.header}>
              <TouchableOpacity onPress={() => setShowForm(false)} disabled={busy}><Text style={styles.cancel}>Cancel</Text></TouchableOpacity>
              <Text style={styles.headerTitle}>Request more time</Text>
              <View style={styles.headerSpacer} />
            </View>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <Text style={styles.formTitle}>Propose one exact deadline</Text>
              <Text style={styles.body}>The customer decides in Drapeon. The current deadline stays authoritative until they accept.</Text>
              <TouchableOpacity style={styles.dateButton} onPress={() => setShowPicker(true)} accessibilityRole="button" accessibilityLabel="Choose proposed deadline">
                <Feather name="calendar" size={18} color={Colors.needleGreen} />
                <Text style={styles.dateText}>{dateLabel(deadline)}</Text>
              </TouchableOpacity>
              {showPicker ? (
                <DrapeDateTimePicker
                  value={deadline}
                  mode="datetime"
                  minimumDate={minimumDate}
                  onChange={(event, value) => {
                    setShowPicker(false)
                    if (event.type === 'set' && value) setDeadline(value)
                  }}
                />
              ) : null}
              <Text style={styles.label}>Why do you need more time?</Text>
              <TextInput
                value={reason}
                onChangeText={setReason}
                multiline
                maxLength={1000}
                placeholder="Explain what changed, what remains, and how you will meet the new date."
                placeholderTextColor={Colors.midGrey}
                style={styles.input}
              />
              <TouchableOpacity style={styles.primary} disabled={busy} onPress={() => { void submit() }}>
                <Text style={styles.primaryText}>{busy ? 'Sending…' : 'Send for customer decision'}</Text>
              </TouchableOpacity>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { paddingVertical: Spacing.md, alignItems: 'center' },
  launch: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.lg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.lightGrey, backgroundColor: Colors.white, ...Shadow.sm },
  card: { padding: Spacing.lg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight, ...Shadow.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.needleGreenLight },
  copy: { flex: 1 },
  eyebrow: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreen, textTransform: 'uppercase' },
  title: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.ink },
  body: { marginTop: 3, fontSize: FontSize.sm, lineHeight: 20, color: Colors.inkLight },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.lightGrey },
  cancel: { color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  headerTitle: { fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.bold },
  headerSpacer: { width: 48 },
  content: { padding: Spacing.lg, gap: Spacing.md },
  formTitle: { fontSize: FontSize.xl, color: Colors.ink, fontWeight: FontWeight.bold },
  dateButton: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderWidth: 1, borderColor: Colors.lightGrey, borderRadius: Radius.md, paddingHorizontal: Spacing.md, backgroundColor: Colors.white },
  dateText: { flex: 1, color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  label: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  input: { minHeight: 130, borderWidth: 1, borderColor: Colors.lightGrey, borderRadius: Radius.md, padding: Spacing.md, color: Colors.ink, fontSize: FontSize.sm, textAlignVertical: 'top', backgroundColor: Colors.white },
  primary: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.full, backgroundColor: Colors.needleGreen, paddingHorizontal: Spacing.lg },
  primaryText: { color: Colors.white, fontWeight: FontWeight.bold, fontSize: FontSize.sm },
})
