import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { rejectIfBlockedContact } from '../_shared/contact-bypass.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
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

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  if (typeof body.error === 'string' && typeof body.message !== 'string') {
    body.message = body.error
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) return jsonResponse({ error: 'Please sign in again before managing client diary entries.' }, 401, cors)

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400, cors)

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 60)
    if (!allowed) return rateLimitExceededResponse(cors)

    const body = parsed.data

    if (body.action === 'create' || body.action === 'update') {
      const textFields = [
        { surface: 'diary_entries.full_name', text: body.entry.full_name, field: 'full_name' },
        { surface: 'diary_entries.client_notes', text: body.entry.client_notes, field: 'client_notes' },
        { surface: 'diary_entries.fabric_preference', text: body.entry.fabric_preference, field: 'fabric_preference' },
        { surface: 'diary_entries.style_preference', text: body.entry.style_preference, field: 'style_preference' },
        { surface: 'diary_entries.special_fitting_notes', text: body.entry.special_fitting_notes, field: 'special_fitting_notes' },
      ] as const

      for (const field of textFields) {
        const blockedField = await rejectIfBlockedContact({
          supabase,
          fn: FN,
          cors,
          actorId: caller.id,
          actorRole: 'TAILOR',
          surface: field.surface,
          text: field.text,
          message: 'Contact details are not allowed in diary entries.',
          extra: { action: body.action, field: field.field },
        })
        if (blockedField) return blockedField
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
          return jsonResponse({ error: 'We could not save this diary entry right now. Please try again.' }, 500, cors)
        }

        await audit(supabase, {
          event: 'diary_entry.created',
          actor_id: caller.id,
          actor_role: 'TAILOR',
          payload: { entry_id: data.id },
        })

        return jsonResponse({ ok: true, entryId: data.id, passportId: data.passport_id }, 200, cors)
      }

      const { data: existing } = await supabase
        .from('diary_entries')
        .select('id')
        .eq('id', body.entryId)
        .eq('tailor_id', caller.id)
        .maybeSingle()

      if (!existing?.id) return jsonResponse({ error: 'That diary entry was not found. Refresh and try again.' }, 404, cors)

      const { error } = await supabase
        .from('diary_entries')
        .update(payload)
        .eq('id', body.entryId)
        .eq('tailor_id', caller.id)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, error: error.message })
        return jsonResponse({ error: 'We could not update this diary entry right now. Please try again.' }, 500, cors)
      }

      await audit(supabase, {
        event: 'diary_entry.updated',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        payload: { entry_id: body.entryId },
      })

      return jsonResponse({ ok: true, entryId: body.entryId }, 200, cors)
    }

    const { entryId } = body
    const { data: existing } = await supabase
      .from('diary_entries')
      .select('id')
      .eq('id', entryId)
      .eq('tailor_id', caller.id)
      .maybeSingle()

    if (!existing?.id) return jsonResponse({ error: 'That diary entry was not found. Refresh and try again.' }, 404, cors)

    if (body.action === 'mark-invite-sent') {
      const { error } = await supabase
        .from('diary_entries')
        .update({ invite_status: 'INVITE_SENT', updated_at: new Date().toISOString() })
        .eq('id', entryId)
        .eq('tailor_id', caller.id)

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, error: error.message })
        return jsonResponse({ error: 'We could not mark this invite as sent right now. Please try again.' }, 500, cors)
      }

      return jsonResponse({ ok: true }, 200, cors)
    }

    const { error } = await supabase
      .from('diary_entries')
      .delete()
      .eq('id', entryId)
      .eq('tailor_id', caller.id)

    if (error) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: error.message })
      return jsonResponse({ error: 'We could not delete this diary entry right now. Please try again.' }, 500, cors)
    }

    await audit(supabase, {
      event: 'diary_entry.deleted',
      actor_id: caller.id,
      actor_role: 'TAILOR',
      payload: { entry_id: entryId },
    })

    return jsonResponse({ ok: true }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonResponse({ error: 'We could not update the client diary right now. Please try again.' }, 500, cors)
  }
})
