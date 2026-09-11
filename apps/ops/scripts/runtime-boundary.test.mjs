import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OPS_ACCESS_CERT_STALE_MAX_AGE_MS,
  accessCertificateAllowsSensitiveAction,
  accessCertificateFallbackState,
} from '../../web/lib/ops-access-certificate-policy.mjs'
import { hasValidOpsAccessTokenClaims } from '../../web/lib/ops-access-token-policy.mjs'
import { canUseLegacyOpsReadBridge } from '../lib/legacy-read-bridge-policy.mjs'
import { evaluateOpsRuntimeBoundary } from '../lib/runtime-boundary.mjs'

const valid = {
  nodeEnvironment: 'production',
  hostname: 'ops.drapeon.co',
  expectedHostname: 'ops.drapeon.co',
  opsEnvironment: 'production',
  expectedProjectRef: 'prodref',
  supabaseUrl: 'https://prodref.supabase.co',
  accessTeamDomain: 'drapeon.cloudflareaccess.com',
  normalAudience: 'normal-aud',
  sensitiveAudience: 'sensitive-aud',
  sharedToken: undefined,
  bootstrapFlag: undefined,
  localWorkforceFlag: undefined,
}

test('accepts the complete canonical production runtime', () => {
  assert.equal(evaluateOpsRuntimeBoundary(valid), null)
})

test('denies a second production hostname without revealing configuration', () => {
  assert.deepEqual(evaluateOpsRuntimeBoundary({ ...valid, hostname: 'drape-ops.workers.dev' }), { status: 404, code: 'host-denied' })
})

test('fails closed for a cross-project Supabase target', () => {
  assert.deepEqual(evaluateOpsRuntimeBoundary({ ...valid, supabaseUrl: 'https://devref.supabase.co' }), { status: 503, code: 'project-mismatch' })
})

test('fails closed when the sensitive Access audience is absent', () => {
  assert.deepEqual(evaluateOpsRuntimeBoundary({ ...valid, sensitiveAudience: '' }), { status: 503, code: 'access-incomplete' })
})

test('fails closed when any bootstrap or shared-token path is configured', () => {
  assert.deepEqual(evaluateOpsRuntimeBoundary({ ...valid, sharedToken: 'present' }), { status: 503, code: 'forbidden-bootstrap-config' })
  assert.deepEqual(evaluateOpsRuntimeBoundary({ ...valid, bootstrapFlag: 'true' }), { status: 503, code: 'forbidden-bootstrap-config' })
  assert.deepEqual(evaluateOpsRuntimeBoundary({ ...valid, localWorkforceFlag: '1' }), { status: 503, code: 'forbidden-bootstrap-config' })
})

test('permits local development without production credentials', () => {
  assert.equal(evaluateOpsRuntimeBoundary({ ...valid, nodeEnvironment: 'development', hostname: 'localhost', sensitiveAudience: undefined }), null)
  assert.equal(evaluateOpsRuntimeBoundary({ ...valid, hostname: '127.0.0.1', sensitiveAudience: undefined }), null)
})

test('permits the legacy case reader only for recognized development schema drift', () => {
  assert.equal(canUseLegacyOpsReadBridge({ environment: 'DEVELOPMENT', error: { code: '42703' } }), true)
  assert.equal(canUseLegacyOpsReadBridge({ environment: 'development', error: { code: 'PGRST204' } }), true)
})

test('production never falls back to the environment-less legacy case reader', () => {
  assert.equal(canUseLegacyOpsReadBridge({ environment: 'PRODUCTION', error: { code: '42703' } }), false)
  assert.equal(canUseLegacyOpsReadBridge({ environment: 'production', error: { code: 'PGRST204' } }), false)
})

test('authorization, connectivity, and unknown failures never qualify as migration drift', () => {
  assert.equal(canUseLegacyOpsReadBridge({ environment: 'DEVELOPMENT', error: { code: '42501' } }), false)
  assert.equal(canUseLegacyOpsReadBridge({ environment: 'DEVELOPMENT', error: { code: 'PGRST301' } }), false)
  assert.equal(canUseLegacyOpsReadBridge({ environment: 'DEVELOPMENT', error: {} }), false)
})

test('a matching trusted Access key set has a bounded stale-read window', () => {
  assert.equal(accessCertificateFallbackState({ ageMs: OPS_ACCESS_CERT_STALE_MAX_AGE_MS - 1, issuerMatches: true, keyCount: 1 }), 'stale')
  assert.equal(accessCertificateFallbackState({ ageMs: OPS_ACCESS_CERT_STALE_MAX_AGE_MS, issuerMatches: true, keyCount: 1 }), 'reject')
})

test('unknown issuer, missing keys, or invalid cache age always reject', () => {
  assert.equal(accessCertificateFallbackState({ ageMs: 60_000, issuerMatches: false, keyCount: 1 }), 'reject')
  assert.equal(accessCertificateFallbackState({ ageMs: 60_000, issuerMatches: true, keyCount: 0 }), 'reject')
  assert.equal(accessCertificateFallbackState({ ageMs: Number.POSITIVE_INFINITY, issuerMatches: true, keyCount: 1 }), 'reject')
})

test('sensitive actions require freshly fetched Access signing keys', () => {
  assert.equal(accessCertificateAllowsSensitiveAction('fresh'), true)
  assert.equal(accessCertificateAllowsSensitiveAction('stale'), false)
  assert.equal(accessCertificateAllowsSensitiveAction('not-applicable'), false)
})

test('Access lifetime and revocation claims are mandatory and ordered', () => {
  const now = 2_000_000_000
  const validClaims = { iat: now - 60, exp: now + 300, nbf: now - 60, sub: 'operator-subject', email: 'operator@drapeon.co' }
  assert.equal(hasValidOpsAccessTokenClaims(validClaims, now), true)
  assert.equal(hasValidOpsAccessTokenClaims({ ...validClaims, iat: undefined }, now), false)
  assert.equal(hasValidOpsAccessTokenClaims({ ...validClaims, exp: undefined }, now), false)
  assert.equal(hasValidOpsAccessTokenClaims({ ...validClaims, exp: validClaims.iat }, now), false)
  assert.equal(hasValidOpsAccessTokenClaims({ ...validClaims, iat: now + 31 }, now), false)
})

test('Access identity must come from signed subject and email claims', () => {
  const now = 2_000_000_000
  const validClaims = { iat: now - 60, exp: now + 300, sub: 'operator-subject', email: 'operator@drapeon.co' }
  assert.equal(hasValidOpsAccessTokenClaims({ ...validClaims, sub: '' }, now), false)
  assert.equal(hasValidOpsAccessTokenClaims({ ...validClaims, email: '' }, now), false)
})
