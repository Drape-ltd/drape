import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { parseBody, z, uuid } from '../_shared/validate.ts'

const FN = 'message-action'

const BodySchema = z.object({
  action: z.literal('send-message'),
  orderId: uuid,
  senderRole: z.enum(['CUSTOMER', 'TAILOR']),
  senderName: z.string().trim().min(1).max(80),
  type: z.enum(['TEXT', 'PHOTO', 'VOICE']),
  body: z.string().trim().max(2000).optional(),
  photoUrl: z.string().url().optional(),
  voiceUrl: z.string().url().optional(),
})

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) return new Response('Unauthorized', { status: 401, headers: cors })

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) return new Response(parsed.error, { status: 400, headers: cors })

    const body = parsed.data
    if (body.type === 'TEXT' && !body.body?.trim()) {
      return new Response('Message body is required.', { status: 400, headers: cors })
    }
    if (body.type === 'PHOTO' && !body.photoUrl) {
      return new Response('Photo URL is required.', { status: 400, headers: cors })
    }
    if (body.type === 'VOICE' && !body.voiceUrl) {
      return new Response('Voice URL is required.', { status: 400, headers: cors })
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 180)
    if (!allowed) return new Response('Too many requests', { status: 429, headers: cors })

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, customer_id, tailor_id')
      .eq('id', body.orderId)
      .maybeSingle()

    if (orderError) return new Response('Database error', { status: 500, headers: cors })
    if (!order) return new Response('Order not found.', { status: 404, headers: cors })

    const isCustomer = order.customer_id === caller.id
    const isTailor = order.tailor_id === caller.id
    if (!isCustomer && !isTailor) return new Response('Forbidden', { status: 403, headers: cors })

    const expectedRole = isTailor ? 'TAILOR' : 'CUSTOMER'
    if (body.senderRole !== expectedRole) return new Response('Role mismatch.', { status: 403, headers: cors })

    const payload: Record<string, unknown> = {
      order_id: body.orderId,
      sender_id: caller.id,
      sender_role: body.senderRole,
      sender_name: body.senderName,
      type: body.type,
    }
    if (body.type === 'TEXT') payload.body = body.body!.trim()
    if (body.type === 'PHOTO') payload.photo_url = body.photoUrl!
    if (body.type === 'VOICE') payload.voice_url = body.voiceUrl!

    const { error } = await supabase.from('messages').insert(payload)
    if (error) {
      log('error', FN, 'message.insert_failed', { actor_id: caller.id, error: error.message })
      return new Response('Could not send message', { status: 500, headers: cors })
    }

    await audit(supabase, {
      event: 'message.sent',
      actor_id: caller.id,
      actor_role: body.senderRole,
      payload: { function: FN, order_id: body.orderId, type: body.type },
    })

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return new Response('Internal server error', { status: 500, headers: cors })
  }
})
