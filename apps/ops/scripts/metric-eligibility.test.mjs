import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deriveIncidentMetricSets,
  deriveOpsCaseMetricSets,
  isFirstResponseSlaBreached,
  isOpenOpsCase,
  isResolutionSlaBreached,
  isSlaBreachedOpenOpsCase,
  isSlaDueSoonOpenOpsCase,
  isTerminalOpsCase,
  matchesOpsPriority,
  matchesOpsSlaPhase,
  matchesOpsWorkScope,
} from '../lib/metric-eligibility.mjs'

const NOW = Date.parse('2026-09-11T12:00:00.000Z')

function item(overrides = {}) {
  return {
    id: 'case-1',
    status: 'OPEN',
    priority: 'P2',
    assignee: 'operator@example.com',
    slaPaused: false,
    slaDueAt: '2026-09-11T13:00:00.000Z',
    slaPhase: 'FIRST_RESPONSE',
    ...overrides,
  }
}

test('terminal and open source sets normalize status and include cancelled cases', () => {
  for (const status of ['RESOLVED', 'closed', ' Cancelled ']) {
    assert.equal(isTerminalOpsCase(item({ status })), true)
    assert.equal(isOpenOpsCase(item({ status })), false)
  }
  assert.equal(isOpenOpsCase(item({ status: 'WAITING' })), true)
})

test('breached and due-soon clocks are disjoint at the exact deadline', () => {
  const atDeadline = item({ slaDueAt: new Date(NOW).toISOString() })
  assert.equal(isSlaBreachedOpenOpsCase(atDeadline, NOW), false)
  assert.equal(isSlaDueSoonOpenOpsCase(atDeadline, NOW), true)
  assert.equal(isSlaBreachedOpenOpsCase(item({ slaDueAt: new Date(NOW - 1).toISOString() }), NOW), true)
})

test('terminal, paused, missing, and malformed clocks never enter SLA source sets', () => {
  assert.equal(isSlaBreachedOpenOpsCase(item({ status: 'CANCELLED', slaDueAt: '2020-01-01T00:00:00Z' }), NOW), false)
  assert.equal(isSlaBreachedOpenOpsCase(item({ slaPaused: true, slaDueAt: '2020-01-01T00:00:00Z' }), NOW), false)
  assert.equal(isSlaDueSoonOpenOpsCase(item({ slaDueAt: null }), NOW), false)
  assert.equal(isSlaDueSoonOpenOpsCase(item({ slaDueAt: 'not-a-date' }), NOW), false)
})

test('SLA phase source sets cannot overlap', () => {
  const overdue = { slaDueAt: '2026-09-11T11:00:00.000Z' }
  assert.equal(isFirstResponseSlaBreached(item({ ...overdue, slaPhase: 'FIRST_RESPONSE' }), NOW), true)
  assert.equal(isResolutionSlaBreached(item({ ...overdue, slaPhase: 'FIRST_RESPONSE' }), NOW), false)
  assert.equal(isResolutionSlaBreached(item({ ...overdue, slaPhase: 'ACTIVE_RESOLUTION' }), NOW), true)
})

test('case metric sets reconcile open, urgent, unassigned, and SLA totals', () => {
  const cases = [
    item({ id: 'urgent', priority: 'P1', assignee: null, slaDueAt: '2026-09-11T11:00:00.000Z' }),
    item({ id: 'resolution', slaPhase: 'ACTIVE_RESOLUTION', slaDueAt: '2026-09-11T10:00:00.000Z' }),
    item({ id: 'closed', status: 'CLOSED', priority: 'P0', assignee: null, slaDueAt: '2026-09-11T10:00:00.000Z' }),
  ]
  const sets = deriveOpsCaseMetricSets(cases, NOW)
  assert.deepEqual(sets.open.map(({ id }) => id), ['urgent', 'resolution'])
  assert.deepEqual(sets.urgent.map(({ id }) => id), ['urgent'])
  assert.deepEqual(sets.unassigned.map(({ id }) => id), ['urgent'])
  assert.equal(sets.breached.length, 2)
  assert.equal(sets.firstResponseBreached.length, 1)
  assert.equal(sets.resolutionBreached.length, 1)
})

test('queue scopes use the same terminal and SLA rules as headline metrics', () => {
  assert.equal(matchesOpsWorkScope(item({ status: 'CANCELLED' }), 'closed', NOW), true)
  assert.equal(matchesOpsWorkScope(item({ status: 'CANCELLED', assignee: null }), 'unassigned', NOW), false)
  assert.equal(matchesOpsWorkScope(item({ slaDueAt: '2026-09-11T11:00:00.000Z' }), 'overdue', NOW), true)
  assert.equal(matchesOpsWorkScope(item({ slaDueAt: '2026-09-11T15:59:59.000Z' }), 'due', NOW), true)
  assert.equal(matchesOpsWorkScope(item({ slaDueAt: '2026-09-11T16:00:01.000Z' }), 'due', NOW), false)
})

test('priority and phase drill-down filters normalize values and fail closed', () => {
  assert.equal(matchesOpsPriority(item({ priority: 'p1' }), 'critical'), true)
  assert.equal(matchesOpsPriority(item({ priority: 'P2' }), 'P2'), true)
  assert.equal(matchesOpsSlaPhase(item({ slaPhase: 'first_response' }), 'first-response'), true)
  assert.equal(matchesOpsSlaPhase(item(), 'unknown'), false)
})

test('critical incidents are a subset of the same non-terminal incident set', () => {
  const incidents = [
    { id: 'one', status: 'INVESTIGATING', severity: 'critical' },
    { id: 'two', status: 'MONITORING', severity: 'WARNING' },
    { id: 'three', status: 'RESOLVED', severity: 'CRITICAL' },
  ]
  const sets = deriveIncidentMetricSets(incidents)
  assert.deepEqual(sets.open.map(({ id }) => id), ['one', 'two'])
  assert.deepEqual(sets.critical.map(({ id }) => id), ['one'])
})
