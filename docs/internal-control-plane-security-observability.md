# Drape Internal Security And Observability Plan

This document defines the intended security and observability model for the Drape control plane.

## Security Principles

- No internal surface in public nav
- No access without Drape workforce identity
- No write actions without role-based permissions
- No sensitive action without audit logging
- No single shared channel as the source of truth

## Bootstrap Access

Current bootstrap access uses:

- `OPS_DASHBOARD_TOKEN`
- `OPS_DASHBOARD_BOOTSTRAP_ROLE`
- hashed ops session cookie

This is a temporary foundation for building workflows, not the final security model.

`OPS_DASHBOARD_BOOTSTRAP_ROLE` is only a bootstrap control-plane role selector for the current environment. It helps us wire section visibility and write permissions before workforce identity exists. It is not a substitute for per-person authentication.

## Target Workforce Access

### Edge Gate

- Cloudflare Access in front of the internal route or hostname
- deny by default
- allow only workforce identity login

### Workforce Identity

- Microsoft Entra as the source of employee identity
- only `@drapeon.co` accounts should authenticate in the long-term model
- while workforce mailboxes are still being set up, explicitly allowlisted founder or staff emails can be used through `OPS_ALLOWED_EMAILS`
- team membership and access groups come from Entra

### Runtime Environment Contract

For workforce mode the web app expects:

- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`
- `OPS_ALLOWED_EMAIL_DOMAIN`
- `OPS_ALLOWED_EMAILS`

Role assignment can come from either email allowlists or Access-forwarded groups:

- `OPS_ADMIN_EMAILS`
- `OPS_OPS_EMAILS`
- `OPS_CUSTOMER_SUCCESS_EMAILS`
- `OPS_TRUST_EMAILS`
- `OPS_FINANCE_EMAILS`
- `OPS_ENGINEERING_EMAILS`
- `OPS_ADMIN_GROUPS`
- `OPS_OPS_GROUPS`
- `OPS_CUSTOMER_SUCCESS_GROUPS`
- `OPS_TRUST_GROUPS`
- `OPS_FINANCE_GROUPS`
- `OPS_ENGINEERING_GROUPS`

Bootstrap fallback remains available only when workforce mode is not configured:

- `OPS_DASHBOARD_TOKEN`
- `OPS_DASHBOARD_BOOTSTRAP_ROLE`

Production defaults to fail-closed for `/ops` unless Cloudflare Access is
configured. `OPS_ALLOW_BOOTSTRAP_IN_PRODUCTION=1` is a break-glass override only
and must be paired with a short operational window and immediate token rotation.

### App-Level RBAC

Suggested roles:

- `ops`
- `customer_success`
- `trust`
- `finance`
- `engineering`
- `admin`

Suggested rules:

- `customer_success` cannot approve verification
- `engineering` cannot resolve disputes by default
- `ops` cannot grant access privileges
- `finance` can review payouts but should not own chat safety tools
- `admin` can manage cross-functional controls

### Money Desk JIT Boundary

- Money movement cannot use the bootstrap shared-token session.
- Cloudflare Access JWT `sub`, `email`, `iat`, `exp`, groups, and authentication-method references are verified server-side before an Ops session is trusted.
- Money Desk accepts recognized MFA methods only, requires the Access authentication assertion itself to be no older than 15 minutes, issues a database-backed action-scoped grant for at most 15 minutes, and rechecks identity, role, scope, revocation, and expiry inside every database transition.
- Ops and customer-success roles may prepare reviewed actions. Finance or admin must independently approve and execute them. The preparer cannot approve their own request.
- All manual money actions need one approver; high-risk types, unresolved FX, and USD 500-equivalent or greater require two.
- Direct legacy money routes fail closed. Execution adapters are allowlisted by action type and every attempt records a terminal outcome.

## Audit Requirements

Every privileged action should write:

- actor id
- actor role
- event name
- target record id
- before and after state where relevant
- timestamp
- supporting payload

## Operational Observability

The control plane should eventually expose:

- edge traffic health
- auth failures
- Supabase query latency
- function success and failure rates
- payment confirmation success
- webhook failure counts
- dispatch SLA breaches
- notification delivery failures
- stuck order counts by stage

## Recommended Telemetry Spine

- OpenTelemetry for traces and metrics
- Cloudflare analytics for edge and access events
- Supabase metrics and database monitoring
- audit log stream inside Drape for business events
- Sentry for scrubbed Next.js server/client, React Native, Edge, and job exceptions linked by correlation ID

Money telemetry must exclude action secrets, provider credentials, evidence bodies, messages, addresses, and payment credentials. Safe fields include action type, request/attempt/correlation IDs, actor role, risk level, status, provider name, and normalized failure code.

## First Alerts To Wire

- payment webhook failures
- delivery webhook failures
- order review queue age breaches
- dispatch queue age breaches
- verification queue age breaches
- dispute queue age breaches
- notification send failures

## Future Internal Surfaces

### Customer Success Inbox

- support threads
- order-linked communication
- SLA timers
- internal notes

### Incidents

- event feed
- annotations
- on-call summary
- provider status notes

### People And Access

- role visibility
- access review
- workforce group sync status
- break-glass admin flow

## Security Outcome

When complete, the Drape control plane should feel like a real internal product:

- protected before page load
- segmented by role
- observable by default
- auditable for every critical action
- safe enough that the team can run the business from it, not around it
