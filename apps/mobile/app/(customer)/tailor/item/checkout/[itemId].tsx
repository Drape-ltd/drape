import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, TextInput } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { qk, useCustomerMeasurements, useRefreshOnFocus, useSellerItem } from '@/lib/queries'
import { quantityForSize } from '@/lib/ready-made-stock'
import { readFunctionErrorPayload } from '@/lib/function-errors'
import { composeStructuredAddress, parseNominatimSuggestion } from '@/lib/address'
import { invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui'
import { normalizePhoneForStorage, validatePhoneForProfile } from '@drape/shared/phone'
import { phoneHintForContext } from '@/lib/phone-context'
import { resolveDrapeManagedFulfillmentFee } from '@drape/shared'
import { READY_MADE_CHECKOUT_REMINDER, READY_MADE_POLICY_ROWS } from '@/lib/ready-made-policy'
import {
  normalizeReadyMadeSizeGuide,
  recommendReadyMadeSize,
} from '@/lib/ready-made-fit'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { useOrderPaymentFlow } from '@/lib/payments'
import { queryClient } from '@/lib/queryClient'
import type { SellerItemDetail as ItemDetail } from '@/lib/queries'

type FulfillmentOption = 'PICKUP' | 'DELIVERY' | 'SHIPPING'
type RecipientMode = 'SELF' | 'OTHER'

const MAX_READY_MADE_CHECKOUT_QUANTITY = 3
const HOME_BG = '#F9F7F3'
const PRIMARY_GREEN = '#1D9E75'
const CHARCOAL = '#2C2C2A'
const MUTED_GREY = '#8F8D88'

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
  const suppressNextAddressLookup = useRef(false)
  const { data: item, isLoading, refetch } = useSellerItem(itemId)
  const { data: measurements } = useCustomerMeasurements(user?.id)
  const { startOrderPayment } = useOrderPaymentFlow()
  const activeItem = item ?? (checkoutInFlight ? checkoutItemSnapshot : null)

  useRefreshOnFocus(() => { void refetch() }, 0)

  function goBack() {
    if (returnTo) {
      router.replace(returnTo as any)
    } else if (navigation.canGoBack()) router.back()
    else router.replace(`/(customer)/tailor/item/${itemId}`)
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

  const subtotal = useMemo(() => (activeItem ? activeItem.priceAmount * quantity : 0), [activeItem, quantity])
  const fulfillmentFee = useMemo(() => {
    if (!activeItem || !fulfillment) return 0
    return resolveDrapeManagedFulfillmentFee({
      fulfillment,
      orderCurrency: activeItem.currency as 'USD' | 'GBP' | 'EUR' | 'NGN' | 'GHS' | 'KES' | 'CAD',
      sellerLocation: activeItem.sellerLocation,
      destinationAddress: fulfillment === 'PICKUP' ? null : composeAddress(),
    }).feeMinorUnits
  }, [fulfillment, activeItem, addressLine1, addressLine2, city, stateRegion, postcode, country])
  const projectedTotal = subtotal + fulfillmentFee
  const selectedSizeInventory = activeItem
    ? quantityForSize(activeItem.sizeInventory, selectedSize || null, activeItem.inventoryQuantity)
    : 0
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

  async function createOrder() {
    if (!user?.id || !activeItem || !fulfillment || saving) return
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
          recipientName: fulfillment === 'PICKUP' ? undefined : recipientName.trim(),
          recipientPhone: fulfillment === 'PICKUP' ? undefined : normalizePhoneForStorage(recipientPhone),
        },
      })

      if (error || !data?.orderId) {
        const errorPayload = await readFunctionErrorPayload(error)
        const existingOrderId =
          typeof errorPayload?.orderId === 'string' && errorPayload.orderId.length > 0
            ? errorPayload.orderId
            : null
        const errorMessage =
          typeof errorPayload?.error === 'string' && errorPayload.error.length > 0
            ? errorPayload.error
            : error?.message ?? 'Could not create this order right now.'

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
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
              <Text style={styles.itemPrice}>{activeItem.currency} {(activeItem.priceAmount / 100).toFixed(2)}</Text>
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>Before you pay</Text>
              <Text style={styles.infoBody}>{READY_MADE_CHECKOUT_REMINDER}</Text>
            </View>

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
              <SummaryRow label="Item subtotal" value={`${activeItem.currency} ${(subtotal / 100).toFixed(2)}`} />
              <SummaryRow label="Fulfillment" value={fulfillmentLabel(fulfillment)} />
              {fulfillment !== 'PICKUP' && recipientName.trim() ? (
                <SummaryRow label={recipientMode === 'SELF' ? 'Receiving contact' : 'Recipient'} value={recipientName.trim()} />
              ) : null}
              {fulfillment !== 'PICKUP' && recipientPhone.trim() ? (
                <SummaryRow label="Contact phone" value={normalizePhoneForStorage(recipientPhone)} />
              ) : null}
              <SummaryRow
                label={fulfillment === 'DELIVERY' ? 'Delivery fee' : fulfillment === 'SHIPPING' ? 'Shipping fee' : 'Fulfillment fee'}
                value={fulfillmentFee > 0 ? `${activeItem.currency} ${(fulfillmentFee / 100).toFixed(2)}` : 'Free'}
              />
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>{activeItem.currency} {(projectedTotal / 100).toFixed(2)}</Text>
              </View>
            </View>

            <View style={styles.bestUseCard}>
              <Text style={styles.bestUseEyebrow}>Best use</Text>
              <Text style={styles.bestUseText}>
                Drape collects the standard delivery or shipping fee in this checkout, then handles dispatch after the seller marks the order ready.
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
          </>
        )}
      </ScrollView>

      {activeItem ? (
        <View style={styles.footer}>
          <Button
            label={saving ? 'Preparing payment…' : 'Pay now'}
            size="md"
            onPress={createOrder}
            disabled={saving || !fulfillment || (activeItem.sizes.length > 0 && selectedSizeInventory <= 0)}
          />
        </View>
      ) : null}
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
  scroll: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.md, paddingBottom: Spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 44 },
  headerBackButton: {
    width: 44,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerSpacer: { width: 44, height: 44 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: FontWeight.semibold, color: CHARCOAL },
  stateCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: Spacing.lg, gap: Spacing.sm, alignItems: 'center', ...Shadow.sm },
  stateTitle: { fontSize: 16, fontWeight: FontWeight.semibold, color: CHARCOAL },
  stateText: { fontSize: 13, color: Colors.inkLight, textAlign: 'center', lineHeight: 18 },
  summaryCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, gap: 4, ...Shadow.sm },
  sellerName: { fontSize: 13, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold },
  itemTitle: { fontSize: 28, lineHeight: 32, fontWeight: FontWeight.bold, color: CHARCOAL },
  stockSummary: { fontSize: 12, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold },
  itemPrice: { marginTop: 2, fontSize: 22, color: PRIMARY_GREEN, fontWeight: FontWeight.bold },
  infoCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, gap: 4, ...Shadow.sm },
  infoTitle: { fontSize: 15, fontWeight: FontWeight.semibold, color: CHARCOAL },
  infoBody: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  sectionCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, gap: 8, ...Shadow.sm },
  sectionTitle: { fontSize: 15, fontWeight: FontWeight.semibold, color: CHARCOAL },
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
  choiceCard: { backgroundColor: HOME_BG, borderRadius: Radius.md, padding: 12, gap: 4, borderWidth: 1.5, borderColor: Colors.lightGrey, minHeight: 72 },
  choiceCardActive: { borderColor: PRIMARY_GREEN, backgroundColor: Colors.needleGreenLight },
  choiceTitle: { fontSize: 14, fontWeight: FontWeight.semibold, color: CHARCOAL },
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
  breakdownCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, gap: 8, ...Shadow.sm },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontSize: 13, color: MUTED_GREY },
  summaryValue: { fontSize: 13, color: CHARCOAL, fontWeight: FontWeight.medium },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: Colors.lightGrey },
  totalLabel: { fontSize: 15, color: CHARCOAL, fontWeight: FontWeight.semibold },
  totalValue: { fontSize: 15, color: PRIMARY_GREEN, fontWeight: FontWeight.bold },
  bestUseCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, gap: 4, ...Shadow.sm },
  bestUseEyebrow: { fontSize: 11, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  bestUseText: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  policyCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, gap: 8, ...Shadow.sm },
  policyTitle: { fontSize: 15, fontWeight: FontWeight.semibold, color: CHARCOAL },
  policyList: { gap: 8 },
  policyRow: { gap: 4 },
  policyRowTitle: { fontSize: 13, fontWeight: FontWeight.semibold, color: CHARCOAL },
  policyRowBody: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
  },
})
