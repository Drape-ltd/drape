import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import {
  deriveReadyMadeStockStatus,
  normalizeReadyMadeSizeInventory,
  sumReadyMadeSizeInventory,
  zeroReadyMadeSizeInventory,
} from '../_shared/ready-made-inventory.ts'
import { deriveTailorReadiness } from '../_shared/tailor-readiness.ts'
import { parseBody, z } from '../_shared/validate.ts'

const FN = 'seller-item-action'
const FIT_GUIDE_FIELDS = [
  'chest',
  'waist',
  'hips',
  'shoulderWidth',
  'inseam',
  'sleeveLength',
  'neckCircumference',
  'height',
] as const

const FIT_GUIDE_FIELD_SET = new Set<string>(FIT_GUIDE_FIELDS)

const CreateItemSchema = z.object({
  action: z.literal('create-item'),
  title: z.string().trim().min(3).max(120),
  category: z.string().trim().max(60).optional().nullable(),
  description: z.string().trim().max(600).optional().nullable(),
  sizes: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  sizeInventory: z.record(z.string(), z.number().int().min(0).max(5000)).default({}),
  priceAmount: z.number().int().positive().max(100_000_00),
  currency: z.enum(['GBP', 'USD', 'EUR', 'NGN', 'GHS', 'KES', 'CAD']),
  photoUrls: z.array(z.string().url()).max(6).default([]),
  inventoryQuantity: z.number().int().min(0).max(5000).default(0),
  pickupAvailable: z.boolean().default(false),
  deliveryAvailable: z.boolean().default(false),
  shippingAvailable: z.boolean().default(false),
  sizeGuide: z.unknown().optional().nullable(),
  isLive: z.boolean().default(false),
})

const UpdateItemSchema = z.object({
  action: z.literal('update-item'),
  itemId: z.string().uuid(),
  title: z.string().trim().min(3).max(120),
  category: z.string().trim().max(60).optional().nullable(),
  description: z.string().trim().max(600).optional().nullable(),
  sizes: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  sizeInventory: z.record(z.string(), z.number().int().min(0).max(5000)).default({}),
  priceAmount: z.number().int().positive().max(100_000_00),
  currency: z.enum(['GBP', 'USD', 'EUR', 'NGN', 'GHS', 'KES', 'CAD']),
  photoUrls: z.array(z.string().url()).max(6).default([]),
  inventoryQuantity: z.number().int().min(0).max(5000).default(0),
  pickupAvailable: z.boolean().default(false),
  deliveryAvailable: z.boolean().default(false),
  shippingAvailable: z.boolean().default(false),
  sizeGuide: z.unknown().optional().nullable(),
  isLive: z.boolean().default(false),
})

const UpdateItemStateSchema = z.object({
  action: z.enum(['publish-item', 'hide-item', 'mark-sold', 'relist-item', 'delete-item']),
  itemId: z.string().uuid(),
})

const BodySchema = z.union([CreateItemSchema, UpdateItemSchema, UpdateItemStateSchema])

function liveListingPreflightIssues(input: {
  category: string | null | undefined
  description: string
  sizes: string[]
  photoUrls: string[]
  inventoryQuantity: number
  hasSizeGuide: boolean
  requiresPickupAddress: boolean
}) {
  const issues: string[] = []

  if (!input.category?.trim()) {
    issues.push('Before this item can go live, choose a category so buyers know where it belongs.')
  }

  if (input.photoUrls.length === 0) {
    issues.push('Before this item can go live, add at least one clear photo so buyers can see the piece.')
  }

  if (input.sizes.length === 0) {
    issues.push('Before this item can go live, add at least one size. Use One size if that is how you sell it.')
  }

  if (!input.hasSizeGuide) {
    issues.push('Before this item can go live, add a fit guide so buyers can see what each size means and Drape can recommend the right fit.')
  }

  if (input.description.trim().length < 24) {
    issues.push('Before this item can go live, add a fuller description. Aim for 1 or 2 sentences on the style, fit, fabric, or occasion so buyers understand the piece.')
  }

  if (input.inventoryQuantity < 1) {
    issues.push('Before this item can go live, add at least 1 unit to at least one size so buyers can actually order it.')
  }

  if (input.requiresPickupAddress) {
    issues.push('Before pickup items can go live, add your private pickup address in Profile.')
  }

  return issues
}

function existingStockStatusShouldStaySold(currentStockStatus: string | null | undefined, nextInventoryQuantity: number) {
  return currentStockStatus === 'SOLD_OUT' && nextInventoryQuantity <= 0
}

function nextItemInventory(input: {
  sizes: string[]
  sizeInventory: unknown
  fallbackInventoryQuantity?: number | null
}) {
  const sizeInventory = normalizeReadyMadeSizeInventory({
    sizes: input.sizes,
    sizeInventory: input.sizeInventory,
    fallbackInventoryQuantity: input.fallbackInventoryQuantity ?? 0,
  })
  const inventoryQuantity = sumReadyMadeSizeInventory(sizeInventory)

  return { sizeInventory, inventoryQuantity }
}

function sanitizeSizeGuide(raw: unknown, sizes: string[]) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}

  const value = raw as Record<string, unknown>
  const fields = Array.isArray(value.fields)
    ? value.fields
        .filter((field): field is string => typeof field === 'string' && FIT_GUIDE_FIELD_SET.has(field))
        .filter((field, index, all) => all.indexOf(field) === index)
    : []

  if (fields.length === 0) return {}

  const sizeRangesSource =
    value.sizeRanges && typeof value.sizeRanges === 'object' && !Array.isArray(value.sizeRanges)
      ? (value.sizeRanges as Record<string, unknown>)
      : {}

  const sizeRanges: Record<string, Record<string, { min: number | null; max: number | null }>> = {}

  for (const size of sizes) {
    const rawRanges = sizeRangesSource[size]
    if (!rawRanges || typeof rawRanges !== 'object' || Array.isArray(rawRanges)) continue

    const nextRanges: Record<string, { min: number | null; max: number | null }> = {}
    for (const field of fields) {
      const rawField = (rawRanges as Record<string, unknown>)[field]
      if (!rawField || typeof rawField !== 'object' || Array.isArray(rawField)) continue
      const rangeRecord = rawField as Record<string, unknown>

      let min =
        typeof rangeRecord.min === 'number' &&
        Number.isFinite(rangeRecord.min) &&
        rangeRecord.min > 0
          ? Number(rangeRecord.min)
          : null
      let max =
        typeof rangeRecord.max === 'number' &&
        Number.isFinite(rangeRecord.max) &&
        rangeRecord.max > 0
          ? Number(rangeRecord.max)
          : null

      if (min == null && max == null) continue
      if (min != null && max != null && max < min) {
        const nextMin = max
        max = min
        min = nextMin
      }

      nextRanges[field] = { min, max }
    }

    if (Object.keys(nextRanges).length > 0) {
      sizeRanges[size] = nextRanges
    }
  }

  if (Object.keys(sizeRanges).length === 0) return {}

  const fitNotes =
    typeof value.fitNotes === 'string' && value.fitNotes.trim().length > 0
      ? value.fitNotes.trim().slice(0, 240)
      : null
  const stretchNotes =
    typeof value.stretchNotes === 'string' && value.stretchNotes.trim().length > 0
      ? value.stretchNotes.trim().slice(0, 240)
      : null
  const sizeAdvice =
    value.sizeAdvice === 'SIZE_UP_IF_BETWEEN' ||
    value.sizeAdvice === 'SIZE_DOWN_IF_BETWEEN' ||
    value.sizeAdvice === 'ASK_SELLER'
      ? value.sizeAdvice
      : 'ASK_SELLER'

  return {
    version: 1,
    unit: value.unit === 'cm' ? 'cm' : 'in',
    fields,
    sizeRanges,
    fitNotes,
    stretchNotes,
    sizeAdvice,
  }
}

function hasSizeGuide(guide: ReturnType<typeof sanitizeSizeGuide>) {
  const fields = Array.isArray(guide?.fields) ? guide.fields : []
  const sizeRanges = guide?.sizeRanges && typeof guide.sizeRanges === 'object'
    ? Object.keys(guide.sizeRanges as Record<string, unknown>)
    : []
  return fields.length > 0 && sizeRanges.length > 0
}

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
      .select('id, supports_ready_made, profile_completed, id_verification_status, stripe_account_id, paystack_account_id, stripe_connect_account_id, paystack_recipient_code, payout_account_verified, payout_reverification_required, payout_account_type')
      .eq('user_id', caller.id)
      .maybeSingle()

    if (profileError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: profileError.message })
      return new Response('Database error', { status: 500, headers: cors })
    }

    if (!profile?.id) {
      return new Response('Seller profile not found.', { status: 404, headers: cors })
    }

    const { data: pickupDetails, error: pickupDetailsError } = await supabase
      .from('tailor_pickup_details')
      .select('pickup_address')
      .eq('user_id', caller.id)
      .maybeSingle()

    if (pickupDetailsError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: pickupDetailsError.message })
      return new Response('Database error', { status: 500, headers: cors })
    }

    const hasPickupAddress = typeof pickupDetails?.pickup_address === 'string' && pickupDetails.pickup_address.trim().length > 0

    const readiness = deriveTailorReadiness(profile)

    if (body.action === 'create-item' || body.action === 'update-item') {
      const normalizedDescription = body.description?.trim() ?? ''
      const nextSizes = body.sizes ?? []
      const nextPhotoUrls = body.photoUrls ?? []
      const nextSizeGuide = sanitizeSizeGuide(body.sizeGuide, nextSizes)
      const { sizeInventory: nextSizeInventory, inventoryQuantity: nextInventoryQuantity } = nextItemInventory({
        sizes: nextSizes,
        sizeInventory: body.sizeInventory,
        fallbackInventoryQuantity: body.inventoryQuantity ?? 0,
      })
      const nextIsLive = body.isLive ?? false

      if (nextIsLive) {
        if (!(body.pickupAvailable || body.deliveryAvailable || body.shippingAvailable)) {
          return new Response('Choose at least one fulfillment option before publishing this item live.', { status: 400, headers: cors })
        }

        const issues = liveListingPreflightIssues({
          category: body.category,
          description: normalizedDescription,
          sizes: nextSizes,
          photoUrls: nextPhotoUrls,
          inventoryQuantity: nextInventoryQuantity,
          hasSizeGuide: hasSizeGuide(nextSizeGuide),
          requiresPickupAddress: Boolean(body.pickupAvailable && !hasPickupAddress),
        })

        if (issues.length > 0) {
          return new Response(issues[0], { status: 400, headers: cors })
        }
      }

      if (nextIsLive && !profile.supports_ready_made) {
        return new Response('Enable Shop now on your seller profile before publishing items.', { status: 400, headers: cors })
      }

      if (nextIsLive && !readiness.canPublishPaidItems) {
        await audit(supabase, {
          event: 'seller_item.publish_blocked',
          actor_id: caller.id,
          actor_role: 'TAILOR',
          severity: 'warn',
          payload: { function: FN, reason: readiness.code, is_live_request: true },
        })
        return new Response(readiness.message ?? 'Payout setup is still required before publishing paid items live.', { status: 409, headers: cors })
      }

      if (body.action === 'update-item') {
        const { data: editableItem, error: editableItemError } = await supabase
          .from('seller_items')
          .select('id, is_live, stock_status, size_inventory')
          .eq('id', body.itemId)
          .eq('tailor_profile_id', profile.id)
          .maybeSingle()

        if (editableItemError) {
          log('error', FN, 'db.error', { actor_id: caller.id, error: editableItemError.message })
          return new Response('Database error', { status: 500, headers: cors })
        }

        if (!editableItem?.id) {
          return new Response('Item not found.', { status: 404, headers: cors })
        }

        if (editableItem.is_live && editableItem.stock_status !== 'SOLD_OUT') {
          return new Response('Live items cannot be edited until you move them back to draft.', { status: 409, headers: cors })
        }

        const nextStockStatus =
          !nextIsLive && existingStockStatusShouldStaySold(editableItem.stock_status, nextInventoryQuantity)
            ? 'SOLD_OUT'
            : deriveReadyMadeStockStatus({
                isLive: nextIsLive,
                inventoryQuantity: nextInventoryQuantity,
              })

        const { error: updateError } = await supabase
          .from('seller_items')
          .update({
            title: body.title,
            category: body.category?.trim() || null,
            description: normalizedDescription || null,
            sizes: nextSizes,
            price_amount: body.priceAmount,
            currency: body.currency,
            photo_urls: nextPhotoUrls,
            inventory_quantity: nextInventoryQuantity,
            size_inventory: nextSizeInventory,
            size_guide: nextSizeGuide,
            pickup_available: body.pickupAvailable,
            delivery_available: body.deliveryAvailable,
            shipping_available: body.shippingAvailable,
            is_live: nextIsLive,
            stock_status: nextStockStatus,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editableItem.id)
          .eq('tailor_profile_id', profile.id)

        if (updateError) {
          log('error', FN, 'db.error', { actor_id: caller.id, error: updateError.message })
          return new Response('Could not update item', { status: 500, headers: cors })
        }

        await audit(supabase, {
          event: 'seller_item.updated',
          actor_id: caller.id,
          actor_role: 'TAILOR',
          payload: {
            function: FN,
            seller_item_id: editableItem.id,
            is_live: nextIsLive,
            inventory_quantity: nextInventoryQuantity,
            size_inventory: nextSizeInventory,
            stock_status: nextStockStatus,
          },
        })

        return new Response(JSON.stringify({
          ok: true,
          itemId: editableItem.id,
          isLive: nextIsLive,
          stockStatus: nextStockStatus,
          inventoryQuantity: nextInventoryQuantity,
          sizeInventory: nextSizeInventory,
        }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      const { data: created, error: createError } = await supabase
        .from('seller_items')
        .insert({
          tailor_profile_id: profile.id,
          title: body.title,
          category: body.category?.trim() || null,
          description: normalizedDescription || null,
          sizes: nextSizes,
          price_amount: body.priceAmount,
          currency: body.currency,
          photo_urls: nextPhotoUrls,
          inventory_quantity: nextInventoryQuantity,
          size_inventory: nextSizeInventory,
          size_guide: nextSizeGuide,
          pickup_available: body.pickupAvailable,
          delivery_available: body.deliveryAvailable,
          shipping_available: body.shippingAvailable,
          is_live: nextIsLive,
          stock_status: deriveReadyMadeStockStatus({
            isLive: nextIsLive,
            inventoryQuantity: nextInventoryQuantity,
          }),
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
        payload: {
          function: FN,
          seller_item_id: created.id,
          is_live: nextIsLive,
          inventory_quantity: nextInventoryQuantity,
          size_inventory: nextSizeInventory,
        },
      })

      return new Response(JSON.stringify({
        ok: true,
        itemId: created.id,
        isLive: nextIsLive,
        stockStatus: deriveReadyMadeStockStatus({
          isLive: nextIsLive,
          inventoryQuantity: nextInventoryQuantity,
        }),
        inventoryQuantity: nextInventoryQuantity,
        sizeInventory: nextSizeInventory,
      }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { data: existing, error: existingError } = await supabase
      .from('seller_items')
      .select('id, title, category, description, sizes, photo_urls, size_guide, is_live, stock_status, inventory_quantity, size_inventory, pickup_available')
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
    let nextSizeInventory = normalizeReadyMadeSizeInventory({
      sizes: Array.isArray(existing.sizes) ? existing.sizes : [],
      sizeInventory: existing.size_inventory,
      fallbackInventoryQuantity: existing.inventory_quantity ?? 0,
    })
    let nextInventoryQuantity = sumReadyMadeSizeInventory(nextSizeInventory)

    if (body.action === 'delete-item') {
      if (existing.is_live || existing.stock_status !== 'HIDDEN') {
        return new Response('Only hidden draft items can be deleted. Move live or sold items into the right state instead.', { status: 409, headers: cors })
      }

      const { count: orderCount, error: orderCountError } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('seller_item_id', existing.id)

      if (orderCountError) {
        log('error', FN, 'db.error', { actor_id: caller.id, error: orderCountError.message })
        return new Response('Database error', { status: 500, headers: cors })
      }

      if ((orderCount ?? 0) > 0) {
        return new Response('This draft already has order history attached, so keep it in draft instead of deleting it.', { status: 409, headers: cors })
      }

      const { error: deleteError } = await supabase
        .from('seller_items')
        .delete()
        .eq('id', existing.id)
        .eq('tailor_profile_id', profile.id)

      if (deleteError) {
        log('error', FN, 'db.error', { actor_id: caller.id, error: deleteError.message })
        return new Response('Could not delete item', { status: 500, headers: cors })
      }

      await audit(supabase, {
        event: 'seller_item.deleted',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        payload: {
          function: FN,
          seller_item_id: existing.id,
          action: body.action,
        },
      })

      return new Response(JSON.stringify({
        ok: true,
        itemId: existing.id,
        deleted: true,
      }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'publish-item' || body.action === 'relist-item') {
      if (!profile.supports_ready_made) {
        return new Response('Enable Shop now on your seller profile before publishing items.', { status: 400, headers: cors })
      }
      if (!readiness.canPublishPaidItems) {
        await audit(supabase, {
          event: 'seller_item.publish_blocked',
          actor_id: caller.id,
          actor_role: 'TAILOR',
          severity: 'warn',
          payload: { function: FN, seller_item_id: existing.id, action: body.action, reason: readiness.code },
        })
        return new Response(readiness.message ?? 'Payout setup is still required before publishing paid items live.', { status: 409, headers: cors })
      }

      if (body.action === 'relist-item' && nextInventoryQuantity <= 0) {
        return new Response('Edit this item and add stock to at least one size before relisting it.', { status: 409, headers: cors })
      }

      const issues = liveListingPreflightIssues({
        category: existing.category ?? null,
        description: existing.description ?? '',
        sizes: Array.isArray(existing.sizes) ? existing.sizes : [],
        photoUrls: Array.isArray(existing.photo_urls) ? existing.photo_urls : [],
        inventoryQuantity: nextInventoryQuantity,
        hasSizeGuide: hasSizeGuide(
          sanitizeSizeGuide(
            existing.size_guide,
            Array.isArray(existing.sizes) ? existing.sizes : [],
          ),
        ),
        requiresPickupAddress: (existing.pickup_available ?? false) && !hasPickupAddress,
      })

      if (issues.length > 0) {
        return new Response(issues[0], { status: 409, headers: cors })
      }

      if (nextInventoryQuantity <= 0) {
        return new Response('Add stock before publishing this item live.', { status: 409, headers: cors })
      }

      nextIsLive = true
      nextStockStatus = deriveReadyMadeStockStatus({
        isLive: true,
        inventoryQuantity: nextInventoryQuantity,
      })
    } else if (body.action === 'hide-item') {
      nextIsLive = false
      nextStockStatus = deriveReadyMadeStockStatus({
        isLive: false,
        inventoryQuantity: nextInventoryQuantity,
      })
    } else if (body.action === 'mark-sold') {
      nextIsLive = false
      nextSizeInventory = zeroReadyMadeSizeInventory(Array.isArray(existing.sizes) ? existing.sizes : [])
      nextInventoryQuantity = 0
      nextStockStatus = 'SOLD_OUT'
    }

    const { error: updateError } = await supabase
      .from('seller_items')
      .update({
        is_live: nextIsLive,
        stock_status: nextStockStatus,
        inventory_quantity: nextInventoryQuantity,
        size_inventory: nextSizeInventory,
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
      payload: {
        function: FN,
        seller_item_id: existing.id,
        action: body.action,
        is_live: nextIsLive,
        stock_status: nextStockStatus,
        inventory_quantity: nextInventoryQuantity,
        size_inventory: nextSizeInventory,
      },
      })

    return new Response(JSON.stringify({
      ok: true,
      itemId: existing.id,
      isLive: nextIsLive,
      stockStatus: nextStockStatus,
      inventoryQuantity: nextInventoryQuantity,
      sizeInventory: nextSizeInventory,
    }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return new Response('Internal server error', { status: 500, headers: cors })
  }
})
