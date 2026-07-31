import { getDailyApiKey, getSupabaseUrl } from '../_shared/env.ts'

const EVENT_TYPES = [
  'meeting.started',
  'meeting.ended',
  'participant.joined',
  'participant.left',
]

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const expectedSetupSecret = Deno.env.get('DAILY_WEBHOOK_SETUP_SECRET')?.trim()
  const providedSetupSecret = request.headers.get('x-drape-webhook-setup')?.trim()
  const hmac = Deno.env.get('DAILY_WEBHOOK_HMAC')?.trim()
  if (!expectedSetupSecret || providedSetupSecret !== expectedSetupSecret || !hmac) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const dailyApiKey = getDailyApiKey()
  const webhookUrl = `${getSupabaseUrl()}/functions/v1/daily-call-webhook`
  const headers = {
    Authorization: `Bearer ${dailyApiKey}`,
    'Content-Type': 'application/json',
    'User-Agent': 'drapeon-edge-calling/1.0',
  }
  const listResponse = await fetch('https://api.daily.co/v1/webhooks', { headers })
  if (!listResponse.ok) return json({ error: 'Could not inspect Daily webhooks' }, 502)
  const listPayload = await listResponse.json() as {
    data?: Array<{ uuid?: string; url?: string }>
  }
  const existing = listPayload.data?.find((webhook) => webhook.url === webhookUrl)
  const endpoint = existing?.uuid
    ? `https://api.daily.co/v1/webhooks/${existing.uuid}`
    : 'https://api.daily.co/v1/webhooks'

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      url: webhookUrl,
      eventTypes: EVENT_TYPES,
      retryType: 'exponential',
      hmac,
    }),
  })
  const payload = await response.json().catch(() => ({})) as {
    uuid?: unknown
    state?: unknown
  }
  if (!response.ok) return json({ error: 'Daily rejected the webhook configuration' }, 502)

  return json({
    ok: true,
    webhookId: typeof payload.uuid === 'string' ? payload.uuid : existing?.uuid ?? null,
    state: typeof payload.state === 'string' ? payload.state : 'ACTIVE',
    updated: Boolean(existing?.uuid),
    eventTypes: EVENT_TYPES,
  })
})
