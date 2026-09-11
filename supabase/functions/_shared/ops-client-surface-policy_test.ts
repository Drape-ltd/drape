import { assertEquals } from 'jsr:@std/assert@1'
import { isRestrictedOpsPhoneHeaders } from '../../../apps/ops/lib/client-surface-policy.ts'

function headers(values: Record<string, string>) {
  const normalized = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]))
  return { get: (name: string) => normalized.get(name.toLowerCase()) ?? null }
}

Deno.test('restricts iPhone and Android phone user agents', () => {
  assertEquals(isRestrictedOpsPhoneHeaders(headers({
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  })), true)
  assertEquals(isRestrictedOpsPhoneHeaders(headers({
    'user-agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36',
  })), true)
})

Deno.test('restricts a mobile client hint even when the user agent is reduced', () => {
  assertEquals(isRestrictedOpsPhoneHeaders(headers({
    'sec-ch-ua-mobile': '?1',
    'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
  })), true)
})

Deno.test('permits a desktop browser', () => {
  assertEquals(isRestrictedOpsPhoneHeaders(headers({
    'sec-ch-ua-mobile': '?0',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
  })), false)
})
