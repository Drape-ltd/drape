#!/usr/bin/env node

import fs from 'node:fs'

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}

  return Object.fromEntries(
    fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/u)
      .map((line) => line.match(/^([^#=\s]+)=(.*)$/u))
      .filter(Boolean)
      .map((match) => {
        let value = match[2].trim()
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        return [match[1], value]
      })
  )
}

const webEnv = loadEnvFile('apps/web/.env.local')
const mobileEnv = loadEnvFile('apps/mobile/.env.local')
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  webEnv.NEXT_PUBLIC_SUPABASE_URL ??
  mobileEnv.EXPO_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? webEnv.SUPABASE_SERVICE_ROLE_KEY
const healthcheckSecret = process.env.DRAPE_HEALTHCHECK_SECRET ?? mobileEnv.DRAPE_HEALTHCHECK_SECRET
const sentryMonitorToken = process.env.SENTRY_MONITOR_TOKEN ?? mobileEnv.SENTRY_MONITOR_TOKEN
const sentryMonitorOrg = process.env.SENTRY_MONITOR_ORG ?? mobileEnv.SENTRY_MONITOR_ORG
const sentryMonitorProjects = (
  process.env.SENTRY_MONITOR_PROJECTS ??
  mobileEnv.SENTRY_MONITOR_PROJECTS ??
  ''
)
  .split(',')
  .map((project) => project.trim())
  .filter(Boolean)
const outputJson = process.argv.includes('--json')

if (!supabaseUrl || !serviceRoleKey || !healthcheckSecret) {
  console.error(
    'Missing beta log credentials. Configure the Supabase URL and service role in apps/web/.env.local, and DRAPE_HEALTHCHECK_SECRET in apps/mobile/.env.local.'
  )
  process.exit(1)
}

const serviceHeaders = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
}

async function readJson(url, init = {}) {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => null)
  if (!response.ok && response.status !== 503) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(body)}`)
  }
  return { status: response.status, body }
}

function query(table, searchParams) {
  return readJson(`${supabaseUrl}/rest/v1/${table}?${searchParams}`, {
    headers: serviceHeaders,
  })
}

function compactError(value) {
  if (typeof value !== 'string') return null
  return value.replace(/\s+/gu, ' ').trim().slice(0, 240)
}

function sanitizeDiagnosticText(value) {
  const compact = compactError(value)
  if (!compact) return compact

  return compact
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[redacted-email]')
    .replace(/\b(?:\+?\d[\s().-]*){7,15}\b/gu, '[redacted-number]')
    .replace(
      /\b(authorization|bearer|token|secret|password|api[_-]?key)\b\s*[:=]\s*\S+/giu,
      '$1=[redacted]'
    )
}

async function readSentryJson(pathname) {
  const response = await fetch(`https://sentry.io/api/0${pathname}`, {
    headers: {
      authorization: `Bearer ${sentryMonitorToken}`,
      'content-type': 'application/json',
    },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(body)}`)
  }
  return body
}

async function readSentrySignals() {
  if (!sentryMonitorToken || !sentryMonitorOrg) {
    return {
      configured: false,
      status: 'not_configured',
      projects: [],
      unresolvedIssues: [],
    }
  }

  try {
    const organizationPath = encodeURIComponent(sentryMonitorOrg)
    const availableProjects = await readSentryJson(`/organizations/${organizationPath}/projects/`)
    const availableProjectSlugs = (availableProjects ?? [])
      .map((project) => project?.slug)
      .filter(Boolean)
    const projectSlugs =
      sentryMonitorProjects.length > 0
        ? sentryMonitorProjects.filter((project) => availableProjectSlugs.includes(project))
        : availableProjectSlugs

    const issueLists = await Promise.all(
      projectSlugs.map(async (project) => {
        const params = new URLSearchParams({
          query: 'is:unresolved environment:beta',
          sort: 'date',
          limit: '20',
        })
        const issues = await readSentryJson(
          `/projects/${organizationPath}/${encodeURIComponent(project)}/issues/?${params}`
        )

        return (issues ?? []).map((issue) => ({
          project,
          shortId: issue.shortId ?? null,
          level: issue.level ?? null,
          title: sanitizeDiagnosticText(issue.title),
          events: Number(issue.count ?? 0),
          users: Number(issue.userCount ?? 0),
          firstSeen: issue.firstSeen ?? null,
          lastSeen: issue.lastSeen ?? null,
          permalink: issue.permalink ?? null,
        }))
      })
    )

    return {
      configured: true,
      status: 'ok',
      projects: projectSlugs,
      unresolvedIssues: issueLists
        .flat()
        .sort((left, right) => String(right.lastSeen).localeCompare(String(left.lastSeen))),
    }
  } catch (error) {
    return {
      configured: true,
      status: 'error',
      error: sanitizeDiagnosticText(error instanceof Error ? error.message : String(error)),
      projects: [],
      unresolvedIssues: [],
    }
  }
}

const [readiness, pushAttempts, deadJobs, opsIssues] = await Promise.all([
  readJson(`${supabaseUrl}/functions/v1/service-health?check=ready`, {
    headers: { authorization: `Bearer ${healthcheckSecret}` },
  }),
  query(
    'push_delivery_attempts',
    'select=status,notification_kind,order_id,message_id,error_code,error_message,receipt_check_count,ticket_created_at,receipt_checked_at,provider_accepted_at&order=created_at.desc&limit=50'
  ),
  query(
    'job_queue',
    'select=id,job_type,status,attempt_count,max_attempts,last_error,created_at,updated_at&status=eq.DEAD&order=updated_at.desc&limit=20'
  ),
  query(
    'ops_issues',
    'select=issue_number,issue_type,severity,status,title,order_id,last_seen_at&status=in.(OPEN,IN_REVIEW,ESCALATED)&order=last_seen_at.desc&limit=20'
  ),
])
const sentry = await readSentrySignals()

const healthChecks = readiness.body?.checks ?? {}
const healthProblems = Object.entries(healthChecks)
  .filter(([, check]) => check?.status === 'warn' || check?.status === 'fail')
  .map(([name, check]) => ({
    check: name,
    status: check.status,
    message: check.message,
  }))

const report = {
  checkedAt: new Date().toISOString(),
  environment: new URL(supabaseUrl).hostname,
  readiness: {
    httpStatus: readiness.status,
    status: readiness.body?.status ?? 'unknown',
    problems: healthProblems,
  },
  pushAttempts: (pushAttempts.body ?? []).map((row) => ({
    ...row,
    error_message: compactError(row.error_message),
  })),
  deadJobs: (deadJobs.body ?? []).map((row) => ({
    ...row,
    last_error: compactError(row.last_error),
  })),
  openOpsIssues: opsIssues.body ?? [],
  sentry,
}

if (outputJson) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

console.log(`\nDrape beta signals - ${report.checkedAt}`)
console.log(`Environment: ${report.environment}`)
console.log(`Readiness: ${report.readiness.status} (HTTP ${report.readiness.httpStatus})`)

if (report.readiness.problems.length > 0) {
  console.table(report.readiness.problems)
}

console.log(`\nRecent push delivery attempts: ${report.pushAttempts.length}`)
if (report.pushAttempts.length > 0) console.table(report.pushAttempts)

console.log(`\nDead-letter jobs: ${report.deadJobs.length}`)
if (report.deadJobs.length > 0) console.table(report.deadJobs)

console.log(`\nOpen ops issues: ${report.openOpsIssues.length}`)
if (report.openOpsIssues.length > 0) console.table(report.openOpsIssues)

if (!report.sentry.configured) {
  console.log('\nSentry: not configured for read-only monitoring')
} else if (report.sentry.status === 'error') {
  console.log(`\nSentry monitoring error: ${report.sentry.error}`)
} else {
  console.log(`\nSentry projects: ${report.sentry.projects.join(', ')}`)
  console.log(`Unresolved beta issues: ${report.sentry.unresolvedIssues.length}`)
  if (report.sentry.unresolvedIssues.length > 0) {
    console.table(report.sentry.unresolvedIssues)
  }
}
