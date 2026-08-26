import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import {
  deriveDispatchFulfillmentPresentation,
  deriveDispatchCustomerChargePresentation,
  dispatchBlockerCopy,
  isCompletedOrderStage,
  type DispatchCustomerDecision,
  type DispatchFulfillmentPresentation,
  type DispatchRunStatus,
} from '@drape/shared'
import { invokeFunction, supabase } from '@/lib/supabase'
import { useOrderPaymentFlow } from '@/lib/payments'
import { formatAmount, type CurrencyCode } from '@/lib/currency'
import { readFunctionErrorMessage } from '@/lib/function-errors'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { DrapeMediaMosaic, type DrapeMediaMosaicItem } from './DrapeMediaMosaic'
import { AddressAutocompleteInput } from './AddressAutocompleteInput'
import { PhoneNumberInput } from './PhoneNumberInput'

type DispatchEvidence = {
  id: string
  signedUrl?: string | null
  url?: string | null
  mimeType: string
  mediaType: 'IMAGE' | 'VIDEO' | string
  label: string
  expiresInSeconds: number
}

type DispatchRun = {
  id: string
  order_id: string
  method: string
  status: DispatchRunStatus
  funding_status: string
  currency: string
  captured_allowance_amount: number
  customer_funded_allowance_amount: number
  drapeon_subsidy_amount: number
  actual_provider_cost_amount: number | null
  allowance_applied_amount: number
  shortfall_subtotal_amount: number
  shortfall_tax_amount: number
  shortfall_fee_amount: number
  shortfall_total_amount: number
  unused_allowance_amount: number
  customer_refund_amount: number
  customer_refund_tax_amount: number
  customer_refund_status: string
  subsidy_restored_amount: number
  provider_name: string | null
  provider_quote_reference: string | null
  provider_quote_evidence: DispatchEvidence[]
  customer_decision: DispatchCustomerDecision | null
  updated_at: string
}

type DispatchParcel = {
  id: string
  status: string
  provider_name: string | null
  tracking_number: string | null
  tracking_url: string | null
  eta_at: string | null
  eta_timezone: string | null
  last_location: {
    label?: string | null
    latitude?: number | null
    longitude?: number | null
  } | null
}

type DispatchEvent = {
  id: string
  event_type: string
  customer_note: string | null
  occurred_at: string
  evidence_media: DispatchEvidence[]
}

type DispatchState = {
  ok: boolean
  role: 'CUSTOMER' | 'TAILOR'
  paymentConfirmed?: boolean
  paymentReconciliationPending?: boolean
  currentMethod?: string | null
  canRequestDelivery?: boolean
  deliveryDetails?: DeliveryDetails
  run: DispatchRun | null
  parcels: DispatchParcel[]
  events: DispatchEvent[]
}

type DeliveryDetails = {
  recipientName: string
  recipientPhone: string
  address: string
  city: string
  region: string
  postalCode: string
  countryCode: string
}

const emptyDeliveryDetails: DeliveryDetails = {
  recipientName: '', recipientPhone: '', address: '', city: '', region: '', postalCode: '', countryCode: '',
}

const statusCopy: Record<DispatchRunStatus, { title: string; body: string }> = {
  QUOTE_REQUIRED: { title: 'Delivery price being confirmed', body: 'Drapeon is confirming the rider or carrier cost.' },
  AWAITING_CUSTOMER_DECISION: { title: 'Delivery choice needed', body: 'Review the final provider price and choose how to continue.' },
  AWAITING_SHORTFALL_PAYMENT: { title: 'Extra delivery payment needed', body: 'The protected allowance stays applied. Only the disclosed difference is due.' },
  READY_TO_BOOK: { title: 'Delivery funding ready', body: 'Drapeon can now book the rider or carrier.' },
  BOOKED: { title: 'Delivery booked', body: 'The rider or carrier has been arranged.' },
  IN_TRANSIT: { title: 'On the way', body: 'Follow the latest Drapeon Dispatch update here.' },
  DELIVERED: { title: 'Delivered', body: 'Delivery proof is recorded and final reconciliation is underway.' },
  PICKUP_READY: { title: 'Ready for pickup', body: 'Use the collection instructions and code shown on this order.' },
  PICKED_UP: { title: 'Pickup complete', body: 'The collection handoff is recorded.' },
  CANCELLED: { title: 'Delivery cancelled', body: 'Any refundable delivery amount is being returned automatically.' },
  EXCEPTION: { title: 'Delivery needs attention', body: 'Drapeon is resolving an issue. Your protected money will not be released twice.' },
  RECONCILED: { title: 'Delivery complete', body: 'Provider cost, customer refund, and Drapeon funding are balanced.' },
}

const eventLabels: Record<string, string> = {
  QUOTE_RECORDED: 'Provider price confirmed',
  CHEAPER_OPTION_REQUESTED: 'Cheaper option requested',
  DISPATCH_OPTION_DECLINED: 'Delivery option declined',
  SHORTFALL_REQUESTED: 'Delivery payment requested',
  SHORTFALL_PAID: 'Delivery payment confirmed',
  PICKUP_SELECTED: 'Switched to pickup',
  BOOKED: 'Rider or carrier booked',
  CARRIER_ACCEPTED: 'Carrier accepted the parcel',
  COLLECTED: 'Parcel collected',
  AT_HUB: 'Parcel at carrier hub',
  IN_TRANSIT: 'Parcel in transit',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERY_ATTEMPTED: 'Delivery attempted',
  DELIVERED: 'Delivered',
  PICKUP_READY: 'Ready for pickup',
  PICKED_UP: 'Picked up',
  RETURNING: 'Returning',
  RETURNED: 'Returned',
  CANCELLED: 'Delivery cancelled',
  REFUND_COMPLETED: 'Delivery refund completed',
  EXCEPTION_RECORDED: 'Delivery issue recorded',
  RECONCILED: 'Delivery reconciled',
}

function money(amount: number | null | undefined, currency: string) {
  return formatAmount(amount ?? 0, currency as CurrencyCode, currency as CurrencyCode, {})
}

function newDecisionKey(orderId: string, decision: DispatchCustomerDecision) {
  return `dispatch:${orderId}:${decision}:${Date.now()}`
}

function parcelLocation(parcel: DispatchParcel | null) {
  const label = parcel?.last_location?.label?.trim()
  if (label) return label
  const latitude = parcel?.last_location?.latitude
  const longitude = parcel?.last_location?.longitude
  if (typeof latitude === 'number' && typeof longitude === 'number') {
    return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
  }
  return null
}

function evidenceItems(evidence: DispatchEvidence[] | null | undefined): DrapeMediaMosaicItem[] {
  return (evidence ?? []).map((item) => ({
    id: item.id,
    uri: item.signedUrl ?? item.url ?? null,
    kind: item.mediaType === 'VIDEO' || item.mimeType.startsWith('video/') ? 'video' : 'photo',
    label: item.label,
  }))
}

type DrapeonDispatchCardProps = {
  orderId: string
  orderStage?: string | null
  actorRole: 'CUSTOMER' | 'TAILOR'
  onOpenChange?: (open: boolean) => void
  onDeliveryStateChange?: (isTerminal: boolean) => void
  onFulfillmentStateChange?: (state: DispatchFulfillmentPresentation) => void
  onOrderStateChange?: () => void | Promise<void>
}

export function DrapeonDispatchCard({
  orderId,
  orderStage,
  actorRole,
  onOpenChange,
  onDeliveryStateChange,
  onFulfillmentStateChange,
  onOrderStateChange,
}: DrapeonDispatchCardProps) {
  const [state, setState] = useState<DispatchState | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<DispatchCustomerDecision | null>(null)
  const [methodBusy, setMethodBusy] = useState<'LOCAL_DELIVERY' | 'SHIPPING' | null>(null)
  const methodRequestScrollRef = useRef<ScrollView | null>(null)
  const [selectedMethod, setSelectedMethod] = useState<'LOCAL_DELIVERY' | 'SHIPPING'>('LOCAL_DELIVERY')
  const [note, setNote] = useState('')
  const [deliveryDetails, setDeliveryDetails] = useState<DeliveryDetails>(emptyDeliveryDetails)
  const [deliveryDetailsDirty, setDeliveryDetailsDirty] = useState(false)
  const mediaRefreshAttemptedRef = useRef(false)
  const { startOrderPayment } = useOrderPaymentFlow()
  const orderComplete = isCompletedOrderStage(orderStage)

  const setModalOpen = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }, [onOpenChange])

  const refresh = useCallback(async (): Promise<DispatchState | null> => {
    setLoadError(null)
    const { data, error } = await invokeFunction<DispatchState>('drapeon-dispatch-action', {
      body: { action: 'get-state', orderId },
    })
    if (error || !data?.ok) {
      setLoadError(await readFunctionErrorMessage(error, 'Delivery status could not be loaded.'))
      setLoading(false)
      return null
    }
    setState(data)
    if (!deliveryDetailsDirty) setDeliveryDetails({ ...emptyDeliveryDetails, ...data.deliveryDetails })
    setLoading(false)
    return data
  }, [deliveryDetailsDirty, orderId])

  useEffect(() => {
    if (orderComplete) {
      setLoading(false)
      return undefined
    }
    let active = true
    const initialRefresh = setTimeout(() => {
      if (active) void refresh()
    }, 0)
    const channel = supabase.channel(`drapeon-dispatch:${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_fulfillment_runs', filter: `order_id=eq.${orderId}` }, () => { if (active) void refresh() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_fulfillment_parcels', filter: `order_id=eq.${orderId}` }, () => { if (active) void refresh() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_fulfillment_events', filter: `order_id=eq.${orderId}` }, () => { if (active) void refresh() })
      .subscribe()
    return () => {
      active = false
      clearTimeout(initialRefresh)
      void supabase.removeChannel(channel)
    }
  }, [orderComplete, orderId, refresh])

  const run = state?.run ?? null
  const parcel = state?.parcels?.[0] ?? null
  const currentLocation = parcelLocation(parcel)
  const latestEvent = state?.events?.[0] ?? null
  const refundTotal = run ? run.customer_refund_amount + run.customer_refund_tax_amount : 0
  const chargePresentation = deriveDispatchCustomerChargePresentation(run?.captured_allowance_amount)
  const decisionNeeded = actorRole === 'CUSTOMER' && run?.status === 'AWAITING_CUSTOMER_DECISION'
  const pickupRecoveryAvailable = actorRole === 'CUSTOMER'
    && !!run
    && ['QUOTE_REQUIRED', 'AWAITING_SHORTFALL_PAYMENT', 'READY_TO_BOOK'].includes(run.status)
  const paymentNeeded = actorRole === 'CUSTOMER' && run?.status === 'AWAITING_SHORTFALL_PAYMENT' && !state?.paymentConfirmed
  const paymentUpdating = run?.status === 'AWAITING_SHORTFALL_PAYMENT' && !!state?.paymentConfirmed
  const fulfillmentPresentation = deriveDispatchFulfillmentPresentation({
    orderMethod: state?.currentMethod,
    orderStage,
    runMethod: run?.method,
    runStatus: run?.status,
  })
  const presentation = paymentUpdating
    ? { title: 'Delivery payment received', body: 'Drapeon Dispatch is confirming the provider record. You will not be charged again.' }
    : fulfillmentPresentation.replacementPending && run?.status === 'QUOTE_REQUIRED'
      ? { title: 'Delivery requested', body: 'Delivery has replaced pickup. Drapeon is confirming the provider price and proof.' }
    : run?.status === 'AWAITING_SHORTFALL_PAYMENT'
      ? { title: chargePresentation.paymentStatusTitle, body: chargePresentation.paymentStatusBody }
    : run ? statusCopy[run.status] : null
  const history = useMemo(() => state?.events ?? [], [state?.events])
  const quoteProof = useMemo(() => evidenceItems(run?.provider_quote_evidence), [run?.provider_quote_evidence])
  const deliveryQuoteIsCurrent = !!run && !['PICKUP_READY', 'CANCELLED'].includes(run.status)

  useEffect(() => {
    onDeliveryStateChange?.(run?.status === 'DELIVERED' || run?.status === 'RECONCILED' || run?.status === 'PICKED_UP')
  }, [onDeliveryStateChange, run?.status])

  useEffect(() => {
    onFulfillmentStateChange?.(fulfillmentPresentation)
  }, [
    fulfillmentPresentation.effectiveMethod,
    fulfillmentPresentation.pickupCredentialActive,
    fulfillmentPresentation.replacementPending,
    onFulfillmentStateChange,
  ])

  const refreshExpiredEvidence = useCallback(() => {
    if (mediaRefreshAttemptedRef.current) return
    mediaRefreshAttemptedRef.current = true
    void refresh()
  }, [refresh])

  useEffect(() => {
    mediaRefreshAttemptedRef.current = false
  }, [run?.updated_at, open])

  async function decide(decision: DispatchCustomerDecision) {
    if (!run || busy) return
    setBusy(decision)
    const { data, error } = await invokeFunction<{ ok?: boolean; acknowledgement?: string }>('drapeon-dispatch-action', {
      body: {
        action: 'decide-quote',
        orderId,
        decision,
        note: note.trim() || null,
        idempotencyKey: newDecisionKey(orderId, decision),
      },
    })
    setBusy(null)
    if (error || !data?.ok) {
      Alert.alert('Delivery choice not saved', await readFunctionErrorMessage(error, 'Refresh the delivery status and try again.'))
      return
    }
    setNote('')
    await refresh()
    await onOrderStateChange?.()
    if (decision === 'PAY_SHORTFALL') {
      Alert.alert('Choice saved', data.acknowledgement ?? `The exact delivery payment is ready.`, [
        { text: 'Not now', style: 'cancel' },
        { text: 'Pay now', onPress: () => { void payDifference() } },
      ])
      return
    }
    if (decision === 'SWITCH_TO_PICKUP') setModalOpen(false)
    Alert.alert(
      decision === 'SWITCH_TO_PICKUP' ? 'Pickup restored' : 'Delivery updated',
      data.acknowledgement ?? 'Your choice is saved and Drapeon Dispatch has been notified.',
    )
  }

  async function payDifference() {
    if (!run || busy) return
    setBusy('PAY_SHORTFALL')
    const result = await startOrderPayment({ orderId })
    setBusy(null)
    const latest = await refresh()
    if (!result.ok) {
      if (latest?.paymentConfirmed) {
        Alert.alert('Delivery payment received', 'Your payment is confirmed. Drapeon Dispatch is updating the delivery status now.')
        return
      }
      if (result.reason !== 'cancelled') Alert.alert('Payment not completed', result.message)
      return
    }
    Alert.alert('Delivery payment confirmed', 'Drapeon Dispatch can now book the rider or carrier. Your order updates automatically.')
  }

  async function requestMethod(method: 'LOCAL_DELIVERY' | 'SHIPPING') {
    if (methodBusy) return
    const preparedDetails = {
      ...deliveryDetails,
      recipientName: deliveryDetails.recipientName.trim(),
      recipientPhone: deliveryDetails.recipientPhone.trim(),
      address: deliveryDetails.address.trim(),
      countryCode: deliveryDetails.countryCode.trim().toUpperCase(),
    }
    if (!preparedDetails.recipientName || !preparedDetails.recipientPhone || !preparedDetails.address || preparedDetails.countryCode.length !== 2) {
      Alert.alert('Confirm delivery details', 'Add the recipient and phone number, then choose an address from the search results.')
      return
    }
    setMethodBusy(method)
    const { data, error } = await invokeFunction<{ ok?: boolean; acknowledgement?: string; recoveryAction?: string }>('drapeon-dispatch-action', {
      body: {
        action: 'request-method-change', orderId, method,
        note: note.trim() || null,
        deliveryDetails: preparedDetails,
        idempotencyKey: `dispatch:${orderId}:${method}:${Date.now()}`,
      },
    })
    setMethodBusy(null)
    if (error || !data?.ok) {
      Alert.alert('Delivery request not saved', await readFunctionErrorMessage(error, data?.recoveryAction === 'EDIT_DELIVERY_DETAILS' ? 'Confirm the delivery address and recipient details, then try again.' : 'Refresh the order and try again.'))
      return
    }
    setNote('')
    setDeliveryDetailsDirty(false)
    await refresh()
    await onOrderStateChange?.()
    setModalOpen(false)
    Alert.alert('Delivery request saved', data.acknowledgement ?? 'Drapeon Dispatch is confirming the provider price and proof.')
  }

  const deliveryDetailsEditor = (
    <View style={styles.deliveryCard}>
      <View style={styles.deliveryHeading}>
        <View style={styles.deliveryIcon}><Feather name="user" size={18} color={Colors.needleGreenDark} /></View>
        <View style={styles.deliveryHeadingCopy}>
          <Text style={styles.sectionTitle}>Who should receive it?</Text>
          <Text style={styles.help}>Used by the rider or carrier for this order.</Text>
        </View>
      </View>
      <TextInput
        value={deliveryDetails.recipientName}
        onChangeText={(recipientName) => { setDeliveryDetailsDirty(true); setDeliveryDetails((current) => ({ ...current, recipientName })) }}
        placeholder="Recipient name"
        placeholderTextColor={Colors.midGrey}
        autoComplete="name"
        accessibilityLabel="Recipient name"
        style={styles.fieldInput}
      />
      <PhoneNumberInput
        value={deliveryDetails.recipientPhone}
        onChangeText={(recipientPhone) => { setDeliveryDetailsDirty(true); setDeliveryDetails((current) => ({ ...current, recipientPhone })) }}
        placeholder="Phone number"
        accessibilityLabel="Recipient phone number"
      />

      <View style={styles.deliveryDivider} />
      <View style={styles.deliveryHeading}>
        <View style={styles.deliveryIcon}><Feather name="map-pin" size={18} color={Colors.needleGreenDark} /></View>
        <View style={styles.deliveryHeadingCopy}>
          <Text style={styles.sectionTitle}>Where is it going?</Text>
          <Text style={styles.help}>Search once. City, region, and country are filled automatically.</Text>
        </View>
      </View>
      {deliveryDetails.address && deliveryDetails.countryCode.length === 2 ? (
        <View style={styles.selectedAddress}>
          <Feather name="map-pin" size={18} color={Colors.needleGreenDark} />
          <Text style={styles.selectedAddressText}>{deliveryDetails.address}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Change delivery address"
            onPress={() => {
              setDeliveryDetailsDirty(true)
              setDeliveryDetails((current) => ({ ...current, address: '', city: '', region: '', postalCode: '', countryCode: '' }))
            }}
            style={styles.changeAddress}
          >
            <Text style={styles.changeAddressText}>Change</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <AddressAutocompleteInput
          label="Delivery address"
          value={deliveryDetails.address}
          onChangeText={(address) => {
            setDeliveryDetailsDirty(true)
            setDeliveryDetails((current) => ({ ...current, address, city: '', region: '', postalCode: '', countryCode: '' }))
            // Results arrive after the lookup debounce. Re-anchor after they
            // expand so the field and its choices remain above Android's IME.
            setTimeout(() => methodRequestScrollRef.current?.scrollToEnd({ animated: true }), 500)
          }}
          onSelectAddress={(selected) => {
            setDeliveryDetailsDirty(true)
            setDeliveryDetails((current) => ({ ...current, address: selected.displayValue, city: selected.city, region: selected.stateRegion, postalCode: selected.postcode, countryCode: selected.countryCode ?? '' }))
          }}
          placeholder="Search address, area, or landmark"
          autoComplete="street-address"
          onFocus={() => {
            const revealAddressSearch = () => methodRequestScrollRef.current?.scrollToEnd({ animated: true })
            requestAnimationFrame(revealAddressSearch)
            setTimeout(revealAddressSearch, Platform.OS === 'android' ? 180 : 80)
            setTimeout(revealAddressSearch, 520)
          }}
        />
      )}
    </View>
  )

  const deliveryMethodPicker = (
    <View style={styles.methodPicker} accessibilityRole="radiogroup" accessibilityLabel="Choose delivery method">
      <View style={styles.methodTabs}>
        {([
          ['LOCAL_DELIVERY', 'Local delivery'],
          ['SHIPPING', 'Shipping'],
        ] as const).map(([value, label]) => {
          const selected = selectedMethod === value
          return (
            <TouchableOpacity
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={label}
              style={[styles.methodTab, selected && styles.methodTabSelected]}
              onPress={() => setSelectedMethod(value)}
              activeOpacity={0.82}
            >
              <Feather name={value === 'LOCAL_DELIVERY' ? 'truck' : 'package'} size={16} color={selected ? Colors.white : Colors.needleGreenDark} />
              <Text style={[styles.methodTabText, selected && styles.methodTabTextSelected]}>{label}</Text>
            </TouchableOpacity>
          )
        })}
      </View>
      <Text style={styles.help}>
        {selectedMethod === 'LOCAL_DELIVERY'
          ? 'For a nearby rider or local delivery provider.'
          : 'For a carrier shipping across regions or countries.'}
      </Text>
    </View>
  )

  if (loading && !run) {
    return (
      <View accessibilityRole="progressbar" accessibilityLabel="Loading delivery status" style={styles.trigger}>
        <View style={styles.triggerIcon}><ActivityIndicator size="small" color={Colors.needleGreenDark} /></View>
        <View style={styles.flex}>
          <Text style={styles.triggerLabel}>Drapeon Dispatch</Text>
          <Text style={styles.triggerStatus}>Loading delivery status</Text>
        </View>
      </View>
    )
  }

  if (loadError && !run) {
    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Delivery status unavailable. Retry"
        style={[styles.trigger, styles.triggerAttention]}
        onPress={() => { setLoading(true); void refresh() }}
        activeOpacity={0.82}
      >
        <View style={[styles.triggerIcon, styles.errorIcon]}><Feather name="alert-circle" size={16} color={Colors.kanteRust} /></View>
        <View style={styles.flex}>
          <Text style={styles.triggerLabel}>Drapeon Dispatch</Text>
          <Text style={styles.triggerStatus}>Delivery status unavailable</Text>
        </View>
        <Text style={styles.retryText}>Retry</Text>
      </TouchableOpacity>
    )
  }

  if (orderComplete) return null

  if (!run || !presentation) {
    if (actorRole !== 'CUSTOMER' || state?.currentMethod !== 'LOCAL_COLLECTION' || !state?.canRequestDelivery) return null
    return (
      <>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Request delivery instead of pickup" style={styles.trigger} onPress={() => setModalOpen(true)} activeOpacity={0.82}>
          <View style={styles.triggerIcon}><Feather name="truck" size={15} color={Colors.needleGreenDark} /></View>
          <View style={styles.flex}><Text style={styles.triggerLabel}>Fulfilment</Text><Text style={styles.triggerStatus}>Need delivery instead?</Text></View>
          <Feather name="chevron-right" size={18} color={Colors.midGrey} />
        </TouchableOpacity>
        <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalOpen(false)}>
          <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
            <View style={styles.header}><View style={styles.flex}><Text style={styles.eyebrow}>Change fulfilment</Text><Text style={styles.headerTitle}>Request delivery</Text></View><TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" style={styles.close} onPress={() => setModalOpen(false)}><Feather name="x" size={22} color={Colors.ink} /></TouchableOpacity></View>
            <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <ScrollView
                ref={methodRequestScrollRef}
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                showsVerticalScrollIndicator={false}
              >
                <View style={[styles.statusCard, styles.changeMethodStatus]}><Text style={styles.title}>Replace pickup with delivery</Text><Text style={styles.help}>Once saved, the pickup code is retired. You will review provider proof and any price difference before payment.</Text></View>
                {deliveryMethodPicker}
                {deliveryDetailsEditor}
                <TextInput value={note} onChangeText={setNote} placeholder="Optional delivery note" placeholderTextColor={Colors.midGrey} multiline style={styles.input} />
                <Action label={selectedMethod === 'LOCAL_DELIVERY' ? 'Request local delivery' : 'Request shipping'} primary busy={methodBusy === selectedMethod} onPress={() => { void requestMethod(selectedMethod) }} />
              </ScrollView>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </Modal>
      </>
    )
  }

  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Open Drapeon Dispatch details. ${presentation.title}`}
        style={[styles.trigger, (decisionNeeded || paymentNeeded || run.status === 'EXCEPTION') && styles.triggerAttention]}
        onPress={() => setModalOpen(true)}
        activeOpacity={0.82}
      >
        <View style={styles.triggerIcon}><Feather name="truck" size={15} color={Colors.needleGreenDark} /></View>
        <View style={styles.flex}>
          <Text style={styles.triggerLabel}>Drapeon Dispatch</Text>
          <Text style={styles.triggerStatus} numberOfLines={1}>{presentation.title}</Text>
        </View>
        {decisionNeeded || paymentNeeded ? <View style={styles.attentionDot} /> : null}
        <Feather name="chevron-right" size={18} color={Colors.midGrey} />
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalOpen(false)}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <View style={styles.flex}>
              <Text style={styles.eyebrow}>Drapeon Dispatch</Text>
              <Text style={styles.headerTitle}>{presentation.title}</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close Drapeon Dispatch" style={styles.close} onPress={() => setModalOpen(false)}>
              <Feather name="x" size={22} color={Colors.ink} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {loadError ? (
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry delivery status" style={styles.inlineError} onPress={() => { void refresh() }}>
                <Feather name="alert-circle" size={16} color={Colors.kanteRust} />
                <Text style={styles.inlineErrorText}>Latest update could not load. Tap to retry.</Text>
              </TouchableOpacity>
            ) : null}
            <View style={styles.statusCard}>
              <View style={styles.statusHeading}>
                <View style={styles.statusIcon}><Feather name={run.status === 'EXCEPTION' ? 'alert-circle' : 'truck'} size={19} color={Colors.needleGreen} /></View>
                <View style={styles.flex}>
                  <Text style={styles.title}>{presentation.title}</Text>
                  <Text style={styles.body}>{presentation.body}</Text>
                </View>
              </View>
              {parcel?.provider_name || run.provider_name ? <Line label="Provider" value={parcel?.provider_name ?? run.provider_name ?? ''} /> : null}
              {parcel?.tracking_number ? <Line label="Tracking" value={parcel.tracking_number} /> : null}
              {parcel?.eta_at ? <Line label="Estimated arrival" value={new Date(parcel.eta_at).toLocaleString()} /> : null}
              {currentLocation ? <Line label="Current location" value={currentLocation} /> : null}
              {latestEvent?.customer_note ? <Text style={styles.note}>{latestEvent.customer_note}</Text> : null}
            </View>

            {deliveryQuoteIsCurrent && quoteProof.length > 0 ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Provider quote proof</Text>
                <Text style={styles.help}>Review the provider&apos;s price evidence before you approve or pay. The latest proof stays with this dispatch record.</Text>
                <DrapeMediaMosaic
                  items={quoteProof}
                  compact
                  contentFit="contain"
                  testID="dispatch-quote-proof"
                  onLoadError={refreshExpiredEvidence}
                  onPressItem={(item) => { if (item.uri) void Linking.openURL(item.uri) }}
                />
              </View>
            ) : null}

            {deliveryQuoteIsCurrent && run.actual_provider_cost_amount != null ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Delivery price</Text>
                {chargePresentation.isTopUp ? <Line label="Protected delivery allowance" value={money(run.captured_allowance_amount, run.currency)} /> : null}
                <Line label="Provider price" value={money(run.actual_provider_cost_amount, run.currency)} />
                {chargePresentation.isTopUp && run.shortfall_subtotal_amount > 0 ? <Line label={chargePresentation.subtotalLabel} value={money(run.shortfall_subtotal_amount, run.currency)} /> : null}
                {run.shortfall_tax_amount > 0 ? <Line label={chargePresentation.taxLabel} value={money(run.shortfall_tax_amount, run.currency)} /> : null}
                {run.shortfall_fee_amount > 0 ? <Line label="Payment fee" value={money(run.shortfall_fee_amount, run.currency)} /> : null}
                {run.shortfall_total_amount > 0 ? <Line label="Due now" value={money(run.shortfall_total_amount, run.currency)} strong /> : null}
                {refundTotal > 0 ? <Line label="Returning to customer" value={money(refundTotal, run.currency)} strong /> : null}
                {run.subsidy_restored_amount > 0 ? <Text style={styles.help}>{money(run.subsidy_restored_amount, run.currency)} of Drapeon-funded delivery coverage returns to the campaign balance.</Text> : null}
                <Text style={styles.help}>Delivery money is separate from the tailor’s earnings.</Text>
              </View>
            ) : null}

            {paymentUpdating ? (
              <View style={styles.card} accessibilityRole="summary">
                <Text style={styles.sectionTitle}>Payment is confirmed</Text>
                <Text style={styles.body}>The delivery status is updating. If provider reconciliation needs attention, Drapeon Ops is alerted automatically.</Text>
              </View>
            ) : null}

            {decisionNeeded ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Choose how to continue</Text>
                <Text style={styles.body}>{chargePresentation.decisionBody}</Text>
                <TextInput value={note} onChangeText={setNote} placeholder="Optional note for Drapeon Dispatch" placeholderTextColor={Colors.midGrey} multiline style={styles.input} />
                <Action label={`Pay ${money(run.shortfall_total_amount, run.currency)} ${chargePresentation.actionSuffix}`} primary busy={busy === 'PAY_SHORTFALL'} onPress={() => { void decide('PAY_SHORTFALL') }} />
                <Action label="Find a cheaper option" busy={busy === 'REQUEST_CHEAPER_OPTION'} onPress={() => { void decide('REQUEST_CHEAPER_OPTION') }} />
                <Action label="Switch to pickup" busy={busy === 'SWITCH_TO_PICKUP'} onPress={() => { void decide('SWITCH_TO_PICKUP') }} />
                <Action label="Decline this delivery option" danger busy={busy === 'DECLINE_DISPATCH'} onPress={() => { void decide('DECLINE_DISPATCH') }} />
              </View>
            ) : null}

            {pickupRecoveryAvailable ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Prefer pickup?</Text>
                <Text style={styles.body}>Switch back before the provider is booked. Delivery stops, any eligible delivery money is returned, and a fresh pickup code appears when the order is ready.</Text>
                <Action label="Switch back to pickup" busy={busy === 'SWITCH_TO_PICKUP'} onPress={() => { void decide('SWITCH_TO_PICKUP') }} />
              </View>
            ) : null}

            {paymentNeeded ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{chargePresentation.paymentTitle}</Text>
                <Text style={styles.body}>{chargePresentation.paymentBody}</Text>
                <Action label={`Pay ${money(run.shortfall_total_amount, run.currency)}`} primary busy={busy === 'PAY_SHORTFALL'} onPress={() => { void payDifference() }} />
              </View>
            ) : null}

            {actorRole === 'CUSTOMER' && state?.canRequestDelivery && ['PICKUP_READY', 'CANCELLED'].includes(run.status) ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Need delivery instead?</Text>
                <Text style={styles.body}>Request a new provider quote. You will see the proof and exact amount due before payment.</Text>
                {deliveryMethodPicker}
                {deliveryDetailsEditor}
                <TextInput value={note} onChangeText={setNote} placeholder="Optional delivery note" placeholderTextColor={Colors.midGrey} multiline style={styles.input} />
                <Action label={selectedMethod === 'LOCAL_DELIVERY' ? 'Request local delivery' : 'Request shipping'} primary busy={methodBusy === selectedMethod} onPress={() => { void requestMethod(selectedMethod) }} />
              </View>
            ) : null}

            {run.status === 'EXCEPTION' ? (
              <View style={styles.warning}>
                <Text style={styles.sectionTitle}>What happens next</Text>
                <Text style={styles.body}>{dispatchBlockerCopy('OPEN_FULFILLMENT_EXCEPTION').action} Drapeon records the provider outcome before retrying any money movement.</Text>
              </View>
            ) : null}

            {history.length > 0 ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Delivery history</Text>
                {history.map((event) => (
                  <View key={event.id} style={styles.eventRow}>
                    <View style={styles.eventDot} />
                    <View style={styles.flex}>
                      <Text style={styles.eventTitle}>{eventLabels[event.event_type] ?? 'Delivery updated'}</Text>
                      {event.customer_note ? <Text style={styles.eventNote}>{event.customer_note}</Text> : null}
                      <Text style={styles.eventTime}>{new Date(event.occurred_at).toLocaleString()}</Text>
                      {event.evidence_media?.length ? (
                        <View style={styles.eventProof}>
                          <DrapeMediaMosaic
                            items={evidenceItems(event.evidence_media)}
                            compact
                            contentFit="contain"
                            testID={`dispatch-event-proof-${event.id}`}
                            onLoadError={refreshExpiredEvidence}
                            onPressItem={(item) => { if (item.uri) void Linking.openURL(item.uri) }}
                          />
                        </View>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  )
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <View style={styles.line}><Text style={styles.lineLabel}>{label}</Text><Text style={strong ? styles.lineStrong : styles.lineValue}>{value}</Text></View>
}

function Action({ label, primary, danger, busy, onPress }: { label: string; primary?: boolean; danger?: boolean; busy?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={onPress} style={[styles.action, primary && styles.actionPrimary, danger && styles.actionDanger]}>
      {busy ? <ActivityIndicator color={primary ? Colors.white : Colors.needleGreen} /> : <Text style={[styles.actionText, primary && styles.actionTextPrimary, danger && styles.actionTextDanger]}>{label}</Text>}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  trigger: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderWidth: 1, borderColor: Colors.lightGrey, borderRadius: Radius.md, backgroundColor: Colors.white, paddingHorizontal: Spacing.md, marginTop: Spacing.md, ...Shadow.sm },
  triggerAttention: { borderColor: Colors.kanteRust, backgroundColor: Colors.bone },
  triggerIcon: { width: 32, height: 32, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.needleGreenLight },
  errorIcon: { backgroundColor: Colors.bone },
  triggerLabel: { color: Colors.needleGreenDark, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  triggerStatus: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.bold, marginTop: 2 },
  attentionDot: { width: 9, height: 9, borderRadius: Radius.full, backgroundColor: Colors.kanteRust },
  retryText: { color: Colors.needleGreenDark, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl, borderBottomWidth: 1, borderBottomColor: Colors.lightGrey, backgroundColor: Colors.white },
  eyebrow: { color: Colors.needleGreen, fontSize: FontSize.xs, fontWeight: FontWeight.semibold, letterSpacing: .6, textTransform: 'uppercase' },
  headerTitle: { color: Colors.ink, fontSize: FontSize.lg, fontWeight: FontWeight.bold, marginTop: 2 },
  close: { width: 44, height: 44, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bone },
  content: { padding: Spacing.xl, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  inlineError: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.kanteRust, backgroundColor: Colors.bone, paddingHorizontal: Spacing.md },
  inlineErrorText: { flex: 1, color: Colors.ink, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  statusCard: { borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight, padding: Spacing.lg, gap: Spacing.sm },
  changeMethodStatus: { padding: Spacing.md, gap: Spacing.xs },
  statusHeading: { flexDirection: 'row', gap: Spacing.sm },
  statusIcon: { width: 38, height: 38, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.white },
  title: { color: Colors.ink, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  body: { color: Colors.inkLight, fontSize: FontSize.sm, lineHeight: 21, marginTop: 3 },
  note: { color: Colors.ink, fontSize: FontSize.sm, lineHeight: 21, borderTopWidth: 1, borderTopColor: Colors.needleGreen, paddingTop: Spacing.sm },
  card: { borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.lightGrey, backgroundColor: Colors.white, padding: Spacing.lg, gap: Spacing.sm, ...Shadow.sm },
  warning: { borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.kanteRust, backgroundColor: Colors.bone, padding: Spacing.lg, gap: Spacing.sm },
  sectionTitle: { color: Colors.ink, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.md, paddingVertical: 3 },
  lineLabel: { flex: 1, color: Colors.inkLight, fontSize: FontSize.sm, lineHeight: 20 },
  lineValue: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, textAlign: 'right' },
  lineStrong: { color: Colors.ink, fontSize: FontSize.md, fontWeight: FontWeight.bold, textAlign: 'right' },
  help: { color: Colors.inkLight, fontSize: FontSize.xs, lineHeight: 18 },
  fieldInput: { minHeight: 48, borderWidth: 1, borderColor: Colors.lightGrey, borderRadius: Radius.md, paddingHorizontal: Spacing.md, color: Colors.ink, backgroundColor: Colors.white },
  deliveryCard: { borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.lightGrey, backgroundColor: Colors.white, padding: Spacing.lg, gap: Spacing.md, ...Shadow.sm },
  deliveryHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  deliveryHeadingCopy: { flex: 1, gap: 2 },
  deliveryIcon: { width: 38, height: 38, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.needleGreenLight },
  deliveryDivider: { height: 1, backgroundColor: Colors.lightGrey, marginVertical: Spacing.xs },
  selectedAddress: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  selectedAddressText: { flex: 1, color: Colors.ink, fontSize: FontSize.sm, lineHeight: 20, fontWeight: FontWeight.semibold },
  changeAddress: { minHeight: 40, justifyContent: 'center', paddingHorizontal: Spacing.xs },
  changeAddressText: { color: Colors.needleGreenDark, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  methodPicker: { gap: Spacing.sm },
  methodTabs: { flexDirection: 'row', gap: Spacing.sm, padding: 4, borderRadius: Radius.md, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.lightGrey },
  methodTab: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, borderRadius: Radius.sm, paddingHorizontal: Spacing.sm },
  methodTabSelected: { backgroundColor: Colors.needleGreen },
  methodTabText: { color: Colors.needleGreenDark, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, textAlign: 'center' },
  methodTabTextSelected: { color: Colors.white },
  input: { minHeight: 74, borderWidth: 1, borderColor: Colors.lightGrey, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, color: Colors.ink, backgroundColor: Colors.white, textAlignVertical: 'top' },
  action: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.lightGrey, backgroundColor: Colors.white, paddingHorizontal: Spacing.md },
  actionPrimary: { backgroundColor: Colors.needleGreen, borderColor: Colors.needleGreen },
  actionDanger: { borderColor: Colors.kanteRust },
  actionText: { color: Colors.needleGreenDark, fontSize: FontSize.sm, fontWeight: FontWeight.bold, textAlign: 'center' },
  actionTextPrimary: { color: Colors.white },
  actionTextDanger: { color: Colors.kanteRust },
  eventRow: { flexDirection: 'row', gap: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.lightGrey, paddingTop: Spacing.sm },
  eventDot: { width: 9, height: 9, borderRadius: Radius.full, backgroundColor: Colors.needleGreen, marginTop: 5 },
  eventTitle: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  eventNote: { color: Colors.inkLight, fontSize: FontSize.xs, lineHeight: 18, marginTop: 2 },
  eventTime: { color: Colors.midGrey, fontSize: FontSize.xs, marginTop: 3 },
  eventProof: { marginTop: Spacing.sm },
})
