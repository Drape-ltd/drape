# Drape Internal Control Plane

> This document records the original control-plane foundation. The canonical post-submission redesign is [Drapeon Ops Control Plane — Post-Submission Rebuild](./drapeon-ops-control-plane-post-submission-rebuild.md).

This document defines the internal operating system for Drape. The public website remains a marketing and intake surface. The control plane is the protected internal web app where Drape resolves trust, support, dispatch, payout, verification, deletion, and workflow issues with auditability.

## Goals

- Keep all launch-critical operational decisions inside Drape.
- Separate public growth surfaces from internal operations.
- Make every sensitive action attributable, reviewable, and reversible where possible.
- Build one foundation that can later support workforce SSO, RBAC, observability, and on-call response.

## Current Bootstrap State

- Public website and waitlist stay on the main web app.
- Internal control plane lives at `/ops`.
- Access is currently bootstrapped with:
  - `OPS_DASHBOARD_TOKEN`
  - `OPS_DASHBOARD_BOOTSTRAP_ROLE`
  - secure cookie session on `/ops`
- This is acceptable only as a bootstrap access layer while the workflow surface is being built.

## Target Security State

The target model is:

1. Cloudflare Access in front of the internal hostname or route.
2. Microsoft Entra workforce identity provider.
3. Only `@drapeon.co` users may enter the control plane.
4. Team and role membership synced from workforce identity.
5. App-level RBAC enforced inside Drape itself.
6. Every privileged action written to audit logs.

During bootstrap, named founder or staff identities can be explicitly allowlisted while the full `@drapeon.co` workforce mailbox setup is still in flight. This is a temporary bridge, not the final state.

## Core Internal Areas

### Operations

- Dispatch queue
- Tailor intake
- Payout visibility
- Fulfillment exceptions

### Customer Success

- Order reviews
- Disputes
- Support follow-up

### Trust and Safety

- Verification
- Review moderation
- Contact bypass review
- Account deletion follow-up

### Engineering and Reliability

- Workflow issues
- Delivery webhook failures
- Notification failures
- Incident and on-call tooling

## Product Surface Principles

- The public nav should never expose internal tools.
- Internal teams should land in a sidebar-driven control plane, not a single long page.
- The control plane must support focused views by operational domain.
- Read-only visibility and write access should be separable.
- Action surfaces must redirect back to the correct section after save.

## Section Ownership

- `Dispatch` → Ops
- `Order reviews` → Customer Success
- `Disputes` → Customer Success
- `Review moderation` → Trust
- `Verification` → Trust
- `Tailor intake` → Ops
- `Deletion requests` → Trust
- `Payouts` → Finance/Ops
- `Workflow issues` → Engineering
- `Bypass logs` → Trust

## What Belongs In Drape

The control plane should own:

- dispatch stage control
- cancellation and delivery review resolution
- dispute resolution
- account deletion handling
- tailor verification decisions
- payout visibility and manual payout follow-up
- review visibility decisions
- safety review and conversation pause controls
- workflow exception triage

## What Can Stay External For Now

- workforce identity provider configuration
- on-call paging vendor
- external analytics and dashboard providers
- SMS/WhatsApp vendor configuration

These can integrate later, but the business workflow must still be anchored in Drape.

## Next Internal Surfaces

- Customer success inbox
- Incidents and on-call
- People and access
- Support audit timeline
- Notification delivery health
- Provider and webhook health

## Definition Of “Real”

The control plane is only “real” when:

- the user enters through a protected access path
- internal sections are clearly separated
- every operational action has an audit trail
- every workflow returns the actor to a stable section state
- Drape can resolve customer and tailor problems from this surface without relying on side-channel memory
