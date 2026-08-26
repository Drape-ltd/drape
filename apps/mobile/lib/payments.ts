import * as WebBrowser from 'expo-web-browser'
import * as ExpoLinking from 'expo-linking'
import {
  normalizeAccountCurrency,
  resolvePaymentProviderForCurrency,
  type PaymentRoutingProvider,
} from '@drape/shared'
import { isMachineErrorCodeMessage, readFunctionErrorMessage, readFunctionErrorPayload } from '@/lib/function-errors'
import { invokeFunction } from '@/lib/supabase'
import {
  getStripeUnavailableMessage,
  isNativeStripeRuntimeAvailable,
  isStripePaymentSheetCanceled,
  useOptionalStripe,
} from '@/lib/stripe-runtime'
import { usePaystackCheckout } from '@/lib/paystack-checkout'

WebBrowser.maybeCompleteAuthSession()

const STRIPE_RETURN_URL = ExpoLinking.createURL('stripe-redirect')
const PAYSTACK_RETURN_URL = ExpoLinking.createURL('paystack-redirect')
const STRIPE_MERCHANT_DISPLAY_NAME = 'Drapeon'

function paymentProviderDisplayName(provider: PaymentRoutingProvider) {
  return provider === 'PAYSTACK' ? 'Paystack' : 'Stripe'
}

export function paymentRouteLabelForCurrency(currency: string | null | undefined) {
  const orderCurrency = normalizeAccountCurrency(currency)
  if (!orderCurrency) return null
  return `${paymentProviderDisplayName(resolvePaymentProviderForCurrency(orderCurrency))} checkout`
}

export function paymentRouteCopyForCurrency(currency: string | null | undefined) {
  const orderCurrency = normalizeAccountCurrency(currency)
  if (!orderCurrency) return null
  return `This ${orderCurrency} order uses ${paymentRouteLabelForCurrency(orderCurrency)}. Any refund returns through the same payment route, even if you change your account currency later.`
}

type BasePreparePaymentResponse = {
  ok: boolean
  orderId: string
  paymentIntentId: string
  existing: boolean
  stage: string
  amount: number
  currency: string
  confirmed?: boolean
  alreadyPaid?: boolean
}

type StripePreparePaymentResponse = BasePreparePaymentResponse & {
  provider: 'STRIPE'
  clientSecret: string | null
  authorizationUrl?: null
}

type PaystackPreparePaymentResponse = BasePreparePaymentResponse & {
  provider: 'PAYSTACK'
  authorizationUrl: string | null
  clientSecret?: null
}

type CoveragePreparePaymentResponse = BasePreparePaymentResponse & {
  provider: 'COVERAGE'
  confirmed: true
  clientSecret?: null
  authorizationUrl?: null
}

type PreparePaymentResponse = StripePreparePaymentResponse | PaystackPreparePaymentResponse | CoveragePreparePaymentResponse

type ConfirmPaymentResponse = {
  ok: boolean
  confirmed: boolean
  alreadyConfirmed?: boolean
  provider: 'STRIPE' | 'PAYSTACK'
  orderId: string
  paymentIntentId: string
  stage: string
  status: string
}

type MaterialAdvancePreparePaymentResponse = {
  ok: boolean
  provider: 'STRIPE' | 'PAYSTACK'
  orderId: string
  advanceId: string
  paymentIntentId: string
  authorizationUrl: string | null
  clientSecret: string | null
  amount: number
  currency: string
  existing: boolean
}

type MaterialAdvanceConfirmPaymentResponse = {
  ok: boolean
  confirmed: boolean
  advance: {
    id: string
    status: string
    release_status?: string | null
  }
}

type CommercialAdjustmentPreparePaymentResponse = {
  ok: boolean
  provider: 'STRIPE' | 'PAYSTACK'
  adjustmentId: string
  paymentIntentId: string
  authorizationUrl: string | null
  clientSecret: string | null
  amount: number
  currency: string
}

export type OrderPaymentFlowResult =
  | {
      ok: true
      orderId: string
      stage: string
      paymentIntentId: string
      alreadyPaid?: boolean
    }
  | {
      ok: false
      reason: 'not_configured' | 'cancelled' | 'failed'
      message: string
      stage?: string
    }

export function getStripePublishableKey() {
  return (process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '').trim()
}

export function hasStripePublishableKey() {
  return getStripePublishableKey().length > 0
}

async function resolvePaymentErrorMessage(
  error: Error | null,
  fallback: string,
) {
  const payload = error ? await readFunctionErrorPayload(error) : null
  const rawMessage = error ? await readFunctionErrorMessage(error, fallback) : fallback
  const payloadError = typeof payload?.error === 'string' ? payload.error.trim().toLowerCase() : ''
  const payloadMessage = typeof payload?.message === 'string' ? payload.message.trim().toLowerCase() : ''
  const normalized = `${rawMessage.toLowerCase()} ${payloadError} ${payloadMessage}`

  if (normalized.includes('delivery address is required')) {
    return 'Add a delivery address before starting payment.'
  }

  if (normalized === 'unauthorized' || normalized.includes('session expired') || normalized.includes('sign in again')) {
    return 'Your session expired. Sign in again before starting payment.'
  }

  if (normalized === 'forbidden' || normalized.includes('not available from this account')) {
    return 'This order is not available from this account. Switch accounts or reopen the correct order.'
  }

  if (normalized.includes('quote has expired')) {
    return 'This quote has expired. Ask your tailor to send a fresh one before trying again.'
  }

  if (normalized.includes('custom order is not ready for payment yet')) {
    return 'This quote is not ready for payment yet. Refresh the order and wait for the latest quote.'
  }

  if (normalized.includes('ready-made order is not in a payable state')) {
    return 'This checkout is no longer ready for payment. Reopen the item and try again.'
  }

  if (normalized.includes('not awaiting a delivery or shipping payment')) {
    return 'This order is not awaiting a delivery or shipping payment right now. Refresh the order first.'
  }

  if (normalized.includes('not awaiting fulfillment payment confirmation')) {
    return 'This delivery or shipping payment is no longer awaiting confirmation. Pull to refresh in a moment.'
  }

  if (normalized.includes('missing payment details')) {
    return 'This order is missing payment details right now. Refresh first, then try again.'
  }

  if (normalized.includes('verified email is required')) {
    return 'Add a verified email to your account before starting this checkout.'
  }

  if (normalized.includes('payment is still processing')) {
    return 'Payment is still processing. Pull to refresh in a moment.'
  }

  if (normalized.includes('payment was canceled')) {
    return 'Payment was canceled. Start payment again when you are ready.'
  }

  if (normalized.includes('payment failed')) {
    return 'Payment failed. Start payment again when you are ready.'
  }

  if (normalized.includes('checkout url') || normalized.includes('checkout link')) {
    return 'Payment checkout could not open cleanly. Please try again in a moment.'
  }

  if (normalized.includes('client secret') || normalized.includes('payment intent')) {
    return 'Card checkout could not open cleanly. Please try again in a moment.'
  }

  return isMachineErrorCodeMessage(rawMessage) ? fallback : rawMessage
}

function successResult(data: {
  orderId: string
  stage: string
  paymentIntentId: string
  alreadyPaid?: boolean
}): OrderPaymentFlowResult {
  return {
    ok: true,
    orderId: data.orderId,
    stage: data.stage,
    paymentIntentId: data.paymentIntentId,
    alreadyPaid: data.alreadyPaid,
  }
}

function nativePaymentSheetErrorMessage(
  error: { localizedMessage?: string | null; message?: string | null; code?: string | null } | null | undefined,
  fallback: string,
) {
  const raw = `${error?.localizedMessage ?? ''} ${error?.message ?? ''} ${error?.code ?? ''}`.toLowerCase()

  if (!raw.trim()) return fallback
  if (raw.includes('declined')) {
    return 'Your card was declined. Try another card or contact your bank.'
  }
  if (raw.includes('insufficient')) {
    return 'This card does not have enough funds for this payment.'
  }
  if (raw.includes('expired')) {
    return 'This card appears to be expired. Use another card.'
  }
  if (raw.includes('authentication') || raw.includes('3d secure') || raw.includes('verification')) {
    return 'Card authentication was not completed. Try again or use another card.'
  }
  if (raw.includes('network') || raw.includes('timed out') || raw.includes('connection')) {
    return 'Connection looks weak. Your payment was not completed. Try again when the signal improves.'
  }

  return fallback
}

async function failureStageFromError(error: Error | null) {
  const payload = error ? await readFunctionErrorPayload(error) : null
  return typeof payload?.stage === 'string' ? payload.stage : undefined
}

export async function confirmOrderPayment(
  orderId: string,
  paymentIntentId: string,
): Promise<OrderPaymentFlowResult> {
  const { data: confirmed, error: confirmError } = await invokeFunction<ConfirmPaymentResponse>('payment-action', {
    body: {
      action: 'confirm-payment',
      orderId,
      paymentIntentId,
    },
  })

  if (confirmError || !confirmed?.confirmed) {
    return {
      ok: false,
      reason: 'failed',
      message: await resolvePaymentErrorMessage(
        confirmError,
        'Payment went through, but we could not confirm the order yet. Pull to refresh in a moment.',
      ),
      stage: await failureStageFromError(confirmError),
    }
  }

  return successResult({
    orderId: confirmed.orderId,
    stage: confirmed.stage,
    paymentIntentId: confirmed.paymentIntentId,
  })
}

function preparedPaymentRoutingFailure(prepared: PreparePaymentResponse): OrderPaymentFlowResult | null {
  if (prepared.provider === 'COVERAGE') return prepared.confirmed ? null : { ok: false, reason: 'failed', message: 'Complimentary coverage has not been confirmed yet.' }
  const orderCurrency = normalizeAccountCurrency(prepared.currency)
  if (!orderCurrency) {
    return {
      ok: false,
      reason: 'failed',
      stage: prepared.stage,
      message: 'This order currency is not supported for payment right now. Refresh the order and try again.',
    }
  }

  const expectedProvider = resolvePaymentProviderForCurrency(orderCurrency)
  if (prepared.provider !== expectedProvider) {
    return {
      ok: false,
      reason: 'failed',
      stage: prepared.stage,
      message: `Payment routing did not match this ${orderCurrency} order. Refresh the order and try again before paying.`,
    }
  }

  return null
}

export function useOrderPaymentFlow() {
  const { available: stripeRuntimeAvailable, initPaymentSheet, presentPaymentSheet } = useOptionalStripe()
  const paystackCheckout = usePaystackCheckout()

  async function failureStage(error: Error | null) {
    return failureStageFromError(error)
  }

  async function startOrderPayment(options: {
    orderId: string
    customerEmail?: string | null
    customerName?: string | null
    quoteId?: string | null
    expectedQuoteVersion?: number | null
  }): Promise<OrderPaymentFlowResult> {
    const { data: prepared, error: prepareError } = await invokeFunction<PreparePaymentResponse>('payment-action', {
      body: {
        action: 'prepare-payment',
        orderId: options.orderId,
        ...(options.quoteId ? { quoteId: options.quoteId } : {}),
        ...(options.expectedQuoteVersion
          ? { expectedQuoteVersion: options.expectedQuoteVersion }
          : {}),
      },
    })

    if (prepareError || !prepared) {
      return {
        ok: false,
        reason: 'failed',
        message: await resolvePaymentErrorMessage(
          prepareError,
          'Could not start payment for this order right now.',
        ),
        stage: await failureStage(prepareError),
      }
    }

    const routingFailure = preparedPaymentRoutingFailure(prepared)
    if (routingFailure) {
      return routingFailure
    }

    if (prepared.confirmed || prepared.alreadyPaid || prepared.stage === 'CONFIRMED') {
      return successResult({
        orderId: prepared.orderId,
        stage: prepared.stage,
        paymentIntentId: prepared.paymentIntentId,
        alreadyPaid: prepared.alreadyPaid,
      })
    }

    if (prepared.provider === 'PAYSTACK') {
      if (!prepared.authorizationUrl) {
        return {
          ok: false,
          reason: 'failed',
          message: 'Payment checkout could not open cleanly. Please try again in a moment.',
        }
      }

      const browserResult = await paystackCheckout.present(
        prepared.authorizationUrl,
        PAYSTACK_RETURN_URL,
      )

      let reference = prepared.paymentIntentId
      if (browserResult.type === 'success') {
        try {
          const callbackUrl = new URL(browserResult.url)
          reference =
            callbackUrl.searchParams.get('reference') ??
            callbackUrl.searchParams.get('trxref') ??
            prepared.paymentIntentId
        } catch {
          reference = prepared.paymentIntentId
        }
      }

      const confirmed = await confirmOrderPayment(prepared.orderId, reference)
      if (confirmed.ok) {
        return confirmed
      }

      if (browserResult.type === 'success') {
        return confirmed
      }

      if (browserResult.type === 'error') {
        return { ok: false, reason: 'failed', message: browserResult.message, stage: prepared.stage }
      }

      return {
        ok: false,
        reason: 'cancelled',
        message: 'Payment was not completed.',
        stage: prepared.stage,
      }
    }

    if (!hasStripePublishableKey()) {
      return {
        ok: false,
        reason: 'not_configured',
        message: 'Card payments are not available in this build yet. Use another supported payment method or try again after updating the app.',
      }
    }

    if (!stripeRuntimeAvailable || !isNativeStripeRuntimeAvailable()) {
      return {
        ok: false,
        reason: 'not_configured',
        message: getStripeUnavailableMessage(),
      }
    }

    if (!prepared.clientSecret) {
      return {
        ok: false,
        reason: 'failed',
        message: 'Card checkout could not open cleanly. Please try again in a moment.',
      }
    }

    const { error: initError } = await initPaymentSheet({
      merchantDisplayName: STRIPE_MERCHANT_DISPLAY_NAME,
      paymentIntentClientSecret: prepared.clientSecret,
      returnURL: STRIPE_RETURN_URL,
      allowsDelayedPaymentMethods: false,
      defaultBillingDetails: {
        email: options.customerEmail?.trim() || undefined,
        name: options.customerName?.trim() || undefined,
      },
    })

    if (initError) {
      return {
        ok: false,
        reason: 'failed',
        message: nativePaymentSheetErrorMessage(
          initError,
          'Card checkout could not open cleanly. Please try again in a moment.',
        ),
      }
    }

    const { error: presentError } = await presentPaymentSheet()
    if (presentError) {
      if (isStripePaymentSheetCanceled(presentError.code)) {
        return {
          ok: false,
          reason: 'cancelled',
          message: 'Payment was not completed.',
          stage: prepared.stage,
        }
      }

      return {
        ok: false,
        reason: 'failed',
        message: nativePaymentSheetErrorMessage(
          presentError,
          'Payment could not be completed. Try again or use another card.',
        ),
      }
    }

    return confirmOrderPayment(prepared.orderId, prepared.paymentIntentId)
  }

  async function startMaterialAdvancePayment(options: {
    orderId: string
    advanceId: string
    customerEmail?: string | null
    customerName?: string | null
  }): Promise<OrderPaymentFlowResult> {
    const { data: prepared, error: prepareError } = await invokeFunction<MaterialAdvancePreparePaymentResponse>(
      'material-advance-action',
      {
        body: {
          action: 'prepare-payment',
          orderId: options.orderId,
          advanceId: options.advanceId,
        },
      },
    )

    if (prepareError || !prepared) {
      return {
        ok: false,
        reason: 'failed',
        message: await resolvePaymentErrorMessage(
          prepareError,
          'Could not start the material advance payment right now.',
        ),
      }
    }

    const orderCurrency = normalizeAccountCurrency(prepared.currency)
    if (!orderCurrency || prepared.provider !== resolvePaymentProviderForCurrency(orderCurrency)) {
      return {
        ok: false,
        reason: 'failed',
        message: 'Payment routing did not match this material advance. Refresh the order and try again before paying.',
      }
    }

    const confirmMaterialAdvance = async (providerPaymentId: string): Promise<OrderPaymentFlowResult> => {
      const { data: confirmed, error: confirmError } = await invokeFunction<MaterialAdvanceConfirmPaymentResponse>(
        'material-advance-action',
        {
          body: {
            action: 'confirm-payment',
            advanceId: options.advanceId,
            paymentIntentId: providerPaymentId,
          },
        },
      )

      if (confirmError || !confirmed?.confirmed) {
        return {
          ok: false,
          reason: 'failed',
          message: await resolvePaymentErrorMessage(
            confirmError,
            'Payment went through, but Drapeon could not confirm the material advance yet. Pull to refresh in a moment.',
          ),
        }
      }

      return successResult({
        orderId: options.orderId,
        stage: confirmed.advance.status,
        paymentIntentId: providerPaymentId,
      })
    }

    if (prepared.provider === 'PAYSTACK') {
      if (!prepared.authorizationUrl) {
        return {
          ok: false,
          reason: 'failed',
          message: 'Payment checkout could not open cleanly. Please try again in a moment.',
        }
      }

      const browserResult = await paystackCheckout.present(
        prepared.authorizationUrl,
        PAYSTACK_RETURN_URL,
      )

      let reference = prepared.paymentIntentId
      if (browserResult.type === 'success') {
        try {
          const callbackUrl = new URL(browserResult.url)
          reference =
            callbackUrl.searchParams.get('reference') ??
            callbackUrl.searchParams.get('trxref') ??
            prepared.paymentIntentId
        } catch {
          reference = prepared.paymentIntentId
        }
      }

      const confirmed = await confirmMaterialAdvance(reference)
      if (confirmed.ok || browserResult.type === 'success') return confirmed
      if (browserResult.type === 'error') {
        return { ok: false, reason: 'failed', message: browserResult.message }
      }

      return {
        ok: false,
        reason: 'cancelled',
        message: 'Payment was not completed.',
      }
    }

    if (!hasStripePublishableKey()) {
      return {
        ok: false,
        reason: 'not_configured',
        message: 'Card payments are not available in this build yet. Use another supported payment method or try again after updating the app.',
      }
    }

    if (!stripeRuntimeAvailable || !isNativeStripeRuntimeAvailable()) {
      return {
        ok: false,
        reason: 'not_configured',
        message: getStripeUnavailableMessage(),
      }
    }

    if (!prepared.clientSecret) {
      return {
        ok: false,
        reason: 'failed',
        message: 'Card checkout could not open cleanly. Please try again in a moment.',
      }
    }

    const { error: initError } = await initPaymentSheet({
      merchantDisplayName: STRIPE_MERCHANT_DISPLAY_NAME,
      paymentIntentClientSecret: prepared.clientSecret,
      returnURL: STRIPE_RETURN_URL,
      allowsDelayedPaymentMethods: false,
      defaultBillingDetails: {
        email: options.customerEmail?.trim() || undefined,
        name: options.customerName?.trim() || undefined,
      },
    })

    if (initError) {
      return {
        ok: false,
        reason: 'failed',
        message: nativePaymentSheetErrorMessage(
          initError,
          'Card checkout could not open cleanly. Please try again in a moment.',
        ),
      }
    }

    const { error: presentError } = await presentPaymentSheet()
    if (presentError) {
      if (isStripePaymentSheetCanceled(presentError.code)) {
        return {
          ok: false,
          reason: 'cancelled',
          message: 'Payment was not completed.',
        }
      }

      return {
        ok: false,
        reason: 'failed',
        message: nativePaymentSheetErrorMessage(
          presentError,
          'Payment could not be completed. Try again or use another card.',
        ),
      }
    }

    return confirmMaterialAdvance(prepared.paymentIntentId)
  }

  async function startCommercialAdjustmentPayment(options: {
    orderId: string
    adjustmentId: string
    customerEmail?: string | null
    customerName?: string | null
  }): Promise<OrderPaymentFlowResult> {
    const { data: prepared, error: prepareError } = await invokeFunction<CommercialAdjustmentPreparePaymentResponse>(
      'commercial-adjustment-action',
      { body: { action: 'prepare-payment', adjustmentId: options.adjustmentId } },
    )
    if (prepareError || !prepared) {
      return { ok: false, reason: 'failed', message: await resolvePaymentErrorMessage(prepareError, 'Could not start this approved order-change payment.') }
    }
    const orderCurrency = normalizeAccountCurrency(prepared.currency)
    if (!orderCurrency || prepared.provider !== resolvePaymentProviderForCurrency(orderCurrency)) {
      return { ok: false, reason: 'failed', message: 'Payment routing did not match this approved order change. Refresh and try again.' }
    }

    const confirm = async (paymentIntentId: string): Promise<OrderPaymentFlowResult> => {
      const { data, error } = await invokeFunction<{ ok: boolean; confirmed: boolean }>('commercial-adjustment-action', {
        body: { action: 'confirm-payment', adjustmentId: options.adjustmentId, paymentIntentId },
      })
      if (error || !data?.confirmed) {
        return { ok: false, reason: 'failed', message: await resolvePaymentErrorMessage(error, 'Payment went through, but Drapeon could not confirm the order change yet. Pull to refresh shortly.') }
      }
      return successResult({ orderId: options.orderId, stage: 'PAID', paymentIntentId })
    }

    if (prepared.provider === 'PAYSTACK') {
      if (!prepared.authorizationUrl) return { ok: false, reason: 'failed', message: 'Secure checkout could not open. Try again in a moment.' }
      const checkout = await paystackCheckout.present(prepared.authorizationUrl, PAYSTACK_RETURN_URL)
      let reference = prepared.paymentIntentId
      if (checkout.type === 'success') {
        try {
          const callback = new URL(checkout.url)
          reference = callback.searchParams.get('reference') ?? callback.searchParams.get('trxref') ?? reference
        } catch { /* server verification still uses the prepared reference */ }
      }
      const confirmed = await confirm(reference)
      if (confirmed.ok || checkout.type === 'success') return confirmed
      if (checkout.type === 'error') return { ok: false, reason: 'failed', message: checkout.message }
      return { ok: false, reason: 'cancelled', message: 'Payment was not completed.' }
    }

    if (!hasStripePublishableKey()) return { ok: false, reason: 'not_configured', message: 'Card payments are not available in this build yet.' }
    if (!stripeRuntimeAvailable || !isNativeStripeRuntimeAvailable()) return { ok: false, reason: 'not_configured', message: getStripeUnavailableMessage() }
    if (!prepared.clientSecret) return { ok: false, reason: 'failed', message: 'Card checkout could not open cleanly.' }
    const { error: initError } = await initPaymentSheet({
      merchantDisplayName: STRIPE_MERCHANT_DISPLAY_NAME,
      paymentIntentClientSecret: prepared.clientSecret,
      returnURL: STRIPE_RETURN_URL,
      allowsDelayedPaymentMethods: false,
      defaultBillingDetails: { email: options.customerEmail?.trim() || undefined, name: options.customerName?.trim() || undefined },
    })
    if (initError) return { ok: false, reason: 'failed', message: nativePaymentSheetErrorMessage(initError, 'Card checkout could not open cleanly.') }
    const { error: presentError } = await presentPaymentSheet()
    if (presentError) {
      if (isStripePaymentSheetCanceled(presentError.code)) return { ok: false, reason: 'cancelled', message: 'Payment was not completed.' }
      return { ok: false, reason: 'failed', message: nativePaymentSheetErrorMessage(presentError, 'Payment could not be completed.') }
    }
    return confirm(prepared.paymentIntentId)
  }

  async function startOrderTip(options: { orderId: string; amount: number; currency: string; customerEmail?: string | null; customerName?: string | null }): Promise<OrderPaymentFlowResult> {
    const { data: prepared, error: prepareError } = await invokeFunction<{ ok: boolean; confirmed?: boolean; tipId: string; provider: 'STRIPE'|'PAYSTACK'; providerReference: string; authorizationUrl: string|null; clientSecret: string|null; amount: number; currency: string }>('order-tip-action', { body: { action: 'prepare', orderId: options.orderId, amount: options.amount, currency: options.currency, idempotencyKey: `tip:${options.orderId}:${options.amount}` } })
    if (prepareError || !prepared) return { ok: false, reason: 'failed', message: await resolvePaymentErrorMessage(prepareError, 'Could not start this tip payment.') }
    if (prepared.confirmed) return successResult({ orderId: options.orderId, stage: 'PAYOUT_PENDING', paymentIntentId: prepared.providerReference })
    const confirm = async () => {
      const { data, error } = await invokeFunction<{ confirmed: boolean }>('order-tip-action', { body: { action: 'confirm', tipId: prepared.tipId, providerReference: prepared.providerReference } })
      if (error || !data?.confirmed) return { ok: false, reason: 'failed', message: await resolvePaymentErrorMessage(error, 'The tip went through, but confirmation is still pending.') } as OrderPaymentFlowResult
      return successResult({ orderId: options.orderId, stage: 'PAYOUT_PENDING', paymentIntentId: prepared.providerReference })
    }
    if (prepared.provider === 'PAYSTACK') {
      if (!prepared.authorizationUrl) return { ok: false, reason: 'failed', message: 'Secure tip checkout could not open.' }
      const checkout = await paystackCheckout.present(prepared.authorizationUrl, PAYSTACK_RETURN_URL)
      const result = await confirm()
      if (result.ok || checkout.type === 'success') return result
      if (checkout.type === 'error') return { ok: false, reason: 'failed', message: checkout.message }
      return { ok: false, reason: 'cancelled', message: 'Tip was not completed.' }
    }
    if (!hasStripePublishableKey() || !stripeRuntimeAvailable || !isNativeStripeRuntimeAvailable()) return { ok: false, reason: 'not_configured', message: getStripeUnavailableMessage() }
    if (!prepared.clientSecret) return { ok: false, reason: 'failed', message: 'Card tip checkout could not open.' }
    const { error: initError } = await initPaymentSheet({ merchantDisplayName: STRIPE_MERCHANT_DISPLAY_NAME, paymentIntentClientSecret: prepared.clientSecret, returnURL: STRIPE_RETURN_URL, allowsDelayedPaymentMethods: false, defaultBillingDetails: { email: options.customerEmail?.trim() || undefined, name: options.customerName?.trim() || undefined } })
    if (initError) return { ok: false, reason: 'failed', message: nativePaymentSheetErrorMessage(initError, 'Card tip checkout could not open.') }
    const { error: presentError } = await presentPaymentSheet()
    if (presentError) return isStripePaymentSheetCanceled(presentError.code) ? { ok: false, reason: 'cancelled', message: 'Tip was not completed.' } : { ok: false, reason: 'failed', message: nativePaymentSheetErrorMessage(presentError, 'Tip could not be completed.') }
    return confirm()
  }

  return {
    startOrderPayment,
    startMaterialAdvancePayment,
    startCommercialAdjustmentPayment,
    startOrderTip,
    isStripeConfigured: hasStripePublishableKey(),
  }
}
