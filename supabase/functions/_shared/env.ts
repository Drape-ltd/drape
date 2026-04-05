export function getSupabaseUrl(): string {
  return Deno.env.get('SUPABASE_URL')!
}

export function getServiceRoleKey(): string {
  return Deno.env.get('DRAPE_SERVICE_ROLE_JWT') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
}

export function getStripeSecretKey(): string {
  const key = Deno.env.get('STRIPE_SECRET_KEY') ?? Deno.env.get('STRIPE_SECRET_KEY_SANDBOX')
  if (!key) throw new Error('Missing Stripe secret key environment variable.')
  return key
}

export function getStripeWebhookSecret(): string {
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!secret) throw new Error('Missing Stripe webhook secret environment variable.')
  return secret
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

export function getDailyApiKey(): string {
  const key = Deno.env.get('DAILY_API_KEY')
  if (!key) throw new Error('Missing Daily API key environment variable.')
  return key
}
