/**
 * claim-passport
 *
 * Allows a customer to preview or atomically claim a tailor-issued
 * Client Passport (diary entry) identified by its passport_id UUID.
 *
 * Actions:
 *   preview  — returns tailor display name, client name, and how many
 *              measurements are filled in, without touching the database.
 *              Used to render a confirmation screen before claiming.
 *
 *   claim    — atomically marks the diary_entry as CLAIMED and copies the
 *              available measurements into the caller's customer_profile.
 *              Fails if the entry is already claimed or the invite link has
 *              expired (invite_expires_at < now()).
 *
 * Security:
 *   - Caller must be authenticated (customer JWT).
 *   - Role is verified by checking for a customer_profiles row — tailors
 *     do not have one, so they cannot claim passports.
 *   - Rate limited to 10 attempts per user per hour to prevent brute force.
 *   - All passport lookups and the claim UPDATE use the service role client
 *     so RLS on diary_entries is bypassed server-side (not from the client).
 *   - claimed_by_user_id is never grantable to the authenticated role at DB
 *     level; it can only be written here via service role.
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { z, parseBody, uuid } from '../_shared/validate.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { mergeDiaryMeasurementsIntoCustomerProfile } from '../_shared/fit-passport.ts'

const BodySchema = z.discriminatedUnion('action', [
  z.object({ passportId: uuid, action: z.literal('preview') }),
  z.object({ passportId: uuid, action: z.literal('claim') }),
])

const FN = 'claim-passport'

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed.', message: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  const caller = await getAuthUser(req)
  if (!caller) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // ── Service-role client (bypasses RLS for passport lookups and claim write) ─

  const service = createClient(
    getSupabaseUrl(),
    getServiceRoleKey(),
    { auth: { persistSession: false } },
  )

  // ── Rate limit — 10 attempts per user per hour ────────────────────────────

  const allowed = await checkRateLimit(service, `claim-passport:${caller.id}`, 3600, 10)
  if (!allowed) {
    return rateLimitExceededResponse(cors)
  }

  // ── Role check — must be a customer ──────────────────────────────────────

  const { data: customerProfile } = await service
    .from('customer_profiles')
    .select('id, measurements')
    .eq('user_id', caller.id)
    .maybeSingle()

  if (!customerProfile) {
    return new Response(
      JSON.stringify({ error: 'Only customers can claim passports.' }),
      { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  }

  // ── Parse body ────────────────────────────────────────────────────────────

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body.', message: 'Invalid request body.', code: 'INVALID_JSON' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const parsed = parseBody(BodySchema, rawBody)
  if (!parsed.ok) {
    return new Response(JSON.stringify({ error: 'This invite link could not be opened. Ask your tailor to resend it.', message: 'This invite link could not be opened. Ask your tailor to resend it.', code: 'VALIDATION_FAILED' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const { passportId, action } = parsed.data

  // ── Fetch the diary entry ─────────────────────────────────────────────────

  const { data: entry, error: fetchErr } = await service
    .from('diary_entries')
    .select(`
      id, full_name, invite_status, invite_expires_at, claimed_by_user_id,
      measurement_unit, chest, shoulder, sleeve, waist, hip, trouser_length, neck, inseam,
      thigh, ankle, bicep, wrist, back_length, under_bust, measured_at, measured_location,
      tailor_id,
      tailor_profiles:tailor_profiles!diary_entries_tailor_id_fkey(display_name)
    `)
    .eq('passport_id', passportId)
    .maybeSingle()

  if (fetchErr) {
    console.error(`[${FN}] fetch error:`, fetchErr.message)
    return new Response(JSON.stringify({ error: 'Unexpected error. Please try again.' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  if (!entry) {
    return new Response(JSON.stringify({ error: 'Passport not found.' }), {
      status: 404,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // Count filled measurements (excluding unit field)
  const MEASUREMENT_FIELDS = ['chest', 'shoulder', 'sleeve', 'waist', 'hip', 'trouser_length', 'neck', 'inseam', 'thigh', 'ankle', 'bicep', 'wrist', 'back_length', 'under_bust'] as const
  const measurementCount = MEASUREMENT_FIELDS.filter((f) => (entry as any)[f] !== null).length

  const tailorName = (entry as any).tailor_profiles?.display_name ?? 'Your tailor'

  // ── PREVIEW ───────────────────────────────────────────────────────────────

  if (action === 'preview') {
    const expired = entry.invite_expires_at
      ? new Date(entry.invite_expires_at) < new Date()
      : false

    return new Response(
      JSON.stringify({
        clientName:      entry.full_name,
        tailorName,
        measurementCount,
        inviteStatus:    entry.invite_status,
        expired,
        alreadyClaimed:  entry.invite_status === 'CLAIMED',
      }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  }

  // ── CLAIM ─────────────────────────────────────────────────────────────────

  // Guard: already claimed
  if (entry.invite_status === 'CLAIMED') {
    // Allow the same user to re-claim their own passport (idempotent)
    if (entry.claimed_by_user_id === caller.id) {
      return new Response(
        JSON.stringify({ success: true, alreadyOwned: true }),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
      )
    }
    return new Response(
      JSON.stringify({ error: 'This passport has already been claimed.' }),
      { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  }

  // Guard: expired invite
  if (entry.invite_expires_at && new Date(entry.invite_expires_at) < new Date()) {
    return new Response(
      JSON.stringify({ error: 'This invite link has expired. Ask your tailor to resend.' }),
      { status: 410, headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  }

  // Atomic claim — WHERE clause prevents double-claim race condition
  const { data: claimedRows, error: claimErr } = await service
    .from('diary_entries')
    .update({
      invite_status:       'CLAIMED',
      claimed_by_user_id:  caller.id,
    })
    .eq('passport_id', passportId)
    .is('claimed_by_user_id', null) // only claim if not yet claimed
    .select('id')

  if (claimErr) {
    console.error(`[${FN}] claim update error:`, claimErr.message)
    return new Response(JSON.stringify({ error: 'Failed to claim passport. Please try again.' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  if (!claimedRows || claimedRows.length === 0) {
    // Race condition — another request claimed it between our read and write
    return new Response(
      JSON.stringify({ error: 'This passport has already been claimed.' }),
      { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  }

  // Merge measurements into customer_profiles.measurements
  const merged = mergeDiaryMeasurementsIntoCustomerProfile({
    existing: (customerProfile.measurements as Record<string, unknown> | null) ?? null,
    diaryEntry: entry as Record<string, unknown>,
    claimedAt: new Date().toISOString(),
  })

  const { error: profileErr } = await service
    .from('customer_profiles')
    .update({ measurements: merged })
    .eq('user_id', caller.id)

  if (profileErr) {
    // Non-fatal — passport is claimed, measurement merge is best-effort
    console.error(`[${FN}] measurement merge error:`, profileErr.message)
  }

  const profileLabel = typeof entry.full_name === 'string' && entry.full_name.trim()
    ? entry.full_name.trim()
    : 'Tailor passport'
  const { error: namedProfileErr } = await service
    .from('customer_measurement_profiles')
    .insert({
      customer_id: caller.id,
      label: profileLabel,
      relationship: 'SELF',
      measurements: merged,
      unit_preference: (entry as any).measurement_unit ?? merged.unit ?? 'cm',
      source: 'PASSPORT_CLAIM',
      is_default: false,
      last_measured_at: (entry as any).measured_at ?? new Date().toISOString(),
    })

  if (namedProfileErr) {
    // Non-fatal — older environments may not have named wearer profiles yet.
    console.error(`[${FN}] named measurement profile error:`, namedProfileErr.message)
  }

  console.log(`[${FN}] passport ${passportId} claimed by user ${caller.id}`)

  return new Response(
    JSON.stringify({ success: true, measurementCount }),
    { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
  )
})
