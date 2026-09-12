import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'

const FN = 'cleanup-signup-media-quarantine'
const BUCKET = 'signup-media-quarantine'

type Entry = { path?: unknown }

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const unauthorized = await authorizeCronRequest(req, FN, cors)
  if (unauthorized) return unauthorized

  const client = createClient(getSupabaseUrl(), getServiceRoleKey())
  const { data: rows, error } = await client
    .from('signup_media_quarantine')
    .select('user_id,manifest')
    .lte('expires_at', new Date().toISOString())
    .limit(100)
  if (error) return Response.json({ error: 'Expired signup media could not be listed.' }, { status: 500, headers: cors })

  let removed = 0
  for (const row of rows ?? []) {
    const paths = (Array.isArray(row.manifest) ? row.manifest : [])
      .map((entry: Entry) => typeof entry.path === 'string' ? entry.path : '')
      .filter(Boolean)
    if (paths.length) {
      const { error: storageError } = await client.storage.from(BUCKET).remove(paths)
      if (storageError) continue
    }
    const { error: rowError } = await client.from('signup_media_quarantine').delete().eq('user_id', row.user_id)
    if (!rowError) removed += 1
  }

  return Response.json({ removed }, { headers: cors })
})
