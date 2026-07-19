import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { rejectIfBlockedContact } from '../_shared/contact-bypass.ts'
import { queueMediaSafetyReview } from '../_shared/media-safety.ts'
import { parseBody, z, uuid } from '../_shared/validate.ts'

const FN = 'portfolio-item-action'

const BaseItemSchema = z.object({
  imageUrl: z.string().url(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).optional().nullable(),
  category: z.string().trim().max(60).optional().nullable(),
})

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('seed-from-setup'),
    photoUrls: z.array(z.string().url()).max(12).default([]),
  }),
  z.object({
    action: z.literal('create-item'),
    item: BaseItemSchema,
  }),
  z.object({
    action: z.literal('update-item'),
    itemId: uuid,
    item: BaseItemSchema,
  }),
  z.object({
    action: z.literal('delete-item'),
    itemId: uuid,
  }),
  z.object({
    action: z.literal('reorder-items'),
    itemIds: z.array(uuid).min(1).max(24),
  }),
  z.object({
    action: z.literal('set-cover'),
    itemId: uuid,
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

async function syncProfilePhotoUrls(supabase: any, tailorProfileId: string) {
  const { data: portfolioRows, error: portfolioError } = await supabase
    .from('portfolio_items')
    .select('image_url')
    .eq('tailor_profile_id', tailorProfileId)
    .order('sort_order', { ascending: true })

  if (portfolioError) throw portfolioError

  const nextUrls = ((portfolioRows ?? []) as Array<{ image_url?: string | null }>)
    .map((row) => row.image_url)
    .filter((url): url is string => typeof url === 'string' && url.length > 0)

  const { error: profileError } = await supabase
    .from('tailor_profiles')
    .update({ portfolio_photo_urls: nextUrls, updated_at: new Date().toISOString() })
    .eq('id', tailorProfileId)

  if (profileError) throw profileError
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) return jsonResponse({ error: 'Please sign in again before managing your portfolio.' }, 401, cors)

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400, cors)

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 80)
    if (!allowed) return rateLimitExceededResponse(cors)

    const { data: profile, error: profileError } = await supabase
      .from('tailor_profiles')
      .select('id, user_id, display_name, id_verification_status, is_live')
      .eq('user_id', caller.id)
      .maybeSingle()

    if (profileError) {
      log('error', FN, 'profile.lookup_failed', { actor_id: caller.id, error: profileError.message })
      return jsonResponse({ error: 'We could not load your tailor profile right now. Please try again.' }, 500, cors)
    }
    if (!profile?.id) return jsonResponse({ error: 'Complete your tailor profile before managing portfolio items.' }, 404, cors)

    const body = parsed.data

    if (body.action === 'seed-from-setup') {
      const seedPhotoUrls = body.photoUrls ?? []
      const { data: existingRows, error: existingError } = await supabase
        .from('portfolio_items')
        .select('id, image_url')
        .eq('tailor_profile_id', profile.id)
        .order('sort_order', { ascending: true })

      if (existingError) return jsonResponse({ error: 'We could not load your portfolio right now. Please try again.' }, 500, cors)

      const existing = (existingRows ?? []) as Array<{ id: string; image_url?: string | null }>
      const allBlank = existing.length > 0 && existing.every((row) => !row.image_url)
      if (allBlank) {
        const { error } = await supabase.from('portfolio_items').delete().eq('tailor_profile_id', profile.id)
        if (error) return jsonResponse({ error: 'We could not refresh your portfolio setup right now. Please try again.' }, 500, cors)
      }

      if ((existing.length === 0 || allBlank) && seedPhotoUrls.length > 0) {
        const { error } = await supabase.from('portfolio_items').insert(
          seedPhotoUrls.map((url, index) => ({
            tailor_profile_id: profile.id,
            image_url: url,
            title: `Portfolio photo ${index + 1}`,
            description: null,
            category: null,
            sort_order: index,
          })),
        )
        if (error) return jsonResponse({ error: 'We could not add your setup photos to your portfolio yet. Please try again.' }, 500, cors)
      }

      await syncProfilePhotoUrls(supabase, profile.id)
      await queueMediaSafetyReview(supabase, {
        fn: FN,
        actorId: caller.id,
        actorRole: 'TAILOR',
        surface: 'portfolio.public',
        publicUrls: seedPhotoUrls,
        purpose: 'PORTFOLIO',
        tailorProfileId: profile.id,
        relatedEntityType: 'tailor_profile',
        relatedEntityId: profile.id,
        metadata: { action: body.action },
      })
      return jsonResponse({ ok: true }, 200, cors)
    }

    if (body.action === 'create-item') {
      const contactCheckedFields: Array<[string, string, string | null | undefined, string]> = [
        ['portfolio_item.title', 'title', body.item.title, "Contact details can't be included in portfolio titles."],
        ['portfolio_item.category', 'category', body.item.category, "Contact details can't be included in portfolio categories."],
        ['portfolio_item.description', 'description', body.item.description, "Contact details can't be included in portfolio descriptions."],
      ]

      for (const [surface, field, text, message] of contactCheckedFields) {
        const blocked = await rejectIfBlockedContact({
          supabase,
          fn: FN,
          cors,
          actorId: caller.id,
          actorRole: 'TAILOR',
          surface,
          text,
          message,
          extra: { field, action: body.action },
        })
        if (blocked) return blocked
      }

      const { data: created, error } = await supabase
        .from('portfolio_items')
        .insert({
          tailor_profile_id: profile.id,
          image_url: body.item.imageUrl,
          title: body.item.title,
          description: body.item.description?.trim() || null,
          category: body.item.category?.trim() || null,
          sort_order: 0,
        })
        .select('id')
        .single()

      if (error || !created?.id) return jsonResponse({ error: 'We could not save this portfolio item right now. Please try again.' }, 500, cors)
      await syncProfilePhotoUrls(supabase, profile.id)
      await queueMediaSafetyReview(supabase, {
        fn: FN,
        actorId: caller.id,
        actorRole: 'TAILOR',
        surface: 'portfolio.public',
        publicUrls: [body.item.imageUrl],
        purpose: 'PORTFOLIO',
        tailorProfileId: profile.id,
        relatedEntityType: 'portfolio_item',
        relatedEntityId: created.id,
        metadata: { action: body.action },
      })
      return jsonResponse({ ok: true, itemId: created.id }, 200, cors)
    }

    if (body.action === 'update-item') {
      const contactCheckedFields: Array<[string, string, string | null | undefined, string]> = [
        ['portfolio_item.title', 'title', body.item.title, "Contact details can't be included in portfolio titles."],
        ['portfolio_item.category', 'category', body.item.category, "Contact details can't be included in portfolio categories."],
        ['portfolio_item.description', 'description', body.item.description, "Contact details can't be included in portfolio descriptions."],
      ]

      for (const [surface, field, text, message] of contactCheckedFields) {
        const blocked = await rejectIfBlockedContact({
          supabase,
          fn: FN,
          cors,
          actorId: caller.id,
          actorRole: 'TAILOR',
          surface,
          text,
          message,
          extra: { field, action: body.action, itemId: body.itemId },
        })
        if (blocked) return blocked
      }

      const { error } = await supabase
        .from('portfolio_items')
        .update({
          image_url: body.item.imageUrl,
          title: body.item.title,
          description: body.item.description?.trim() || null,
          category: body.item.category?.trim() || null,
        })
        .eq('id', body.itemId)
        .eq('tailor_profile_id', profile.id)

      if (error) return jsonResponse({ error: 'We could not update this portfolio item right now. Please try again.' }, 500, cors)
      await syncProfilePhotoUrls(supabase, profile.id)
      await queueMediaSafetyReview(supabase, {
        fn: FN,
        actorId: caller.id,
        actorRole: 'TAILOR',
        surface: 'portfolio.public',
        publicUrls: [body.item.imageUrl],
        purpose: 'PORTFOLIO',
        tailorProfileId: profile.id,
        relatedEntityType: 'portfolio_item',
        relatedEntityId: body.itemId,
        metadata: { action: body.action },
      })
      return jsonResponse({ ok: true }, 200, cors)
    }

    if (body.action === 'reorder-items') {
      const nextItemIds = [...new Set(body.itemIds)]
      if (nextItemIds.length !== body.itemIds.length) {
        return jsonResponse({ error: 'Portfolio order cannot include duplicate items.' }, 400, cors)
      }

      const { data: rows, error: rowsError } = await supabase
        .from('portfolio_items')
        .select('id')
        .eq('tailor_profile_id', profile.id)
        .in('id', nextItemIds)

      if (rowsError) return jsonResponse({ error: 'We could not load your portfolio order right now. Please try again.' }, 500, cors)

      const ownedIds = new Set(((rows ?? []) as Array<{ id: string }>).map((row) => row.id))
      if (ownedIds.size !== nextItemIds.length) {
        return jsonResponse({ error: 'That portfolio order includes an item we could not verify. Refresh and try again.' }, 404, cors)
      }

      for (const [index, itemId] of nextItemIds.entries()) {
        const { error } = await supabase
          .from('portfolio_items')
          .update({ sort_order: index })
          .eq('id', itemId)
          .eq('tailor_profile_id', profile.id)
        if (error) return jsonResponse({ error: 'We could not update your portfolio order right now. Please try again.' }, 500, cors)
      }

      await syncProfilePhotoUrls(supabase, profile.id)
      await audit(supabase, {
        event: 'portfolio_item.reordered',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        payload: { function: FN, item_ids: nextItemIds },
      })
      return jsonResponse({ ok: true }, 200, cors)
    }

    if (body.action === 'set-cover') {
      const { data: rows, error: rowsError } = await supabase
        .from('portfolio_items')
        .select('id, sort_order')
        .eq('tailor_profile_id', profile.id)
        .order('sort_order', { ascending: true })

      if (rowsError) return jsonResponse({ error: 'We could not load your portfolio order right now. Please try again.' }, 500, cors)

      const portfolioRows = (rows ?? []) as Array<{ id: string; sort_order?: number | null }>
      const target = portfolioRows.find((row) => row.id === body.itemId)
      if (!target) return jsonResponse({ error: 'That portfolio item was not found. Refresh and try again.' }, 404, cors)

      const nextOrder = [target, ...portfolioRows.filter((row) => row.id !== body.itemId)]
      for (const [index, row] of nextOrder.entries()) {
        const { error } = await supabase
          .from('portfolio_items')
          .update({ sort_order: index })
          .eq('id', row.id)
          .eq('tailor_profile_id', profile.id)
        if (error) return jsonResponse({ error: 'We could not update your portfolio cover right now. Please try again.' }, 500, cors)
      }

      await syncProfilePhotoUrls(supabase, profile.id)
      await audit(supabase, {
        event: 'portfolio_item.cover_set',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        payload: { function: FN, item_id: body.itemId },
      })
      return jsonResponse({ ok: true }, 200, cors)
    }

    const { error } = await supabase
      .from('portfolio_items')
      .delete()
      .eq('id', body.itemId)
      .eq('tailor_profile_id', profile.id)

    if (error) return jsonResponse({ error: 'We could not delete this portfolio item right now. Please try again.' }, 500, cors)
    await syncProfilePhotoUrls(supabase, profile.id)
    await audit(supabase, {
      event: 'portfolio_item.deleted',
      actor_id: caller.id,
      actor_role: 'TAILOR',
      payload: { function: FN, item_id: body.itemId },
    })
    return jsonResponse({ ok: true }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonResponse({ error: 'We could not update your portfolio right now. Please try again.' }, 500, cors)
  }
})
