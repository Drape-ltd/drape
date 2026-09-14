import assert from 'node:assert/strict'
import test from 'node:test'
import { fingerprint, nextAlertState } from './index.mjs'

const slow = (latencyMs = 3_400) => [
  {
    id: 'prod-ready',
    ok: false,
    severity: 'warning',
    httpStatus: 200,
    latencyMs,
    detail: `Ready but slow (${latencyMs} ms)`,
  },
]

const healthy = [
  {
    id: 'prod-ready',
    ok: true,
    severity: 'ok',
    httpStatus: 200,
    latencyMs: 900,
    detail: 'Ready',
  },
]

const critical = [
  {
    id: 'prod-ready',
    ok: false,
    severity: 'critical',
    httpStatus: 503,
    latencyMs: 400,
    detail: 'Database readiness failed',
  },
]

test('a transient slow probe does not notify Slack', () => {
  const decision = nextAlertState(null, slow(), fingerprint(slow()))
  assert.equal(decision.event, 'NONE')
  assert.equal(decision.alertState.incidentOpen, false)
  assert.equal(decision.alertState.warningStreak, 1)
})

test('three consecutive slow probes open one warning incident', () => {
  const first = nextAlertState(null, slow(3_200), fingerprint(slow(3_200)))
  const second = nextAlertState(
    { healthy: false, alertState: first.alertState },
    slow(3_600),
    fingerprint(slow(3_600))
  )
  const third = nextAlertState(
    { healthy: false, alertState: second.alertState },
    slow(3_900),
    fingerprint(slow(3_900))
  )

  assert.equal(first.event, 'NONE')
  assert.equal(second.event, 'NONE')
  assert.equal(third.event, 'DEGRADED')
  assert.equal(third.alertState.incidentOpen, true)
})

test('two consecutive healthy probes are required before recovery', () => {
  const open = {
    healthy: false,
    alertState: {
      incidentOpen: true,
      warningStreak: 3,
      healthyStreak: 0,
      lastAlertSeverity: 'warning',
      lastAlertFingerprint: fingerprint(slow()),
    },
  }
  const first = nextAlertState(open, healthy, fingerprint(healthy))
  const second = nextAlertState(
    { healthy: true, alertState: first.alertState },
    healthy,
    fingerprint(healthy)
  )

  assert.equal(first.event, 'NONE')
  assert.equal(first.alertState.incidentOpen, true)
  assert.equal(second.event, 'RECOVERED')
  assert.equal(second.alertState.incidentOpen, false)
})

test('a critical readiness failure alerts immediately', () => {
  const decision = nextAlertState(null, critical, fingerprint(critical))
  assert.equal(decision.event, 'DEGRADED')
  assert.equal(decision.alertState.incidentOpen, true)
})

test('slow-warning fingerprints do not change with latency jitter', () => {
  assert.equal(fingerprint(slow(3_100)), fingerprint(slow(4_900)))
})
