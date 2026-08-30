import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []

function read(relativePath) {
  const absolutePath = resolve(root, relativePath)
  if (!existsSync(absolutePath)) {
    failures.push(`${relativePath}: file is missing`)
    return ''
  }
  return readFileSync(absolutePath, 'utf8')
}

function requireText(relativePath, source, values) {
  for (const value of values) {
    if (!source.includes(value)) failures.push(`${relativePath}: missing ${value}`)
  }
}

const controlPlanePath = 'supabase/migrations/20260828120000_communications_control_plane.sql'
const workflowPath = 'supabase/migrations/20260828130000_communications_ops_workflow.sql'
const orchestrationPath = 'supabase/migrations/20260828140000_communications_retry_and_incident_orchestration.sql'
const controlPlane = read(controlPlanePath)
const workflow = read(workflowPath)
const orchestration = read(orchestrationPath)

requireText(controlPlanePath, controlPlane, [
  'communication_campaigns',
  'communication_campaign_recipients',
  'communication_provider_events',
  'communication_inbox',
  'communication_consent',
  'service_incidents',
  'acknowledgement_required',
])

const workflowAndOrchestration = `${workflow}\n${orchestration}`
for (const contract of [
  'ops_create_communication_campaign',
  'ops_review_communication_campaign',
  'ops_publish_communication_campaign',
  'ops_pause_communication_campaign',
  'ops_resume_communication_campaign',
  'ops_cancel_communication_campaign',
  'ops_retry_communication_recipient',
  'ops_upsert_service_incident',
  'ops_create_incident_communication_campaign',
]) {
  if (!workflowAndOrchestration.includes(contract)) {
    failures.push(`communications workflow migrations: missing ${contract}`)
  }
}

const acknowledgementFiles = [
  'supabase/functions/_shared/communication-campaign-worker.ts',
  'supabase/functions/communications-action/index.ts',
  'apps/mobile/app/(customer)/profile/notifications.tsx',
  'apps/mobile/app/(tailor)/profile/notifications.tsx',
  'apps/web/components/communication-center.tsx',
]
for (const relativePath of acknowledgementFiles) {
  requireText(relativePath, read(relativePath), ['acknowledgement_required'])
}

const statusFiles = [
  'supabase/functions/communications-action/index.ts',
  'apps/mobile/lib/communications.ts',
  'apps/web/components/service-status-surface.tsx',
]
for (const relativePath of statusFiles) {
  requireText(relativePath, read(relativePath), ['STATUS_LIST'])
}

for (const relativePath of [
  'apps/mobile/app/(customer)/profile/service-status.tsx',
  'apps/mobile/app/(tailor)/profile/service-status.tsx',
  'apps/web/app/status/page.tsx',
]) {
  read(relativePath)
}

if (failures.length > 0) {
  console.error('Communications contract parity failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log('Communications contract parity passed across SQL, Edge, mobile, and web.')
}
