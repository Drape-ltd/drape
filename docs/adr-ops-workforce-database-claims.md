# ADR: Ops Workforce Database Claims

Status: Accepted; amended after development threat-model proof
Date: 2026-09-10
Owners: Engineering and Security
Scope: New route-owned Drapeon Ops application

## Context

Cloudflare Access authenticates a named workforce member, but an Access JWT is
not itself a database authorization model. The legacy `/ops` surface verifies
Access and then reads with the Supabase service role. That is acceptable only as
a time-boxed migration bridge: it gives application code more database authority
than the human operator should have and cannot make Postgres independently prove
the operator, environment, role, or revocation state.

## Decision

The separate Ops application forwards the original verified Cloudflare Access
assertion to a dedicated Supabase Edge authorization broker. The broker verifies
the assertion independently against Cloudflare's current public keys and then
resolves the named workforce principal from the database. The assertion contains:

- issuer and key ID;
- immutable workforce principal and session IDs;
- normalized email and Access subject;
- environment (`development` or `production`);
- role and department capabilities;
- `normal` or `sensitive` assurance audience;
- Access authentication time;
- issued-at, not-before, and expiry;
- Cloudflare expiry and authentication context.

No Drapeon runtime holds a private key capable of minting arbitrary Supabase JWT
roles. That signing-key design was rejected during implementation because theft
of such a key could be used to claim a more privileged Postgres role. Cloudflare
owns and rotates its Access signing key; the Ops app and Edge broker consume only
public verification material. Verification fails closed for an unknown `kid`,
issuer, audience, environment, expiry, revocation cutoff, or principal.

The Edge broker owns the isolated Supabase service credential already required
by Edge workloads; it is never exposed to the browser or the Ops application.
The broker can execute only route-specific code paths and typed Ops RPCs. Every mutation RPC
must recheck the principal is active, environment is permitted, token version is
current, capability is present, expected record version matches, idempotency key
is valid, and sensitive assurance is present when required. The actor and
request correlation ID are written in the same transaction as the outcome and
durable receipt.

The Supabase service role is restricted to the independently authenticated Edge
broker, isolated provisioning, reconciliation, migrations, and bounded
automation. It is not present in canonical interactive Ops application routes.
During migration, narrowly scoped service-role reads remain in the server-only
Ops data adapter and are removed domain by domain.

## Failure behavior

- Access verification failure: return locked; do not issue a workforce token.
- Principal missing, revoked, stale, or in the wrong environment: deny.
- Cloudflare public-key or broker configuration missing: return service unavailable.
- Database authorization disagreement: database denial wins.
- Access expiry during an edit: preserve operator input, refresh authorization,
  reread the authoritative record, then require explicit resubmission.
- Concurrency conflict: no partial mutation; return current version and a safe
  comparison view.

## Rotation and revocation

- Sensitive Access assertions last at most 15 minutes and are never stored in local storage.
- Cloudflare signing keys are fetched over HTTPS, selected by `kid`, and cached
  for a bounded interval. Stale or unverifiable assertions fail closed.
- Offboarding records an immediate session revocation cutoff, revokes active sessions,
  disables Ops push subscriptions, and removes Access group membership.
- Production and development use different signing keys, issuers, audiences,
  database roles, principals, and notification sinks.

## Verification

For each migrated route, prove independent app and broker allow/deny behavior for every applicable role,
revocation before Access expiry, cross-environment denial, token expiry,
concurrency conflict, duplicate idempotency, audit/receipt persistence, and the
absence of base-table grants. Record the test correlation IDs in the workflow
proof artifact.
