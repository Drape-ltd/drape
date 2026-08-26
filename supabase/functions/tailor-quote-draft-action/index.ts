import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { parseBody, z } from '../_shared/validate.ts'
import { SUPPORTED_ACCOUNT_CURRENCIES } from '../../../packages/shared/src/currency-config.ts'
import {
  TAILOR_QUOTE_DRAFT_MAX_BYTES,
  TAILOR_QUOTE_DRAFT_VERSION,
} from '../../../packages/shared/src/quote-draft.ts'

const fields = z.object({
  amount: z.string().max(40),
  tailoringAmount: z.string().max(40),
  fabricAllowanceAmount: z.string().max(40),
  fabricCoverage: z.array(z.string().trim().min(1).max(60)).max(12),
  fabricAssumptions: z.string().max(1200),
  completionDate: z.string().max(40),
  laborAmount: z.string().max(40),
  sourcingAmount: z.string().max(40),
  rushAmount: z.string().max(40),
  includedText: z.string().max(500),
  excludedText: z.string().max(500),
  breakdownSummary: z.string().max(300),
  note: z.string().max(300),
  currency: z.enum(SUPPORTED_ACCOUNT_CURRENCIES),
})

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('load'), orderId: z.string().trim().uuid() }),
  z.object({ action: z.literal('delete'), orderId: z.string().trim().uuid() }),
  z.object({
    action: z.literal('save'),
    orderId: z.string().trim().uuid(),
    version: z.literal(TAILOR_QUOTE_DRAFT_VERSION),
    mode: z.enum(['send', 'revise']),
    fields,
  }),
])

function response(cors: HeadersInit, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return response(cors, { error: 'Method not allowed.' }, 405)
  const auth = await getAuthUser(req)
  if (!auth) return response(cors, { error: 'Sign in again to continue.' }, 401)
  const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
  if (!parsed.ok) return response(cors, { error: parsed.error }, 400)
  const body = parsed.data
  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

  const { data: order, error: orderError } = await supabase.from('orders')
    .select('id, tailor_id, stage')
    .eq('id', body.orderId)
    .maybeSingle()
  if (orderError) return response(cors, { error: 'Could not verify this order.' }, 500)
  if (!order || order.tailor_id !== auth.id) return response(cors, { error: 'This order is not available from your tailor account.' }, 403)

  if (body.action === 'load') {
    const { data, error } = await supabase.from('tailor_quote_drafts')
      .select('version, mode, fields, updated_at')
      .eq('order_id', body.orderId).eq('tailor_id', auth.id).maybeSingle()
    return error
      ? response(cors, { error: 'Could not load this quote draft.' }, 500)
      : response(cors, { ok: true, draft: data ?? null })
  }

  if (body.action === 'delete') {
    const { error } = await supabase.from('tailor_quote_drafts').delete()
      .eq('order_id', body.orderId).eq('tailor_id', auth.id)
    return error
      ? response(cors, { error: 'Could not clear this quote draft.' }, 500)
      : response(cors, { ok: true })
  }

  if (!['PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT'].includes(order.stage)) {
    return response(cors, { error: 'This order no longer accepts quote drafts.' }, 409)
  }
  const encoded = new TextEncoder().encode(JSON.stringify(body.fields))
  if (encoded.byteLength > TAILOR_QUOTE_DRAFT_MAX_BYTES) {
    return response(cors, { error: 'This quote draft is too large to save.' }, 413)
  }
  const now = new Date().toISOString()
  const { data, error } = await supabase.from('tailor_quote_drafts').upsert({
    order_id: body.orderId,
    tailor_id: auth.id,
    version: body.version,
    mode: body.mode,
    fields: body.fields,
    updated_at: now,
  }, { onConflict: 'order_id,tailor_id' }).select('updated_at').single()
  return error
    ? response(cors, { error: 'Could not save this quote draft.' }, 500)
    : response(cors, { ok: true, updatedAt: data.updated_at })
})
