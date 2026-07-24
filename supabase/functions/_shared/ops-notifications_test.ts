import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { parseEmailList } from './ops-notifications.ts'

Deno.test('parseEmailList normalizes and deduplicates configured Ops recipients', () => {
  assertEquals(
    parseEmailList(' Ops@Drapeon.co,founder@example.com;ops@drapeon.co\nreview@example.com '),
    ['ops@drapeon.co', 'founder@example.com', 'review@example.com'],
  )
})

Deno.test('parseEmailList ignores empty recipient entries', () => {
  assertEquals(parseEmailList(' , ; \n '), [])
  assertEquals(parseEmailList(null), [])
})
