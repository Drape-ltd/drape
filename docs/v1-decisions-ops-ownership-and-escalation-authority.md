# V1 Decisions: Ops Ownership And Escalation Authority

Date: April 2, 2026

## Why This Exists

Drape needs a practical answer to:

- who can triage
- who can decide
- who can override
- what should escalate automatically

This document turns the research into a working V1 stance.

## Core Principle

Broad visibility is fine.
Irreversible authority should be narrower.

## Decision 1: Separate Triage Authority From Final Decision Authority

### Chosen rule

For V1, not everyone who can open `/ops` should conceptually have the same authority.

### Why

The system already has meaningful operational actions.
That does not mean every ops-visible issue should be decided by the same person or lane.

## Decision 2: Frontline Ops Own Intake And Queue Movement

### Chosen rule

Frontline ops should be able to:

- review incoming cases
- assign priority
- request missing evidence
- move a case into `UNDER_REVIEW`
- review bypass logs
- acknowledge deletion requests
- keep the queue moving

### Why

These actions are important, but usually reversible and lower-risk than cash or trust outcomes.

## Decision 3: Money-Affecting Decisions Need A Narrower Lane

### Chosen rule

The following should sit in a narrower money-risk lane for V1:

- dispute outcome `REFUND` vs `RELEASE`
- payout release while facts are ambiguous
- provider dispute response
- platform-funded goodwill
- partial refund approval outside ordinary policy

### Best V1 owner

- senior ops or founder-led finance/risk lane

### Why

These decisions can create irreversible financial loss fast.

## Decision 4: Trust-And-Safety Decisions Need A Narrower Lane

### Chosen rule

The following should sit in a narrower trust lane:

- off-platform payment or circumvention cases
- harassment or pressure cases
- identity or portfolio deception
- seller restriction or suspension calls
- borderline verification decisions

### Best V1 owner

- senior ops or founder-led trust lane

### Why

Trust actions are reputationally and legally more sensitive than routine support.

## Decision 5: Event-Critical And Cross-Border Exceptions Escalate By Default

### Chosen rule

These should escalate automatically beyond ordinary frontline handling:

- event-critical order failure
- international shipping loss or customs ambiguity
- platform-caused failure with reputational downside
- orders near payout release with unresolved evidence gaps

### Why

These cases carry asymmetric downside if judged too casually.

## Decision 6: Verification Approval Is Not The Same As Simple Queue Cleanup

### Chosen rule

Approve/reject verification should be treated as a meaningful trust decision, not just admin cleanup.

### Why

Verification affects public trust, seller readiness, and downstream payout risk.

## Decision 7: Shared-Token Ops Access Should Bias V1 Toward Conservatism

### Chosen rule

Because the current `/ops` surface is token-gated rather than identity-graded, Drape should be more conservative about what is considered safe to decide from that surface.

### Best V1 posture

- triage broadly
- finalize narrowly
- treat person-level accountability as a requirement for future hardening

### Why

Tooling limits should make policy stricter, not looser.

## Decision 8: Some Decisions Should Ideally Record A Named Human Owner

### Chosen rule

For V1, the following should conceptually have a named owner even if the tooling is still catching up:

- final dispute resolution
- seller restriction
- verification rejection
- goodwill approval
- cross-border loss resolution

### Why

If an irreversible decision cannot be tied back to a real human owner, consistency gets weaker very quickly.

## Decision 9: Use A Three-Level Authority Ladder For V1

### Chosen rule

The cleanest working V1 ladder is:

1. `FRONTLINE_OPS`
2. `SENIOR_OPS`
3. `FOUNDER_OVERRIDE`

### What it means

- `FRONTLINE_OPS`
  - intake
  - triage
  - evidence chase
  - routine queue movement
- `SENIOR_OPS`
  - dispute decisions
  - payout and trust-sensitive actions
  - higher-risk seller review
- `FOUNDER_OVERRIDE`
  - exceptional goodwill
  - ambiguous cross-border loss
  - major reputation-sensitive exceptions
  - policy-edge cases not yet cleanly encoded

## Decision 10: Escalation Triggers Should Be Explicit

### Chosen rule

A case should escalate if any of these are true:

- processor deadline is active
- trust/safety risk is active
- event date is near
- payout release is near with unresolved facts
- cross-border or customs ambiguity exists
- platform-funded recovery is being considered
- seller restriction may be necessary

### Why

Explicit escalation beats “whoever happens to notice.”

## Decision 11: Frontline Ops Should Not Be Forced To Invent Policy

### Chosen rule

If a case falls outside the written decision docs, frontline ops should escalate rather than improvising a new rule mid-incident.

### Why

Improvised precedent is one of the fastest ways to create inconsistent marketplace trust.

## Decision 12: Future Tooling Should Reflect This Ladder More Explicitly

### Chosen rule

When implemented later, useful fields and primitives likely include:

- `ops_owner`
- `ops_role_required`
- `escalated_at`
- `escalated_by`
- `escalation_reason`
- `final_decided_by`
- `final_decided_at`

### Why

Right now the operational authority model exists mostly in people’s heads and docs.
Later the product should enforce it more directly.

## Recommendation Summary

The cleanest V1 posture is:

- frontline ops handles intake and queue movement
- senior ops handles money and trust-sensitive decisions
- founder override stays for exceptional edge cases
- event-critical, processor-timed, and cross-border issues escalate automatically
- shared-token ops access should make Drape more conservative about irreversible actions

## Sources

- [Upwork: Dispute Process Demystified](https://www.upwork.com/resources/upwork-dispute-process)
- [Upwork Help: Payment dispute response timelines](https://support.upwork.com/hc/en-us/articles/211062068-How-to-respond-if-a-freelancer-files-a-payment-dispute)
- [Airbnb Help: Safety issue support](https://www.airbnb.com/help/article/248)
- [Airbnb Help: Pay and communicate on Airbnb](https://www.airbnb.com/help/article/231)
- [Etsy Help: How to Resolve a Case from a Buyer](https://help.etsy.com/hc/en-us/articles/360016126873-How-to-Resolve-a-Case-from-a-Buyer)
- [Etsy Help: How to Open a Case](https://help.etsy.com/hc/en-us/articles/5745586898199-How-to-Open-a-Case)
- [Stripe: Disputes](https://docs.stripe.com/disputes)
- [Paystack: Manage disputes](https://paystack.com/docs/payments/manage-disputes/)
