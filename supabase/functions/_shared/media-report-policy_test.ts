import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { deriveMediaReportModeration } from './media-report-policy.ts'

Deno.test('one ordinary report keeps publish-first media visible for Trust review', () => {
  assertEquals(deriveMediaReportModeration('OTHER', 1), {
    automaticallyBlocked: false,
    riskLevel: 'MEDIUM',
    status: null,
  })
})

Deno.test('two distinct reports temporarily restrict media', () => {
  assertEquals(deriveMediaReportModeration('SCAM_OR_IMPERSONATION', 2), {
    automaticallyBlocked: true,
    riskLevel: 'HIGH',
    status: 'AUTO_BLOCKED',
  })
})

Deno.test('child safety report temporarily restricts media immediately', () => {
  assertEquals(deriveMediaReportModeration('CHILD_SAFETY', 1), {
    automaticallyBlocked: true,
    riskLevel: 'HIGH',
    status: 'AUTO_BLOCKED',
  })
})
