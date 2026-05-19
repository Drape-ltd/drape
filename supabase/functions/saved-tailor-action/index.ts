import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { parseBody, z, uuid } from '../_shared/validate.ts'

const FN = 'saved-tailor-action'

const ACTION_ALIASES: Record<string, string> = {
  saveTailor: 'save-tailor',
  save_tailor: 'save-tailor',
  saveReadyMadeItem: 'save-ready-made-item',
  save_ready_made_item: 'save-ready-made-item',
  saveReadyMade: 'save-ready-made-item',
  save_ready_made: 'save-ready-made-item',
  'save-ready-made': 'save-ready-made-item',
  saveItem: 'save-item',
  save_item: 'save-item',
  saveWishlistItem: 'save-item',
  save_wishlist_item: 'save-item',
  'save-item': 'save-item',
  'save-wishlist-item': 'save-item',
  unsaveByProfile: 'unsave-by-profile',
  unsave_by_profile: 'unsave-by-profile',
  unsaveById: 'unsave-by-id',
  unsave_by_id: 'unsave-by-id',
  createCollection: 'create-collection',
  create_collection: 'create-collection',
  renameCollection: 'rename-collection',
  rename_collection: 'rename-collection',
  deleteCollection: 'delete-collection',
  delete_collection: 'delete-collection',
  removeItem: 'remove-item',
  remove_item: 'remove-item',
  moveItem: 'move-item',
  move_item: 'move-item',
  addNote: 'add-note',
  add_note: 'add-note',
}

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), tailorProfileId: uuid }),
  z.object({ action: z.literal('save-tailor'), tailorProfileId: uuid, collectionId: uuid.optional(), collectionName: z.string().trim().min(1).max(80).optional() }),
  z.object({ action: z.literal('save-ready-made-item'), readyMadeItemId: uuid, collectionId: uuid.optional(), collectionName: z.string().trim().min(1).max(80).optional() }),
  z.object({ action: z.literal('unsave-by-profile'), tailorProfileId: uuid }),
  z.object({ action: z.literal('unsave-by-id'), savedId: uuid }),
  z.object({ action: z.literal('create-collection'), name: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal('rename-collection'), collectionId: uuid, name: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal('delete-collection'), collectionId: uuid }),
  z.object({ action: z.literal('remove-item'), itemId: uuid }),
  z.object({ action: z.literal('move-item'), itemId: uuid, targetCollectionId: uuid }),
  z.object({ action: z.literal('add-note'), itemId: uuid, note: z.string().trim().max(240).nullable().optional() }),
])

type SupabaseClient = ReturnType<typeof createClient<any>>

function jsonError(cors: HeadersInit, status: number, code: string, error: string, message = error) {
  return new Response(JSON.stringify({ code, error, message }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function normalizeBody(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw

  const input = { ...(raw as Record<string, unknown>) }
  const copyStringAlias = (from: string, to: string) => {
    if (typeof input[to] !== 'string' && typeof input[from] === 'string') input[to] = input[from]
  }

  copyStringAlias('tailor_profile_id', 'tailorProfileId')
  copyStringAlias('tailorId', 'tailorProfileId')
  copyStringAlias('tailor_id', 'tailorProfileId')
  copyStringAlias('ready_made_item_id', 'readyMadeItemId')
  copyStringAlias('readyMadeId', 'readyMadeItemId')
  copyStringAlias('ready_made_id', 'readyMadeItemId')
  copyStringAlias('collection_id', 'collectionId')
  copyStringAlias('collection_name', 'collectionName')
  copyStringAlias('saved_id', 'savedId')
  copyStringAlias('item_id', 'itemId')
  copyStringAlias('target_collection_id', 'targetCollectionId')

  const rawItemType = input.itemType ?? input.item_type ?? input.type
  const itemType =
    typeof rawItemType === 'string'
      ? rawItemType.trim().toUpperCase().replaceAll('-', '_')
      : null
  const itemId = typeof input.itemId === 'string' ? input.itemId : null

  if (itemId && itemType === 'TAILOR' && typeof input.tailorProfileId !== 'string') {
    input.tailorProfileId = itemId
  }
  if (
    itemId &&
    ['READY_MADE_ITEM', 'READYMADEITEM', 'READY_MADE', 'READYMADE', 'ITEM'].includes(itemType ?? '') &&
    typeof input.readyMadeItemId !== 'string'
  ) {
    input.readyMadeItemId = itemId
  }

  const action = input.action
  if (typeof action === 'string') {
    input.action = ACTION_ALIASES[action] ?? action
  }

  if (
    input.action === 'save' ||
    input.action === 'save-item' ||
    typeof input.action !== 'string'
  ) {
    if (typeof input.readyMadeItemId === 'string') {
      input.action = 'save-ready-made-item'
    } else if (typeof input.tailorProfileId === 'string') {
      input.action = 'save-tailor'
    }
  }

  return input
}

async function ensureCollection(
  supabase: SupabaseClient,
  customerId: string,
  input?: { collectionId?: string; collectionName?: string },
) {
  if (input?.collectionId) {
    const { data, error } = await supabase
      .from('wishlist_collections')
      .select('id, name')
      .eq('id', input.collectionId)
      .eq('customer_id', customerId)
      .maybeSingle()

    if (error) throw error
    if (!data) throw new Error('Wishlist collection not found')
    return data as { id: string; name: string }
  }

  const name = input?.collectionName?.trim() || 'My Go-To Tailors'
  const { data: existing, error: existingError } = await supabase
    .from('wishlist_collections')
    .select('id, name')
    .eq('customer_id', customerId)
    .eq('name', name)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing) return existing as { id: string; name: string }

  const { data: created, error: createError } = await supabase
    .from('wishlist_collections')
    .insert({ customer_id: customerId, name })
    .select('id, name')
    .single()

  if (createError) throw createError
  return created as { id: string; name: string }
}

async function removeSavedTailorIndexIfUnused(supabase: SupabaseClient, customerId: string, tailorProfileId: string) {
  const { data: remaining, error: remainingError } = await supabase
    .from('wishlist_items')
    .select('id, wishlist_collections!inner(customer_id)')
    .eq('item_type', 'TAILOR')
    .eq('tailor_id', tailorProfileId)
    .eq('wishlist_collections.customer_id', customerId)
    .limit(1)

  if (remainingError) throw remainingError
  if ((remaining ?? []).length > 0) return

  const { error } = await supabase
    .from('saved_tailors')
    .delete()
    .eq('user_id', customerId)
    .eq('tailor_profile_id', tailorProfileId)

  if (error) throw error
}

async function ownedCollectionIds(supabase: SupabaseClient, customerId: string) {
  const { data, error } = await supabase
    .from('wishlist_collections')
    .select('id')
    .eq('customer_id', customerId)

  if (error) throw error
  return (data ?? []).map((row: { id: string }) => row.id)
}

async function insertWishlistItem(
  supabase: SupabaseClient,
  input: {
    collectionId: string
    itemType: 'TAILOR' | 'READY_MADE_ITEM'
    tailorProfileId?: string
    readyMadeItemId?: string
  },
) {
  const payload =
    input.itemType === 'TAILOR'
      ? { collection_id: input.collectionId, item_type: input.itemType, tailor_id: input.tailorProfileId }
      : { collection_id: input.collectionId, item_type: input.itemType, ready_made_item_id: input.readyMadeItemId }

  const { data, error } = await supabase
    .from('wishlist_items')
    .insert(payload)
    .select('id')
    .single()

  if (!error) return data as { id: string }
  if ((error as { code?: string }).code !== '23505') throw error

  let query = supabase
    .from('wishlist_items')
    .select('id')
    .eq('collection_id', input.collectionId)
    .eq('item_type', input.itemType)

  if (input.itemType === 'TAILOR') {
    if (!input.tailorProfileId) throw new Error('Tailor profile ID is required')
    query = query.eq('tailor_id', input.tailorProfileId)
  } else {
    if (!input.readyMadeItemId) throw new Error('Ready-made item ID is required')
    query = query.eq('ready_made_item_id', input.readyMadeItemId)
  }

  const { data: existing, error: existingError } = await query.single()
  if (existingError) throw existingError
  return existing as { id: string }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) return jsonError(cors, 401, 'UNAUTHORIZED', 'You need to sign in again before updating your wishlist.')

    const rawBody = await req.json().catch(() => ({}))
    const parsed = parseBody(BodySchema, normalizeBody(rawBody))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', {
        actor_id: caller.id,
        action: rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
          ? (rawBody as Record<string, unknown>).action
          : null,
        keys: rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
          ? Object.keys(rawBody as Record<string, unknown>)
          : [],
        error: parsed.error,
      })
      return jsonError(
        cors,
        400,
        'VALIDATION_FAILED',
        'We could not update this wishlist from the details provided. Refresh and try again.',
      )
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 120)
    if (!allowed) return rateLimitExceededResponse(cors)

    const body = parsed.data

    if (body.action === 'create-collection') {
      const collection = await ensureCollection(supabase, caller.id, { collectionName: body.name })
      return new Response(JSON.stringify({ ok: true, collection }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'rename-collection') {
      const { data, error } = await supabase
        .from('wishlist_collections')
        .update({ name: body.name })
        .eq('id', body.collectionId)
        .eq('customer_id', caller.id)
        .select('id, name')
        .maybeSingle()

      if (error) throw error
      if (!data) return jsonError(cors, 404, 'COLLECTION_NOT_FOUND', 'Wishlist collection not found.')

      return new Response(JSON.stringify({ ok: true, collection: data }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'delete-collection') {
      const { error } = await supabase
        .from('wishlist_collections')
        .delete()
        .eq('id', body.collectionId)
        .eq('customer_id', caller.id)

      if (error) throw error
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'save' || body.action === 'save-tailor') {
      const collection = await ensureCollection(supabase, caller.id, {
        collectionId: 'collectionId' in body ? body.collectionId : undefined,
        collectionName: 'collectionName' in body ? body.collectionName : undefined,
      })

      const { error } = await supabase
        .from('saved_tailors')
        .upsert({ user_id: caller.id, tailor_profile_id: body.tailorProfileId }, { onConflict: 'user_id,tailor_profile_id' })

      if (error) {
        log('error', FN, 'save.failed', { actor_id: caller.id, error: error.message })
        return jsonError(cors, 500, 'SAVE_FAILED', 'Could not save seller.')
      }

      await audit(supabase, {
        event: 'saved_tailor.saved',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        payload: { function: FN, tailor_profile_id: body.tailorProfileId },
      })

      const item = await insertWishlistItem(supabase, {
        collectionId: collection.id,
        itemType: 'TAILOR',
        tailorProfileId: body.tailorProfileId,
      })

      return new Response(JSON.stringify({ ok: true, collection, item }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    } else if (body.action === 'save-ready-made-item') {
      const collection = await ensureCollection(supabase, caller.id, {
        collectionId: body.collectionId,
        collectionName: body.collectionName,
      })

      const item = await insertWishlistItem(supabase, {
        collectionId: collection.id,
        itemType: 'READY_MADE_ITEM',
        readyMadeItemId: body.readyMadeItemId,
      })

      await audit(supabase, {
        event: 'wishlist.ready_made_item_saved',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        payload: { function: FN, ready_made_item_id: body.readyMadeItemId, collection_id: collection.id },
      })

      return new Response(JSON.stringify({ ok: true, collection, item }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    } else if (body.action === 'unsave-by-profile') {
      const collectionIds = await ownedCollectionIds(supabase, caller.id)
      if (collectionIds.length > 0) {
        const { error: wishlistError } = await supabase
          .from('wishlist_items')
          .delete()
          .eq('item_type', 'TAILOR')
          .eq('tailor_id', body.tailorProfileId)
          .in('collection_id', collectionIds)

        if (wishlistError) throw wishlistError
      }

      const { error } = await supabase
        .from('saved_tailors')
        .delete()
        .eq('user_id', caller.id)
        .eq('tailor_profile_id', body.tailorProfileId)

      if (error) return jsonError(cors, 500, 'REMOVE_FAILED', 'Could not remove seller.')
    } else if (body.action === 'unsave-by-id') {
      const { data: savedRow } = await supabase
        .from('saved_tailors')
        .select('tailor_profile_id')
        .eq('id', body.savedId)
        .eq('user_id', caller.id)
        .maybeSingle()

      const { error } = await supabase
        .from('saved_tailors')
        .delete()
        .eq('id', body.savedId)
        .eq('user_id', caller.id)

      if (error) return jsonError(cors, 500, 'REMOVE_FAILED', 'Could not remove seller.')

      if (savedRow?.tailor_profile_id) {
        const collectionIds = await ownedCollectionIds(supabase, caller.id)
        if (collectionIds.length > 0) {
          const { error: wishlistError } = await supabase
            .from('wishlist_items')
            .delete()
            .eq('item_type', 'TAILOR')
            .eq('tailor_id', savedRow.tailor_profile_id)
            .in('collection_id', collectionIds)

          if (wishlistError) throw wishlistError
        }
      }
    } else if (body.action === 'remove-item') {
      const { data: existing, error: existingError } = await supabase
        .from('wishlist_items')
        .select('id, item_type, tailor_id, collection_id, wishlist_collections!inner(customer_id)')
        .eq('id', body.itemId)
        .eq('wishlist_collections.customer_id', caller.id)
        .maybeSingle()

      if (existingError) throw existingError
      if (!existing) return jsonError(cors, 404, 'ITEM_NOT_FOUND', 'Wishlist item not found.')

      const { error } = await supabase
        .from('wishlist_items')
        .delete()
        .eq('id', body.itemId)

      if (error) throw error

      if (existing.item_type === 'TAILOR' && existing.tailor_id) {
        await removeSavedTailorIndexIfUnused(supabase, caller.id, existing.tailor_id)
      }
    } else if (body.action === 'move-item') {
      await ensureCollection(supabase, caller.id, { collectionId: body.targetCollectionId })

      const { data: existing, error: existingError } = await supabase
        .from('wishlist_items')
        .select('id, wishlist_collections!inner(customer_id)')
        .eq('id', body.itemId)
        .eq('wishlist_collections.customer_id', caller.id)
        .maybeSingle()

      if (existingError) throw existingError
      if (!existing) return jsonError(cors, 404, 'ITEM_NOT_FOUND', 'Wishlist item not found.')

      const { data: moved, error } = await supabase
        .from('wishlist_items')
        .update({ collection_id: body.targetCollectionId })
        .eq('id', body.itemId)
        .select('id')
        .maybeSingle()

      if (error) throw error
      if (!moved) return jsonError(cors, 404, 'ITEM_NOT_FOUND', 'Wishlist item not found.')
    } else if (body.action === 'add-note') {
      const { data: existing, error: existingError } = await supabase
        .from('wishlist_items')
        .select('id, wishlist_collections!inner(customer_id)')
        .eq('id', body.itemId)
        .eq('wishlist_collections.customer_id', caller.id)
        .maybeSingle()

      if (existingError) throw existingError
      if (!existing) return jsonError(cors, 404, 'ITEM_NOT_FOUND', 'Wishlist item not found.')

      const { data: updated, error } = await supabase
        .from('wishlist_items')
        .update({ note: body.note?.trim() || null })
        .eq('id', body.itemId)
        .select('id')
        .maybeSingle()

      if (error) throw error
      if (!updated) return jsonError(cors, 404, 'ITEM_NOT_FOUND', 'Wishlist item not found.')
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonError(cors, 500, 'INTERNAL_ERROR', 'Could not update your wishlist right now.')
  }
})
