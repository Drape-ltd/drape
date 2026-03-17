/**
 * _shared/validate.ts
 *
 * Zod-based input validation for Edge Functions.
 *
 * Usage:
 *   import { z, parseBody, uuid, shortText, longText } from '../_shared/validate.ts'
 *
 *   const Schema = z.object({ orderId: uuid, action: z.enum([...]) })
 *   const result = parseBody(Schema, rawJson)
 *   if (!result.ok) return new Response(result.error, { status: 400, ... })
 *   const { orderId, action } = result.data
 */

export { z } from 'https://esm.sh/zod@3.22.4'
import { z } from 'https://esm.sh/zod@3.22.4'

// ─── Reusable field schemas ────────────────────────────────────────────────────

/** UUID v4 string */
export const uuid = z.string().uuid({ message: 'Must be a valid UUID' })

/** Non-empty string, trimmed, max 300 chars — for notes / short user text */
export const shortText = z.string().trim().min(1).max(300)

/** Optional note — trimmed, max 300 chars */
export const optionalNote = z.string().trim().max(300).optional()

/** ISO date string */
export const isoDate = z
  .string()
  .refine((val) => !isNaN(Date.parse(val)), { message: 'Must be a valid ISO date string' })

// ─── Parse helper ─────────────────────────────────────────────────────────────

type ParseOk<T> = { ok: true; data: T }
type ParseErr  = { ok: false; error: string }

/**
 * Parse raw JSON against a Zod schema.
 * Returns { ok: true, data } on success or { ok: false, error } with a
 * human-readable message suitable for a 400 response body.
 */
export function parseBody<T>(
  schema: z.ZodType<T>,
  raw: unknown,
): ParseOk<T> | ParseErr {
  const result = schema.safeParse(raw)
  if (result.success) return { ok: true, data: result.data }

  const messages = result.error.issues
    .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
    .join('; ')

  return { ok: false, error: `Validation error — ${messages}` }
}
