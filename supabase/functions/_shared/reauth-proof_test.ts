import {
  issueReauthProof,
  verifyReauthProof,
} from './reauth-proof.ts'

function expect(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

Deno.test('reauth proof verifies for the same user, purpose, and five minute window', async () => {
  const now = Date.parse('2026-05-09T10:00:00.000Z')
  const { proof, payload } = await issueReauthProof(
    { userId: 'user-1', purpose: 'ACCOUNT_DELETION' },
    { secret: 'test-secret', now: () => now },
  )

  const result = await verifyReauthProof(
    proof,
    { userId: 'user-1', purpose: 'ACCOUNT_DELETION' },
    { secret: 'test-secret', now: () => now + 4 * 60 * 1000 },
  )

  expect(result.ok, 'proof should verify inside the five minute window')
  if (result.ok) {
    expect(result.payload.nonce === payload.nonce, 'verified payload should be the issued payload')
  }
})

Deno.test('reauth proof expires after five minutes', async () => {
  const now = Date.parse('2026-05-09T10:00:00.000Z')
  const { proof } = await issueReauthProof(
    { userId: 'user-1', purpose: 'ACCOUNT_DELETION' },
    { secret: 'test-secret', now: () => now },
  )

  const result = await verifyReauthProof(
    proof,
    { userId: 'user-1', purpose: 'ACCOUNT_DELETION' },
    { secret: 'test-secret', now: () => now + 5 * 60 * 1000 + 1 },
  )

  expect(!result.ok, 'expired proof should fail')
  if (!result.ok) {
    expect(result.code === 'REAUTH_PROOF_EXPIRED', 'expired proof should return an explicit expiry code')
  }
})

Deno.test('reauth proof cannot be replayed for another purpose', async () => {
  const now = Date.parse('2026-05-09T10:00:00.000Z')
  const { proof } = await issueReauthProof(
    { userId: 'user-1', purpose: 'ACCOUNT_DELETION' },
    { secret: 'test-secret', now: () => now },
  )

  const result = await verifyReauthProof(
    proof,
    { userId: 'user-1', purpose: 'PAYOUT_ACCOUNT_CHANGE' },
    { secret: 'test-secret', now: () => now },
  )

  expect(!result.ok, 'proof for one purpose should not verify for another purpose')
  if (!result.ok) {
    expect(result.code === 'REAUTH_PROOF_PURPOSE_MISMATCH', 'purpose replay should be explicit')
  }
})

Deno.test('reauth proof rejects tampering before any sensitive operation can run', async () => {
  const now = Date.parse('2026-05-09T10:00:00.000Z')
  const { proof } = await issueReauthProof(
    { userId: 'user-1', purpose: 'ACCOUNT_DELETION' },
    { secret: 'test-secret', now: () => now },
  )
  const tampered = proof.replace(/.$/u, proof.endsWith('a') ? 'b' : 'a')

  const result = await verifyReauthProof(
    tampered,
    { userId: 'user-1', purpose: 'ACCOUNT_DELETION' },
    { secret: 'test-secret', now: () => now },
  )

  expect(!result.ok, 'tampered proof should fail')
  if (!result.ok) {
    expect(result.code === 'REAUTH_PROOF_INVALID', 'tampered proof should return an invalid signature code')
  }
})
