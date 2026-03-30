import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
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
])

async function syncProfilePhotoUrls(supabase: ReturnType<typeof createClient>, tailorProfileId: string) {
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
    if (!caller) return new Response('Unauthorized', { status: 401, headers: cors })

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) return new Response(parsed.error, { status: 400, headers: cors })

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 80)
    if (!allowed) return new Response('Too many requests', { status: 429, headers: cors })

    const { data: profile, error: profileError } = await supabase
      .from('tailor_profiles')
      .select('id')
      .eq('user_id', caller.id)
      .maybeSingle()

    if (profileError) {
      log('error', FN, 'profile.lookup_failed', { actor_id: caller.id, error: profileError.message })
      return new Response('Database error', { status: 500, headers: cors })
    }
    if (!profile?.id) return new Response('Seller profile not found.', { status: 404, headers: cors })

    const body = parsed.data

    if (body.action === 'seed-from-setup') {
      const { data: existingRows, error: existingError } = await supabase
        .from('portfolio_items')
        .select('id, image_url')
        .eq('tailor_profile_id', profile.id)
        .order('sort_order', { ascending: true })

      if (existingError) return new Response('Could not load portfolio', { status: 500, headers: cors })

      const existing = (existingRows ?? []) as Array<{ id: string; image_url?: string | null }>
      const allBlank = existing.length > 0 && existing.every((row) => !row.image_url)
      if (allBlank) {
        const { error } = await supabase.from('portfolio_items').delete().eq('tailor_profile_id', profile.id)
        if (error) return new Response('Could not reset portfolio', { status: 500, headers: cors })
      }

      if ((existing.length === 0 || allBlank) && body.photoUrls.length > 0) {
        const { error } = await supabase.from('portfolio_items').insert(
          body.photoUrls.map((url, index) => ({
            tailor_profile_id: profile.id,
            image_url: url,
            title: `Portfolio photo ${index + 1}`,
            description: null,
            category: null,
            sort_order: index,
          })),
        )
        if (error) return new Response('Could not seed portfolio', { status: 500, headers: cors })
      }

      await syncProfilePhotoUrls(supabase, profile.id)
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'create-item') {
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

      if (error || !created?.id) return new Response('Could not save portfolio item', { status: 500, headers: cors })
      await syncProfilePhotoUrls(supabase, profile.id)
      return new Response(JSON.stringify({ ok: true, itemId: created.id }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'update-item') {
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

      if (error) return new Response('Could not update portfolio item', { status: 500, headers: cors })
      await syncProfilePhotoUrls(supabase, profile.id)
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { error } = await supabase
      .from('portfolio_items')
      .delete()
      .eq('id', body.itemId)
      .eq('tailor_profile_id', profile.id)

    if (error) return new Response('Could not delete portfolio item', { status: 500, headers: cors })
    await syncProfilePhotoUrls(supabase, profile.id)
    await audit(supabase, {
      event: 'portfolio_item.deleted',
      actor_id: caller.id,
      actor_role: 'TAILOR',
      payload: { function: FN, item_id: body.itemId },
    })
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return new Response('Internal server error', { status: 500, headers: cors })
  }
})
