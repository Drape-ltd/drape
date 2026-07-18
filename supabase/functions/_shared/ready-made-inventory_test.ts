import { resolveReadyMadeListingState } from './ready-made-inventory.ts'

function expectEquals(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`)
  }
}

Deno.test('resolveReadyMadeListingState keeps onboarding items hidden while preserving inventory counts', () => {
  const result = resolveReadyMadeListingState({
    requestedIsLive: true,
    canPublishReadyMade: true,
    inventoryQuantity: 4,
    onboarding: true,
  })

  expectEquals(
    result,
    {
      isLive: false,
      forcedDraft: true,
      stockStatus: 'HIDDEN',
      inventoryQuantity: 4,
    },
    'onboarding-created items should save as hidden drafts without dropping stock counts',
  )
})

Deno.test('resolveReadyMadeListingState publishes eligible non-onboarding items', () => {
  const result = resolveReadyMadeListingState({
    requestedIsLive: true,
    canPublishReadyMade: true,
    inventoryQuantity: 4,
    onboarding: false,
  })

  expectEquals(
    result,
    {
      isLive: true,
      forcedDraft: false,
      stockStatus: 'IN_STOCK',
      inventoryQuantity: 4,
    },
    'eligible non-onboarding items should be allowed to publish',
  )
})
