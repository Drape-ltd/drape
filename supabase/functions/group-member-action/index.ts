/**
 * group-member-action
 *
 * Handles group-order invite acceptance. The owner can share invite codes from
 * the order screen; invited customers accept with their own measurement profile
 * so the tailor receives one protected group brief instead of loose texts.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'group-member-action'

const inviteCode = z.string().trim().min(16).max(80)

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), orderId: uuid }),
  z.object({ action: z.literal('preview'), inviteCode }),
  z.object({ action: z.literal('accept'), inviteCode, measurementProfileId: uuid.optional().nullable() }),
  z.object({ action: z.literal('decline'), inviteCode }),
  z.object({ action: z.literal('mark-invited'), memberId: uuid }),
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

function displayNameFromProfile(row: unknown, fallback: string) {
  const value = (row as { display_name?: string | null } | null)?.display_name
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405, cors)
  }

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      return jsonResponse({ error: 'Please sign in before opening this group invite.' }, 401, cors)
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      return jsonResponse({ error: 'This group invite could not be opened. Ask the order owner to resend it.' }, 400, cors)
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey(), {
      auth: { persistSession: false },
    })

    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 30)
    if (!allowed) return rateLimitExceededResponse(cors)

    const { data: customerProfile } = await supabase
      .from('customer_profiles')
      .select('id, display_name')
      .eq('user_id', caller.id)
      .maybeSingle()

    if (!customerProfile) {
      return jsonResponse({ error: 'Only customer accounts can accept group order invites.' }, 403, cors)
    }

    if (parsed.data.action === 'list') {
      const { data: members, error: membersError } = await supabase
        .from('order_group_members')
        .select('id, display_name, status, invite_code, invited_user_id, accepted_at, owner_customer_id')
        .eq('order_id', parsed.data.orderId)
        .order('created_at', { ascending: true })

      if (membersError) {
        log('error', FN, 'list.failed', { actor_id: caller.id, order_id: parsed.data.orderId, error: membersError.message })
        return jsonResponse({ error: 'We could not load group members right now.' }, 500, cors)
      }

      const rows = (members ?? []) as Array<{
        id: string
        display_name: string
        status: string
        invite_code: string
        invited_user_id: string | null
        accepted_at: string | null
        owner_customer_id: string
      }>
      if (rows.some((row) => row.owner_customer_id !== caller.id)) {
        return jsonResponse({ error: 'Only the order owner can view this group list.' }, 403, cors)
      }

      return jsonResponse({
        ok: true,
        members: rows.map((row) => ({
          id: row.id,
          displayName: row.display_name,
          status: row.status,
          inviteCode: row.invite_code,
          invitedUserId: row.invited_user_id,
          acceptedAt: row.accepted_at,
        })),
      }, 200, cors)
    }

    if (parsed.data.action === 'mark-invited') {
      const { data: member, error: memberError } = await supabase
        .from('order_group_members')
        .select('id, owner_customer_id, status')
        .eq('id', parsed.data.memberId)
        .maybeSingle()

      if (memberError || !member) {
        return jsonResponse({ error: 'This group member could not be found.' }, 404, cors)
      }
      if ((member as { owner_customer_id?: string }).owner_customer_id !== caller.id) {
        return jsonResponse({ error: 'Only the order owner can share this group invite.' }, 403, cors)
      }

      const { error: updateError } = await supabase
        .from('order_group_members')
        .update({
          status: (member as { status?: string }).status === 'ACCEPTED' ? 'ACCEPTED' : 'INVITED',
          invited_at: new Date().toISOString(),
        })
        .eq('id', parsed.data.memberId)

      if (updateError) {
        log('error', FN, 'mark_invited.failed', { actor_id: caller.id, error: updateError.message })
        return jsonResponse({ error: 'We could not mark this invite as shared. Please try again.' }, 500, cors)
      }

      return jsonResponse({ ok: true }, 200, cors)
    }

    const { data: invite, error: inviteError } = await supabase
      .from('order_group_members')
      .select('id, order_id, owner_customer_id, invited_user_id, display_name, role, status, invite_code, measurement_profile_id, accepted_at, orders(reference, garment_type, stage)')
      .eq('invite_code', parsed.data.inviteCode)
      .maybeSingle()

    if (inviteError || !invite) {
      return jsonResponse({ error: 'This group invite is not valid anymore. Ask the order owner to resend it.' }, 404, cors)
    }

    const inviteRow = invite as {
      id: string
      order_id: string
      owner_customer_id: string
      invited_user_id: string | null
      display_name: string
      role: string
      status: string
      invite_code: string
      measurement_profile_id: string | null
      accepted_at: string | null
      orders?: { reference?: string | null; garment_type?: string | null; stage?: string | null } | Array<{ reference?: string | null; garment_type?: string | null; stage?: string | null }> | null
    }

    const order = Array.isArray(inviteRow.orders) ? inviteRow.orders[0] : inviteRow.orders

    const { data: ownerProfile } = await supabase
      .from('customer_profiles')
      .select('display_name')
      .eq('user_id', inviteRow.owner_customer_id)
      .maybeSingle()

    const ownerName = displayNameFromProfile(ownerProfile, 'The order owner')

    if (parsed.data.action === 'preview') {
      return jsonResponse({
        ok: true,
        memberName: inviteRow.display_name,
        ownerName,
        orderReference: order?.reference ?? inviteRow.order_id,
        garmentType: order?.garment_type ?? 'Group order',
        status: inviteRow.status,
        alreadyAcceptedByYou: inviteRow.status === 'ACCEPTED' && inviteRow.invited_user_id === caller.id,
        acceptedBySomeoneElse: inviteRow.status === 'ACCEPTED' && inviteRow.invited_user_id !== caller.id,
      }, 200, cors)
    }

    if (inviteRow.status === 'REMOVED') {
      return jsonResponse({ error: 'This group invite has been removed by the order owner.' }, 409, cors)
    }

    if (inviteRow.status === 'ACCEPTED' && inviteRow.invited_user_id && inviteRow.invited_user_id !== caller.id) {
      return jsonResponse({ error: 'This group invite has already been accepted by another account.' }, 409, cors)
    }

    if (parsed.data.action === 'decline') {
      if (inviteRow.status === 'ACCEPTED' && inviteRow.invited_user_id === caller.id) {
        return jsonResponse({ error: 'This invite is already attached to your measurements. Contact support if that was a mistake.' }, 409, cors)
      }

      const { error: declineError } = await supabase
        .from('order_group_members')
        .update({ status: 'DECLINED', invited_user_id: caller.id })
        .eq('id', inviteRow.id)

      if (declineError) {
        log('error', FN, 'decline.failed', { actor_id: caller.id, error: declineError.message })
        return jsonResponse({ error: 'We could not decline this invite right now. Please try again.' }, 500, cors)
      }

      await audit(supabase, {
        event: 'group_order.invite_declined',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        order_id: inviteRow.order_id,
        payload: { function: FN, member_id: inviteRow.id },
      })

      return jsonResponse({ ok: true, status: 'DECLINED' }, 200, cors)
    }

    let measurementProfileId = parsed.data.measurementProfileId ?? null

    if (measurementProfileId) {
      const { data: profile } = await supabase
        .from('customer_measurement_profiles')
        .select('id')
        .eq('id', measurementProfileId)
        .eq('customer_id', caller.id)
        .maybeSingle()
      if (!profile) {
        return jsonResponse({ error: 'Choose one of your own measurement profiles before accepting this invite.' }, 400, cors)
      }
    } else {
      const { data: defaultProfile } = await supabase
        .from('customer_measurement_profiles')
        .select('id')
        .eq('customer_id', caller.id)
        .order('is_default', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      measurementProfileId = (defaultProfile as { id?: string } | null)?.id ?? null
    }

    if (!measurementProfileId) {
      return jsonResponse({
        error: 'Add or choose a measurement profile before accepting this group invite.',
        code: 'MEASUREMENT_PROFILE_REQUIRED',
      }, 400, cors)
    }

    const { error: acceptError } = await supabase
      .from('order_group_members')
      .update({
        status: 'ACCEPTED',
        invited_user_id: caller.id,
        measurement_profile_id: measurementProfileId,
        accepted_at: new Date().toISOString(),
      })
      .eq('id', inviteRow.id)

    if (acceptError) {
      log('error', FN, 'accept.failed', { actor_id: caller.id, error: acceptError.message })
      return jsonResponse({ error: 'We could not accept this invite right now. Please try again.' }, 500, cors)
    }

    await audit(supabase, {
      event: 'group_order.invite_accepted',
      actor_id: caller.id,
      actor_role: 'CUSTOMER',
      order_id: inviteRow.order_id,
      payload: { function: FN, member_id: inviteRow.id, measurement_profile_id: measurementProfileId },
    })

    return jsonResponse({ ok: true, status: 'ACCEPTED' }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonResponse({ error: 'We could not process this group invite right now. Please try again.' }, 500, cors)
  }
})
