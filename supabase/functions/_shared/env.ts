export function getSupabaseUrl(): string {
  return Deno.env.get('SUPABASE_URL')!
}

export function getServiceRoleKey(): string {
  return (
    Deno.env.get('DRAPE_SERVICE_ROLE_JWT') ??
    Deno.env.get('DRAPE_SERVICE_ROLE_KEY') ??
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  )!
}

export function getSupabaseAnonKey(): string {
  const key =
    Deno.env.get('SUPABASE_ANON_KEY') ??
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ??
    Deno.env.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (!key) throw new Error('Missing Supabase anon key environment variable.')
  return key
}

export function getStripeSecretKey(): string {
  const key = Deno.env.get('STRIPE_SECRET_KEY') ?? Deno.env.get('STRIPE_SECRET_KEY_SANDBOX')
  if (!key) throw new Error('Missing Stripe secret key environment variable.')
  return key
}

export function getStripeWebhookSecrets(): string[] {
  const secrets = [
    Deno.env.get('STRIPE_WEBHOOK_SECRET'),
    Deno.env.get('STRIPE_WEBHOOK_SECRETS'),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index)

  if (secrets.length === 0) throw new Error('Missing Stripe webhook secret environment variable.')
  return secrets
}

export function getStripeWebhookSecret(): string {
  return getStripeWebhookSecrets()[0]
}

export function getPaystackSecretKey(): string {
  const key = Deno.env.get('PAYSTACK_SECRET_KEY') ?? Deno.env.get('PAYSTACK_SECRET_KEY_TEST')
  if (!key) throw new Error('Missing Paystack secret key environment variable.')
  return key
}

export function getPaystackCallbackUrl(): string {
  const siteUrl =
    Deno.env.get('PAYSTACK_CALLBACK_URL') ??
    Deno.env.get('SITE_URL') ??
    Deno.env.get('NEXT_PUBLIC_SITE_URL') ??
    'https://drapeon.co'

  if (siteUrl.includes('/payments/paystack/callback')) {
    return siteUrl
  }

  return `${siteUrl.replace(/\/+$/u, '')}/payments/paystack/callback`
}

export function getZiptaxApiKey(): string {
  const key = Deno.env.get('ZIPTAX_API_KEY')
  if (!key) throw new Error('Missing ZIPTAX_API_KEY environment variable.')
  return key
}

export function getOptionalSentryDsn(): string | null {
  return Deno.env.get('SENTRY_DSN') ?? Deno.env.get('SUPABASE_SENTRY_DSN') ?? null
}

export function getOptionalHealthcheckSecret(): string | null {
  return Deno.env.get('DRAPE_HEALTHCHECK_SECRET') ?? Deno.env.get('HEALTHCHECK_SECRET') ?? null
}

export function getDailyApiKey(): string {
  const key = Deno.env.get('DAILY_API_KEY')
  if (!key) throw new Error('Missing Daily API key environment variable.')
  return key
}
