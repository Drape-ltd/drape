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

Deno.test('renders secure media and app-open fallbacks without publicizing storage paths', () => {
  const email = renderDrapeonTransactionalEmail({
    preheader: 'New production proof',
    headline: 'Review the latest order media',
    recipientName: 'Anna',
    body: 'A new image is ready.',
    ctaLabel: 'View securely on web',
    ctaUrl: 'https://drapeon.co/account/orders/order-1',
    secondaryCtaLabel: 'Open in Drapeon',
    secondaryCtaUrl: 'drapeon://orders/order-1',
    evidenceImageUrl: 'https://signed.example/media.jpg?token=short-lived',
    evidenceLinkUrl: 'https://drapeon.co/account/orders/order-1#order-media',
  })

  assertStringIncludes(email.html, 'View this media securely on Drapeon')
  assertStringIncludes(email.html, 'https://drapeon.co/account/orders/order-1#order-media')
  assertStringIncludes(email.html, 'Open in Drapeon')
  assertStringIncludes(email.text, 'Open in Drapeon: drapeon://orders/order-1')
})
