import { Fragment, type ReactNode } from 'react'

type StripeSheetError = {
  code?: string
  message?: string
  localizedMessage?: string | null
}

type StripeSheetResult = {
  error?: StripeSheetError | null
}

type StripeHookValue = {
  initPaymentSheet: (params: Record<string, unknown>) => Promise<StripeSheetResult>
  presentPaymentSheet: () => Promise<StripeSheetResult>
}

type StripeProviderProps = {
  publishableKey: string
  urlScheme: string
  setReturnUrlSchemeOnAndroid?: boolean
  children: ReactNode
}

const STRIPE_UNAVAILABLE_MESSAGE =
  'Stripe checkout is not available in this app runtime yet. Open Drape in the rebuilt development client before testing Stripe payments.'

let stripeRuntimeResolved = false
let stripeProviderImpl: ((props: StripeProviderProps) => ReactNode) | null = null
let stripeUseStripeImpl: (() => StripeHookValue) | null = null
let stripeCanceledCode = 'Canceled'

function resolveStripeRuntime() {
  if (stripeRuntimeResolved) return
  stripeRuntimeResolved = true

  try {
    const stripeModule = require('@stripe/stripe-react-native')
    stripeProviderImpl = stripeModule.StripeProvider ?? null
    stripeUseStripeImpl = stripeModule.useStripe ?? null
    stripeCanceledCode = stripeModule.PaymentSheetError?.Canceled ?? stripeCanceledCode
  } catch {
    stripeProviderImpl = null
    stripeUseStripeImpl = null
  }
}

function unavailableResult(): StripeSheetResult {
  return {
    error: {
      code: 'stripe_unavailable',
      message: STRIPE_UNAVAILABLE_MESSAGE,
      localizedMessage: STRIPE_UNAVAILABLE_MESSAGE,
    },
  }
}

export function isNativeStripeRuntimeAvailable() {
  resolveStripeRuntime()
  return !!stripeProviderImpl && !!stripeUseStripeImpl
}

export function OptionalStripeProvider({
  children,
  publishableKey,
  urlScheme,
  setReturnUrlSchemeOnAndroid,
}: StripeProviderProps) {
  resolveStripeRuntime()

  if (!publishableKey || !stripeProviderImpl) {
    return <Fragment>{children}</Fragment>
  }

  const Provider = stripeProviderImpl

  return (
    <Provider
      publishableKey={publishableKey}
      urlScheme={urlScheme}
      setReturnUrlSchemeOnAndroid={setReturnUrlSchemeOnAndroid}
    >
      {children}
    </Provider>
  )
}

export function useOptionalStripe(): StripeHookValue & { available: boolean } {
  resolveStripeRuntime()

  if (stripeUseStripeImpl) {
    return {
      ...stripeUseStripeImpl(),
      available: true,
    }
  }

  return {
    available: false,
    initPaymentSheet: async () => unavailableResult(),
    presentPaymentSheet: async () => unavailableResult(),
  }
}

export function isStripePaymentSheetCanceled(code: string | undefined) {
  resolveStripeRuntime()
  return code === stripeCanceledCode
}

export function getStripeUnavailableMessage() {
  return STRIPE_UNAVAILABLE_MESSAGE
}
