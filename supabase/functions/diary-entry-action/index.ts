import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'diary-entry-action'

const nullableText = z.string().trim().max(1000).optional().nullable()
const nullableNumber = z.number().finite().min(0).max(500).optional().nullable()

const EntrySchema = z.object({
  full_name: z.string().trim().min(1).max(120),
  gender: z.enum(['MALE', 'FEMALE', 'PREFER_NOT_TO_SAY']).optional().nullable(),
  client_notes: nullableText,
  measurement_unit: z.enum(['cm', 'in']),
  chest: nullableNumber,
  shoulder: nullableNumber,
  sleeve: nullableNumber,
  waist: nullableNumber,
  hip: nullableNumber,
  trouser_length: nullableNumber,
  neck: nullableNumber,
  thigh: nullableNumber,
  inseam: nullableNumber,
  ankle: nullableNumber,
  bicep: nullableNumber,
  wrist: nullableNumber,
  back_length: nullableNumber,
  under_bust: nullableNumber,
  fabric_preference: nullableText,
  style_preference: nullableText,
  event_type: z.enum(['WEDDING', 'CASUAL', 'ASOEBI', 'FORMAL', 'OTHER']).optional().nullable(),
  special_fitting_notes: nullableText,
  measured_at: z.string().trim().max(20).optional().nullable(),
  measured_location: z.enum(['SHOP', 'CUSTOMER_HOME', 'EVENT']),
})

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    entry: EntrySchema,
  }),
  z.object({
    action: z.literal('update'),
    entryId: uuid,
    entry: EntrySchema,
  }),
  z.object({
    action: z.literal('mark-invite-sent'),
    entryId: uuid,
  }),
  z.object({
    action: z.literal('delete'),
    entryId: uuid,
  }),
])

function hasBlockedContact(text: string) {
  return /(https?:\/\/|www\.|instagram|whatsapp|telegram|@\w+|\+?\d[\d\s().-]{6,}\d)/i.test(text)
}

function validateNoContact(entry: z.infer<typeof EntrySchema>) {
  const textFields = [
    entry.full_name,
    entry.client_notes,
    entry.fabric_preference,
    entry.style_preference,
    entry.special_fitting_notes,
  ]
  return !textFields.some((value) => typeof value === 'string' && value.trim() && hasBlockedContact(value))
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) return new Response('Unauthorized', { status: 401, headers: cors })

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) return new Response(parsed.error, { status: 400, headers: cors })

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 60)
    if (!allowed) return new Response('Too many requests', { status: 429, headers: cors })

    const body = parsed.data

    if (body.action === 'create' || body.action === 'update') {
      if (!validateNoContact(body.entry)) {
        return new Response('Contact details are not allowed in diary entries.', { status: 400, headers: cors })
      }

      const payload = {
        tailor_id: caller.id,
        ...body.entry,
        updated_at: new Date().toISOString(),
      }

      if (body.action === 'create') {
        const { data, error } = await supabase
          .from('diary_entries')
          .insert(payload)
          .select('id, passport_id')
          .single()

        if (error || !data) {
          log('error', FN, 'db.error', { actor_id: caller.id, error: error?.message ?? 'create failed' })
          return new Response(error?.message ?? 'Could not save diary entry.', { status: 500, headers: cors })
        }

        await audit(supabase, {
          event: 'diary_entry.created',
          actor_id: caller.id,
          actor_role: 'TAILOR',
          payload: { entry_id: data.id },
        })

        return new Response(JSON.stringify({ ok: true, entryId: data.id, passportId: data.passport_id }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      const { data: existing } = await supabase
        .from('diary_entries')
        .select('id')
        .eq('id', body.entryId)
        .eq('tailor_id', caller.id)
        .maybeSingle()

      if (!existing?.id) return new Response('Diary entry not found', { status: 404, headers: cors })

      const { error } = await supabase
        .from('diary_entries')
        .update(payload)
        .eq('id', body.entryId)
        .eq('tailor_id', caller.id)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, error: error.message })
        return new Response(error.message ?? 'Could not update diary entry.', { status: 500, headers: cors })
      }

      await audit(supabase, {
        event: 'diary_entry.updated',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        payload: { entry_id: body.entryId },
      })

      return new Response(JSON.stringify({ ok: true, entryId: body.entryId }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { entryId } = body
    const { data: existing } = await supabase
      .from('diary_entries')
      .select('id')
      .eq('id', entryId)
      .eq('tailor_id', caller.id)
      .maybeSingle()

    if (!existing?.id) return new Response('Diary entry not found', { status: 404, headers: cors })

    if (body.action === 'mark-invite-sent') {
      const { error } = await supabase
        .from('diary_entries')
        .update({ invite_status: 'INVITE_SENT', updated_at: new Date().toISOString() })
        .eq('id', entryId)
        .eq('tailor_id', caller.id)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, error: error.message })
        return new Response(error.message ?? 'Could not mark invite sent.', { status: 500, headers: cors })
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { error } = await supabase
      .from('diary_entries')
      .delete()
      .eq('id', entryId)
      .eq('tailor_id', caller.id)

    if (error) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: error.message })
      return new Response(error.message ?? 'Could not delete diary entry.', { status: 500, headers: cors })
    }

    await audit(supabase, {
      event: 'diary_entry.deleted',
      actor_id: caller.id,
      actor_role: 'TAILOR',
      payload: { entry_id: entryId },
    })

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return new Response('Internal server error', { status: 500, headers: cors })
  }
})
