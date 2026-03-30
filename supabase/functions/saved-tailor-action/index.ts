import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { parseBody, z, uuid } from '../_shared/validate.ts'

const FN = 'saved-tailor-action'

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), tailorProfileId: uuid }),
  z.object({ action: z.literal('unsave-by-profile'), tailorProfileId: uuid }),
  z.object({ action: z.literal('unsave-by-id'), savedId: uuid }),
])

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) return new Response('Unauthorized', { status: 401, headers: cors })

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) return new Response(parsed.error, { status: 400, headers: cors })

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 120)
    if (!allowed) return new Response('Too many requests', { status: 429, headers: cors })

    const body = parsed.data

    if (body.action === 'save') {
      const { error } = await supabase
        .from('saved_tailors')
        .upsert({ user_id: caller.id, tailor_profile_id: body.tailorProfileId }, { onConflict: 'user_id,tailor_profile_id' })

      if (error) {
        log('error', FN, 'save.failed', { actor_id: caller.id, error: error.message })
        return new Response('Could not save seller', { status: 500, headers: cors })
      }

      await audit(supabase, {
        event: 'saved_tailor.saved',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        payload: { function: FN, tailor_profile_id: body.tailorProfileId },
      })
    } else if (body.action === 'unsave-by-profile') {
      const { error } = await supabase
        .from('saved_tailors')
        .delete()
        .eq('user_id', caller.id)
        .eq('tailor_profile_id', body.tailorProfileId)

      if (error) return new Response('Could not remove seller', { status: 500, headers: cors })
    } else {
      const { error } = await supabase
        .from('saved_tailors')
        .delete()
        .eq('id', body.savedId)
        .eq('user_id', caller.id)

      if (error) return new Response('Could not remove seller', { status: 500, headers: cors })
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return new Response('Internal server error', { status: 500, headers: cors })
  }
})
