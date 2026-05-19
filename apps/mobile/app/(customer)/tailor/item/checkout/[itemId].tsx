import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, TextInput, KeyboardAvoidingView, Platform } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { qk, useCustomerMeasurements, useRefreshOnFocus, useSellerItem } from '@/lib/queries'
import { quantityForSize } from '@/lib/ready-made-stock'
import { isLikelyConnectivityIssue, readFunctionErrorMessage, readFunctionErrorPayload } from '@/lib/function-errors'
import { composeStructuredAddress, parseNominatimSuggestion } from '@/lib/address'
import { invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui'
import { goBackOrReturnToIfNeeded } from '@/lib/navigation'
import { normalizePhoneForStorage, validatePhoneForProfile } from '@drape/shared/phone'
import { ORDER_CANCELLATION_ACK_COPY, ORDER_CANCELLATION_POLICY_ROWS } from '@drape/shared/checkout-policy'
import { phoneHintForContext } from '@/lib/phone-context'
import { READY_MADE_CHECKOUT_REMINDER, READY_MADE_POLICY_ROWS } from '@/lib/ready-made-policy'
import {
  normalizeReadyMadeSizeGuide,
  recommendReadyMadeSize,
} from '@/lib/ready-made-fit'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { paymentRouteCopyForCurrency, useOrderPaymentFlow } from '@/lib/payments'
import { queryClient } from '@/lib/queryClient'
import { Sentry } from '@/lib/sentry'
import type { SellerItemDetail as ItemDetail } from '@/lib/queries'
import { formatAmount, useCurrency, type CurrencyCode } from '@/lib/currency'

type FulfillmentOption = 'PICKUP' | 'DELIVERY' | 'SHIPPING'
type RecipientMode = 'SELF' | 'OTHER'
type CheckoutPricingPreview = {
  currency: CurrencyCode
  displayCurrency?: CurrencyCode
  sourceCurrency: CurrencyCode
  sourceSubtotal: number
  fxRate: number
  fxRateTimestamp: string | null
  subtotalAmount: number
  platformFeeAmount: number
  taxAmount: number
  taxRateBps: number
  taxRegion: string
  taxFallback: boolean
  taxFallbackReason: string | null
  shippingAmount: number
  totalAmount: number
  taxLabel: string
}

const MAX_READY_MADE_CHECKOUT_QUANTITY = 3
const HOME_BG = Colors.bone
const PRIMARY_GREEN = Colors.needleGreen
const CHARCOAL = Colors.ink
const MUTED_GREY = Colors.midGrey

function stockHelperText(inventoryQuantity: number) {
  if (inventoryQuantity <= 0) return 'This item is sold out right now.'
  if (inventoryQuantity <= 1) return 'Only 1 unit is left right now.'
  return `Only ${inventoryQuantity} units are left right now.`
}

function sizeStockHelperText(size: string, inventoryQuantity: number) {
  if (inventoryQuantity <= 0) return `Size ${size} is sold out right now.`
  if (inventoryQuantity <= 1) return `Only 1 unit is left in size ${size} right now.`
  return `Only ${inventoryQuantity} units are left in size ${size} right now.`
}

function defaultFulfillment(item: ItemDetail | null): FulfillmentOption | null {
  if (!item) return null
  if (item.pickupAvailable) return 'PICKUP'
  if (item.deliveryAvailable) return 'DELIVERY'
  if (item.shippingAvailable) return 'SHIPPING'
  return null
}

function fulfillmentLabel(value: FulfillmentOption | null) {
  if (value === 'PICKUP') return 'Pickup'
  if (value === 'DELIVERY') return 'Delivery'
  if (value === 'SHIPPING') return 'Shipping'
  return 'Choose'
}

export default function ReadyMadeCheckoutScreen() {
  const { itemId, returnTo } = useLocalSearchParams<{ itemId: string; returnTo?: string }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const [saving, setSaving] = useState(false)
  const [cancellationPolicyAcknowledged, setCancellationPolicyAcknowledged] = useState(false)
  const [checkoutInFlight, setCheckoutInFlight] = useState(false)
  const [checkoutItemSnapshot, setCheckoutItemSnapshot] = useState<ItemDetail | null>(null)
  const [selectedSize, setSelectedSize] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [fulfillment, setFulfillment] = useState<FulfillmentOption | null>(null)
  const [addressSearch, setAddressSearch] = useState('')
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [city, setCity] = useState('')
  const [stateRegion, setStateRegion] = useState('')
  const [postcode, setPostcode] = useState('')
  const [country, setCountry] = useState('')
  const [recipientMode, setRecipientMode] = useState<RecipientMode>('SELF')
  const [recipientName, setRecipientName] = useState('')
  const [recipientPhone, setRecipientPhone] = useState('')
  const [addressError, setAddressError] = useState('')
  const [recipientError, setRecipientError] = useState('')
  const [checkoutPricing, setCheckoutPricing] = useState<CheckoutPricingPreview | null>(null)
  const [pricingLoading, setPricingLoading] = useState(false)
  const [pricingError, setPricingError] = useState('')
  const suppressNextAddressLookup = useRef(false)
  const { data: item, isLoading, refetch } = useSellerItem(itemId)
  const { data: measurements } = useCustomerMeasurements(user?.id)
  const { startOrderPayment } = useOrderPaymentFlow()
  const { currency: accountCurrency, rates } = useCurrency()
  const activeItem = item ?? (checkoutInFlight ? checkoutItemSnapshot : null)

  useRefreshOnFocus(() => { void refetch() }, 0)

  function goBack() {
    goBackOrReturnToIfNeeded(router, navigation, returnTo, `/(customer)/tailor/item/${itemId}`)
  }

  useEffect(() => {
    if (!item) return
    const normalizedGuide = normalizeReadyMadeSizeGuide(item.sizeGuide, item.sizes)
    const recommendedSize = recommendReadyMadeSize({
      guide: normalizedGuide,
      measurements,
      sizes: item.sizes.filter((size) => quantityForSize(item.sizeInventory, size, item.inventoryQuantity) > 0),
    }).size
    setSelectedSize((current) => {
      if (current && quantityForSize(item.sizeInventory, current, item.inventoryQuantity) > 0) return current
      if (recommendedSize && quantityForSize(item.sizeInventory, recommendedSize, item.inventoryQuantity) > 0) return recommendedSize
      return item.sizes.find((size) => quantityForSize(item.sizeInventory, size, item.inventoryQuantity) > 0) ?? item.sizes[0] ?? ''
    })
    setFulfillment((current) => current ?? defaultFulfillment(item))
  }, [item, measurements])

  useEffect(() => {
    if (item) {
      setCheckoutItemSnapshot(item)
    }
  }, [item])

  useEffect(() => {
    if (!user) return
    if (recipientMode !== 'SELF') return
    setRecipientName(String(user.user_metadata?.display_name ?? '').trim())
    setRecipientPhone(normalizePhoneForStorage(String(user.user_metadata?.phone ?? '')))
  }, [user, recipientMode])

  useEffect(() => {
    const text = addressSearch.trim()
    setShowSuggestions(false)
    if (suppressNextAddressLookup.current) {
      suppressNextAddressLookup.current = false
      return
    }
    if (text.length < 5) {
      setAddressSuggestions([])
      return
    }

    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&addressdetails=1&limit=5`,
          { headers: { 'Accept-Language': 'en', 'User-Agent': 'Drape/1.0' } }
        )
        const data: any[] = await res.json()
        const filtered = data.filter((entry) => entry?.display_name && entry?.address)
        setAddressSuggestions(filtered)
        setShowSuggestions(filtered.length > 0)
      } catch {
        setAddressSuggestions([])
        setShowSuggestions(false)
      }
    }, 400)

    return () => clearTimeout(timeout)
  }, [addressSearch])

  function selectSuggestion(item: any) {
    const parsed = parseNominatimSuggestion(item)

    suppressNextAddressLookup.current = true
    setAddressSearch(parsed.displayValue)
    setAddressLine1(parsed.line1)
    setAddressLine2(parsed.line2)
    setCity(parsed.city)
    setStateRegion(parsed.stateRegion)
    setPostcode(parsed.postcode)
    setCountry(parsed.country)
    setAddressError('')
    setAddressSuggestions([])
    setShowSuggestions(false)
  }

  function composeAddress() {
    return composeStructuredAddress({
      line1: addressLine1,
      line2: addressLine2,
      city,
      stateRegion,
      postcode,
      country,
    })
  }

  function validateRecipientContact() {
    const trimmedName = recipientName.trim()
    const normalizedPhone = normalizePhoneForStorage(recipientPhone)
    if (!trimmedName) {
      setRecipientError('Enter the recipient name before continuing.')
      return false
    }
    const phoneError = validatePhoneForProfile(normalizedPhone)
    if (phoneError) {
      setRecipientError(phoneError)
      return false
    }
    setRecipientError('')
    return true
  }

  function validate() {
    if (!activeItem || !fulfillment) return false
    const selectedSizeInventory = selectedSize ? quantityForSize(activeItem.sizeInventory, selectedSize, activeItem.inventoryQuantity) : activeItem.inventoryQuantity
    if (activeItem.sizes.length > 0 && !selectedSize.trim()) {
      Alert.alert('Choose a size', 'Pick the size you want before continuing.')
      return false
    }
    if (activeItem.sizes.length > 0 && selectedSizeInventory <= 0) {
      Alert.alert('Size sold out', `Size ${selectedSize} is no longer available. Choose another size before continuing.`)
      return false
    }
    if (quantity < 1) {
      Alert.alert('Invalid quantity', 'Quantity must be at least 1.')
      return false
    }
    const maxQuantity = Math.min(MAX_READY_MADE_CHECKOUT_QUANTITY, selectedSizeInventory)
    if (maxQuantity < 1) {
      Alert.alert('Sold out', 'This item just sold out. Please go back and choose another piece.')
      return false
    }
    if (quantity > maxQuantity) {
      Alert.alert('Quantity limit', `For now, you can check out up to ${maxQuantity} unit${maxQuantity === 1 ? '' : 's'} for this item.`)
      return false
    }
    if (fulfillment !== 'PICKUP') {
      if (!addressLine1.trim() || !city.trim() || !stateRegion.trim() || !country.trim()) {
        setAddressError('Add the full delivery address before continuing. Street, city, region, and country are required.')
        return false
      }
      if (!validateRecipientContact()) {
        return false
      }
      setAddressError('')
    }
    return true
  }

  const selectedSizeInventory = activeItem
    ? quantityForSize(activeItem.sizeInventory, selectedSize || null, activeItem.inventoryQuantity)
    : 0
  const sellerUnavailable = activeItem ? activeItem.sellerAvailability === 'FULLY_BOOKED' || !activeItem.sellerLive : false
  const maxCheckoutQuantity = activeItem
    ? Math.min(MAX_READY_MADE_CHECKOUT_QUANTITY, activeItem.sizes.length > 0 ? selectedSizeInventory : activeItem.inventoryQuantity)
    : MAX_READY_MADE_CHECKOUT_QUANTITY
  const recipientPhoneHint = phoneHintForContext(country, activeItem?.sellerLocation)
  const sizeRecommendation = useMemo(
    () =>
      activeItem
        ? recommendReadyMadeSize({
            guide: normalizeReadyMadeSizeGuide(activeItem.sizeGuide, activeItem.sizes),
            measurements,
            sizes: activeItem.sizes.filter((size) => quantityForSize(activeItem.sizeInventory, size, activeItem.inventoryQuantity) > 0),
          })
        : null,
    [activeItem, measurements],
  )

  useEffect(() => {
    if (!activeItem) return
    const nextLimit = Math.max(1, maxCheckoutQuantity)
    setQuantity((current) => Math.min(current, nextLimit))
  }, [activeItem, maxCheckoutQuantity])

  useEffect(() => {
    let cancelled = false

    async function loadPricingPreview() {
      if (!activeItem || !fulfillment) {
        setCheckoutPricing(null)
        setPricingError('')
        setPricingLoading(false)
        return
      }

      if (sellerUnavailable) {
        setCheckoutPricing(null)
        setPricingError('This seller is not accepting new ready-made orders right now. Save the item and check back later.')
        setPricingLoading(false)
        return
      }

      if (activeItem.sizes.length > 0 && !selectedSize.trim()) {
        setCheckoutPricing(null)
        setPricingError('')
        setPricingLoading(false)
        return
      }

      const needsAddress = fulfillment !== 'PICKUP'
      const composedAddress = needsAddress ? composeAddress() : ''
      const trimmedCity = city.trim()
      const trimmedRegion = stateRegion.trim()
      const trimmedPostalCode = postcode.trim()
      const trimmedCountry = country.trim()

      if (needsAddress && (!addressLine1.trim() || !trimmedCity || !trimmedRegion || !trimmedCountry)) {
        setCheckoutPricing(null)
        setPricingError('Add the full delivery address to see your locked tax and total.')
        setPricingLoading(false)
        return
      }

      setPricingLoading(true)
      setPricingError('')

      try {
        const { data, error } = await invokeFunction<{
          ok: boolean
          pricing?: CheckoutPricingPreview
        }>('ready-made-order-action', {
          body: {
            action: 'preview-checkout',
            sellerItemId: activeItem.id,
            size: selectedSize.trim() || undefined,
            quantity,
            fulfillment,
            address: needsAddress ? composedAddress : undefined,
            city: needsAddress ? trimmedCity : undefined,
            region: needsAddress ? trimmedRegion : undefined,
            postalCode: needsAddress ? trimmedPostalCode || undefined : undefined,
            countryCode: needsAddress ? trimmedCountry : undefined,
          },
        })

        if (cancelled) return

        if (error || !data?.pricing) {
          const message = await readFunctionErrorMessage(
            error,
            'We could not calculate tax and totals for this checkout right now.',
          )
          setCheckoutPricing(null)
          setPricingError(message)
          setPricingLoading(false)
          return
        }

        setCheckoutPricing(data.pricing)
        setPricingError('')
      } catch {
        if (cancelled) return
        setCheckoutPricing(null)
        setPricingError('We could not calculate tax and totals for this checkout right now.')
      } finally {
        if (!cancelled) {
          setPricingLoading(false)
        }
      }
    }

    const timeout = setTimeout(() => {
      void loadPricingPreview()
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [
    activeItem,
    sellerUnavailable,
    fulfillment,
    selectedSize,
    quantity,
    addressLine1,
    addressLine2,
    city,
    stateRegion,
    postcode,
    country,
  ])

  async function createOrder() {
    if (!user?.id || !activeItem || !fulfillment || saving) return
    if (sellerUnavailable) {
      Alert.alert('Seller unavailable', 'This seller is not accepting new ready-made orders right now. Save the item and check back later.')
      return
    }
    if (!validate()) return

    setCheckoutInFlight(true)
    setCheckoutItemSnapshot(activeItem)
    setSaving(true)
    try {
      const { data, error } = await invokeFunction<{ ok: boolean; orderId?: string }>('ready-made-order-action', {
        body: {
          action: 'create-checkout',
          sellerItemId: activeItem.id,
          size: selectedSize || undefined,
          quantity,
          fulfillment,
          address: fulfillment === 'PICKUP' ? undefined : composeAddress(),
          city: fulfillment === 'PICKUP' ? undefined : city.trim(),
          region: fulfillment === 'PICKUP' ? undefined : stateRegion.trim(),
          postalCode: fulfillment === 'PICKUP' ? undefined : postcode.trim() || undefined,
          countryCode: fulfillment === 'PICKUP' ? undefined : country.trim(),
          recipientName: fulfillment === 'PICKUP' ? undefined : recipientName.trim(),
          recipientPhone: fulfillment === 'PICKUP' ? undefined : normalizePhoneForStorage(recipientPhone),
          cancellationPolicyAcknowledged,
        },
      })

      if (error || !data?.orderId) {
        const errorPayload = await readFunctionErrorPayload(error)
        const existingOrderId =
          typeof errorPayload?.orderId === 'string' && errorPayload.orderId.length > 0
            ? errorPayload.orderId
            : null
        const errorMessage = await readFunctionErrorMessage(error, 'Could not create this order right now.')

        if (existingOrderId) {
          Alert.alert('Checkout already saved', errorMessage)
          router.replace({
            pathname: '/(customer)/orders/[id]',
            params: { id: existingOrderId, tab: 'active' },
          })
          return
        }

        setCheckoutInFlight(false)
        Alert.alert('Checkout failed', errorMessage)
        return
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.sellerItem(activeItem.id) }),
        queryClient.invalidateQueries({ queryKey: qk.tailorShop(activeItem.tailorProfileId) }),
      ])

      const paymentResult = await startOrderPayment({
        orderId: data.orderId,
        customerEmail: user?.email,
      })

      if (!paymentResult.ok) {
        if (paymentResult.reason === 'cancelled') {
          Alert.alert('Payment not finished', 'Your checkout is still saved. Finish payment from the order screen any time.')
        } else if (paymentResult.stage === 'PAYMENT_FAILED') {
          Alert.alert('Checkout failed', `${paymentResult.message}\n\nRetry from the order screen within 2 hours to keep this checkout alive.`)
        } else {
          Alert.alert('Payment unavailable', paymentResult.message)
        }

        router.replace({
          pathname: '/(customer)/orders/[id]',
          params: { id: data.orderId, tab: 'active' },
        })
        return
      }

      router.replace({
        pathname: '/(customer)/orders/[id]',
        params: { id: data.orderId, tab: 'active', placed: '1' },
      })
    } catch (error) {
      setCheckoutInFlight(false)
      Sentry.captureException(error, { extra: { context: 'ready_made_checkout_create', itemId: activeItem.id } })
      Alert.alert(
        'Checkout unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your card has not been charged. Retry checkout when the signal improves.'
          : 'Something went wrong before payment could finish. Your card has not been charged. Please try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.headerBackButton}>
            <Feather name="arrow-left" size={20} color={CHARCOAL} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Checkout</Text>
          <View style={styles.headerSpacer} />
        </View>

        {isLoading && !activeItem ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateText}>Loading checkout…</Text>
          </View>
        ) : !activeItem ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>Item unavailable</Text>
            <Text style={styles.stateText}>This piece is no longer available right now.</Text>
            <Button label="Back to seller" variant="secondary" onPress={goBack} />
          </View>
        ) : (
          <>
            <View style={styles.summaryCard}>
              <Text style={styles.sellerName}>{activeItem.sellerName}</Text>
              <Text style={styles.itemTitle}>{activeItem.title}</Text>
              <Text style={styles.stockSummary}>
                {activeItem.sizes.length > 0 && selectedSize
                  ? sizeStockHelperText(selectedSize, selectedSizeInventory)
                  : stockHelperText(activeItem.inventoryQuantity)}
              </Text>
              <Text style={styles.itemPrice}>{formatAmount(activeItem.priceAmount, activeItem.currency as CurrencyCode, activeItem.currency as CurrencyCode, rates)}</Text>
              {activeItem.currency !== accountCurrency ? (
                <Text style={styles.stockSummary}>
                  Approx. {formatAmount(activeItem.priceAmount, activeItem.currency as CurrencyCode, accountCurrency, rates)} in your display currency. Checkout uses the seller's currency.
                </Text>
              ) : null}
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>Before you pay</Text>
              <Text style={styles.infoBody}>{READY_MADE_CHECKOUT_REMINDER}</Text>
            </View>

            {sellerUnavailable ? (
              <View style={styles.blockerCard}>
                <Text style={styles.blockerTitle}>Seller unavailable</Text>
                <Text style={styles.blockerBody}>
                  {activeItem.sellerName} is not accepting new ready-made orders right now. Save this item and check back later.
                </Text>
              </View>
            ) : null}

            {activeItem.sizes.length > 0 ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Choose size</Text>
                {sizeRecommendation?.status === 'RECOMMENDED' || sizeRecommendation?.status === 'BETWEEN' ? (
                  <View style={styles.recommendationCard}>
                    <Text style={styles.recommendationLabel}>{sizeRecommendation.summary}</Text>
                    <Text style={styles.recommendationDetail}>{sizeRecommendation.detail}</Text>
                  </View>
                ) : null}
                {sizeRecommendation?.status === 'MISSING_MEASUREMENTS' ? (
                  <View style={styles.recommendationCard}>
                    <Text style={styles.recommendationLabel}>{sizeRecommendation.summary}</Text>
                    <Text style={styles.recommendationDetail}>{sizeRecommendation.detail}</Text>
                    <Button
                      label="Add measurements"
                      variant="secondary"
                      onPress={() => router.push('/(customer)/profile/measurements')}
                    />
                  </View>
                ) : null}
                {sizeRecommendation?.status === 'MISSING_GUIDE' ? (
                  <View style={styles.recommendationCard}>
                    <Text style={styles.recommendationLabel}>Seller fit guide missing</Text>
                    <Text style={styles.recommendationDetail}>
                      There is no size recommendation for this item yet, so choose your size manually or ask the seller before you pay.
                    </Text>
                  </View>
                ) : null}
                <View style={styles.optionWrap}>
                  {activeItem.sizes.map((size) => (
                    <TouchableOpacity
                      key={size}
                      style={[
                        styles.pill,
                        selectedSize === size && styles.pillActive,
                        quantityForSize(activeItem.sizeInventory, size, activeItem.inventoryQuantity) <= 0 && styles.pillDisabled,
                      ]}
                      onPress={() => {
                        if (quantityForSize(activeItem.sizeInventory, size, activeItem.inventoryQuantity) <= 0) return
                        setSelectedSize(size)
                      }}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          selectedSize === size && styles.pillTextActive,
                          quantityForSize(activeItem.sizeInventory, size, activeItem.inventoryQuantity) <= 0 && styles.pillTextDisabled,
                        ]}
                      >
                        {size} · {quantityForSize(activeItem.sizeInventory, size, activeItem.inventoryQuantity)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Quantity</Text>
              <View style={styles.quantityRow}>
                <TouchableOpacity style={styles.quantityBtn} onPress={() => setQuantity((value) => Math.max(1, value - 1))}>
                  <Text style={styles.quantityBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.quantityValue}>{quantity}</Text>
                <TouchableOpacity style={styles.quantityBtn} onPress={() => setQuantity((value) => Math.min(Math.max(1, maxCheckoutQuantity), value + 1))}>
                  <Text style={styles.quantityBtnText}>+</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.helperText}>
                {activeItem.sizes.length > 0 && selectedSize
                  ? sizeStockHelperText(selectedSize, selectedSizeInventory)
                  : stockHelperText(activeItem.inventoryQuantity)} Up to {maxCheckoutQuantity} unit{maxCheckoutQuantity === 1 ? '' : 's'} per checkout for now.
              </Text>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>How you’ll get it</Text>
              <View style={styles.choiceGroup}>
                {activeItem.pickupAvailable ? (
                  <ChoiceCard title="Pickup" hint="Collect directly from the seller." active={fulfillment === 'PICKUP'} onPress={() => setFulfillment('PICKUP')} />
                ) : null}
                {activeItem.deliveryAvailable ? (
                  <ChoiceCard title="Delivery" hint="Seller or team delivers nearby." active={fulfillment === 'DELIVERY'} onPress={() => setFulfillment('DELIVERY')} />
                ) : null}
                {activeItem.shippingAvailable ? (
                  <ChoiceCard title="Shipping" hint="Courier handles it." active={fulfillment === 'SHIPPING'} onPress={() => setFulfillment('SHIPPING')} />
                ) : null}
              </View>
              {fulfillment === 'PICKUP' ? (
                <Text style={styles.helperText}>
                  Exact pickup details are shared only after the seller marks the order ready for collection.
                </Text>
              ) : null}
            </View>

            {fulfillment !== 'PICKUP' ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Who should receive it?</Text>
                <View style={styles.choiceGroup}>
                  <ChoiceCard
                    title="I will receive it"
                    hint="Use your own name and phone for delivery or shipping."
                    active={recipientMode === 'SELF'}
                    onPress={() => setRecipientMode('SELF')}
                  />
                  <ChoiceCard
                    title="Someone else will receive it"
                    hint="Enter the other person's name and phone so the courier reaches the right person."
                    active={recipientMode === 'OTHER'}
                    onPress={() => setRecipientMode('OTHER')}
                  />
                </View>
                <TextInput
                  style={styles.input}
                  value={recipientName}
                  onChangeText={(value) => {
                    setRecipientName(value)
                    if (recipientError) setRecipientError('')
                  }}
                  placeholder={recipientMode === 'SELF' ? 'Your name' : 'Recipient name'}
                  placeholderTextColor={Colors.midGrey}
                />
                <TextInput
                  style={styles.input}
                  value={recipientPhone}
                  onChangeText={(value) => {
                    setRecipientPhone(normalizePhoneForStorage(value))
                    if (recipientError) setRecipientError('')
                  }}
                  placeholder={recipientMode === 'SELF' ? 'Your phone, e.g. +234... or +44...' : 'Recipient phone, e.g. +234... or +44...'}
                  placeholderTextColor={Colors.midGrey}
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                />
                <Text style={styles.helperText}>
                  {recipientMode === 'SELF'
                    ? `This is the number the courier or rider will use if they need you. ${recipientPhoneHint}`
                    : `The courier or rider may call this person directly. ${recipientPhoneHint}`}
                </Text>
                <TextInput
                  style={styles.input}
                  value={addressSearch}
                  onChangeText={(value) => {
                    setAddressSearch(value)
                    if (addressError) setAddressError('')
                  }}
                  placeholder="Search address, area, or landmark"
                  placeholderTextColor={Colors.midGrey}
                />
                {showSuggestions ? (
                  <View style={styles.suggestionsCard}>
                    {addressSuggestions.map((suggestion, index) => (
                      <TouchableOpacity
                        key={`${suggestion.place_id ?? suggestion.display_name}-${index}`}
                        style={[styles.suggestionRow, index === addressSuggestions.length - 1 && styles.suggestionRowLast]}
                        onPress={() => selectSuggestion(suggestion)}
                      >
                        <Text style={styles.suggestionText}>{suggestion.display_name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
                <Text style={styles.helperText}>
                  Search first if you can. If the map suggestion is not quite right, type the address manually using street, area, city, region, and country. Landmarks are okay in address line 2.
                </Text>
                <TextInput style={styles.input} value={addressLine1} onChangeText={setAddressLine1} placeholder="Address line 1" placeholderTextColor={Colors.midGrey} />
                <TextInput style={styles.input} value={addressLine2} onChangeText={setAddressLine2} placeholder="Address line 2 (optional)" placeholderTextColor={Colors.midGrey} />
                <View style={styles.inlineRow}>
                  <TextInput style={[styles.input, styles.inlineInput]} value={city} onChangeText={setCity} placeholder="City" placeholderTextColor={Colors.midGrey} />
                  <TextInput style={[styles.input, styles.inlineInput]} value={stateRegion} onChangeText={setStateRegion} placeholder="State / region" placeholderTextColor={Colors.midGrey} />
                </View>
                <View style={styles.inlineRow}>
                  <TextInput style={[styles.input, styles.inlineInput]} value={postcode} onChangeText={setPostcode} placeholder="Postcode / ZIP (optional)" placeholderTextColor={Colors.midGrey} />
                  <TextInput style={[styles.input, styles.inlineInput]} value={country} onChangeText={setCountry} placeholder="Country" placeholderTextColor={Colors.midGrey} />
                </View>
                {recipientError ? <Text style={styles.errorText}>{recipientError}</Text> : null}
                {addressError ? <Text style={styles.errorText}>{addressError}</Text> : null}
              </View>
            ) : null}

            <View style={styles.breakdownCard}>
              <Text style={styles.sectionTitle}>Order summary</Text>
              <SummaryRow label="Fulfillment" value={fulfillmentLabel(fulfillment)} />
              {fulfillment !== 'PICKUP' && recipientName.trim() ? (
                <SummaryRow label={recipientMode === 'SELF' ? 'Receiving contact' : 'Recipient'} value={recipientName.trim()} />
              ) : null}
              {fulfillment !== 'PICKUP' && recipientPhone.trim() ? (
                <SummaryRow label="Contact phone" value={normalizePhoneForStorage(recipientPhone)} />
              ) : null}
              {pricingLoading && !checkoutPricing ? (
                <View style={styles.pricingStateRow}>
                  <ActivityIndicator size="small" color={PRIMARY_GREEN} />
                  <Text style={styles.helperText}>Calculating tax and locked total…</Text>
                </View>
              ) : pricingError ? (
                <Text style={styles.errorText}>{pricingError}</Text>
              ) : checkoutPricing ? (
                <>
                  <SummaryRow
                    label="Item subtotal"
                    value={formatAmount(checkoutPricing.subtotalAmount, checkoutPricing.currency, checkoutPricing.currency, rates)}
                  />
                  <SummaryRow
                    label={fulfillment === 'DELIVERY' ? 'Standard delivery fee' : fulfillment === 'SHIPPING' ? 'Standard shipping fee' : 'Pickup fee'}
                    value={checkoutPricing.shippingAmount > 0
                      ? formatAmount(checkoutPricing.shippingAmount, checkoutPricing.currency, checkoutPricing.currency, rates)
                      : 'Free'}
                  />
                  <SummaryRow
                    label={checkoutPricing.taxLabel}
                    value={formatAmount(checkoutPricing.taxAmount, checkoutPricing.currency, checkoutPricing.currency, rates)}
                  />
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Total</Text>
                    <Text style={styles.totalValue}>
                      {formatAmount(checkoutPricing.totalAmount, checkoutPricing.currency, checkoutPricing.currency, rates)}
                    </Text>
                  </View>
                  {checkoutPricing.taxFallback ? (
                    <Text style={styles.helperText}>
                      Tax was estimated because live tax lookup was unavailable for this address.
                    </Text>
                  ) : null}
                  {paymentRouteCopyForCurrency(checkoutPricing.currency) ? (
                    <Text style={styles.helperText}>
                      {paymentRouteCopyForCurrency(checkoutPricing.currency)}
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text style={styles.helperText}>
                  Add the final checkout details above to see the locked tax and total before you pay.
                </Text>
              )}
            </View>

            <View style={styles.bestUseCard}>
              <Text style={styles.bestUseEyebrow}>Best use</Text>
              <Text style={styles.bestUseText}>
                {fulfillment === 'PICKUP'
                  ? 'Pickup has no delivery fee, but tax can still apply based on the order location. Pickup details stay private until the seller marks the order ready. Bring your collection code and inspect the item before closing the order.'
                  : 'Drape collects the standard delivery or shipping fee in this checkout. Carrier surcharges, customs, or import duties are not charged automatically; if anything extra is needed, Drape will ask you to approve it before dispatch.'}
              </Text>
            </View>

            <View style={styles.policyCard}>
              <Text style={styles.policyTitle}>Returns and remedies</Text>
              <View style={styles.policyList}>
                {READY_MADE_POLICY_ROWS.map((row) => (
                  <View key={row.title} style={styles.policyRow}>
                    <Text style={styles.policyRowTitle}>{row.title}</Text>
                    <Text style={styles.policyRowBody}>{row.body}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.policyCard}>
              <Text style={styles.policyTitle}>Cancellation policy</Text>
              <View style={styles.policyList}>
                {ORDER_CANCELLATION_POLICY_ROWS.map((row) => (
                  <View key={row.title} style={styles.policyRow}>
                    <Text style={styles.policyRowTitle}>{row.title}</Text>
                    <Text style={styles.policyRowBody}>{row.body}</Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity
                style={[
                  styles.policyAckRow,
                  cancellationPolicyAcknowledged && styles.policyAckRowActive,
                ]}
                onPress={() => setCancellationPolicyAcknowledged((value) => !value)}
                activeOpacity={0.75}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: cancellationPolicyAcknowledged }}
                accessibilityLabel="Acknowledge cancellation policy"
              >
                <View style={[styles.policyCheck, cancellationPolicyAcknowledged && styles.policyCheckActive]}>
                  <Text style={styles.policyCheckText}>{cancellationPolicyAcknowledged ? '✓' : ''}</Text>
                </View>
                <Text style={styles.policyAckText}>{ORDER_CANCELLATION_ACK_COPY}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>

      {activeItem ? (
        <View style={styles.footer}>
          <Button
            label={saving ? 'Preparing payment…' : 'Pay now'}
            size="md"
            onPress={createOrder}
            disabled={
              saving
              || pricingLoading
              || !checkoutPricing
              || !!pricingError
              || !fulfillment
              || sellerUnavailable
              || !cancellationPolicyAcknowledged
              || (activeItem.sizes.length > 0 && selectedSizeInventory <= 0)
            }
          />
        </View>
      ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function ChoiceCard({ title, hint, active, onPress }: { title: string; hint: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.choiceCard, active && styles.choiceCardActive]} onPress={onPress}>
      <Text style={[styles.choiceTitle, active && styles.choiceTitleActive]}>{title}</Text>
      <Text style={styles.choiceHint}>{hint}</Text>
    </TouchableOpacity>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: HOME_BG },
  keyboardAvoider: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.sm, paddingBottom: Spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 44 },
  headerBackButton: {
    width: 44,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerSpacer: { width: 44, height: 44 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: FontWeight.semibold, color: CHARCOAL, fontFamily: 'Georgia' },
  stateCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: Spacing.lg, gap: Spacing.sm, alignItems: 'center', ...Shadow.sm },
  stateTitle: { fontSize: 16, fontWeight: FontWeight.semibold, color: CHARCOAL, fontFamily: 'Georgia' },
  stateText: { fontSize: 13, color: Colors.inkLight, textAlign: 'center', lineHeight: 18 },
  summaryCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 12, gap: 4, ...Shadow.sm },
  sellerName: { fontSize: 13, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold },
  itemTitle: { fontSize: 24, lineHeight: 28, fontWeight: FontWeight.bold, color: CHARCOAL, fontFamily: 'Georgia' },
  stockSummary: { fontSize: 12, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold },
  itemPrice: { marginTop: 2, fontSize: 22, color: PRIMARY_GREEN, fontWeight: FontWeight.bold, fontFamily: 'Georgia' },
  infoCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 12, gap: 4, ...Shadow.sm },
  infoTitle: { fontSize: 15, fontWeight: FontWeight.semibold, color: CHARCOAL, fontFamily: 'Georgia' },
  infoBody: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  blockerCard: { backgroundColor: Colors.errorLight, borderRadius: Radius.md, padding: 12, gap: 4, ...Shadow.sm },
  blockerTitle: { fontSize: 15, fontWeight: FontWeight.semibold, color: Colors.error, fontFamily: 'Georgia' },
  blockerBody: { fontSize: 13, color: Colors.error, lineHeight: 18 },
  sectionCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 12, gap: 8, ...Shadow.sm },
  sectionTitle: { fontSize: 15, fontWeight: FontWeight.semibold, color: CHARCOAL, fontFamily: 'Georgia' },
  recommendationCard: {
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.md,
    padding: 12,
    gap: 4,
  },
  recommendationLabel: { fontSize: 13, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold },
  recommendationDetail: { fontSize: 12, color: Colors.inkLight, lineHeight: 16 },
  helperText: { fontSize: 12, color: MUTED_GREY, lineHeight: 16 },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.full,
    backgroundColor: HOME_BG,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    justifyContent: 'center',
  },
  pillActive: { backgroundColor: Colors.needleGreenLight, borderColor: PRIMARY_GREEN },
  pillDisabled: { opacity: 0.5 },
  pillText: { fontSize: 13, color: Colors.inkLight, fontWeight: FontWeight.medium },
  pillTextActive: { color: PRIMARY_GREEN },
  pillTextDisabled: { color: MUTED_GREY },
  quantityRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  quantityBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: HOME_BG, alignItems: 'center', justifyContent: 'center' },
  quantityBtnText: { fontSize: 22, color: CHARCOAL, fontWeight: FontWeight.semibold },
  quantityValue: { minWidth: 28, textAlign: 'center', fontSize: 16, fontWeight: FontWeight.semibold, color: CHARCOAL },
  choiceGroup: { gap: 8 },
  choiceCard: { backgroundColor: HOME_BG, borderRadius: Radius.md, padding: 12, gap: 4, borderWidth: 1, borderColor: Colors.lightGrey, minHeight: 64 },
  choiceCardActive: { borderColor: PRIMARY_GREEN, backgroundColor: Colors.needleGreenLight },
  choiceTitle: { fontSize: 14, fontWeight: FontWeight.semibold, color: CHARCOAL, fontFamily: 'Georgia' },
  choiceTitleActive: { color: PRIMARY_GREEN },
  choiceHint: { fontSize: 12, color: MUTED_GREY, lineHeight: 16 },
  input: {
    backgroundColor: HOME_BG,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: CHARCOAL,
    fontSize: 14,
    minHeight: 44,
  },
  inlineRow: { flexDirection: 'row', gap: 8 },
  inlineInput: { flex: 1 },
  suggestionsCard: { backgroundColor: Colors.white, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.lightGrey, overflow: 'hidden' },
  suggestionRow: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.lightGrey, minHeight: 44, justifyContent: 'center' },
  suggestionRowLast: { borderBottomWidth: 0 },
  suggestionText: { fontSize: 13, color: CHARCOAL },
  errorText: { fontSize: 12, color: Colors.error, marginTop: 2 },
  breakdownCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 12, gap: 8, ...Shadow.sm },
  pricingStateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontSize: 13, color: MUTED_GREY },
  summaryValue: { fontSize: 13, color: CHARCOAL, fontWeight: FontWeight.medium },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: Colors.lightGrey },
  totalLabel: { fontSize: 15, color: CHARCOAL, fontWeight: FontWeight.semibold },
  totalValue: { fontSize: 15, color: PRIMARY_GREEN, fontWeight: FontWeight.bold, fontFamily: 'Georgia' },
  bestUseCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 12, gap: 4, ...Shadow.sm },
  bestUseEyebrow: { fontSize: 11, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  bestUseText: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  policyCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 12, gap: 8, ...Shadow.sm },
  policyTitle: { fontSize: 15, fontWeight: FontWeight.semibold, color: CHARCOAL, fontFamily: 'Georgia' },
  policyList: { gap: 8 },
  policyRow: { gap: 4 },
  policyRowTitle: { fontSize: 13, fontWeight: FontWeight.semibold, color: CHARCOAL },
  policyRowBody: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  policyAckRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 4,
    padding: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: HOME_BG,
    minHeight: 52,
  },
  policyAckRowActive: { borderColor: PRIMARY_GREEN, backgroundColor: Colors.needleGreenLight },
  policyCheck: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: MUTED_GREY,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  policyCheckActive: { borderColor: PRIMARY_GREEN, backgroundColor: PRIMARY_GREEN },
  policyCheckText: { fontSize: 13, color: Colors.textInverse, fontWeight: FontWeight.bold },
  policyAckText: { flex: 1, fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
  },
})
