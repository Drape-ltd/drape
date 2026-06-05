import { Alert, Linking } from 'react-native'
import { normalizePhoneForStorage, validateDispatchPhoneForProfile, validatePhoneForProfile } from '@drape/shared/phone'

type TrackingAudience = 'customer' | 'tailor'
type FulfillmentStage = 'SHIPPED' | 'OUT_FOR_DELIVERY'

export function normalizeTrackingNumberInput(value: string) {
  return value.replace(/\s+/g, '').toUpperCase()
}

function normalizeCarrierName(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase()
}

export function getShipStagePreflightError(options: {
  deliveryMethod: string | null | undefined
  deliveryAddress: string | null | undefined
  trackingNumber: string
  carrier: string
}) {
  if (options.deliveryMethod === 'LOCAL_COLLECTION') {
    return 'This order is set for local collection. Mark it ready for collection instead.'
  }

  if (!options.deliveryAddress?.trim()) {
    return 'Shipping address is missing on this order. Ask the customer to update it before shipping.'
  }

  if (!options.trackingNumber.trim()) {
    return 'Add the shipment tracking number before marking this order as shipped.'
  }

  if (!options.carrier.trim()) {
    return 'Add the shipping carrier before marking this order as shipped.'
  }

  return null
}

export function getFulfillmentStagePreflightError(options: {
  targetStage: FulfillmentStage
  deliveryMethod: string | null | undefined
  deliveryAddress: string | null | undefined
  recipientName: string | null | undefined
  recipientPhone: string | null | undefined
  provider: string
  reference: string
  trackingNumber: string
  contactName: string
  contactPhone: string
}) {
  if (options.targetStage === 'SHIPPED' && options.deliveryMethod === 'LOCAL_COLLECTION') {
    return 'This order is set for local collection. Mark it ready for collection instead.'
  }

  if (options.targetStage === 'SHIPPED' && options.deliveryMethod === 'LOCAL_DELIVERY') {
    return 'This order is set for local delivery. Mark it out for delivery instead.'
  }

  if (options.targetStage === 'OUT_FOR_DELIVERY' && options.deliveryMethod === 'LOCAL_COLLECTION') {
    return 'This order is set for local collection. Mark it ready for collection instead.'
  }

  if (options.targetStage === 'OUT_FOR_DELIVERY' && options.deliveryMethod === 'SHIPPING') {
    return 'This order is set for shipping. Mark it as shipped once the courier has accepted the parcel.'
  }

  if (!options.deliveryAddress?.trim()) {
    return 'Delivery address is missing on this order. Ask the customer to update it before dispatch.'
  }

  if (!options.recipientName?.trim()) {
    return 'Recipient name is missing on this order. Ask the customer to update it before dispatch.'
  }

  if (!options.recipientPhone?.trim()) {
    return 'Recipient phone is missing on this order. Ask the customer to update it before dispatch.'
  }

  if (validatePhoneForProfile(options.recipientPhone) != null) {
    return 'Recipient phone looks incomplete. Ask the customer to update it before dispatch.'
  }

  if (!options.provider.trim()) {
    return 'Add the courier, shipper, or delivery partner before marking this handoff as started.'
  }

  if (options.targetStage === 'SHIPPED' && !options.trackingNumber.trim() && !options.reference.trim()) {
    return 'Add a tracking number or shipment reference before marking this order as shipped.'
  }

  if (options.targetStage === 'SHIPPED' && !options.contactName.trim()) {
    return 'Add the courier or shipping contact name before marking this order as shipped.'
  }

  if (options.targetStage === 'SHIPPED' && !options.contactPhone.trim()) {
    return 'Add the courier or shipping contact phone before marking this order as shipped.'
  }

  if (options.targetStage === 'SHIPPED' && validateDispatchPhoneForProfile(options.contactPhone) != null) {
    return 'Shipping contact phone looks incomplete. Add a full number with country code before marking this order as shipped.'
  }

  if (options.targetStage === 'OUT_FOR_DELIVERY' && !options.contactName.trim()) {
    return 'Add the rider or delivery contact name before marking this order out for delivery.'
  }

  if (options.targetStage === 'OUT_FOR_DELIVERY' && !options.contactPhone.trim()) {
    return 'Add the rider or delivery contact phone before marking this order out for delivery.'
  }

  if (options.targetStage === 'OUT_FOR_DELIVERY' && validateDispatchPhoneForProfile(options.contactPhone) != null) {
    return 'Delivery contact phone looks incomplete. Add a full number with country code before marking this order out for delivery.'
  }

  return null
}

export function normalizeDispatchReferenceInput(value: string) {
  return value.trim().toUpperCase()
}

export function normalizeContactPhoneInput(value: string) {
  return normalizePhoneForStorage(value)
}

export function buildTrackingUrl(trackingNumber: string, carrier?: string | null) {
  const normalizedTracking = normalizeTrackingNumberInput(trackingNumber)
  if (!normalizedTracking) return null

  const normalizedCarrier = normalizeCarrierName(carrier)

  if (normalizedCarrier.includes('dhl')) {
    return `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encodeURIComponent(normalizedTracking)}`
  }

  if (normalizedCarrier.includes('ups')) {
    return `https://www.ups.com/track?tracknum=${encodeURIComponent(normalizedTracking)}`
  }

  if (normalizedCarrier.includes('fedex')) {
    return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(normalizedTracking)}`
  }

  if (normalizedCarrier.includes('usps')) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(normalizedTracking)}`
  }

  if (normalizedCarrier.includes('royal mail')) {
    return `https://www.royalmail.com/track-your-item#/tracking-results/${encodeURIComponent(normalizedTracking)}`
  }

  if (normalizedCarrier.includes('evri') || normalizedCarrier.includes('hermes')) {
    return `https://www.evri.com/track/parcel/${encodeURIComponent(normalizedTracking)}/details`
  }

  if (normalizedCarrier.includes('dpd')) {
    return `https://tracking.dpd.de/status/en_US/parcel/${encodeURIComponent(normalizedTracking)}`
  }

  const query = carrier?.trim()
    ? `${carrier.trim()} tracking ${normalizedTracking}`
    : `tracking ${normalizedTracking}`

  return `https://www.google.com/search?q=${encodeURIComponent(query)}`
}

function trackingOpenFailedMessage(audience: TrackingAudience) {
  if (audience === 'customer') {
    return 'We could not open the carrier tracking page right now. The tracking number is still saved on this order, so you can retry later or use it manually. Keep any customs or delivery issues in the order thread so support can follow the timeline.'
  }

  return 'We could not open the carrier tracking page right now. The tracking number stays on this order, so you can retry later or share it manually if needed. Keep any carrier, customs, or dispatch updates inside Drapeon so the order timeline stays complete.'
}

export async function openTrackingPage(options: {
  trackingNumber: string
  carrier?: string | null
  audience: TrackingAudience
}) {
  const url = buildTrackingUrl(options.trackingNumber, options.carrier)
  if (!url) {
    Alert.alert('Tracking unavailable', 'This shipment is missing a usable tracking number right now.')
    return false
  }

  const supported = await Linking.canOpenURL(url)
  if (!supported) {
    Alert.alert('Tracking unavailable', trackingOpenFailedMessage(options.audience))
    return false
  }

  try {
    await Linking.openURL(url)
    return true
  } catch {
    Alert.alert('Tracking unavailable', trackingOpenFailedMessage(options.audience))
    return false
  }
}
