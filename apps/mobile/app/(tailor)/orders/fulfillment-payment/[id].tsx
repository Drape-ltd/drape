import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, TextInput,
} from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { minorUnitsFromInput, moneyInputFromMinorUnits } from '@/lib/money-input'
import { goBackOrReturnTo } from '@/lib/navigation'
import { filterContactInfo, rejectPlaceholder } from '@drape/shared/contact-filter'
import { formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'
import type { OrderStage } from '@drape/shared/order-machine'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

type OrderDetail = {
  id: string
  reference: string
  garmentType: string
  customerName: string
  orderKind: 'CUSTOM' | 'READY_MADE'
  stage: OrderStage
  deliveryMethod: string
  quotedAmount: number | null
  itemSubtotal: number | null
  fulfillmentFee: number
  quotedCurrency: CurrencyCode
  deliveryAddress: string | null
  recipientName: string | null
  recipientPhone: string | null
  fulfillmentPaymentRequestedAt: string | null
  fulfillmentPaymentPaidAt: string | null
}

type CustomerProfileJoinRow = {
  display_name: string | null
}

type FulfillmentPaymentOrderRow = {
  id: string
  reference: string | null
  garment_type: string | null
  order_kind: 'CUSTOM' | 'READY_MADE' | null
  stage: OrderStage | null
  delivery_method: string | null
  quoted_amount: number | null
  item_subtotal: number | null
  fulfillment_fee: number | null
  currency: CurrencyCode | null
  quoted_currency: CurrencyCode | null
  delivery_address: string | null
  recipient_name: string | null
  recipient_phone: string | null
  fulfillment_payment_requested_at: string | null
  fulfillment_payment_paid_at: string | null
  customer_profiles: CustomerProfileJoinRow | CustomerProfileJoinRow[] | null
}

function firstJoinedRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function baseAmount(order: Pick<OrderDetail, 'orderKind' | 'itemSubtotal' | 'quotedAmount' | 'fulfillmentFee'>) {
  if (order.orderKind === 'READY_MADE') {
    return order.itemSubtotal ?? (order.quotedAmount != null ? Math.max(order.quotedAmount - order.fulfillmentFee, 0) : null)
  }
  if (order.quotedAmount == null) return null
  return Math.max(order.quotedAmount - order.fulfillmentFee, 0)
}

function fulfillmentLabel(deliveryMethod: string) {
  return deliveryMethod === 'LOCAL_DELIVERY' ? 'delivery' : 'shipping'
}

export default function FulfillmentPaymentRequestScreen() {
  const { id, returnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [saving, setSaving] = useState(false)

  function goBack() {
    goBackOrReturnTo(router, navigation, returnTo, '/(tailor)/orders')
  }

  useEffect(() => {
    async function load() {
      if (!id || !user?.id) return
      setLoading(true)
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, reference, garment_type, order_kind, stage, delivery_method,
          quoted_amount, item_subtotal, fulfillment_fee, currency, quoted_currency,
          delivery_address, recipient_name, recipient_phone,
          fulfillment_payment_requested_at, fulfillment_payment_paid_at,
          customer_profiles!customer_id(display_name)
        `)
        .eq('id', id)
        .eq('tailor_id', user.id)
        .maybeSingle()

      setLoading(false)

      if (error || !data) {
        setOrder(null)
        return
      }

      const row = data as FulfillmentPaymentOrderRow
      const customerProfile = firstJoinedRow(row.customer_profiles)
      const nextOrder = {
        id: row.id,
        reference: row.reference ?? 'Order',
        garmentType: row.garment_type ?? 'Order',
        customerName: customerProfile?.display_name ?? 'Customer',
        orderKind: row.order_kind ?? 'CUSTOM',
        stage: row.stage ?? 'PENDING_QUOTE',
        deliveryMethod: row.delivery_method ?? 'SHIPPING',
        quotedAmount: row.quoted_amount ?? null,
        itemSubtotal: row.item_subtotal ?? null,
        fulfillmentFee: row.fulfillment_fee ?? 0,
        quotedCurrency: (row.currency ?? row.quoted_currency ?? 'USD') as CurrencyCode,
        deliveryAddress: row.delivery_address ?? null,
        recipientName: row.recipient_name ?? null,
        recipientPhone: row.recipient_phone ?? null,
        fulfillmentPaymentRequestedAt: row.fulfillment_payment_requested_at ?? null,
        fulfillmentPaymentPaidAt: row.fulfillment_payment_paid_at ?? null,
      } satisfies OrderDetail

      setOrder(nextOrder)
      setAmount(moneyInputFromMinorUnits(nextOrder.fulfillmentFee))
      setNote('')
      setNoteError('')
    }

    void load()
  }, [id, user?.id])

  function validateNote(value: string) {
    if (!value.trim()) {
      setNoteError('')
      return true
    }
    const placeholder = rejectPlaceholder(value, 'Note')
    if (placeholder) {
      setNoteError(placeholder)
      return false
    }
    const blocked = filterContactInfo(value)
    if (blocked.blocked) {
      setNoteError("Contact details can't be included.")
      return false
    }
    setNoteError('')
    return true
  }

  async function submit() {
    if (!order || saving) return
    const requestedAmount = minorUnitsFromInput(amount)
    if (requestedAmount == null || requestedAmount <= 0) {
      Alert.alert(
        'Amount required',
        `Enter the exact ${fulfillmentLabel(order.deliveryMethod)} amount before sending this request.`,
      )
      return
    }
    if (!validateNote(note)) return

    setSaving(true)
    const { data, error } = await invokeFunction<{ ok: boolean; error?: string }>('tailor-order-action', {
      body: {
        orderId: order.id,
        action: 'request-fulfillment-payment',
        amount: requestedAmount,
        note: note.trim() || undefined,
      },
    })
    setSaving(false)

    if (error || !data?.ok) {
      const fallback = `Could not request ${fulfillmentLabel(order.deliveryMethod)} payment right now.`
      const message = error ? await readFunctionErrorMessage(error, fallback) : fallback
      Alert.alert(
        'Could not send request',
        isLikelyConnectivityIssue(error)
          ? `Connection looks weak. We could not send this ${fulfillmentLabel(order.deliveryMethod)} request yet. Retry when the signal improves.`
          : message,
      )
      return
    }

    Alert.alert(
      `${order.deliveryMethod === 'LOCAL_DELIVERY' ? 'Delivery' : 'Shipping'} payment requested`,
      `The customer can now pay the exact ${fulfillmentLabel(order.deliveryMethod)} amount from their order screen. Dispatch stays locked until that payment is confirmed.`,
      [{ text: 'OK', onPress: goBack }],
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateCard}>
          <ActivityIndicator color={Colors.needleGreen} size="large" />
          <Text style={styles.stateText}>Loading fulfillment request…</Text>
        </View>
      </SafeAreaView>
    )
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Order unavailable</Text>
          <Text style={styles.stateText}>We could not load this order right now.</Text>
          <Button label="Back to order" variant="secondary" onPress={goBack} />
        </View>
      </SafeAreaView>
    )
  }

  if (order.deliveryMethod === 'LOCAL_COLLECTION') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Pickup orders do not need this step</Text>
          <Text style={styles.stateText}>The customer receives a collection code when the order is ready, so no delivery or shipping fee is needed.</Text>
          <Button label="Back to order" variant="secondary" onPress={goBack} />
        </View>
      </SafeAreaView>
    )
  }

  if (!order.fulfillmentPaymentRequestedAt || order.fulfillmentFee > 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Dispatch fee is already handled</Text>
          <Text style={styles.stateText}>
            Drapeon adds the standard {fulfillmentLabel(order.deliveryMethod)} fee at checkout from the buyer address and your location. If a carrier surcharge, customs charge, or import duty appears later, contact Drapeon support so the customer can approve it before dispatch.
          </Text>
          <Button label="Back to order" variant="secondary" onPress={goBack} />
        </View>
      </SafeAreaView>
    )
  }

  if (order.fulfillmentPaymentPaidAt) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>{order.deliveryMethod === 'LOCAL_DELIVERY' ? 'Delivery payment already handled' : 'Shipping payment already handled'}</Text>
          <Text style={styles.stateText}>This order is ready for handoff once the parcel or rider is actually booked.</Text>
          <Button label="Back to order" variant="secondary" onPress={goBack} />
        </View>
      </SafeAreaView>
    )
  }

  if (order.stage !== 'FINISHING') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Not ready yet</Text>
          <Text style={styles.stateText}>Move the order to Preparing order first. Once it is packed and checked, you can request the exact {fulfillmentLabel(order.deliveryMethod)} amount here.</Text>
          <Button label="Back to order" variant="secondary" onPress={goBack} />
        </View>
      </SafeAreaView>
    )
  }

  const paidSoFar = baseAmount(order)
  const projectedTotal = (paidSoFar ?? 0) + (minorUnitsFromInput(amount) ?? 0)
  const actionLabel = order.fulfillmentPaymentRequestedAt
    ? `Update ${fulfillmentLabel(order.deliveryMethod)} payment request`
    : `Request ${fulfillmentLabel(order.deliveryMethod)} payment`

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{order.deliveryMethod === 'LOCAL_DELIVERY' ? 'Delivery payment' : 'Shipping payment'}</Text>
        <View style={{ width: 52 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.summaryCard}>
          <Text style={styles.eyebrow}>Order</Text>
          <Text style={styles.title}>{order.garmentType}</Text>
          <Text style={styles.subtitle}>{order.customerName} · #{order.reference}</Text>
          <Text style={styles.helper}>
            Take your time here. Compare the cheapest and most reliable option first, then send the exact amount when you are ready. Dispatch stays locked until the customer pays.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Fulfillment summary</Text>
          {paidSoFar != null ? (
            <Row
              label={order.orderKind === 'READY_MADE' ? 'Item already paid' : 'Base quote already paid'}
              value={formatAmount(paidSoFar, order.quotedCurrency, order.quotedCurrency, STATIC_FALLBACK_RATES)}
            />
          ) : null}
          <Row
            label={order.deliveryMethod === 'LOCAL_DELIVERY' ? 'Delivery due next' : 'Shipping due next'}
            value={amount.trim() ? formatAmount(minorUnitsFromInput(amount) ?? 0, order.quotedCurrency, order.quotedCurrency, STATIC_FALLBACK_RATES) : 'Enter amount'}
          />
          <Row
            label="Projected total"
            value={formatAmount(projectedTotal, order.quotedCurrency, order.quotedCurrency, STATIC_FALLBACK_RATES)}
            bold
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recipient</Text>
          <Text style={styles.bodyText}>{order.recipientName ?? 'Missing recipient name'}</Text>
          <Text style={styles.helper}>{order.recipientPhone ?? 'Missing recipient phone'}</Text>
          <Text style={[styles.helper, { marginTop: Spacing.sm }]}>{order.deliveryAddress ?? 'Missing delivery address'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Exact amount</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            placeholder={order.deliveryMethod === 'LOCAL_DELIVERY' ? 'Enter exact delivery amount' : 'Enter exact shipping amount'}
            placeholderTextColor={Colors.midGrey}
            keyboardType="decimal-pad"
          />
          <Text style={styles.helper}>
            Use the real amount you have agreed on after checking the courier or rider option you trust.
          </Text>

          <Text style={[styles.cardTitle, { marginTop: Spacing.lg }]}>Note for customer</Text>
          <TextInput
            style={[styles.input, styles.noteInput]}
            value={note}
            onChangeText={(value) => {
              setNote(value)
              if (noteError) void validateNote(value)
            }}
            placeholder={order.deliveryMethod === 'LOCAL_DELIVERY'
              ? 'Optional note, e.g. We found a reliable local rider for this delivery.'
              : 'Optional note, e.g. This is the exact courier quote after checking DHL and local options.'}
            placeholderTextColor={Colors.midGrey}
            multiline
          />
          {noteError ? <Text style={styles.errorText}>{noteError}</Text> : null}
          <Text style={styles.helper}>
            Keep this clear and buyer-friendly. Do not include direct contact details in the note.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button label={saving ? 'Sending request…' : actionLabel} onPress={submit} disabled={saving} />
      </View>
    </SafeAreaView>
  )
}

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.rowValueBold]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
  },
  backText: { fontSize: FontSize.lg, color: Colors.needleGreen, fontWeight: FontWeight.medium },
  headerTitle: { fontSize: FontSize.lg, color: Colors.ink, fontWeight: FontWeight.semibold },
  content: { padding: Spacing.xl, gap: Spacing.lg, paddingBottom: 120 },
  summaryCard: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.xl, gap: Spacing.sm, ...Shadow.sm },
  eyebrow: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 1 },
  title: { fontSize: FontSize.xxl, color: Colors.ink, fontWeight: FontWeight.bold },
  subtitle: { fontSize: FontSize.sm, color: Colors.inkLight },
  helper: { fontSize: FontSize.sm, color: Colors.midGrey, lineHeight: 22 },
  card: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.xl, gap: Spacing.sm, ...Shadow.sm },
  cardTitle: { fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.semibold },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  rowLabel: { flex: 1, fontSize: FontSize.sm, color: Colors.midGrey },
  rowValue: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.medium, textAlign: 'right' },
  rowValueBold: { color: Colors.needleGreen, fontWeight: FontWeight.bold },
  bodyText: { fontSize: FontSize.md, color: Colors.ink, lineHeight: 24 },
  input: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.ink,
  },
  noteInput: { minHeight: 110, textAlignVertical: 'top' },
  errorText: { fontSize: FontSize.xs, color: Colors.error },
  footer: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
    backgroundColor: Colors.bone,
  },
  stateCard: {
    margin: Spacing.xl,
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    alignItems: 'center',
    ...Shadow.sm,
  },
  stateTitle: { fontSize: FontSize.lg, color: Colors.ink, fontWeight: FontWeight.semibold, textAlign: 'center' },
  stateText: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 22 },
})
