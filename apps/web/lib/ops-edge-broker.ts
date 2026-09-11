import 'server-only'

import { randomUUID } from 'node:crypto'
import { headers } from 'next/headers'

export type OpsReadAction =
  | 'session'
  | 'canonical-cases'
  | 'trust-case'
  | 'support-case'
  | 'money'
  | 'money-grant'
  | 'orders'
  | 'order-detail'
  | 'reliability'
  | 'customers'
  | 'customer-detail'
  | 'tailors'
  | 'tailor-detail'
  | 'vision'
  | 'delivery'
  | 'communications'
  | 'access-governance'
  | 'audit-report'

type OpsBrokerEnvelope<T> = {
  ok?: boolean
  data?: T
  error?: string
  correlationId?: string
}

function brokerConfiguration() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? process.env.SUPABASE_URL?.trim()
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? process.env.SUPABASE_ANON_KEY?.trim()
  if (!supabaseUrl || !anonKey) return null
  return { supabaseUrl: supabaseUrl.replace(/\/+$/u, ''), anonKey }
}

export function requiresOpsEdgeBroker() {
  return process.env.NODE_ENV === 'production' || process.env.DRAPE_OPS_ENV === 'production'
}

export async function invokeOpsReadBroker<T>(action: OpsReadAction, input: Record<string, unknown> = {}): Promise<T> {
  const config = brokerConfiguration()
  if (!config) throw new Error('The Ops authorization broker is not configured.')

  const headerStore = await headers()
  const assertion = headerStore.get('cf-access-jwt-assertion')?.trim()
  if (!assertion) throw new Error('A current Cloudflare Access assertion is required.')
  const correlationId = headerStore.get('x-correlation-id')?.trim() || randomUUID()

  const response = await fetch(`${config.supabaseUrl}/functions/v1/ops-read-gateway`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      'Content-Type': 'application/json',
      'x-correlation-id': correlationId,
      'x-drape-ops-access-assertion': assertion,
    },
    body: JSON.stringify({ action, input }),
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => null) as OpsBrokerEnvelope<T> | null
  if (!response.ok || !payload?.ok || payload.data === undefined) {
    throw new Error(payload?.error ?? `The Ops authorization broker returned ${response.status}.`)
  }
  return payload.data
}
