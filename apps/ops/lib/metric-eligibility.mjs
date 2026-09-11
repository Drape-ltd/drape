// @ts-check

const TERMINAL_CASE_STATUSES = new Set(['RESOLVED', 'CLOSED', 'CANCELLED'])
const TERMINAL_INCIDENT_STATUSES = new Set(['RESOLVED', 'CLOSED', 'CANCELLED'])
const URGENT_PRIORITIES = new Set(['P0', 'P1'])

/** @param {unknown} value */
function normalized(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

/** @param {unknown} value */
function timestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** @param {{ status: string }} item */
export function isTerminalOpsCase(item) {
  return TERMINAL_CASE_STATUSES.has(normalized(item.status))
}

/** @param {{ status: string }} item */
export function isOpenOpsCase(item) {
  return !isTerminalOpsCase(item)
}

/** @param {{ status: string, priority?: string | null }} item */
export function isUrgentOpenOpsCase(item) {
  return isOpenOpsCase(item) && URGENT_PRIORITIES.has(normalized(item.priority))
}

/** @param {{ status: string, assignee?: string | null }} item */
export function isUnassignedOpenOpsCase(item) {
  return isOpenOpsCase(item) && normalized(item.assignee) === ''
}

/** @param {{ status: string, slaPaused?: boolean, slaDueAt?: string | null }} item */
export function isSlaTrackedOpenOpsCase(item) {
  return isOpenOpsCase(item) && !item.slaPaused && timestamp(item.slaDueAt) !== null
}

/**
 * @param {{ status: string, slaPaused?: boolean, slaDueAt?: string | null }} item
 * @param {number} nowMs
 */
export function isSlaBreachedOpenOpsCase(item, nowMs) {
  const dueAt = timestamp(item.slaDueAt)
  return isOpenOpsCase(item) && !item.slaPaused && dueAt !== null && dueAt < nowMs
}

/**
 * @param {{ status: string, slaPaused?: boolean, slaDueAt?: string | null, slaPhase?: string | null }} item
 * @param {number} nowMs
 */
export function isFirstResponseSlaBreached(item, nowMs) {
  return normalized(item.slaPhase) === 'FIRST_RESPONSE' && isSlaBreachedOpenOpsCase(item, nowMs)
}

/**
 * @param {{ status: string, slaPaused?: boolean, slaDueAt?: string | null, slaPhase?: string | null }} item
 * @param {number} nowMs
 */
export function isResolutionSlaBreached(item, nowMs) {
  return normalized(item.slaPhase) === 'ACTIVE_RESOLUTION' && isSlaBreachedOpenOpsCase(item, nowMs)
}

/**
 * @param {{ status: string, slaPaused?: boolean, slaDueAt?: string | null }} item
 * @param {number} nowMs
 * @param {number} [windowMs]
 */
export function isSlaDueSoonOpenOpsCase(item, nowMs, windowMs = 4 * 60 * 60 * 1000) {
  const dueAt = timestamp(item.slaDueAt)
  return isOpenOpsCase(item)
    && !item.slaPaused
    && dueAt !== null
    && dueAt >= nowMs
    && dueAt <= nowMs + windowMs
}

/**
 * @param {{ status: string, assignee?: string | null, slaPaused?: boolean, slaDueAt?: string | null }} item
 * @param {string} scope
 * @param {number} nowMs
 */
export function matchesOpsWorkScope(item, scope, nowMs) {
  switch (scope) {
    case 'all': return true
    case 'closed': return isTerminalOpsCase(item)
    case 'unassigned': return isUnassignedOpenOpsCase(item)
    case 'overdue': return isSlaBreachedOpenOpsCase(item, nowMs)
    case 'due': return isSlaDueSoonOpenOpsCase(item, nowMs)
    case 'open':
    default: return isOpenOpsCase(item)
  }
}

/** @param {{ priority?: string | null }} item @param {string} priority */
export function matchesOpsPriority(item, priority) {
  if (priority === 'all') return true
  if (priority === 'critical') return URGENT_PRIORITIES.has(normalized(item.priority))
  return normalized(item.priority) === normalized(priority)
}

/** @param {{ slaPhase?: string | null }} item @param {string} phase */
export function matchesOpsSlaPhase(item, phase) {
  if (phase === 'all') return true
  if (phase === 'first-response') return normalized(item.slaPhase) === 'FIRST_RESPONSE'
  if (phase === 'resolution') return normalized(item.slaPhase) === 'ACTIVE_RESOLUTION'
  return false
}

/**
 * @template {{ status: string, priority?: string | null, assignee?: string | null, slaPaused?: boolean, slaDueAt?: string | null, slaPhase?: string | null }} T
 * @param {T[]} items
 * @param {number} nowMs
 */
export function deriveOpsCaseMetricSets(items, nowMs) {
  const open = items.filter(isOpenOpsCase)
  return {
    open,
    urgent: open.filter(isUrgentOpenOpsCase),
    unassigned: open.filter(isUnassignedOpenOpsCase),
    slaTracked: open.filter(isSlaTrackedOpenOpsCase),
    breached: open.filter((item) => isSlaBreachedOpenOpsCase(item, nowMs)),
    firstResponseBreached: open.filter((item) => isFirstResponseSlaBreached(item, nowMs)),
    resolutionBreached: open.filter((item) => isResolutionSlaBreached(item, nowMs)),
  }
}

/** @param {{ status: string }} incident */
export function isOpenServiceIncident(incident) {
  return !TERMINAL_INCIDENT_STATUSES.has(normalized(incident.status))
}

/** @param {{ status: string, severity: string }} incident */
export function isCriticalOpenServiceIncident(incident) {
  return isOpenServiceIncident(incident) && normalized(incident.severity) === 'CRITICAL'
}

/**
 * @template {{ status: string, severity: string }} T
 * @param {T[]} incidents
 */
export function deriveIncidentMetricSets(incidents) {
  const open = incidents.filter(isOpenServiceIncident)
  return { open, critical: open.filter(isCriticalOpenServiceIncident) }
}
