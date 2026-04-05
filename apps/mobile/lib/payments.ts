import * as WebBrowser from 'expo-web-browser'
import { PaymentSheetError, useStripe } from '@stripe/stripe-react-native'
import { readFunctionErrorPayload } from '@/lib/function-errors'
import { invokeFunction } from '@/lib/supabase'

WebBrowser.maybeCompleteAuthSession()

const STRIPE_RETURN_URL = 'drape://stripe-redirect'
const PAYSTACK_RETURN_URL = 'drape://paystack-redirect'
const STRIPE_MERCHANT_DISPLAY_NAME = 'Drape'

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

type PreparePaymentResponse = StripePreparePaymentResponse | PaystackPreparePaymentResponse

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
  const rawMessage =
    (typeof payload?.error === 'string' && payload.error.trim().length > 0
      ? payload.error.trim()
      : error?.message?.trim()) || fallback
  const normalized = rawMessage.toLowerCase()

  if (normalized.includes('delivery address is required')) {
    return 'Add a delivery address before starting payment.'
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

  return rawMessage
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

export function useOrderPaymentFlow() {
  const { initPaymentSheet, presentPaymentSheet } = useStripe()

  async function confirmPreparedPayment(
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
      }
    }

    return successResult({
      orderId: confirmed.orderId,
      stage: confirmed.stage,
      paymentIntentId: confirmed.paymentIntentId,
    })
  }

  async function startOrderPayment(options: {
    orderId: string
    customerEmail?: string | null
    customerName?: string | null
  }): Promise<OrderPaymentFlowResult> {
    const { data: prepared, error: prepareError } = await invokeFunction<PreparePaymentResponse>('payment-action', {
      body: { action: 'prepare-payment', orderId: options.orderId },
    })

    if (prepareError || !prepared) {
      return {
        ok: false,
        reason: 'failed',
        message: await resolvePaymentErrorMessage(
          prepareError,
          'Could not start payment for this order right now.',
        ),
      }
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
          message: 'Paystack did not return a checkout URL. Please try again.',
        }
      }

      const browserResult = await WebBrowser.openAuthSessionAsync(
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

      const confirmed = await confirmPreparedPayment(prepared.orderId, reference)
      if (confirmed.ok) {
        return confirmed
      }

      if (browserResult.type === 'success') {
        return confirmed
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
        message: 'Stripe is not configured in this app build yet. Add the publishable key and try again.',
      }
    }

    if (!prepared.clientSecret) {
      return {
        ok: false,
        reason: 'failed',
        message: 'Payment is missing a client secret. Please try again.',
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
        message: initError.localizedMessage ?? initError.message,
      }
    }

    const { error: presentError } = await presentPaymentSheet()
    if (presentError) {
      if (presentError.code === PaymentSheetError.Canceled) {
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
        message: presentError.localizedMessage ?? presentError.message,
      }
    }

    return confirmPreparedPayment(prepared.orderId, prepared.paymentIntentId)
  }

  return {
    startOrderPayment,
    isStripeConfigured: hasStripePublishableKey(),
  }
}
