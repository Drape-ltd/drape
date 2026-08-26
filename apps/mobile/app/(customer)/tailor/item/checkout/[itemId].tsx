import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { qk, useCustomerMeasurements, useRefreshOnFocus, useSellerItem } from '@/lib/queries'
import { quantityForSize } from '@/lib/ready-made-stock'
import {
  isLikelyConnectivityIssue,
  readFunctionErrorMessage,
  readFunctionErrorPayload,
} from '@/lib/function-errors'
import { composeStructuredAddress } from '@/lib/address'
import { invokeFunction, supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import {
  Button,
  AddressAutocompleteInput,
  ChoiceSheet,
  DisclosureSection,
  DrapeCapsuleButton,
  DrapeFloatingActionDock,
  DRAPE_FLOATING_ACTION_DOCK_CLEARANCE,
  PhoneNumberInput,
} from '@/components/ui'
import { useDrapeCapsuleNavScroll } from '@/components/ui/DrapeCapsuleNav'
import { appendToHistory, goBackOrReturnTo, pickSafeReturnTo, resetTo } from '@/lib/navigation'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { useKeyboardState } from '@/lib/useKeyboardState'
import { normalizePhoneForStorage, validatePhoneForProfile } from '@drape/shared/phone'
import {
  ORDER_CANCELLATION_ACK_COPY,
  ORDER_CANCELLATION_POLICY_ROWS,
} from '@drape/shared/checkout-policy'
import { phoneHintForContext } from '@/lib/phone-context'
import { READY_MADE_CHECKOUT_REMINDER, READY_MADE_POLICY_ROWS } from '@/lib/ready-made-policy'
import { normalizeReadyMadeSizeGuide, recommendReadyMadeSize } from '@/lib/ready-made-fit'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { useOrderPaymentFlow } from '@/lib/payments'
import { queryClient } from '@/lib/queryClient'
import { Sentry } from '@/lib/sentry'
import type { SellerItemDetail as ItemDetail } from '@/lib/queries'
import { formatAmount, useCurrency, type CurrencyCode } from '@/lib/currency'
import {
  CommercialBenefitsCard,
  type CommercialBenefitReservation,
} from '@/components/ui/CommercialBenefitsCard'

type FulfillmentOption = 'PICKUP' | 'DELIVERY' | 'SHIPPING'
type RecipientMode = 'SELF' | 'OTHER'
type MeasurementProfileRow = {
  id: string
  label: string
  relationship: string | null
  measurements: Record<string, unknown> | null
  unit_preference: string | null
  source: string | null
  is_default: boolean | null
  last_measured_at: string | null
  updated_at: string | null
}
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
  const { itemId, returnTo, historyChain } = useLocalSearchParams<{
    itemId: string
    returnTo?: string
    historyChain?: string
  }>()
  const router = useRouter()
  const navigation = useNavigation()
  const keyboard = useKeyboardState()
  const actionDockScroll = useDrapeCapsuleNavScroll()
  const { user } = useAuth()
  const [saving, setSaving] = useState(false)
  const [cancellationPolicyAcknowledged, setCancellationPolicyAcknowledged] = useState(false)
  const [fitGuidanceAcknowledged, setFitGuidanceAcknowledged] = useState(false)
  const checkoutScrollRef = useRef<ScrollView>(null)
  const cancellationSectionYRef = useRef(0)
  const deliverySectionYRef = useRef(0)
  const [checkoutInFlight, setCheckoutInFlight] = useState(false)
  const [checkoutItemSnapshot, setCheckoutItemSnapshot] = useState<ItemDetail | null>(null)
  const [selectedSize, setSelectedSize] = useState('')
  const [sizeSheetOpen, setSizeSheetOpen] = useState(false)
  const [measurementProfileSheetOpen, setMeasurementProfileSheetOpen] = useState(false)
  const [measurementProfiles, setMeasurementProfiles] = useState<MeasurementProfileRow[]>([])
  const [selectedMeasurementProfile, setSelectedMeasurementProfile] = useState<MeasurementProfileRow | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [fulfillment, setFulfillment] = useState<FulfillmentOption | null>(null)
  const [addressSearch, setAddressSearch] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [city, setCity] = useState('')
  const [stateRegion, setStateRegion] = useState('')
  const [postcode, setPostcode] = useState('')
  const [country, setCountry] = useState('')
  const [addressVerificationSource, setAddressVerificationSource] = useState<string | null>(null)
  const [addressVerificationReference, setAddressVerificationReference] = useState<string | null>(null)
  const [addressVerifiedAt, setAddressVerifiedAt] = useState<string | null>(null)
  const [recipientMode, setRecipientMode] = useState<RecipientMode>('SELF')
  const [recipientName, setRecipientName] = useState('')
  const [recipientPhone, setRecipientPhone] = useState('')
  const [addressError, setAddressError] = useState('')
  const [recipientError, setRecipientError] = useState('')
  const [checkoutPricing, setCheckoutPricing] = useState<CheckoutPricingPreview | null>(null)
  const [pricingLoading, setPricingLoading] = useState(false)
  const [pricingError, setPricingError] = useState('')
  const [preparedOrderId, setPreparedOrderId] = useState<string | null>(null)
  const [benefitReservation, setBenefitReservation] = useState<CommercialBenefitReservation | null>(null)
  const [promotionCode, setPromotionCode] = useState('')
  const [promotionError, setPromotionError] = useState('')
  const { data: item, isLoading, refetch } = useSellerItem(itemId)
  const { data: measurements } = useCustomerMeasurements(user?.id)
  const activeMeasurements = selectedMeasurementProfile?.measurements ?? measurements
  const { startOrderPayment } = useOrderPaymentFlow()
  const { currency: accountCurrency, rates } = useCurrency()
  const activeItem = item ?? (checkoutInFlight ? checkoutItemSnapshot : null)

  const markAddressManuallyConfirmed = useCallback(() => {
    setAddressVerificationSource('CUSTOMER_CONFIRMED_STRUCTURED')
    setAddressVerificationReference(null)
    setAddressVerifiedAt(new Date().toISOString())
  }, [])

  useRefreshOnFocus(() => {
    void refetch()
  }, 0)

  function goBack() {
    goBackOrReturnTo(
      router,
      navigation,
      pickSafeReturnTo(historyChain, returnTo),
      `/(customer)/tailor/item/${itemId}`,
    )
  }

  useContextualBackHandler(goBack)

  useEffect(() => {
    if (!item) return
    const timer = setTimeout(() => {
      const normalizedGuide = normalizeReadyMadeSizeGuide(item.sizeGuide, item.sizes)
      const recommendedSize = recommendReadyMadeSize({
        guide: normalizedGuide,
        measurements: activeMeasurements,
        sizes: item.sizes.filter(
          (size) => quantityForSize(item.sizeInventory, size, item.inventoryQuantity) > 0
        ),
      }).size
      setSelectedSize((current) => {
        if (current && quantityForSize(item.sizeInventory, current, item.inventoryQuantity) > 0)
          return current
        if (
          recommendedSize &&
          quantityForSize(item.sizeInventory, recommendedSize, item.inventoryQuantity) > 0
        )
          return recommendedSize
        return (
          item.sizes.find(
            (size) => quantityForSize(item.sizeInventory, size, item.inventoryQuantity) > 0
          ) ??
          item.sizes[0] ??
          ''
        )
      })
      setFulfillment((current) => current ?? defaultFulfillment(item))
    }, 0)
    return () => clearTimeout(timer)
  }, [activeMeasurements, item])

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    supabase
      .from('customer_measurement_profiles')
      .select('id, label, relationship, measurements, unit_preference, source, is_default, last_measured_at, updated_at')
      .eq('customer_id', user.id)
      .order('is_default', { ascending: false })
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled || error) return
        const rows = (data ?? []) as MeasurementProfileRow[]
        setMeasurementProfiles(rows)
        setSelectedMeasurementProfile((current) => current ?? rows.find((profile) => profile.is_default) ?? rows[0] ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [user?.id])

  useEffect(() => {
    if (!user) return
    if (recipientMode !== 'SELF') return
    const timer = setTimeout(() => {
      setRecipientName(String(user.user_metadata?.display_name ?? '').trim())
      setRecipientPhone(normalizePhoneForStorage(String(user.user_metadata?.phone ?? '')))
    }, 0)
    return () => clearTimeout(timer)
  }, [user, recipientMode])

  const composeAddress = useCallback(() => {
    return composeStructuredAddress({
      line1: addressLine1,
      line2: addressLine2,
      city,
      stateRegion,
      postcode,
      country,
    })
  }, [addressLine1, addressLine2, city, stateRegion, postcode, country])

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
    if (!fitGuidanceAcknowledged) {
      Alert.alert('Review the fit first', 'Confirm the selected size and size guidance before payment.')
      return false
    }
    const selectedSizeInventory = selectedSize
      ? quantityForSize(activeItem.sizeInventory, selectedSize, activeItem.inventoryQuantity)
      : activeItem.inventoryQuantity
    if (activeItem.sizes.length > 0 && !selectedSize.trim()) {
      Alert.alert('Choose a size', 'Pick the size you want before continuing.')
      return false
    }
    if (activeItem.sizes.length > 0 && selectedSizeInventory <= 0) {
      Alert.alert(
        'Size sold out',
        `Size ${selectedSize} is no longer available. Choose another size before continuing.`
      )
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
      Alert.alert(
        'Quantity limit',
        `For now, you can check out up to ${maxQuantity} unit${maxQuantity === 1 ? '' : 's'} for this item.`
      )
      return false
    }
    if (fulfillment !== 'PICKUP') {
      if (!addressLine1.trim() || !city.trim() || !stateRegion.trim() || !country.trim()) {
        setAddressError(
          'Add the full delivery address before continuing. Street, city, region, and country are required.'
        )
        Alert.alert(
          'Add shipping details',
          'Add the recipient and full shipping address so Drapeon can confirm delivery eligibility, tax, and the final total.',
          [
            { text: 'Not now', style: 'cancel' },
            {
              text: 'Add address',
              onPress: () => {
                requestAnimationFrame(() => {
                  checkoutScrollRef.current?.scrollTo({
                    y: Math.max(0, deliverySectionYRef.current - 24),
                    animated: true,
                  })
                })
              },
            },
          ]
        )
        return false
      }
      if (!validateRecipientContact()) {
        Alert.alert(
          'Check recipient details',
          'Add a valid recipient name and phone number so the courier can complete delivery.',
          [
            { text: 'Not now', style: 'cancel' },
            {
              text: 'Review details',
              onPress: () => {
                requestAnimationFrame(() => {
                  checkoutScrollRef.current?.scrollTo({
                    y: Math.max(0, deliverySectionYRef.current - 24),
                    animated: true,
                  })
                })
              },
            },
          ]
        )
        return false
      }
      setAddressError('')
    }
    if (!cancellationPolicyAcknowledged) {
      Alert.alert(
        'Accept the cancellation policy',
        'Review the cancellation and refund terms, then confirm that you understand them before paying.',
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Review policy',
            onPress: () => {
              requestAnimationFrame(() => {
                checkoutScrollRef.current?.scrollTo({
                  y: Math.max(0, cancellationSectionYRef.current - 24),
                  animated: true,
                })
              })
            },
          },
        ]
      )
      return false
    }
    return true
  }

  const selectedSizeInventory = activeItem
    ? quantityForSize(activeItem.sizeInventory, selectedSize || null, activeItem.inventoryQuantity)
    : 0
  const sellerUnavailable = activeItem
    ? activeItem.shopPaused || !activeItem.sellerLive
    : false
  const deliveryDetailsComplete =
    fulfillment === 'PICKUP' ||
    (!!recipientName.trim() &&
      !!recipientPhone.trim() &&
      !!addressLine1.trim() &&
      !!city.trim() &&
      !!stateRegion.trim() &&
      !!country.trim())
  const maxCheckoutQuantity = activeItem
    ? Math.min(
        MAX_READY_MADE_CHECKOUT_QUANTITY,
        activeItem.sizes.length > 0 ? selectedSizeInventory : activeItem.inventoryQuantity
      )
    : MAX_READY_MADE_CHECKOUT_QUANTITY
  const recipientPhoneHint = phoneHintForContext(country, activeItem?.sellerLocation)
  const sizeRecommendation = useMemo(
    () =>
      activeItem
        ? recommendReadyMadeSize({
            guide: normalizeReadyMadeSizeGuide(activeItem.sizeGuide, activeItem.sizes),
            measurements: activeMeasurements,
            sizes: activeItem.sizes.filter(
              (size) =>
                quantityForSize(activeItem.sizeInventory, size, activeItem.inventoryQuantity) > 0
            ),
          })
        : null,
    [activeItem, activeMeasurements]
  )

  useEffect(() => {
    if (!activeItem) return
    const timer = setTimeout(() => {
      const nextLimit = Math.max(1, maxCheckoutQuantity)
      setQuantity((current) => Math.min(current, nextLimit))
    }, 0)
    return () => clearTimeout(timer)
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
        setPricingError(
          'This seller is not accepting new ready-made orders right now. Save the item and check back later.'
        )
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

      if (
        needsAddress &&
        (!addressLine1.trim() || !trimmedCity || !trimmedRegion || !trimmedCountry)
      ) {
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
            addressVerificationSource: needsAddress ? addressVerificationSource ?? undefined : undefined,
            addressVerificationReference: needsAddress ? addressVerificationReference ?? undefined : undefined,
            addressVerifiedAt: needsAddress ? addressVerifiedAt ?? undefined : undefined,
          },
        })

        if (cancelled) return

        if (error || !data?.pricing) {
          const message = await readFunctionErrorMessage(
            error,
            'We could not calculate tax and totals for this checkout right now.'
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
    addressVerificationSource,
    addressVerificationReference,
    addressVerifiedAt,
    composeAddress,
  ])

  const openPreparedOrder = useCallback((orderId: string) => {
    resetTo(router, {
      pathname: '/(customer)/orders/[id]',
      params: { id: orderId, tab: 'active' },
    })
  }, [router])

  async function reserveEnteredPromotion(orderId: string) {
    const normalizedCode = promotionCode.trim().toUpperCase()
    if (!normalizedCode) return
    setPromotionError('')
    try {
      const { error } = await invokeFunction('commercial-benefit-action', {
        body: {
          action: 'reserve',
          orderId,
          code: normalizedCode,
          idempotencyKey: `ready-made:${orderId}:promotion:${normalizedCode}`,
        },
      })
      if (error) {
        setPromotionError(await readFunctionErrorMessage(error, 'This discount code could not be applied.'))
        return
      }
      const { data: reservation, error: reservationError } = await supabase
        .from('commercial_benefit_reservations')
        .select('id, total_benefit_amount, customer_due_amount, currency, expires_at')
        .eq('order_id', orderId)
        .eq('status', 'RESERVED')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (reservationError) throw reservationError
      setBenefitReservation((reservation ?? null) as CommercialBenefitReservation | null)
      setPromotionCode('')
    } catch (cause) {
      setPromotionError(cause instanceof Error ? cause.message : 'This discount code could not be applied.')
    }
  }

  async function payPreparedOrder() {
    if (!preparedOrderId || saving) return
    setSaving(true)
    try {
      const { data: liveBenefit } = await supabase
        .from('commercial_benefit_reservations')
        .select('id, total_benefit_amount, customer_due_amount, currency, expires_at')
        .eq('order_id', preparedOrderId)
        .eq('status', 'RESERVED')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const nextBenefit = (liveBenefit ?? null) as CommercialBenefitReservation | null
      if (benefitReservation && !nextBenefit) {
        setBenefitReservation(null)
        Alert.alert(
          'Promotion expired',
          'The reserved promotion expired before payment. Your full locked total is shown again; review it before continuing.'
        )
        return
      }
      setBenefitReservation(nextBenefit)

      const paymentResult = await startOrderPayment({
        orderId: preparedOrderId,
        customerEmail: user?.email,
      })

      if (!paymentResult.ok) {
        if (paymentResult.reason === 'cancelled') {
          Alert.alert(
            'Payment not finished',
            'Your checkout, stock hold, and any active promotion are saved for 2 hours. Finish payment from the order screen before the hold expires.'
          )
        } else if (paymentResult.stage === 'PAYMENT_FAILED') {
          Alert.alert(
            'Checkout failed',
            `${paymentResult.message}\n\nRetry from the order screen within 2 hours to keep this checkout alive.`
          )
        } else {
          Alert.alert('Payment unavailable', paymentResult.message)
        }
        openPreparedOrder(preparedOrderId)
        return
      }

      resetTo(router, {
        pathname: '/(customer)/orders/[id]',
        params: { id: preparedOrderId, tab: 'active', placed: '1' },
      })
    } catch (error) {
      Sentry.captureException(error, {
        extra: { context: 'ready_made_checkout_payment', orderId: preparedOrderId },
      })
      Alert.alert(
        'Payment unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your checkout is still saved and no new charge was started.'
          : 'We could not safely start payment. Your checkout is still saved; try again from the order screen.'
      )
    } finally {
      setSaving(false)
    }
  }

  async function createOrder() {
    if (!user?.id || !activeItem || !fulfillment || saving) return
    if (sellerUnavailable) {
      Alert.alert(
        'Seller unavailable',
        'This seller is not accepting new ready-made orders right now. Save the item and check back later.'
      )
      return
    }
    if (!validate()) return
    if (pricingLoading) {
      Alert.alert('Finalizing total', 'Drapeon is confirming shipping, tax, and your locked total. Try again in a moment.')
      return
    }
    if (pricingError || !checkoutPricing) {
      Alert.alert(
        'Total unavailable',
        pricingError || 'Drapeon could not confirm the shipping and tax total yet. Review the address and try again.'
      )
      return
    }

    setCheckoutInFlight(true)
    setCheckoutItemSnapshot(activeItem)
    setSaving(true)
    try {
      const { data, error } = await invokeFunction<{ ok: boolean; orderId?: string }>(
        'ready-made-order-action',
        {
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
            addressVerificationSource:
              fulfillment === 'PICKUP' ? undefined : addressVerificationSource ?? undefined,
            addressVerificationReference:
              fulfillment === 'PICKUP' ? undefined : addressVerificationReference ?? undefined,
            addressVerifiedAt: fulfillment === 'PICKUP' ? undefined : addressVerifiedAt ?? undefined,
            recipientName: fulfillment === 'PICKUP' ? undefined : recipientName.trim(),
            recipientPhone:
              fulfillment === 'PICKUP' ? undefined : normalizePhoneForStorage(recipientPhone),
            cancellationPolicyAcknowledged,
            fitGuidanceAcknowledged,
          },
        }
      )

      if (error || !data?.orderId) {
        const errorPayload = await readFunctionErrorPayload(error)
        const existingOrderId =
          typeof errorPayload?.orderId === 'string' && errorPayload.orderId.length > 0
            ? errorPayload.orderId
            : null
        const errorMessage = await readFunctionErrorMessage(
          error,
          'Could not create this order right now.'
        )

        if (existingOrderId) {
          setPreparedOrderId(existingOrderId)
          setCheckoutInFlight(true)
          Alert.alert('Checkout already saved', `${errorMessage}\n\nReview promotions and continue payment below.`)
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
      setPreparedOrderId(data.orderId)
      setBenefitReservation(null)
      await reserveEnteredPromotion(data.orderId)
      checkoutScrollRef.current?.scrollToEnd({ animated: true })
    } catch (error) {
      setCheckoutInFlight(false)
      Sentry.captureException(error, {
        extra: { context: 'ready_made_checkout_create', itemId: activeItem.id },
      })
      Alert.alert(
        'Checkout unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your card has not been charged. Retry checkout when the signal improves.'
          : 'Something went wrong before payment could finish. Your card has not been charged. Please try again.'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          ref={checkoutScrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          {...actionDockScroll}
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
                <Text style={styles.itemPrice}>
                  {formatAmount(
                    activeItem.priceAmount,
                    activeItem.currency as CurrencyCode,
                    activeItem.currency as CurrencyCode,
                    rates
                  )}
                </Text>
                {activeItem.currency !== accountCurrency ? (
                  <Text style={styles.stockSummary}>
                    Approx.{' '}
                    {formatAmount(
                      activeItem.priceAmount,
                      activeItem.currency as CurrencyCode,
                      accountCurrency,
                      rates
                    )}{' '}
                    in your display currency. Checkout uses the seller's currency.
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
                    {activeItem.sellerName} is not accepting new ready-made orders right now. Save
                    this item and check back later.
                  </Text>
                </View>
              ) : null}

              {activeItem.sizes.length > 0 ? (
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionTitle}>Choose size</Text>
                  {measurementProfiles.length > 0 ? (
                    <TouchableOpacity
                      style={styles.profileSelectRow}
                      onPress={() => setMeasurementProfileSheetOpen(true)}
                      accessibilityRole="button"
                      accessibilityLabel="Choose measurement profile for size recommendation"
                    >
                      <View>
                        <Text style={styles.profileSelectEyebrow}>Fit profile</Text>
                        <Text style={styles.profileSelectTitle}>
                          {selectedMeasurementProfile?.label ?? 'Me'}
                        </Text>
                      </View>
                      <Feather name="chevron-down" size={18} color={Colors.midGrey} />
                    </TouchableOpacity>
                  ) : null}
                  {sizeRecommendation?.status === 'RECOMMENDED' ||
                  sizeRecommendation?.status === 'BETWEEN' ? (
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
                        onPress={() =>
                          router.replace({
                            pathname: '/(customer)/profile/measurements',
                            params: {
                              returnTo: `/(customer)/tailor/item/checkout/${itemId}`,
                              historyChain: appendToHistory(historyChain, `/(customer)/tailor/item/checkout/${itemId}`),
                            },
                          })
                        }
                      />
                    </View>
                  ) : null}
                  {sizeRecommendation?.status === 'MISSING_GUIDE' ? (
                    <View style={styles.recommendationCard}>
                      <Text style={styles.recommendationLabel}>Seller fit guide missing</Text>
                      <Text style={styles.recommendationDetail}>
                        There is no size recommendation for this item yet, so choose your size
                        manually or ask the seller before you pay.
                      </Text>
                    </View>
                  ) : null}
                  <TouchableOpacity
                    style={[styles.selectCard, !selectedSize && styles.selectCardWarning]}
                    onPress={() => setSizeSheetOpen(true)}
                    activeOpacity={0.78}
                    accessibilityRole="button"
                    accessibilityLabel={`Choose size. Current size ${selectedSize || 'not selected'}`}
                  >
                    <View style={styles.selectCopy}>
                      <Text style={[styles.selectLabel, !selectedSize && styles.selectLabelWarning]}>
                        Size
                      </Text>
                      <Text style={styles.selectValue}>{selectedSize || 'Choose a size'}</Text>
                      <Text style={styles.selectHint}>
                        {selectedSize
                          ? sizeStockHelperText(selectedSize, selectedSizeInventory)
                          : 'Pick one available size before checkout.'}
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={20} color={Colors.midGrey} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.policyAckRow,
                      fitGuidanceAcknowledged && styles.policyAckRowActive,
                    ]}
                    onPress={() => setFitGuidanceAcknowledged((value) => !value)}
                    activeOpacity={0.75}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: fitGuidanceAcknowledged }}
                    accessibilityLabel={`Confirm fit review for size ${selectedSize || 'not selected'}`}
                  >
                    <View
                      style={[
                        styles.policyCheck,
                        fitGuidanceAcknowledged && styles.policyCheckActive,
                      ]}
                    >
                      <Text style={styles.policyCheckText}>
                        {fitGuidanceAcknowledged ? '✓' : ''}
                      </Text>
                    </View>
                    <Text style={styles.policyAckText}>
                      I reviewed the size guide and confirm {selectedSize || 'this size'} is the size I want.
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {activeItem.sizes.length === 0 ? (
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionTitle}>One-size fit</Text>
                  <Text style={styles.helperText}>
                    Review the listing measurements and fit notes before paying.
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.policyAckRow,
                      fitGuidanceAcknowledged && styles.policyAckRowActive,
                    ]}
                    onPress={() => setFitGuidanceAcknowledged((value) => !value)}
                    activeOpacity={0.75}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: fitGuidanceAcknowledged }}
                    accessibilityLabel="Confirm one-size fit review"
                  >
                    <View style={[styles.policyCheck, fitGuidanceAcknowledged && styles.policyCheckActive]}>
                      <Text style={styles.policyCheckText}>{fitGuidanceAcknowledged ? '✓' : ''}</Text>
                    </View>
                    <Text style={styles.policyAckText}>
                      I reviewed the listing measurements and confirm this fit works for me.
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Quantity</Text>
                <View style={styles.quantityRow}>
                  <TouchableOpacity
                    style={styles.quantityBtn}
                    onPress={() => setQuantity((value) => Math.max(1, value - 1))}
                    accessibilityRole="button"
                    accessibilityLabel={`Decrease quantity, currently ${quantity}`}
                  >
                    <Text style={styles.quantityBtnText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.quantityValue} accessibilityLabel={`Quantity: ${quantity}`}>{quantity}</Text>
                  <TouchableOpacity
                    style={styles.quantityBtn}
                    onPress={() =>
                      setQuantity((value) => Math.min(Math.max(1, maxCheckoutQuantity), value + 1))
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Increase quantity, currently ${quantity}`}
                  >
                    <Text style={styles.quantityBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.helperText}>
                  {activeItem.sizes.length > 0 && selectedSize
                    ? sizeStockHelperText(selectedSize, selectedSizeInventory)
                    : stockHelperText(activeItem.inventoryQuantity)}{' '}
                  Up to {maxCheckoutQuantity} unit{maxCheckoutQuantity === 1 ? '' : 's'} per
                  checkout for now.
                </Text>
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>How you’ll get it</Text>
                <View style={styles.choiceGroup}>
                  {activeItem.pickupAvailable ? (
                    <ChoiceCard
                      title="Pickup"
                      hint="Collect directly from the seller."
                      active={fulfillment === 'PICKUP'}
                      onPress={() => setFulfillment('PICKUP')}
                    />
                  ) : null}
                  {activeItem.deliveryAvailable ? (
                    <ChoiceCard
                      title="Delivery"
                      hint="Seller or team delivers nearby."
                      active={fulfillment === 'DELIVERY'}
                      onPress={() => setFulfillment('DELIVERY')}
                    />
                  ) : null}
                  {activeItem.shippingAvailable ? (
                    <ChoiceCard
                      title="Shipping"
                      hint="Courier handles it."
                      active={fulfillment === 'SHIPPING'}
                      onPress={() => setFulfillment('SHIPPING')}
                    />
                  ) : null}
                </View>
                {fulfillment === 'PICKUP' ? (
                  <Text style={styles.helperText}>
                    Exact pickup details are shared only after the seller marks the order ready for
                    collection.
                  </Text>
                ) : null}
              </View>

              {fulfillment !== 'PICKUP' ? (
                <View
                  style={styles.sectionCard}
                  onLayout={(event) => {
                    deliverySectionYRef.current = event.nativeEvent.layout.y
                  }}
                >
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
                  <PhoneNumberInput
                    label={recipientMode === 'SELF' ? 'Your phone' : 'Recipient phone'}
                    value={recipientPhone}
                    onChangeText={(value) => {
                      setRecipientPhone(value)
                      if (recipientError) setRecipientError('')
                    }}
                    placeholder="Phone number"
                    required
                    hint={
                      recipientMode === 'SELF'
                        ? `This is the number the courier or rider will use if they need you. ${recipientPhoneHint}`
                        : `The courier or rider may call this person directly. ${recipientPhoneHint}`
                    }
                  />
                  <AddressAutocompleteInput
                    label="Find delivery address"
                    value={addressSearch}
                    onChangeText={(value) => {
                      setAddressSearch(value)
                      if (addressError) setAddressError('')
                    }}
                    placeholder="Search address, area, or landmark"
                    onSelectAddress={(selected) => {
                      setAddressSearch(selected.displayValue)
                      setAddressLine1(selected.line1)
                      setAddressLine2(selected.line2)
                      setCity(selected.city)
                      setStateRegion(selected.stateRegion)
                      setPostcode(selected.postcode)
                      setCountry(selected.countryCode || selected.country)
                      setAddressVerificationSource('NOMINATIM')
                      setAddressVerificationReference(selected.reference ?? null)
                      setAddressVerifiedAt(new Date().toISOString())
                      setAddressError('')
                    }}
                  />
                  <Text style={styles.helperText}>
                    Search first if you can. If the map suggestion is not quite right, type the
                    address manually using street, area, city, region, and country. Landmarks are
                    okay in address line 2.
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={addressLine1}
                    onChangeText={(value) => {
                      setAddressLine1(value)
                      markAddressManuallyConfirmed()
                    }}
                    placeholder="Address line 1"
                    placeholderTextColor={Colors.midGrey}
                  />
                  <TextInput
                    style={styles.input}
                    value={addressLine2}
                    onChangeText={(value) => {
                      setAddressLine2(value)
                      markAddressManuallyConfirmed()
                    }}
                    placeholder="Address line 2 (optional)"
                    placeholderTextColor={Colors.midGrey}
                  />
                  <View style={styles.inlineRow}>
                    <TextInput
                      style={[styles.input, styles.inlineInput]}
                      value={city}
                      onChangeText={(value) => {
                        setCity(value)
                        markAddressManuallyConfirmed()
                      }}
                      placeholder="City"
                      placeholderTextColor={Colors.midGrey}
                    />
                    <TextInput
                      style={[styles.input, styles.inlineInput]}
                      value={stateRegion}
                      onChangeText={(value) => {
                        setStateRegion(value)
                        markAddressManuallyConfirmed()
                      }}
                      placeholder="State / region"
                      placeholderTextColor={Colors.midGrey}
                    />
                  </View>
                  <View style={styles.inlineRow}>
                    <TextInput
                      style={[styles.input, styles.inlineInput]}
                      value={postcode}
                      onChangeText={(value) => {
                        setPostcode(value)
                        markAddressManuallyConfirmed()
                      }}
                      placeholder="Postcode / ZIP (optional)"
                      placeholderTextColor={Colors.midGrey}
                    />
                    <TextInput
                      style={[styles.input, styles.inlineInput]}
                      value={country}
                      onChangeText={(value) => {
                        setCountry(value)
                        markAddressManuallyConfirmed()
                      }}
                      placeholder="Country"
                      placeholderTextColor={Colors.midGrey}
                    />
                  </View>
                  {recipientError ? <Text style={styles.errorText}>{recipientError}</Text> : null}
                  {addressError ? <Text style={styles.errorText}>{addressError}</Text> : null}
                </View>
              ) : null}

              <View style={styles.breakdownCard}>
                <Text style={styles.sectionTitle}>Order summary</Text>
                <SummaryRow label="Fulfillment" value={fulfillmentLabel(fulfillment)} />
                {fulfillment !== 'PICKUP' && recipientName.trim() ? (
                  <SummaryRow
                    label={recipientMode === 'SELF' ? 'Receiving contact' : 'Recipient'}
                    value={recipientName.trim()}
                  />
                ) : null}
                {fulfillment !== 'PICKUP' && recipientPhone.trim() ? (
                  <SummaryRow
                    label="Contact phone"
                    value={normalizePhoneForStorage(recipientPhone)}
                  />
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
                      value={formatAmount(
                        checkoutPricing.subtotalAmount,
                        checkoutPricing.currency,
                        checkoutPricing.currency,
                        rates
                      )}
                    />
                    <SummaryRow
                      label={
                        fulfillment === 'DELIVERY'
                          ? 'Standard delivery fee'
                          : fulfillment === 'SHIPPING'
                            ? 'Standard shipping fee'
                            : 'Pickup fee'
                      }
                      value={
                        checkoutPricing.shippingAmount > 0
                          ? formatAmount(
                              checkoutPricing.shippingAmount,
                              checkoutPricing.currency,
                              checkoutPricing.currency,
                              rates
                            )
                          : 'Free'
                      }
                    />
                    <SummaryRow
                      label={checkoutPricing.taxFallback ? 'Estimated tax' : checkoutPricing.taxLabel || 'Tax'}
                      value={formatAmount(
                        checkoutPricing.taxAmount,
                        checkoutPricing.currency,
                        checkoutPricing.currency,
                        rates
                      )}
                    />
                    <View style={styles.totalRow}>
                      <Text style={styles.totalLabel}>Total</Text>
                      <Text style={styles.totalValue}>
                        {formatAmount(
                          checkoutPricing.totalAmount,
                          checkoutPricing.currency,
                          checkoutPricing.currency,
                          rates
                        )}
                      </Text>
                    </View>
                    {checkoutPricing.taxFallback ? (
                      <Text style={styles.helperText}>
                        Tax was estimated because live tax lookup was unavailable for this address.
                      </Text>
                    ) : null}
                    <Text style={styles.helperText}>Choose your secure payment method in the next step.</Text>
                    <View style={styles.promotionEntry}>
                      <Text style={styles.promotionEntryTitle}>Discount code</Text>
                      <TextInput
                        accessibilityLabel="Discount code"
                        autoCapitalize="characters"
                        autoCorrect={false}
                        value={promotionCode}
                        onChangeText={(value) => {
                          setPromotionCode(value.toUpperCase())
                          if (promotionError) setPromotionError('')
                        }}
                        placeholder="Enter code (optional)"
                        placeholderTextColor={Colors.midGrey}
                        style={styles.promotionInput}
                      />
                      <Text style={styles.helperText}>
                        We’ll apply it after stock is held and show the new total before secure payment opens. Available Drapeon credits appear there too.
                      </Text>
                      {promotionError ? <Text style={styles.errorText}>{promotionError}</Text> : null}
                    </View>
                  </>
                ) : (
                  <Text style={styles.helperText}>
                    Add the final checkout details above to see the locked tax and total before you
                    pay.
                  </Text>
                )}
              </View>

              <DisclosureSection
                title="Payment protection"
                summary="Payment stays protected until the handoff is confirmed."
                tone="success"
                icon="shield"
              >
                <Text style={styles.bestUseText}>
                  Pay securely in the next step. If the item is wrong, damaged, missing, or materially different, report it in Drapeon before closing the order.
                </Text>
              </DisclosureSection>

              <DisclosureSection
                title="Fulfillment note"
                summary={fulfillment === 'PICKUP' ? 'Pickup details stay private until ready.' : 'Delivery fees are collected here; extras need approval.'}
                tone="info"
                icon="truck"
              >
                <Text style={styles.bestUseText}>
                  {fulfillment === 'PICKUP'
                    ? 'Pickup has no delivery fee, but tax can still apply based on the order location. Pickup details stay private until the seller marks the order ready. Bring your collection code and inspect the item before closing the order.'
                    : 'Drapeon collects the standard delivery or shipping fee in this checkout. Carrier surcharges, customs, or import duties are not charged automatically; if anything extra is needed, Drapeon will ask you to approve it before dispatch.'}
                </Text>
                <Text style={styles.bestUseText}>
                  Handmade or small-batch pieces can vary slightly from photos. If the item arrives
                  damaged, wrong, missing, or materially different from the listing, raise it inside
                  Drapeon before closing the order.
                </Text>
              </DisclosureSection>

              <DisclosureSection
                title="Returns and remedies"
                summary="Review when refunds, fixes, or disputes are available."
                tone="info"
                icon="shield"
              >
                <View style={styles.policyList}>
                  {READY_MADE_POLICY_ROWS.map((row) => (
                    <View key={row.title} style={styles.policyRow}>
                      <Text style={styles.policyRowTitle}>{row.title}</Text>
                      <Text style={styles.policyRowBody}>{row.body}</Text>
                    </View>
                  ))}
                </View>
              </DisclosureSection>

              <View
                onLayout={(event) => {
                  cancellationSectionYRef.current = event.nativeEvent.layout.y
                }}
              >
                <DisclosureSection
                  title="Cancellation policy"
                  summary={
                    cancellationPolicyAcknowledged
                      ? 'Reviewed and accepted.'
                      : 'Required before payment.'
                  }
                  tone={cancellationPolicyAcknowledged ? 'success' : 'warning'}
                  icon="alert-circle"
                >
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
                    <View
                      style={[
                        styles.policyCheck,
                        cancellationPolicyAcknowledged && styles.policyCheckActive,
                      ]}
                    >
                      <Text style={styles.policyCheckText}>
                        {cancellationPolicyAcknowledged ? '✓' : ''}
                      </Text>
                    </View>
                    <Text style={styles.policyAckText}>{ORDER_CANCELLATION_ACK_COPY}</Text>
                  </TouchableOpacity>
                </DisclosureSection>
              </View>
            </>
          )}
        </ScrollView>

        {activeItem ? (
          <DrapeFloatingActionDock
            compactWidth={170}
            forceCompact={keyboard.visible}
            testID="ready-made-checkout-action"
          >
            {(compact) => (
              <DrapeCapsuleButton
                label={
                  saving
                    ? 'Preparing…'
                    : !fitGuidanceAcknowledged
                      ? 'Review size to pay'
                      : !deliveryDetailsComplete
                        ? fulfillment === 'SHIPPING'
                          ? 'Add shipping details'
                          : 'Add delivery details'
                      : !cancellationPolicyAcknowledged
                        ? 'Accept policy to pay'
                        : compact
                          ? 'Continue'
                          : 'Review payment'
                }
                icon="shopping-bag"
                loading={saving}
                style={styles.actionDockPrimary}
                onPress={createOrder}
                disabled={
                  saving ||
                  !fulfillment ||
                  sellerUnavailable ||
                  (activeItem.sizes.length > 0 && !selectedSize.trim()) ||
                  (activeItem.sizes.length > 0 && selectedSizeInventory <= 0)
                }
              />
            )}
          </DrapeFloatingActionDock>
        ) : null}
        <Modal
          visible={Boolean(preparedOrderId)}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => {
            if (preparedOrderId) openPreparedOrder(preparedOrderId)
          }}
        >
          <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
            <View style={styles.paymentReviewHeader}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close payment review"
                onPress={() => {
                  if (preparedOrderId) openPreparedOrder(preparedOrderId)
                }}
                style={styles.paymentReviewClose}
              >
                <Feather name="x" size={24} color={Colors.ink} />
              </TouchableOpacity>
              <Text style={styles.paymentReviewTitle}>Review payment</Text>
              <View style={styles.paymentReviewClose} />
            </View>
            <ScrollView
              contentContainerStyle={styles.paymentReviewContent}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.breakdownCard}>
                <Text style={styles.sectionTitle}>Locked checkout</Text>
                <SummaryRow label="Item subtotal" value={checkoutPricing ? formatAmount(checkoutPricing.subtotalAmount, checkoutPricing.currency, checkoutPricing.currency, rates) : '—'} />
                <SummaryRow label="Fulfillment" value={checkoutPricing ? formatAmount(checkoutPricing.shippingAmount, checkoutPricing.currency, checkoutPricing.currency, rates) : '—'} />
                <SummaryRow label={checkoutPricing?.taxLabel || 'Tax'} value={checkoutPricing ? formatAmount(checkoutPricing.taxAmount, checkoutPricing.currency, checkoutPricing.currency, rates) : '—'} />
                {benefitReservation ? (
                  <SummaryRow
                    label="Drapeon promotion or credit"
                    value={`−${formatAmount(benefitReservation.total_benefit_amount, benefitReservation.currency as CurrencyCode, benefitReservation.currency as CurrencyCode, rates)}`}
                  />
                ) : null}
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Pay now</Text>
                  <Text style={styles.totalValue}>
                    {checkoutPricing
                      ? formatAmount(
                          benefitReservation?.customer_due_amount ?? checkoutPricing.totalAmount,
                          checkoutPricing.currency,
                          checkoutPricing.currency,
                          rates
                        )
                      : '—'}
                  </Text>
                </View>
              </View>
              {preparedOrderId ? (
                <CommercialBenefitsCard
                  orderId={preparedOrderId}
                  currency={checkoutPricing?.currency ?? null}
                  variant="checkout"
                  initialCode={promotionCode}
                  initialError={promotionError}
                  onChanged={(reservation) => {
                    setBenefitReservation(reservation)
                    if (reservation) setPromotionError('')
                  }}
                />
              ) : null}
              <Text style={styles.helperText}>
                Promotions are checked again immediately before payment. Your seller's protected earnings do not change.
              </Text>
            </ScrollView>
            <View style={styles.paymentReviewDock}>
              <Button
                label={saving ? 'Opening secure payment…' : benefitReservation?.customer_due_amount === 0 ? 'Complete covered order' : 'Continue securely'}
                onPress={() => { void payPreparedOrder() }}
                loading={saving}
                disabled={saving}
              />
            </View>
          </SafeAreaView>
        </Modal>
        {activeItem ? (
          <SizeChoiceSheet
            visible={sizeSheetOpen}
            sizes={activeItem.sizes}
            selectedSize={selectedSize}
            sizeInventory={activeItem.sizeInventory}
            inventoryQuantity={activeItem.inventoryQuantity}
            onClose={() => setSizeSheetOpen(false)}
            onSelect={(size) => {
              setSelectedSize(size)
              setFitGuidanceAcknowledged(false)
              setSizeSheetOpen(false)
            }}
          />
        ) : null}
        <ChoiceSheet
          visible={measurementProfileSheetOpen}
          title="Choose fit profile"
          subtitle="Use this profile for the size recommendation on this item."
          options={measurementProfiles.map((profile) => ({
            value: profile.id,
            title: profile.is_default ? `${profile.label} · default` : profile.label,
            body: profile.last_measured_at
              ? `Updated ${new Date(profile.last_measured_at).toLocaleDateString()}`
              : profile.source?.replace(/_/g, ' ').toLowerCase() ?? 'Saved profile',
            icon: profile.relationship === 'SELF' ? 'user' : 'users',
          }))}
          selectedValue={selectedMeasurementProfile?.id}
          onClose={() => setMeasurementProfileSheetOpen(false)}
          onSelect={(value) => {
            setSelectedMeasurementProfile(measurementProfiles.find((profile) => profile.id === value) ?? null)
            setFitGuidanceAcknowledged(false)
            setMeasurementProfileSheetOpen(false)
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function SizeChoiceSheet({
  visible,
  sizes,
  selectedSize,
  sizeInventory,
  inventoryQuantity,
  onClose,
  onSelect,
}: {
  visible: boolean
  sizes: string[]
  selectedSize: string
  sizeInventory: ItemDetail['sizeInventory']
  inventoryQuantity: number
  onClose: () => void
  onSelect: (size: string) => void
}) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <TouchableOpacity style={styles.sheetScrim} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom + Spacing.lg, 40) }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleWrap}>
              <Text style={styles.sheetTitle}>Choose size</Text>
              <Text style={styles.sheetSubtitle}>
                Select one available size. Low-stock sizes show the exact quantity left.
              </Text>
            </View>
            <TouchableOpacity style={styles.sheetClose} onPress={onClose} accessibilityLabel="Close size picker">
              <Feather name="x" size={18} color={Colors.ink} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.sheetRows} showsVerticalScrollIndicator={false}>
            {sizes.map((size) => {
              const remaining = quantityForSize(sizeInventory, size, inventoryQuantity)
              const disabled = remaining <= 0
              const selected = selectedSize === size
              return (
                <TouchableOpacity
                  key={size}
                  style={[
                    styles.sheetChoiceRow,
                    selected && styles.sheetChoiceRowSelected,
                    disabled && styles.sheetChoiceRowDisabled,
                  ]}
                  disabled={disabled}
                  onPress={() => onSelect(size)}
                  activeOpacity={0.78}
                >
                  <View style={styles.sheetChoiceText}>
                    <Text style={styles.sheetChoiceTitle}>{size}</Text>
                    <Text style={styles.sheetChoiceBody}>{sizeStockHelperText(size, remaining)}</Text>
                  </View>
                  {selected ? (
                    <Feather name="check-circle" size={18} color={Colors.needleGreen} />
                  ) : null}
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function ChoiceCard({
  title,
  hint,
  active,
  onPress,
}: {
  title: string
  hint: string
  active: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      style={[styles.choiceCard, active && styles.choiceCardActive]}
      onPress={onPress}
    >
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
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
    paddingBottom: DRAPE_FLOATING_ACTION_DOCK_CLEARANCE + Spacing.lg,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 44 },
  headerBackButton: {
    width: 44,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerSpacer: { width: 44, height: 44 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: FontWeight.semibold,
    color: CHARCOAL,
    fontFamily: Fonts.display,
  },
  stateCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    gap: Spacing.sm,
    alignItems: 'center',
    ...Shadow.sm,
  },
  stateTitle: {
    fontSize: 16,
    fontWeight: FontWeight.semibold,
    color: CHARCOAL,
    fontFamily: Fonts.display,
  },
  stateText: { fontSize: 13, color: Colors.inkLight, textAlign: 'center', lineHeight: 18 },
  summaryCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 12,
    gap: 4,
    ...Shadow.sm,
  },
  sellerName: { fontSize: 13, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold },
  itemTitle: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: FontWeight.bold,
    color: CHARCOAL,
    fontFamily: Fonts.display,
  },
  stockSummary: { fontSize: 12, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold },
  itemPrice: {
    marginTop: 2,
    fontSize: 22,
    color: PRIMARY_GREEN,
    fontWeight: FontWeight.bold,
    fontFamily: Fonts.display,
  },
  infoCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 12,
    gap: 4,
    ...Shadow.sm,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: FontWeight.semibold,
    color: CHARCOAL,
    fontFamily: Fonts.display,
  },
  infoBody: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  blockerCard: {
    backgroundColor: Colors.errorLight,
    borderRadius: Radius.md,
    padding: 12,
    gap: 4,
    ...Shadow.sm,
  },
  blockerTitle: {
    fontSize: 15,
    fontWeight: FontWeight.semibold,
    color: Colors.error,
    fontFamily: Fonts.display,
  },
  blockerBody: { fontSize: 13, color: Colors.error, lineHeight: 18 },
  sectionCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 12,
    gap: 8,
    ...Shadow.sm,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: FontWeight.semibold,
    color: CHARCOAL,
    fontFamily: Fonts.display,
  },
  recommendationCard: {
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.md,
    padding: 12,
    gap: 4,
  },
  profileSelectRow: {
    minHeight: 58,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: HOME_BG,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  profileSelectEyebrow: {
    fontSize: 11,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  profileSelectTitle: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  recommendationLabel: { fontSize: 13, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold },
  recommendationDetail: { fontSize: 12, color: Colors.inkLight, lineHeight: 16 },
  helperText: { fontSize: 12, color: MUTED_GREY, lineHeight: 16 },
  selectCard: {
    minHeight: 74,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: HOME_BG,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  selectCardWarning: { borderColor: Colors.statusPending },
  selectCopy: { flex: 1, gap: 2 },
  selectLabel: {
    fontSize: 12,
    color: Colors.inkLight,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
  },
  selectLabelWarning: { color: Colors.statusPending },
  selectValue: { fontSize: 15, color: CHARCOAL, fontWeight: FontWeight.semibold },
  selectHint: { fontSize: 12, color: MUTED_GREY, lineHeight: 16 },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheetScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  sheet: {
    maxHeight: '78%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.md,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.lightGrey,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  sheetTitleWrap: { flex: 1, gap: 3 },
  sheetTitle: {
    fontSize: 20,
    color: CHARCOAL,
    fontWeight: FontWeight.semibold,
    fontFamily: Fonts.display,
  },
  sheetSubtitle: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  sheetClose: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  sheetRows: { gap: Spacing.sm, paddingBottom: Spacing.sm },
  sheetChoiceRow: {
    minHeight: 68,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  sheetChoiceRowSelected: {
    borderColor: PRIMARY_GREEN,
    backgroundColor: Colors.needleGreenLight,
  },
  sheetChoiceRowDisabled: { opacity: 0.48 },
  sheetChoiceText: { flex: 1, gap: 2 },
  sheetChoiceTitle: {
    fontSize: FontSize.sm,
    color: CHARCOAL,
    fontWeight: FontWeight.semibold,
  },
  sheetChoiceBody: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 18,
  },
  quantityRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  quantityBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: HOME_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityBtnText: { fontSize: 22, color: CHARCOAL, fontWeight: FontWeight.semibold },
  quantityValue: {
    minWidth: 28,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: FontWeight.semibold,
    color: CHARCOAL,
  },
  choiceGroup: { gap: 8 },
  choiceCard: {
    backgroundColor: HOME_BG,
    borderRadius: Radius.md,
    padding: 12,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    minHeight: 64,
  },
  choiceCardActive: { borderColor: PRIMARY_GREEN, backgroundColor: Colors.needleGreenLight },
  choiceTitle: {
    fontSize: 14,
    fontWeight: FontWeight.semibold,
    color: CHARCOAL,
    fontFamily: Fonts.display,
  },
  choiceTitleActive: { color: PRIMARY_GREEN },
  choiceHint: { fontSize: 12, color: MUTED_GREY, lineHeight: 16 },
  input: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: CHARCOAL,
    fontSize: 16,
    minHeight: 58,
  },
  inlineRow: { flexDirection: 'row', gap: 8 },
  inlineInput: { flex: 1 },
  errorText: { fontSize: 12, color: Colors.error, marginTop: 2 },
  breakdownCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  pricingStateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  promotionEntry: {
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
    gap: 8,
  },
  promotionEntryTitle: {
    fontSize: 13,
    color: CHARCOAL,
    fontWeight: FontWeight.semibold,
  },
  promotionInput: {
    minHeight: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: HOME_BG,
    paddingHorizontal: 12,
    color: CHARCOAL,
    fontSize: 15,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 },
  summaryLabel: { flex: 1, fontSize: 13, lineHeight: 18, color: MUTED_GREY },
  summaryValue: { flexShrink: 0, fontSize: 13, lineHeight: 18, color: CHARCOAL, fontWeight: FontWeight.medium },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
  },
  totalLabel: { fontSize: 15, color: CHARCOAL, fontWeight: FontWeight.semibold },
  totalValue: {
    fontSize: 15,
    color: PRIMARY_GREEN,
    fontWeight: FontWeight.bold,
    fontFamily: Fonts.display,
  },
  bestUseText: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
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
  paymentReviewHeader: {
    minHeight: 62,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.white,
  },
  paymentReviewClose: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentReviewTitle: {
    fontSize: FontSize.lg,
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontWeight: FontWeight.semibold,
  },
  paymentReviewContent: {
    padding: Spacing.lg,
    paddingBottom: 132,
    gap: Spacing.md,
    backgroundColor: Colors.bone,
  },
  paymentReviewDock: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    bottom: Spacing.md,
    padding: Spacing.sm,
    borderRadius: Radius.xl,
    backgroundColor: Colors.white,
    ...Shadow.md,
  },
  actionDockPrimary: { flex: 1 },
})
