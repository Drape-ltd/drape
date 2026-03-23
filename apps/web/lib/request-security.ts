import type { SupabaseClient } from '@supabase/supabase-js'

const MAX_JSON_BODY_BYTES = 16_384

export async function readJsonBody(
  request: Request,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string; status: number }> {
  const contentType = request.headers.get('content-type') ?? ''
  const loweredContentType = contentType.toLowerCase()

  if (loweredContentType.includes('application/json')) {
    const raw = await request.text().catch(() => '')
    if (!raw) {
      return { ok: false, error: 'Invalid request body.', status: 400 }
    }

    if (raw.length > maxBytes) {
      return { ok: false, error: 'Request body is too large.', status: 413 }
    }

    try {
      const data = JSON.parse(raw) as Record<string, unknown>
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { ok: false, error: 'Invalid request body.', status: 400 }
      }
      return { ok: true, data }
    } catch {
      return { ok: false, error: 'Invalid request body.', status: 400 }
    }
  }

  if (
    loweredContentType.includes('application/x-www-form-urlencoded') ||
    loweredContentType.includes('multipart/form-data')
  ) {
    const formData = await request.formData().catch(() => null)
    if (!formData) {
      return { ok: false, error: 'Invalid request body.', status: 400 }
    }

    const data: Record<string, unknown> = {}
    let approxBytes = 0

    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') {
        data[key] = value
        approxBytes += key.length + value.length
      }
    }

    if (approxBytes > maxBytes) {
      return { ok: false, error: 'Request body is too large.', status: 413 }
    }

    return { ok: true, data }
  }

  return { ok: false, error: 'Invalid content type.', status: 415 }
}

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for') ?? ''
  const realIp = request.headers.get('x-real-ip') ?? ''
  const candidate = forwardedFor.split(',')[0]?.trim() || realIp.trim() || 'unknown'
  return candidate.slice(0, 128)
}

export async function checkPublicRateLimit(
  client: SupabaseClient,
  key: string,
  windowSeconds: number,
  maxRequests: number,
): Promise<boolean> {
  const { data, error } = await client.rpc('check_rate_limit', {
    p_key: key,
    p_window_seconds: windowSeconds,
    p_max_requests: maxRequests,
  })

  if (error) {
    console.error('[web rateLimit] error:', error.message)
    return false
  }

  return data === true
}

export function trimmedString(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

export function optionalTrimmedString(value: unknown, max: number): string | null {
  const trimmed = trimmedString(value, max)
  return trimmed.length > 0 ? trimmed : null
}
