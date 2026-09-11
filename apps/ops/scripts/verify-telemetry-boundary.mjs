import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const [scrubber, logger, sentry, opsIssues, edgeNotifications, webNotifications, customerEmail, opsAction, opsError, badgeRoute, opsAuth, workforcePrincipal] = await Promise.all([
  readFile(new URL('../../supabase/functions/_shared/telemetry-scrub.ts', root), 'utf8'),
  readFile(new URL('../../supabase/functions/_shared/logger.ts', root), 'utf8'),
  readFile(new URL('../../supabase/functions/_shared/sentry.ts', root), 'utf8'),
  readFile(new URL('../../supabase/functions/_shared/ops-issues.ts', root), 'utf8'),
  readFile(new URL('../../supabase/functions/_shared/ops-notifications.ts', root), 'utf8'),
  readFile(new URL('../web/lib/ops-notifications.ts', root), 'utf8'),
  readFile(new URL('../web/lib/ops-customer-email.ts', root), 'utf8'),
  readFile(new URL('../web/app/ops/action/route.ts', root), 'utf8'),
  readFile(new URL('app/ops/error.tsx', root), 'utf8'),
  readFile(new URL('app/ops/api/badge/route.ts', root), 'utf8'),
  readFile(new URL('../web/lib/ops-auth.ts', root), 'utf8'),
  readFile(new URL('../web/lib/ops-workforce-principal.ts', root), 'utf8'),
])

const checks = [
  ['Shared scrubber covers sensitive keys, contacts, URLs, bearer/JWT, and provider credentials', scrubber.includes('SENSITIVE_KEY') && scrubber.includes('EMAIL_VALUE') && scrubber.includes('PHONE_VALUE') && scrubber.includes('URL_VALUE') && scrubber.includes('CREDENTIAL_VALUE')],
  ['Shared scrubber bounds depth, strings, and arrays', scrubber.includes("depth > 4") && scrubber.includes('.slice(0, 1_000)') && scrubber.includes('.slice(0, 50)')],
  ['Structured Edge stdout serializes only scrubbed fields', logger.includes('serializeTelemetryEntry(level, fn, event, data)') && scrubber.includes('JSON.stringify(sanitizeTelemetryValue({') && !logger.includes('error.message')],
  ['Sentry scrubs the complete event including message, tags, and extras', sentry.includes('sanitizeSentryEventValue({') && sentry.includes('message,') && sentry.includes('tags: options.tags') && sentry.includes('extra: options.extra')],
  ['Ops issue persistence uses the scrubbed logger', opsIssues.includes("import { log } from './logger.ts'") && !opsIssues.includes('console.')],
  ['Notification provider failures never log response bodies', !edgeNotifications.includes('response.text()') && !webNotifications.includes('response.text()') && !customerEmail.includes('response.text()')],
  ['Ops browser errors retain only stable references and types', !opsError.includes('error.message') && !badgeRoute.includes("console.error('[ops-badge] authoritative-read-failed', error") && !opsAuth.includes('message: error instanceof Error') && !workforcePrincipal.includes('{ message: error.message }')],
  ['Legacy rollback actions do not log operator email or raw failure detail', !opsAction.includes('actor: session.email') && !opsAction.includes("console.error('ops_action_failed', { kind, actor") && !opsAction.includes("targetStage, error: settlementEvidenceError.message")],
]

const failures = checks.filter(([, passed]) => !passed)
for (const [label, passed] of checks) console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`)

if (failures.length > 0) {
  console.error(`\nOps telemetry boundary failed ${failures.length} of ${checks.length} checks.`)
  process.exit(1)
}

console.log(`\nOps telemetry boundary passed ${checks.length} checks.`)
