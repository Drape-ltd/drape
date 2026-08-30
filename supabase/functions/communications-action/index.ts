import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import {
  COMMUNICATION_CATEGORIES,
  COMMUNICATION_CHANNELS,
  communicationDefaults,
  isCommunicationCategory,
  isCommunicationChannel,
} from '../_shared/communications.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getSupabaseAnonKey, getSupabaseUrl } from '../_shared/env.ts'

type Json = Record<string, unknown>

function json(headers: Record<string, string>, status: number, body: Json) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (message.includes('MANDATORY_COMMUNICATION')) return 'This essential communication cannot be disabled.'
  if (message.includes('MARKETING_CONSENT_REQUIRED')) return 'Marketing consent is required before enabling this channel.'
  if (message.includes('INBOX_REQUIRED')) return 'In-app notifications cannot be disabled.'
  if (message.includes('INBOX_ITEM_NOT_FOUND')) return 'That notification is no longer available.'
  return 'This communication setting could not be updated right now.'
}

function userClient(req: Request) {
  const authorization = req.headers.get('Authorization') ?? ''
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(cors, 405, { error: 'METHOD_NOT_ALLOWED' })

  let body: Json
  try {
    body = await req.json()
  } catch {
    return json(cors, 400, { error: 'INVALID_JSON' })
  }

  const action = typeof body.action === 'string' ? body.action : ''
  const client = userClient(req)

  if (action === 'STATUS_LIST') {
    const { data, error } = await client
      .from('service_incidents')
      .select('id,incident_key,title,summary,severity,status,affected_services,acknowledgement_required,destination,started_at,resolved_at,updated_at')
      .eq('public_visible', true)
      .order('started_at', { ascending: false })
      .limit(50)
    if (error) return json(cors, 503, { error: 'STATUS_UNAVAILABLE' })
    return json(cors, 200, { incidents: data ?? [] })
  }

  const user = await getAuthUser(req)
  if (!user) return json(cors, 401, { error: 'AUTH_REQUIRED' })

  try {
    if (action === 'PREFERENCES_GET') {
      const [{ data: rows, error: preferenceError }, { data: consentRows, error: consentError }] = await Promise.all([
        client.from('communication_preferences').select('category,channel,enabled,source,updated_at'),
        client.from('communication_consents').select('channel,status,policy_version,source,created_at')
          .eq('purpose', 'MARKETING').order('created_at', { ascending: false }),
      ])
      if (preferenceError || consentError) throw preferenceError ?? consentError

      const matrix = communicationDefaults() as Record<string, Record<string, Record<string, unknown>>>
      for (const row of rows ?? []) {
        if (!isCommunicationCategory(row.category) || !isCommunicationChannel(row.channel)) continue
        matrix[row.category][row.channel] = {
          ...matrix[row.category][row.channel],
          enabled: row.enabled,
          source: row.source,
          updatedAt: row.updated_at,
        }
      }

      const consents: Record<string, Json> = {}
      for (const row of consentRows ?? []) {
        if (!isCommunicationChannel(row.channel) || consents[row.channel]) continue
        consents[row.channel] = {
          granted: row.status === 'GRANTED',
          policyVersion: row.policy_version,
          source: row.source,
          createdAt: row.created_at,
        }
      }
      return json(cors, 200, {
        categories: COMMUNICATION_CATEGORIES,
        channels: COMMUNICATION_CHANNELS,
        preferences: matrix,
        marketingConsents: consents,
      })
    }

    if (action === 'PREFERENCE_SET') {
      if (!isCommunicationCategory(body.category) || !isCommunicationChannel(body.channel) || typeof body.enabled !== 'boolean') {
        return json(cors, 400, { error: 'INVALID_PREFERENCE' })
      }
      const { data, error } = await client.rpc('set_my_communication_preference', {
        p_category: body.category,
        p_channel: body.channel,
        p_enabled: body.enabled,
        p_source: 'ACCOUNT_SETTINGS',
      })
      if (error) throw error
      return json(cors, 200, { preference: data })
    }

    if (action === 'CONSENT_SET') {
      if (!isCommunicationChannel(body.channel) || body.channel === 'IN_APP' || typeof body.granted !== 'boolean') {
        return json(cors, 400, { error: 'INVALID_CONSENT' })
      }
      const { data, error } = await client.rpc('set_my_marketing_consent', {
        p_channel: body.channel,
        p_granted: body.granted,
        p_policy_version: typeof body.policyVersion === 'string' && body.policyVersion.trim() ? body.policyVersion.trim() : '2026-08-communications-v1',
        p_source: 'ACCOUNT_SETTINGS',
        p_evidence: { surface: 'COMMUNICATION_SETTINGS' },
      })
      if (error) throw error
      return json(cors, 200, { consent: data })
    }

    if (action === 'INBOX_LIST') {
      const limit = Math.max(1, Math.min(50, Number(body.limit) || 30))
      let query = client.from('communication_inbox')
        .select('id,category,purpose,severity,title,body,destination_key,destination_params,media,correlation_id,acknowledgement_required,read_at,acknowledged_at,expires_at,created_at')
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (typeof body.before === 'string' && body.before) query = query.lt('created_at', body.before)
      const [{ data, error }, { count, error: countError }] = await Promise.all([
        query,
        client.from('communication_inbox').select('id', { count: 'exact', head: true }).is('read_at', null)
          .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`),
      ])
      if (error || countError) throw error ?? countError
      return json(cors, 200, {
        items: data ?? [],
        unreadCount: count ?? 0,
        nextCursor: data?.length === limit ? data[data.length - 1]?.created_at ?? null : null,
      })
    }

    if (action === 'INBOX_MARK') {
      if (typeof body.inboxId !== 'string' || !['READ', 'UNREAD', 'ACKNOWLEDGED'].includes(String(body.inboxAction))) {
        return json(cors, 400, { error: 'INVALID_INBOX_ACTION' })
      }
      const { data, error } = await client.rpc('mark_my_communication_inbox', {
        p_inbox_id: body.inboxId,
        p_action: body.inboxAction,
      })
      if (error) throw error
      return json(cors, 200, { item: data })
    }

    return json(cors, 400, { error: 'UNKNOWN_ACTION' })
  } catch (error) {
    console.error('[communications-action]', action, user.id, error instanceof Error ? error.message : String(error))
    return json(cors, 400, { error: cleanError(error) })
  }
})
