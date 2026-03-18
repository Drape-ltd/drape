/**
 * _shared/logger.ts
 *
 * Structured JSON logger for Drape Edge Functions.
 *
 * - log()   → writes JSON to stdout (captured by Supabase EF log dashboard)
 * - audit() → writes a row to audit_logs table via service-role client
 *
 * Log format (JSON, one line per entry):
 * {
 *   "level": "info" | "warn" | "error",
 *   "fn":    "customer-order-action",
 *   "event": "order.stage_changed",
 *   "ts":    "2026-03-16T12:00:00.000Z",
 *   ...extra fields
 * }
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Level = 'info' | 'warn' | 'error'

export function log(
  level: Level,
  fn: string,
  event: string,
  data?: Record<string, unknown>,
): void {
  const entry = JSON.stringify({
    level,
    fn,
    event,
    ts: new Date().toISOString(),
    ...data,
  })

  if (level === 'error') {
    console.error(entry)
  } else if (level === 'warn') {
    console.warn(entry)
  } else {
    console.log(entry)
  }
}

/**
 * Write a row to audit_logs. Non-blocking — awaiting is optional.
 * Failures are logged to stdout but never thrown (audit must not block the request).
 */
export async function audit(
  supabase: SupabaseClient,
  options: {
    event: string
    actor_id?: string | null
    actor_role?: string | null
    order_id?: string | null
    severity?: Level
    payload?: Record<string, unknown>
  },
): Promise<void> {
  const { event, actor_id, actor_role, order_id, severity = 'info', payload } = options
  const { error } = await supabase.from('audit_logs').insert({
    event,
    actor_id:   actor_id   ?? null,
    actor_role: actor_role ?? null,
    order_id:   order_id   ?? null,
    severity,
    payload:    payload    ?? null,
  })
  if (error) {
    // Don't throw — audit failure must never break the request
    console.error(JSON.stringify({ level: 'error', fn: 'logger', event: 'audit.write_failed', error: error.message }))
  }
}
