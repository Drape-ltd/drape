import { assertEquals } from 'jsr:@std/assert@1'
import {
  routineOpsCaseGenerationEnabled,
  shouldPersistRoutineOpsIssue,
} from './ops-issue-generation-policy.ts'

Deno.test('routine Ops cases default off before launch', () => {
  assertEquals(shouldPersistRoutineOpsIssue('release-order-payouts', undefined), false)
  assertEquals(shouldPersistRoutineOpsIssue('monitor-sentry-issues', ''), false)
  assertEquals(shouldPersistRoutineOpsIssue('process-job-queue', 'false'), false)
})

Deno.test('launch switch enables routine automated Ops cases', () => {
  assertEquals(routineOpsCaseGenerationEnabled('TRUE'), true)
  assertEquals(shouldPersistRoutineOpsIssue('release-order-payouts', 'true'), true)
})

Deno.test('manual and customer-initiated cases remain available before launch', () => {
  assertEquals(shouldPersistRoutineOpsIssue('ops-dashboard-manual', undefined), true)
  assertEquals(shouldPersistRoutineOpsIssue('request-data-access', undefined), true)
  assertEquals(shouldPersistRoutineOpsIssue('account-profile-action', undefined), true)
})
