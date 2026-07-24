import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { classifyExpoPushReceipt } from './expo-push-receipts.ts'

Deno.test('classifies accepted Expo receipts without claiming device delivery', () => {
  assertEquals(classifyExpoPushReceipt({ status: 'ok' }), { kind: 'provider-accepted' })
})

Deno.test('classifies missing Expo receipts as pending', () => {
  assertEquals(classifyExpoPushReceipt(undefined), { kind: 'pending' })
  assertEquals(classifyExpoPushReceipt({}), { kind: 'pending' })
})

Deno.test('preserves Expo delivery error codes for token cleanup and ops review', () => {
  assertEquals(
    classifyExpoPushReceipt({
      status: 'error',
      message: 'The device is not registered.',
      details: { error: 'DeviceNotRegistered' },
    }),
    {
      kind: 'delivery-error',
      errorCode: 'DeviceNotRegistered',
      message: 'The device is not registered.',
    },
  )
})
