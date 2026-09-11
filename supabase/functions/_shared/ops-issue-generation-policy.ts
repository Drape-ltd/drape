const ROUTINE_AUTOMATION_SOURCES = new Set([
  'escalate-production-stalls',
  'monitor-sentry-issues',
  'monitor-settlements',
  'payout-watchdog',
  'process-job-queue',
  'process-push-receipts',
  'release-order-payouts',
  'send-consultation-reminders',
])

export function routineOpsCaseGenerationEnabled(value: string | null | undefined) {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase())
}

export function shouldPersistRoutineOpsIssue(
  source: string,
  launchSwitch: string | null | undefined,
) {
  if (routineOpsCaseGenerationEnabled(launchSwitch)) return true
  return !ROUTINE_AUTOMATION_SOURCES.has(source.trim().toLowerCase())
}
