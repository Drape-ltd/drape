import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { log } from './logger.ts'

const FN = 'provider-health'

export type ProviderName =
  | 'STRIPE'
  | 'PAYSTACK'
  | 'TWILIO'
  | 'RESEND'
  | 'EXPO'
  | 'DAILY'
  | 'SHIPBUBBLE'
  | 'SHIPPO'
  | 'TOPSHIP'

export async function getProviderCircuit(
  supabase: SupabaseClient,
  provider: ProviderName | string,
  operation = 'GENERAL',
) {
  const { data, error } = await supabase.rpc('get_provider_circuit', {
    p_provider: provider,
    p_operation: operation,
  })

  if (error) {
    log('warn', FN, 'circuit.lookup_failed', { provider, operation, error: error.message })
    return { open: false, status: 'UNKNOWN', error: error.message }
  }

  const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  return {
    open: payload.open === true,
    status: typeof payload.status === 'string' ? payload.status : 'UNKNOWN',
    message: typeof payload.lastError === 'string' ? payload.lastError : null,
    circuitOpenUntil: typeof payload.circuitOpenUntil === 'string' ? payload.circuitOpenUntil : null,
  }
}

export async function recordProviderHealth(
  supabase: SupabaseClient,
  input: {
    provider: ProviderName | string
    operation?: string
    succeeded: boolean
    error?: string | null
    openAfterFailures?: number
    openSeconds?: number
    metadata?: Record<string, unknown>
  },
) {
  const { error } = await supabase.rpc('record_provider_health', {
    p_provider: input.provider,
    p_operation: input.operation ?? 'GENERAL',
    p_succeeded: input.succeeded,
    p_error: input.error ?? null,
    p_open_after_failures: input.openAfterFailures ?? 3,
    p_open_seconds: input.openSeconds ?? 300,
    p_metadata: input.metadata ?? {},
  })

  if (error) {
    log('warn', FN, 'record.failed', {
      provider: input.provider,
      operation: input.operation ?? 'GENERAL',
      succeeded: input.succeeded,
      error: error.message,
    })
  }
}
