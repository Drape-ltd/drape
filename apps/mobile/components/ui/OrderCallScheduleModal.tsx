import { useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { DrapeDateTimePicker as DateTimePicker } from './DrapeDateTimePicker'
import { Feather } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { formatExplicitZonedDateTime, resolvedLocalTimeZone } from '@drape/shared/date-time'
import {
  CALL_SCHEDULING_POLICY,
  callSchedulingDefaultStartDate,
  callSchedulingReasonFor,
  callSchedulingStartsAtMinDate,
  isCallSchedulingStartValid,
  recommendedSchedulingStartDate,
} from '@drape/shared/call-scheduling-policy'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { invokeFunction } from '@/lib/supabase'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { scheduleCallStartLocalNotification } from '@/lib/notifications'
import type { OrderCallMeta, OrderCallReason } from '@/lib/order-support'
import { Button } from './Button'
import { Input } from './Input'

type Props = {
  visible: boolean
  orderId: string
  counterpartName: string
  actorLabel: 'customer' | 'tailor'
  existingOrderCall?: OrderCallMeta | null
  onClose: () => void
  onScheduled?: (orderCall: OrderCallMeta | null) => void
}

function defaultStartAt() {
  return callSchedulingDefaultStartDate()
}

function minimumStartAt() {
  return callSchedulingStartsAtMinDate()
}

function formatStart(value: Date | string | null | undefined) {
  return formatExplicitZonedDateTime(value, { timeZone: resolvedLocalTimeZone(), fallback: 'Choose a time' }) ?? 'Choose a time'
}

function currentTimezone() {
  return resolvedLocalTimeZone() ?? undefined
}

export function OrderCallScheduleModal({
  visible,
  orderId,
  counterpartName,
  actorLabel,
  existingOrderCall,
  onClose,
  onScheduled,
}: Props) {
  const [scheduledAt, setScheduledAt] = useState(defaultStartAt)
  const [minimumDate, setMinimumDate] = useState(minimumStartAt)
  const [showPicker, setShowPicker] = useState(false)
  const [reason, setReason] = useState<OrderCallReason>('PICKUP_OR_DELIVERY')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  function resetForm() {
    const existingStart = existingOrderCall?.scheduledStartAt
      ? new Date(existingOrderCall.scheduledStartAt)
      : null
    setMinimumDate(minimumStartAt())
    setScheduledAt(
      existingStart && Number.isFinite(existingStart.getTime()) && existingStart.getTime() > Date.now()
        ? existingStart
        : defaultStartAt()
    )
    setReason(existingOrderCall?.reason ?? 'PICKUP_OR_DELIVERY')
    setNote(existingOrderCall?.note ?? '')
    setShowPicker(false)
  }

  const selectedReason = callSchedulingReasonFor(reason)
  const title = existingOrderCall?.status === 'SCHEDULED' ? 'Reschedule order call' : 'Schedule order call'
  const submitLabel = existingOrderCall?.status === 'SCHEDULED' ? 'Reschedule call' : 'Schedule call'

  function openReasonPicker() {
    Alert.alert(
      'Reason for the call',
      'Choose the main reason so the conversation starts with the right context.',
      [
        { text: 'Cancel', style: 'cancel' },
        ...CALL_SCHEDULING_POLICY.reasons.map((option) => ({
          text: option.label,
          onPress: () => setReason(option.value as OrderCallReason),
        })),
      ]
    )
  }

  async function scheduleCall() {
    if (saving) return
    if (!isCallSchedulingStartValid(scheduledAt)) {
      const suggestion = recommendedSchedulingStartDate()
      Alert.alert(
        'Use the next available time?',
        `${formatStart(scheduledAt)} is too soon. The earliest valid option is ${formatStart(suggestion)}.`,
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: `Use ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(suggestion)}`, onPress: () => setScheduledAt(suggestion) },
        ],
      )
      return
    }

    const filtered = filterContactInfo(note)
    if (filtered.blocked) {
      Alert.alert('Keep it in Drapeon', filtered.userMessage)
      return
    }

    setSaving(true)
    const { data, error } = await invokeFunction<{ ok?: boolean; orderCall?: OrderCallMeta }>(
      'order-call-action',
      {
        body: {
          orderId,
          action: 'schedule-order-call',
          scheduledStartAt: scheduledAt.toISOString(),
          timezone: currentTimezone(),
          reason,
          note: note.trim() || undefined,
        },
      }
    )
    setSaving(false)

    if (error) {
      const fallback = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. Your call was not scheduled yet. Try again when the signal improves.'
        : 'We could not schedule this order call right now.'
      Alert.alert('Call not scheduled', await readFunctionErrorMessage(error, fallback))
      return
    }

    Alert.alert(
      'Call scheduled',
      `The order call is set for ${formatStart(scheduledAt)}. Drapeon will send reminders, and the call stays inside Messages.`
    )
    void scheduleCallStartLocalNotification({
      orderId,
      callKind: 'ready-made',
      scheduledStartAt: scheduledAt,
      counterpartName,
    }).catch(() => {})
    onScheduled?.(data?.orderCall ?? null)
    onClose()
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onShow={resetForm}
    >
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        accessibilityViewIsModal
      >
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>Order call</Text>
              <Text style={styles.title}>{title}</Text>
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close call scheduler"
            >
              <Feather name="x" size={20} color={Colors.ink} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.trustCard}>
              <View style={styles.trustIcon}>
                <Feather name="phone-call" size={18} color={Colors.needleGreen} />
              </View>
              <View style={styles.trustCopy}>
                <Text style={styles.trustTitle}>Free coordination call</Text>
                <Text style={styles.trustText}>
                  Use this only for visual or audio clarity with {counterpartName || `the ${actorLabel === 'customer' ? 'tailor' : 'customer'}`}. Keep final decisions, approvals, and payments in this thread.
                </Text>
              </View>
            </View>

            <Pressable
              style={styles.selectRow}
              onPress={() => setShowPicker(true)}
              accessibilityRole="button"
              accessibilityLabel="Choose order call time"
            >
              <View>
                <Text style={styles.inputLabel}>Call time</Text>
                <Text style={styles.selectValue}>{formatStart(scheduledAt)}</Text>
              </View>
              <Feather name="calendar" size={20} color={Colors.needleGreen} />
            </Pressable>
            <Text style={styles.helperText}>
              Pick a time at least {CALL_SCHEDULING_POLICY.minLookaheadMinutes} minutes from now. The room opens {CALL_SCHEDULING_POLICY.opensBeforeMinutes} minutes before the slot and closes {CALL_SCHEDULING_POLICY.expiresAfterMinutes} minutes after.
            </Text>
            {showPicker ? (
              <DateTimePicker
                value={scheduledAt}
                mode="datetime"
                minimumDate={minimumDate}
                onChange={(_, value) => {
                  setShowPicker(Platform.OS === 'ios')
                  if (value) setScheduledAt(value)
                }}
              />
            ) : null}

            <Pressable
              style={styles.selectRow}
              onPress={openReasonPicker}
              accessibilityRole="button"
              accessibilityLabel="Choose reason for order call"
            >
              <View style={styles.reasonCopy}>
                <Text style={styles.inputLabel}>Reason</Text>
                <Text style={styles.selectValue}>{selectedReason.label}</Text>
                <Text style={styles.helperText}>{selectedReason.detail}</Text>
              </View>
              <Feather name="chevron-down" size={20} color={Colors.midGrey} />
            </Pressable>

            <Input
              label="Context for the call"
              placeholder="e.g. Please show the sleeve detail before pickup."
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={4}
              maxLength={300}
              filterContact
              hint="Optional. No phone numbers, handles, or outside-payment instructions."
            />

            <Button
              label={submitLabel}
              onPress={scheduleCall}
              loading={saving}
              disabled={saving}
              style={styles.submitButton}
            />
            <Button
              label="Use messages instead"
              variant="secondary"
              onPress={onClose}
              disabled={saving}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  keyboard: { flex: 1 },
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
  },
  eyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, marginTop: 4 },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bone,
  },
  content: { padding: Spacing.xl, gap: Spacing.md },
  trustCard: {
    flexDirection: 'row',
    gap: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    padding: Spacing.lg,
    ...Shadow.sm,
  },
  trustIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  trustCopy: { flex: 1, gap: 4 },
  trustTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  trustText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  selectRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  reasonCopy: { flex: 1, gap: 2 },
  inputLabel: { fontSize: 13, fontWeight: FontWeight.semibold, color: Colors.ink },
  selectValue: { fontSize: 16, color: Colors.ink, fontWeight: FontWeight.semibold },
  helperText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  submitButton: { marginTop: Spacing.sm },
})
