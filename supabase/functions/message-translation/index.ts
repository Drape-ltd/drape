import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { getClientIp, rateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'message-translation'
const languageCode = z.string().trim().regex(/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/u).transform(normalizeLanguageCode)

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('settings'), orderId: uuid }),
  z.object({
    action: z.literal('update-settings'),
    orderId: uuid,
    autoTranslate: z.boolean(),
    targetLanguage: languageCode,
    sourceLanguage: languageCode.nullable().optional(),
  }),
  z.object({ action: z.literal('languages'), orderId: uuid }),
  z.object({
    action: z.literal('translate'),
    orderId: uuid,
    messageId: z.string().trim().min(1).max(128),
    targetLanguage: languageCode,
    sourceLanguage: languageCode.nullable().optional(),
  }),
])

function normalizeLanguageCode(value: string) {
  const [language, region] = value.replace('_', '-').split('-')
  return region ? `${language.toLowerCase()}-${region.toUpperCase()}` : language.toLowerCase()
}

function jsonResponse(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function jsonError(cors: HeadersInit, status: number, code: string, error: string) {
  return jsonResponse({ code, error }, status, cors)
}

async function authorizeOrder(supabase: any, orderId: string, userId: string) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, customer_id, tailor_id')
    .eq('id', orderId)
    .maybeSingle()
  if (error || !data) return false
  return data.customer_id === userId || data.tailor_id === userId
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function decodeGoogleText(value: string) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

type ProviderTranslation = {
  translatedText: string
  detectedSourceLanguage?: string
  provider: string
}

function azureHeaders() {
  const apiKey = Deno.env.get('AZURE_TRANSLATOR_KEY')?.trim()
  if (!apiKey) return null

  const region = Deno.env.get('AZURE_TRANSLATOR_REGION')?.trim()
  return {
    'Content-Type': 'application/json; charset=UTF-8',
    'Ocp-Apim-Subscription-Key': apiKey,
    ...(region ? { 'Ocp-Apim-Subscription-Region': region } : {}),
    'X-ClientTraceId': crypto.randomUUID(),
  }
}

async function providerError(response: Response, provider: string) {
  const detail = await response.text().catch(() => '')
  log('warn', FN, 'provider.request_failed', {
    provider,
    status: response.status,
    detail: detail.slice(0, 240),
  })
  throw new Error('TRANSLATION_PROVIDER_FAILED')
}

async function azureLanguages() {
  const response = await fetch(
    'https://api.cognitive.microsofttranslator.com/languages?api-version=3.0&scope=translation',
    { headers: { 'Accept-Language': 'en' } },
  )
  if (!response.ok) await providerError(response, 'azure-translator-v3')
  const result = await response.json()
  return Object.entries(result?.translation ?? {})
    .filter(([code, item]) => typeof code === 'string' && typeof (item as any)?.name === 'string')
    .map(([code, item]) => ({ code: normalizeLanguageCode(code), name: (item as any).name as string }))
}

async function azureTranslate(
  text: string,
  targetLanguage: string,
  sourceLanguage?: string | null,
): Promise<ProviderTranslation> {
  const headers = azureHeaders()
  if (!headers) throw new Error('TRANSLATION_NOT_CONFIGURED')

  const query = new URLSearchParams({
    'api-version': '3.0',
    to: targetLanguage,
    textType: 'plain',
  })
  if (sourceLanguage) query.set('from', sourceLanguage)

  const response = await fetch(`https://api.cognitive.microsofttranslator.com/translate?${query}`, {
    method: 'POST',
    headers,
    body: JSON.stringify([{ Text: text }]),
  })
  if (!response.ok) await providerError(response, 'azure-translator-v3')

  const result = await response.json()
  const translatedText = result?.[0]?.translations?.[0]?.text
  if (typeof translatedText !== 'string' || !translatedText.trim()) {
    throw new Error('TRANSLATION_PROVIDER_FAILED')
  }

  return {
    translatedText: translatedText.trim(),
    detectedSourceLanguage: result?.[0]?.detectedLanguage?.language,
    provider: 'azure-translator-v3',
  }
}

async function googleRequest(path: string, init?: RequestInit) {
  const apiKey = Deno.env.get('GOOGLE_CLOUD_TRANSLATION_API_KEY')?.trim()
  if (!apiKey) throw new Error('TRANSLATION_NOT_CONFIGURED')
  const separator = path.includes('?') ? '&' : '?'
  const response = await fetch(`https://translation.googleapis.com/language/translate/v2${path}${separator}key=${encodeURIComponent(apiKey)}`, init)
  if (!response.ok) await providerError(response, 'google-cloud-translation-v2')
  return response.json()
}

async function providerLanguages() {
  if (azureHeaders()) return azureLanguages()

  const result = await googleRequest('/languages?target=en')
  return (result?.data?.languages ?? [])
    .filter((item: any) => typeof item?.language === 'string' && typeof item?.name === 'string')
    .map((item: any) => ({ code: normalizeLanguageCode(item.language), name: item.name }))
}

async function providerTranslate(
  text: string,
  targetLanguage: string,
  sourceLanguage?: string | null,
): Promise<ProviderTranslation> {
  if (azureHeaders()) return azureTranslate(text, targetLanguage, sourceLanguage)

  const requestBody: Record<string, unknown> = { q: text, target: targetLanguage, format: 'text' }
  if (sourceLanguage) requestBody.source = sourceLanguage
  const result = await googleRequest('', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  })
  const translated = result?.data?.translations?.[0]
  const translatedText = typeof translated?.translatedText === 'string'
    ? decodeGoogleText(translated.translatedText).trim()
    : ''
  if (!translatedText) throw new Error('TRANSLATION_PROVIDER_FAILED')
  return {
    translatedText,
    detectedSourceLanguage: translated?.detectedSourceLanguage,
    provider: 'google-cloud-translation-v2',
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) return jsonError(cors, 401, 'UNAUTHORIZED', 'Sign in again to use message translation.')

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) return jsonError(cors, 400, 'VALIDATION_FAILED', parsed.error)

    const body = parsed.data
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    if (!await authorizeOrder(supabase, body.orderId, caller.id)) {
      return jsonError(cors, 403, 'FORBIDDEN', 'This conversation is not available from your account.')
    }

    const limit = await rateLimit(
      supabase,
      caller.id,
      `${FN}:${body.action}`,
      body.action === 'translate' ? 60 : 30,
      60_000,
      { ip: getClientIp(req), userId: caller.id },
    )
    if (!limit.allowed) return rateLimitExceededResponse(cors, limit.retryAfter)

    if (body.action === 'settings') {
      const { data } = await supabase
        .from('conversation_translation_preferences')
        .select('auto_translate, target_language, source_language')
        .eq('order_id', body.orderId)
        .eq('user_id', caller.id)
        .maybeSingle()
      return jsonResponse({
        preference: {
          autoTranslate: data?.auto_translate ?? false,
          targetLanguage: data?.target_language ?? 'en',
          sourceLanguage: data?.source_language ?? null,
        },
      }, 200, cors)
    }

    if (body.action === 'update-settings') {
      const { error } = await supabase.from('conversation_translation_preferences').upsert({
        order_id: body.orderId,
        user_id: caller.id,
        auto_translate: body.autoTranslate,
        target_language: body.targetLanguage,
        source_language: body.sourceLanguage ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'order_id,user_id' })
      if (error) return jsonError(cors, 500, 'DATABASE_ERROR', 'Could not save translation settings.')
      return jsonResponse({
        ok: true,
        preference: {
          autoTranslate: body.autoTranslate,
          targetLanguage: body.targetLanguage,
          sourceLanguage: body.sourceLanguage ?? null,
        },
      }, 200, cors)
    }

    if (body.action === 'languages') {
      try {
        const languages = await providerLanguages()
        return jsonResponse({ languages }, 200, cors)
      } catch (error) {
        if (error instanceof Error && error.message === 'TRANSLATION_NOT_CONFIGURED') {
          return jsonError(cors, 503, 'TRANSLATION_NOT_CONFIGURED', 'Translation is not configured yet.')
        }
        return jsonError(cors, 502, 'TRANSLATION_PROVIDER_FAILED', 'Could not load translation languages.')
      }
    }

    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select('id, order_id, type, body, is_deleted')
      .eq('id', body.messageId)
      .eq('order_id', body.orderId)
      .maybeSingle()
    if (messageError) return jsonError(cors, 500, 'DATABASE_ERROR', 'Could not load this message.')
    if (!message || message.is_deleted) return jsonError(cors, 404, 'MESSAGE_NOT_FOUND', 'This message is no longer available.')
    if (message.type !== 'TEXT' || typeof message.body !== 'string' || !message.body.trim()) {
      return jsonError(cors, 409, 'MESSAGE_NOT_TRANSLATABLE', 'Only text messages can be translated right now.')
    }

    const originalText = message.body.trim()
    const originalSha256 = await sha256(originalText)
    let cacheQuery = supabase
      .from('message_translations')
      .select('source_language, target_language, translated_text, original_sha256')
      .eq('message_id', body.messageId)
      .eq('target_language', body.targetLanguage)
      .eq('original_sha256', originalSha256)
    if (body.sourceLanguage) cacheQuery = cacheQuery.eq('source_language', body.sourceLanguage)
    const { data: cached } = await cacheQuery.order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (cached) {
      return jsonResponse({
        translation: {
          messageId: body.messageId,
          translatedText: cached.translated_text,
          sourceLanguage: cached.source_language,
          targetLanguage: cached.target_language,
        },
        cached: true,
      }, 200, cors)
    }

    try {
      const translated = await providerTranslate(originalText, body.targetLanguage, body.sourceLanguage)
      const translatedText = translated.translatedText
      const detectedSource = normalizeLanguageCode(
        body.sourceLanguage ?? translated.detectedSourceLanguage ?? 'und',
      )

      await supabase.from('message_translations').upsert({
        message_id: body.messageId,
        target_language: body.targetLanguage,
        source_language: detectedSource,
        translated_text: translatedText,
        original_sha256: originalSha256,
        provider: translated.provider,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'message_id,target_language,source_language' })

      await audit(supabase, {
        event: 'message.translated',
        actor_id: caller.id,
        actor_role: 'UNKNOWN',
        order_id: body.orderId,
        payload: {
          function: FN,
          message_id: body.messageId,
          source_language: detectedSource,
          target_language: body.targetLanguage,
        },
      })

      return jsonResponse({
        translation: {
          messageId: body.messageId,
          translatedText,
          sourceLanguage: detectedSource,
          targetLanguage: body.targetLanguage,
        },
        cached: false,
      }, 200, cors)
    } catch (error) {
      if (error instanceof Error && error.message === 'TRANSLATION_NOT_CONFIGURED') {
        return jsonError(cors, 503, 'TRANSLATION_NOT_CONFIGURED', 'Translation is not configured yet.')
      }
      return jsonError(cors, 502, 'TRANSLATION_PROVIDER_FAILED', 'This message could not be translated right now.')
    }
  } catch (error) {
    log('error', FN, 'request.failed', { error: error instanceof Error ? error.message : String(error) })
    return jsonError(cors, 500, 'INTERNAL_ERROR', 'Message translation is unavailable right now.')
  }
})
