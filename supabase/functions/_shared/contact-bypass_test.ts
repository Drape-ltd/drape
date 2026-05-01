import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { hasBlockedContact } from './contact-bypass.ts'

Deno.test('blocks real phone numbers and off-platform contact details', () => {
  assertEquals(hasBlockedContact('+44 7911 123456'), true)
  assertEquals(hasBlockedContact('message me on whatsapp'), true)
  assertEquals(hasBlockedContact('see www.tailor-example.com'), true)
  assertEquals(hasBlockedContact('ada@example.com'), true)
})

Deno.test('allows common custom-fit measurement formats', () => {
  assertEquals(hasBlockedContact('Bust 38, waist 29, hips 42.'), false)
  assertEquals(hasBlockedContact('Please fit this for 38-29-42 with a 14 inch shoulder.'), false)
  assertEquals(hasBlockedContact('Height 5 7, sleeve 23, inseam 31.'), false)
})

Deno.test('allows date-style deadlines in notes', () => {
  assertEquals(hasBlockedContact('Wedding deadline is 2026-05-26.'), false)
  assertEquals(hasBlockedContact('Please deliver before 26/05/2026 if possible.'), false)
})
