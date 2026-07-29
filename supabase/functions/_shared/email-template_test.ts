import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { normalizeDrapeonSender, renderDrapeonTransactionalEmail } from './email-template.ts'

Deno.test('normalizes stale sender display names to Drapeon', () => {
  assertEquals(normalizeDrapeonSender('Drapeon <noreply@drapeon.co>'), 'Drapeon <noreply@drapeon.co>')
})

Deno.test('supports specialized Drapeon sender identities', () => {
  assertEquals(
    normalizeDrapeonSender('Drapeon <noreply@drapeon.co>', 'Drapeon Security', 'security@drapeon.co'),
    'Drapeon Security <noreply@drapeon.co>'
  )
})

Deno.test('escapes user content and provides a plain-text fallback', () => {
  const email = renderDrapeonTransactionalEmail({
    preheader: 'Quote accepted',
    headline: 'Quote <accepted>',
    recipientName: '<Anna>',
    body: 'A customer accepted your quote.',
    details: [
      { label: 'Order', value: '#DRP<&>' },
      { label: 'Item', value: 'Agbada' },
    ],
    ctaLabel: 'Open order',
    ctaUrl: 'https://drapeon.co/account/orders/order-1',
  })

  assertStringIncludes(email.html, 'Quote &lt;accepted&gt;')
  assertStringIncludes(email.html, 'Hi &lt;Anna&gt;,')
  assertStringIncludes(email.html, '#DRP&lt;&amp;&gt;')
  assertStringIncludes(email.text, 'Open order: https://drapeon.co/account/orders/order-1')
})
