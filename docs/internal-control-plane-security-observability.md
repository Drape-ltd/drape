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
