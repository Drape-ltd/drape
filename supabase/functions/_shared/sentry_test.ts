import { assertEquals, assertFalse, assertStringIncludes } from 'jsr:@std/assert'
import { sanitizeSentryEventValue } from './sentry.ts'

Deno.test('Sentry event scrubbing covers messages, tags, extras, and nested sensitive keys', () => {
  const sanitized = sanitizeSentryEventValue({
    message: 'Checkout failed for person@example.com on +1 615 555 0199 at https://private.example/evidence',
    tags: { route: '/checkout', operator: 'staff@drapeon.co', phone: '+1 615 555 0199' },
    extra: {
      orderId: 'order-safe-id',
      authorization: 'Bearer private-token',
      nested: { delivery_address: '10 Private Street', note: 'Email buyer@example.com' },
    },
  }) as Record<string, unknown>

  const serialized = JSON.stringify(sanitized)
  assertStringIncludes(serialized, '[REDACTED_EMAIL]')
  assertStringIncludes(serialized, '[REDACTED_PHONE]')
  assertStringIncludes(serialized, '[REDACTED_URL]')
  assertStringIncludes(serialized, 'order-safe-id')
  assertFalse(serialized.includes('person@example.com'))
  assertFalse(serialized.includes('staff@drapeon.co'))
  assertFalse(serialized.includes('buyer@example.com'))
  assertFalse(serialized.includes('private-token'))
  assertFalse(serialized.includes('private.example'))
  assertFalse(serialized.includes('Private Street'))
  assertEquals((sanitized.tags as Record<string, unknown>).phone, '[REDACTED]')
})

Deno.test('Sentry event scrubbing bounds strings, arrays, and nested depth', () => {
  const sanitized = sanitizeSentryEventValue({
    long: 'a'.repeat(1_200),
    items: Array.from({ length: 75 }, (_, index) => index),
    nested: { one: { two: { three: { four: { five: 'never emitted' } } } } },
  }) as Record<string, unknown>

  assertEquals((sanitized.long as string).length, 1_000)
  assertEquals((sanitized.items as unknown[]).length, 50)
  assertStringIncludes(JSON.stringify(sanitized.nested), '[TRUNCATED]')
})
