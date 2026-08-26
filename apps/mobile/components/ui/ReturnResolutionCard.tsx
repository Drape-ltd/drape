import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import {
  RETURN_REASON_LABELS,
  RETURN_REASONS,
  RESOLUTION_REMEDIES,
  normalizeAccountCurrency,
  parseMoneyInputToMinorUnits,
  type ResolutionRemedy,
  type ReturnReason,
} from '@drape/shared'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { invokeFunction, supabase } from '@/lib/supabase'
import { readFunctionErrorMessage } from '@/lib/function-errors'
import { stripExif } from '@/lib/stripExif'
import { uploadPrivateStorageImage } from '@/lib/storage-upload'
import { MoneyInput } from './MoneyInput'

type ReturnRow = {
  id: string
  reference: string
  reason_code: ReturnReason
  requested_remedy: ResolutionRemedy
  summary: string
  eligibility_status: string
  eligibility_reason: string
  return_required: boolean
  status: string
  requester_role: 'CUSTOMER' | 'TAILOR'
  response_due_at: string
}
type ProposalRow = {
  id: string
  proposed_by_role: 'CUSTOMER' | 'TAILOR' | 'OPS'
  remedy: ResolutionRemedy
  amount: number | null
  currency: string | null
  return_required: boolean
  return_shipping_responsibility: string | null
  note: string
  status: string
  version: number
}

const REMEDY_LABELS: Record<ResolutionRemedy, string> = {
  EXPLANATION: 'Explanation',
  ALTERATION: 'Alteration',
  REMAKE: 'Remake',
  PARTIAL_REFUND: 'Partial refund',
  FULL_REFUND: 'Full refund',
  RETURN_AND_REFUND: 'Return + refund',
  REJECTED: 'Reject request',
}
const key = (scope: string) => `${scope}:${Date.now()}:${Math.random().toString(36).slice(2)}`

export function ReturnResolutionCard({
  orderId,
  actorRole,
  currency = 'USD',
  allowOpen = false,
  onChanged,
}: {
  orderId: string
  actorRole: 'CUSTOMER' | 'TAILOR'
  currency?: string | null
  /** Existing cases remain visible to both roles; only eligible customers receive the launcher. */
  allowOpen?: boolean
  onChanged?: () => void | Promise<void>
}) {
  const [request, setRequest] = useState<ReturnRow | null>(null)
  const [proposal, setProposal] = useState<ProposalRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState<ReturnReason>('QUALITY_WORKMANSHIP')
  const [remedy, setRemedy] = useState<ResolutionRemedy>(
    actorRole === 'CUSTOMER' ? 'ALTERATION' : 'EXPLANATION'
  )
  const [summary, setSummary] = useState('')
  const [amount, setAmount] = useState('')
  const [proposalNote, setProposalNote] = useState('')
  const [evidenceUri, setEvidenceUri] = useState<string | null>(null)
  const currencyCode = normalizeAccountCurrency(currency) ?? 'USD'

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from('order_return_requests')
      .select(
        'id, reference, reason_code, requested_remedy, summary, eligibility_status, eligibility_reason, return_required, status, requester_role, response_due_at'
      )
      .eq('order_id', orderId)
      .not('status', 'in', '(RESOLVED,CANCELLED)')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const current = data as ReturnRow | null
    setRequest(current)
    if (current) {
      const { data: proposalData } = await supabase
        .from('order_resolution_proposals')
        .select(
          'id, proposed_by_role, remedy, amount, currency, return_required, return_shipping_responsibility, note, status, version'
        )
        .eq('return_request_id', current.id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle()
      setProposal(proposalData as ProposalRow | null)
    } else setProposal(null)
    setLoading(false)
  }, [orderId])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const availableOpenRemedies = useMemo(
    () =>
      actorRole === 'CUSTOMER'
        ? RESOLUTION_REMEDIES.filter((value) => value !== 'REJECTED')
        : (['EXPLANATION', 'ALTERATION', 'REMAKE'] as ResolutionRemedy[]),
    [actorRole]
  )
  const moneyRemedy = ['PARTIAL_REFUND', 'FULL_REFUND', 'RETURN_AND_REFUND'].includes(remedy)
  async function invoke(body: Record<string, unknown>) {
    setBusy(true)
    const { error } = await invokeFunction('return-resolution-action', { body })
    setBusy(false)
    if (error) {
      Alert.alert(
        'Resolution not updated',
        await readFunctionErrorMessage(error, 'Drapeon could not safely update this resolution.')
      )
      return false
    }
    await refresh()
    await onChanged?.()
    return true
  }
  async function open() {
    const requestedAmount = moneyRemedy && amount.trim() ? parseMoneyInputToMinorUnits(amount) : null
    if (summary.trim().length < 10 || (moneyRemedy && (!requestedAmount || requestedAmount <= 0))) {
      Alert.alert(
        'Add a little more detail',
        moneyRemedy
          ? 'Explain what happened and enter the requested refund amount.'
          : 'Explain what happened in at least 10 characters.'
      )
      return
    }
    let evidence: Array<Record<string, string>> = []
    let uploadedEvidencePath: string | null = null
    if (evidenceUri) {
      const storageObjectPath = `${orderId}/returns/return-${Date.now()}.jpg`
      try {
        await uploadPrivateStorageImage({
          bucket: 'commercial-evidence',
          path: storageObjectPath,
          uri: await stripExif(evidenceUri),
          contentType: 'image/jpeg',
          maxBytes: 8 * 1024 * 1024,
          upsert: false,
          purpose: 'ORDER_REFERENCE',
        })
        evidence = [
          {
            storageBucket: 'commercial-evidence',
            storageObjectPath,
            evidenceType: 'RETURN_EVIDENCE',
            mimeType: 'image/jpeg',
          },
        ]
        uploadedEvidencePath = storageObjectPath
      } catch {
        Alert.alert(
          'Evidence not uploaded',
          'The private photo could not upload. Check your connection and try again.'
        )
        return
      }
    }
    const opened = await invoke({
      action: 'open',
      orderId,
      reason,
      requestedRemedy: remedy,
      summary: summary.trim(),
      requestedAmount,
      currency: requestedAmount ? currencyCode : null,
      evidence,
      idempotencyKey: key(`return:${orderId}`),
    })
    if (opened) {
      setExpanded(false)
      setSummary('')
      setAmount('')
      setEvidenceUri(null)
    } else if (uploadedEvidencePath) {
      await supabase.storage.from('commercial-evidence').remove([uploadedEvidencePath])
    }
  }
  async function chooseEvidence() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert('Photo access needed', 'Allow photo access to attach private order evidence.')
      return
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsMultipleSelection: false,
    })
    if (!picked.canceled && picked.assets?.[0]?.uri) setEvidenceUri(picked.assets[0].uri)
  }
  async function propose() {
    if (!request || proposalNote.trim().length < 3) {
      Alert.alert('Add proposal details', 'Briefly explain what you are offering.')
      return
    }
    const proposedAmount = moneyRemedy && amount.trim() ? parseMoneyInputToMinorUnits(amount) : null
    if (moneyRemedy && (!proposedAmount || proposedAmount <= 0)) {
      Alert.alert(
        'Enter the exact amount',
        'Refund proposals need an amount both parties can review.'
      )
      return
    }
    await invoke({
      action: 'propose',
      returnRequestId: request.id,
      remedy,
      amount: proposedAmount,
      currency: proposedAmount ? currencyCode : null,
      returnRequired:
        remedy === 'RETURN_AND_REFUND' || (remedy === 'FULL_REFUND' && reason !== 'NOT_RECEIVED'),
      shippingResponsibility: remedy === 'RETURN_AND_REFUND' ? 'UNRESOLVED' : null,
      note: proposalNote.trim(),
      idempotencyKey: key(`proposal:${request.id}`),
    })
  }
  async function decide(decision: 'ACCEPTED' | 'DECLINED') {
    if (proposal)
      await invoke({
        action: 'decide',
        proposalId: proposal.id,
        decision,
        note: '',
        idempotencyKey: key(`decision:${proposal.id}`),
      })
  }

  if (loading) return null
  if (!request && !allowOpen) return null
  if (!request && !expanded)
    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Request a resolution for this received order"
        style={styles.launch}
        onPress={() => setExpanded(true)}
      >
        <View style={styles.icon}>
          <Feather name="rotate-ccw" size={17} color={Colors.needleGreen} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.launchTitle}>Request a resolution</Text>
          <Text style={styles.muted}>
            Ask Drapeon to review an issue with an order you received.
          </Text>
        </View>
        <Feather name="chevron-right" size={20} color={Colors.midGrey} />
      </TouchableOpacity>
    )

  const proposalNeedsMyDecision =
    !!proposal && proposal.status === 'OPEN' && proposal.proposed_by_role !== actorRole
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <Feather name="shield" size={17} color={Colors.needleGreen} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>
            Protected resolution{request ? ` · ${request.reference}` : ''}
          </Text>
          <Text style={styles.title}>
            {request ? RETURN_REASON_LABELS[request.reason_code] : 'Start a resolution'}
          </Text>
        </View>
        {request ? (
          <View style={styles.status}>
            <Text style={styles.statusText}>
              {request.status.replaceAll('_', ' ').toLowerCase()}
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close resolution form"
            onPress={() => setExpanded(false)}
          >
            <Feather name="x" size={22} color={Colors.ink} />
          </TouchableOpacity>
        )}
      </View>
      {request ? (
        <>
          <Text style={styles.summary}>{request.summary}</Text>
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>
              {request.eligibility_status.replaceAll('_', ' ')}
            </Text>
            <Text style={styles.muted}>{request.eligibility_reason}</Text>
          </View>
          {proposal ? (
            <View style={styles.proposal}>
              <Text style={styles.eyebrow}>
                Proposal v{proposal.version} · {proposal.status.toLowerCase()}
              </Text>
              <Text style={styles.proposalTitle}>
                {REMEDY_LABELS[proposal.remedy]}
                {proposal.amount && proposal.currency
                  ? ` · ${proposal.currency} ${(proposal.amount / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                  : ''}
              </Text>
              <Text style={styles.muted}>{proposal.note}</Text>
              {proposal.return_required ? (
                <Text style={styles.returnLine}>A physical return is part of this proposal.</Text>
              ) : null}
            </View>
          ) : null}
          {proposalNeedsMyDecision ? (
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.primary}
                disabled={busy}
                onPress={() => decide('ACCEPTED')}
              >
                <Text style={styles.primaryText}>{busy ? 'Saving…' : 'Accept proposal'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondary}
                disabled={busy}
                onPress={() => decide('DECLINED')}
              >
                <Text style={styles.secondaryText}>Decline</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {!proposal || ['DECLINED', 'SUPERSEDED'].includes(proposal.status) ? (
            <View style={styles.form}>
              <Text style={styles.formTitle}>Offer a clear next step</Text>
              <ChoiceRow
                values={RESOLUTION_REMEDIES}
                selected={remedy}
                label={(value) => REMEDY_LABELS[value]}
                onSelect={setRemedy}
              />
              {moneyRemedy ? (
                <MoneyInput
                  label="Resolution amount"
                  accessibilityLabel="Resolution amount"
                  value={amount}
                  onChangeText={setAmount}
                  currency={currencyCode}
                />
              ) : null}
              <TextInput
                accessibilityLabel="Proposal details"
                style={[styles.input, styles.multiline]}
                value={proposalNote}
                onChangeText={setProposalNote}
                multiline
                placeholder="What are you offering and what happens next?"
                placeholderTextColor={Colors.midGrey}
              />
              <TouchableOpacity style={styles.primary} disabled={busy} onPress={propose}>
                <Text style={styles.primaryText}>{busy ? 'Saving…' : 'Send proposal'}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <Text style={styles.footnote}>
            Accepting records the agreement. Returns and refunds still wait for evidence, Ops
            review, and protected Money Desk execution.
          </Text>
        </>
      ) : (
        <View style={styles.form}>
          <Text style={styles.formTitle}>What happened?</Text>
          <ChoiceRow
            values={RETURN_REASONS}
            selected={reason}
            label={(value) => RETURN_REASON_LABELS[value]}
            onSelect={setReason}
          />
          <Text style={styles.formTitle}>What would help?</Text>
          <ChoiceRow
            values={availableOpenRemedies}
            selected={remedy}
            label={(value) => REMEDY_LABELS[value]}
            onSelect={setRemedy}
          />
          {moneyRemedy ? (
            <MoneyInput
              label="Requested refund amount"
              accessibilityLabel="Requested refund amount"
              value={amount}
              onChangeText={setAmount}
              currency={currencyCode}
            />
          ) : null}
          <TextInput
            accessibilityLabel="Resolution summary"
            style={[styles.input, styles.multiline]}
            value={summary}
            onChangeText={setSummary}
            multiline
            placeholder="Describe the issue, what you expected, and any evidence you have."
            placeholderTextColor={Colors.midGrey}
          />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={
              evidenceUri ? 'Replace private evidence photo' : 'Add private evidence photo'
            }
            style={styles.evidenceButton}
            disabled={busy}
            onPress={chooseEvidence}
          >
            <Feather
              name={evidenceUri ? 'check-circle' : 'image'}
              size={18}
              color={Colors.needleGreen}
            />
            <View style={styles.flex}>
              <Text style={styles.evidenceTitle}>
                {evidenceUri ? 'Private evidence attached' : 'Add evidence photo'}
              </Text>
              <Text style={styles.muted}>
                Visible only to the order parties and authorized Drapeon Ops.
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primary} disabled={busy} onPress={open}>
            <Text style={styles.primaryText}>{busy ? 'Opening…' : 'Open protected case'}</Text>
          </TouchableOpacity>
          <Text style={styles.footnote}>
            This starts the in-app record. Email may notify both parties, but it cannot approve a
            refund.
          </Text>
        </View>
      )}
    </View>
  )
}

function ChoiceRow<T extends string>({
  values,
  selected,
  label,
  onSelect,
}: {
  values: readonly T[]
  selected: T
  label: (value: T) => string
  onSelect: (value: T) => void
}) {
  return (
    <View style={styles.choices}>
      {values.map((value) => (
        <TouchableOpacity
          key={value}
          accessibilityRole="button"
          accessibilityState={{ selected: selected === value }}
          style={[styles.choice, selected === value && styles.choiceActive]}
          onPress={() => onSelect(value)}
        >
          <Text style={[styles.choiceText, selected === value && styles.choiceTextActive]}>
            {label(value)}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  loading: { padding: Spacing.md, alignItems: 'center' },
  launch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    ...Shadow.sm,
  },
  launchTitle: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.ink },
  flex: { flex: 1 },
  card: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  title: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink, marginTop: 2 },
  status: {
    backgroundColor: Colors.boneDeep,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  statusText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    textTransform: 'capitalize',
  },
  summary: { fontSize: FontSize.sm, lineHeight: 21, color: Colors.ink },
  muted: { fontSize: FontSize.xs, lineHeight: 18, color: Colors.inkLight },
  notice: { backgroundColor: Colors.bone, borderRadius: Radius.md, padding: Spacing.md, gap: 4 },
  noticeTitle: { fontSize: FontSize.xs, fontWeight: FontWeight.bold, color: Colors.needleGreen },
  proposal: {
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: 5,
  },
  proposalTitle: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.ink },
  returnLine: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.kanteRust },
  form: { gap: Spacing.sm, marginTop: Spacing.xs },
  formTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.ink },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choice: {
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  choiceActive: { backgroundColor: Colors.needleGreenLight, borderColor: Colors.needleGreen },
  choiceText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  choiceTextActive: { color: Colors.needleGreen },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    color: Colors.ink,
    fontSize: FontSize.sm,
    backgroundColor: Colors.white,
  },
  multiline: { minHeight: 92, paddingTop: 12, textAlignVertical: 'top' },
  evidenceButton: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.md,
    backgroundColor: Colors.bone,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  evidenceTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  actions: { gap: Spacing.sm },
  primary: {
    minHeight: 48,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  primaryText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  secondary: {
    minHeight: 46,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  footnote: { fontSize: FontSize.xs, lineHeight: 18, color: Colors.midGrey },
})
