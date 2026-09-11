# ADR: Ops Sensitive Access Step-Up

Status: Accepted for implementation
Date: 2026-09-10
Owners: Engineering and Security
Scope: High-risk Ops evidence and mutations

## Context

A recently issued normal Cloudflare Access JWT does not prove that the operator
just completed MFA for a high-risk action. Checking only JWT `iat` and `amr`
therefore creates false assurance. A second constraint is browser behavior: when
Access intercepts a form POST, the authentication redirect cannot safely replay
the original request body.

## Decision

Use two Cloudflare Access applications on the same Ops hostname:

- normal application: Ops shell and read routes, audience in `CF_ACCESS_AUD`;
- sensitive application: protected GET checkpoint and action/evidence paths,
  audience in `CF_ACCESS_SENSITIVE_AUD`, IdP MFA required, application session no
  longer than 15 minutes.

An existing secret name is not configuration evidence. The production release
must verify both applications and the selected workforce identity provider in
Cloudflare's authoritative inventory before installing either audience. If the
inventory is empty, Ops remains on the legacy rollback surface and the Worker is
not deployed.

The first protected interaction is always an idempotent GET checkpoint. It
preserves only a sanitized internal return path, lets Cloudflare complete MFA,
verifies the sensitive audience and recognized authentication method, then
returns the operator to the authoritative case. The operator reviews the latest
state and explicitly submits the mutation afterward. A POST is never used as the
first request that may trigger Access authentication.

Protected endpoints accept a named, active workforce principal only when the
current Access assertion contains the dedicated sensitive audience, recognized
MFA context, and an authentication time no older than 15 minutes. The database
mutation also requires a Drapeon workforce token with `sensitive` assurance.

Every canonical `ops-*` Supabase Edge function also keeps Supabase JWT
verification enabled. The Ops Worker sends the project anon JWT as the outer
Edge gateway credential; the function then verifies the Cloudflare Access
assertion, workforce principal, environment, role, revocation state, and—for
sensitive actions—the dedicated MFA audience. The anon JWT is defense in depth,
not workforce authorization, and can never replace the Access/principal checks.
Unauthenticated requests must be rejected before parsing or validating an Ops
operation so the boundary does not disclose its command surface.

Step-up applies to deletion execution, trust approval/rejection, seller
restriction, private evidence access, refunds, payout destination changes,
payout execution, access changes/revocation, bulk sensitive export, and
break-glass activation. Merely viewing a redacted queue does not require it.

## Cloudflare route contract

- `ops.drapeon.co/*`: normal Access application.
- `ops.drapeon.co/ops/action*`: sensitive Access application during legacy
  migration.
- `ops.drapeon.co/ops/identity-document/*`: sensitive Access application during
  legacy migration.
- Canonical `apps/ops` routes place equivalent GET checkpoints under
  `/ops/sensitive/*` and mutations under typed action routes; the sensitive
  Access application owns both path families. The legacy `/protected/*`
  checkpoint redirects permanently to the canonical path during migration.

The sensitive policy must require the configured workforce identity provider and
MFA. Email one-time-pin alone is not accepted as workforce MFA. Production fails
closed when `CF_ACCESS_SENSITIVE_AUD` is absent.

## Failure behavior

- Missing or normal audience: show a protected-access checkpoint; do not mutate.
- Missing/unknown MFA method or stale authentication time: deny and require the
  sensitive Access flow again.
- Expired step-up after form completion: preserve non-secret draft input,
  reauthenticate by GET, reread current state, and require resubmission.
- Return target outside the Ops origin or protocol-relative target: discard and
  return to My Work.
- Access or IdP unavailable: protected actions remain unavailable; reads degrade
  safely where policy allows.

## Verification

Browser proof must cover normal read access, direct protected deep link, the GET
checkpoint, successful MFA, normal-audience denial, stale assertion denial,
refresh and second-tab behavior, safe return routing, POST body not being sent
before authentication, database sensitive-claim enforcement, audit/receipt
creation, and immediate denial after principal revocation.
