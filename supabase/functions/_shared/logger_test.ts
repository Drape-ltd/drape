import { assertEquals, assertFalse, assertStringIncludes } from 'jsr:@std/assert'
import { serializeTelemetryEntry } from './telemetry-scrub.ts'

Deno.test('structured Edge logs scrub contacts, credentials, URLs, and sensitive fields', () => {
  const entry = serializeTelemetryEntry('error', 'checkout', 'provider.failed', {
    correlation_id: 'corr-safe',
    detail: 'person@example.com called +1 615 555 0199 at https://private.example/evidence?token=secret',
    provider_error: 'Bearer abcdefghijklmnop',
    delivery_address: '10 Private Street',
    authorization: 'Bearer do-not-log-me',
  })

  assertStringIncludes(entry, 'corr-safe')
  assertStringIncludes(entry, '[REDACTED_EMAIL]')
  assertStringIncludes(entry, '[REDACTED_PHONE]')
  assertStringIncludes(entry, '[REDACTED_URL]')
  assertStringIncludes(entry, '[REDACTED_CREDENTIAL]')
  assertFalse(entry.includes('person@example.com'))
  assertFalse(entry.includes('private.example'))
  assertFalse(entry.includes('Private Street'))
  assertFalse(entry.includes('do-not-log-me'))
})

Deno.test('structured Edge logs preserve safe operational identifiers', () => {
  const parsed = JSON.parse(serializeTelemetryEntry('info', 'ops-case-action', 'case.updated', {
    correlation_id: 'corr-123',
    case_id: 'case-456',
    outcome: 'SUCCEEDED',
  }))

  assertEquals(parsed.correlation_id, 'corr-123')
  assertEquals(parsed.case_id, 'case-456')
  assertEquals(parsed.outcome, 'SUCCEEDED')
})
