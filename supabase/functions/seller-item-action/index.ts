import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { parseBody, z } from '../_shared/validate.ts'

const FN = 'seller-item-action'

const CreateItemSchema = z.object({
  action: z.literal('create-item'),
  title: z.string().trim().min(3).max(120),
  category: z.string().trim().max(60).optional().nullable(),
  description: z.string().trim().max(600).optional().nullable(),
  sizes: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  priceAmount: z.number().int().positive().max(100_000_00),
  currency: z.enum(['GBP', 'USD', 'EUR', 'NGN', 'GHS', 'KES']),
  photoUrls: z.array(z.string().url()).max(6).default([]),
  pickupAvailable: z.boolean().default(false),
  deliveryAvailable: z.boolean().default(false),
  shippingAvailable: z.boolean().default(false),
  isLive: z.boolean().default(false),
})

const UpdateItemStateSchema = z.object({
  action: z.enum(['publish-item', 'hide-item', 'mark-sold', 'relist-item']),
  itemId: z.string().uuid(),
})

const BodySchema = z.union([CreateItemSchema, UpdateItemStateSchema])

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return new Response('Unauthorized', { status: 401, headers: cors })
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return new Response(parsed.error, { status: 400, headers: cors })
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 40)
    if (!allowed) {
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        severity: 'warn',
        payload: { function: FN },
      })
      return new Response('Too many requests', { status: 429, headers: cors })
    }

    const body = parsed.data

    const { data: profile, error: profileError } = await supabase
      .from('tailor_profiles')
      .select('id, supports_ready_made')
      .eq('user_id', caller.id)
      .maybeSingle()

    if (profileError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: profileError.message })
      return new Response('Database error', { status: 500, headers: cors })
    }

    if (!profile?.id) {
      return new Response('Seller profile not found.', { status: 404, headers: cors })
    }

    if (body.action === 'create-item') {
      if (!(body.pickupAvailable || body.deliveryAvailable || body.shippingAvailable)) {
        return new Response('Choose at least one fulfillment option.', { status: 400, headers: cors })
      }

      if (body.isLive && !profile.supports_ready_made) {
        return new Response('Enable Shop now on your seller profile before publishing items.', { status: 400, headers: cors })
      }

      const { data: created, error: createError } = await supabase
        .from('seller_items')
        .insert({
          tailor_profile_id: profile.id,
          title: body.title,
          category: body.category?.trim() || null,
          description: body.description?.trim() || null,
          sizes: body.sizes,
          price_amount: body.priceAmount,
          currency: body.currency,
          photo_urls: body.photoUrls,
          pickup_available: body.pickupAvailable,
          delivery_available: body.deliveryAvailable,
          shipping_available: body.shippingAvailable,
          is_live: body.isLive,
          stock_status: body.isLive ? 'IN_STOCK' : 'HIDDEN',
        })
        .select('id')
        .single()

      if (createError || !created?.id) {
        log('error', FN, 'db.error', { actor_id: caller.id, error: createError?.message ?? 'create failed' })
        return new Response('Could not create item', { status: 500, headers: cors })
      }

      await audit(supabase, {
        event: 'seller_item.created',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        payload: { function: FN, seller_item_id: created.id, is_live: body.isLive },
      })

      return new Response(JSON.stringify({ ok: true, itemId: created.id }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { data: existing, error: existingError } = await supabase
      .from('seller_items')
      .select('id, is_live, stock_status')
      .eq('id', body.itemId)
      .eq('tailor_profile_id', profile.id)
      .maybeSingle()

    if (existingError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: existingError.message })
      return new Response('Database error', { status: 500, headers: cors })
    }

    if (!existing?.id) {
      return new Response('Item not found.', { status: 404, headers: cors })
    }

    let nextIsLive = existing.is_live ?? false
    let nextStockStatus = existing.stock_status ?? 'IN_STOCK'

    if (body.action === 'publish-item' || body.action === 'relist-item') {
      if (!profile.supports_ready_made) {
        return new Response('Enable Shop now on your seller profile before publishing items.', { status: 400, headers: cors })
      }
      nextIsLive = true
      nextStockStatus = 'IN_STOCK'
    } else if (body.action === 'hide-item') {
      nextIsLive = false
      nextStockStatus = 'HIDDEN'
    } else if (body.action === 'mark-sold') {
      nextIsLive = false
      nextStockStatus = 'SOLD_OUT'
    }

    const { error: updateError } = await supabase
      .from('seller_items')
      .update({
        is_live: nextIsLive,
        stock_status: nextStockStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('tailor_profile_id', profile.id)

    if (updateError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: updateError.message })
      return new Response('Could not update item', { status: 500, headers: cors })
    }

    await audit(supabase, {
      event: 'seller_item.state_changed',
      actor_id: caller.id,
      actor_role: 'TAILOR',
      payload: { function: FN, seller_item_id: existing.id, action: body.action, is_live: nextIsLive, stock_status: nextStockStatus },
    })

    return new Response(JSON.stringify({ ok: true, itemId: existing.id, isLive: nextIsLive, stockStatus: nextStockStatus }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return new Response('Internal server error', { status: 500, headers: cors })
  }
})
