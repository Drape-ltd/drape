# V1 Decisions: Customer Concern Intake And Evidence Policy

Date: April 2, 2026

## Why This Exists

Drape needs a simple and fair answer to:

- when a customer raises a concern
- what happens to the order and payout
- what evidence matters
- when ops refunds or releases

This document turns the research into a working V1 stance.

## Core Principle

Use friendly language for the customer, but conservative control for the platform.

For V1:

- the customer raises a `concern`
- Drape records an internal `dispute`
- payout stays blocked until the concern is resolved

## Decision 1: Keep “Concern” As The Customer-Facing Word

### Chosen rule

Customers should continue to see the word `concern`, not `dispute`, as the main in-app label.

### Why

- it feels less hostile
- it still covers issues that may be fixable
- it fits custom work better than immediately legal-sounding language

## Decision 2: In V1, A Concern Opens A Real Internal Dispute

### Chosen rule

When a customer raises a concern on an active order in V1:

- the order pauses
- the internal dispute record opens
- payout stays blocked

### Why

- simpler than a full two-stage help-request system
- safer for early payout control
- easier to operate while Drape is still learning real failure modes

## Decision 3: Drape Should Encourage Messaging First, But Not Require A Long Waiting Period

### Chosen rule

Drape should encourage the customer to message the tailor first, but it should not require a hard `48-hour` waiting period before opening a concern on an active order.

### Why

- custom production issues can get worse while waiting
- Drape already has in-order messaging and stage history
- payout release is safer when the platform can pause early

### Important nuance

This is different from Etsy because Drape is not only resolving shipping issues after the fact; it is also managing live custom production risk.

## Decision 4: Concern Reasons Should Be Structured

### Chosen rule

V1 concern reasons should stay in a narrow set:

- `NOT_RECEIVED`
- `NOT_AS_DESCRIBED`
- `DAMAGED`
- `FIT_OR_MEASUREMENT_ISSUE`
- `TAILOR_UNRESPONSIVE`
- `WRONG_ITEM`
- `OFF_PLATFORM_OR_TRUST_ISSUE`
- `OTHER`

### Why

Each category points to different evidence and different likely remedies.

## Decision 5: Every Concern Should Collect A Basic Narrative

### Chosen rule

Every concern should collect, at minimum:

- what happened
- when it happened
- what was expected
- what was actually received or observed

### Why

This creates a usable first summary for ops, even before evidence files are uploaded.

## Decision 6: Drape Should Ask For Desired Resolution

### Chosen rule

V1 should later add a lightweight “what outcome are you seeking?” field.

Best V1 options:

- `EXPLANATION_OR_UPDATE`
- `ALTERATION_OR_FIX`
- `REMAKE`
- `PARTIAL_REFUND`
- `FULL_REFUND`
- `OPS_HELP`

### Why

This helps separate:

- a solvable service issue
- a remedy request
- a true refund-first dispute

## Decision 7: Evidence Should Be Stage-Aware And Reason-Aware

### Chosen rule

Drape should not ask for the same evidence in every concern.

### Best V1 evidence prompts

For `NOT_RECEIVED`:

- tracking status
- delivery estimate
- collection / handoff details

For `NOT_AS_DESCRIBED`, `WRONG_ITEM`, or `DAMAGED`:

- customer photos
- packaging or handoff photos if relevant

For `FIT_OR_MEASUREMENT_ISSUE`:

- note whether the issue is size, balance, or workmanship
- optional fit photos if the customer is comfortable

For `TAILOR_UNRESPONSIVE`:

- no extra upload should be required because Drape already has the thread and timeline

For `OFF_PLATFORM_OR_TRUST_ISSUE`:

- screenshots if the issue moved off-platform
- otherwise rely on message history and bypass logs

## Decision 8: The Order Timeline Itself Is Evidence

### Chosen rule

V1 ops review should treat these as part of the evidence packet automatically:

- stage history
- quote and payment state
- delivery / collection status
- messages
- production updates
- internal audit events

### Why

Drape should not rely only on manual uploads when the platform already knows important facts.

## Decision 9: Payout Must Stay Blocked While A Concern Is Open

### Chosen rule

An open V1 concern should automatically block payout release.

### Applies when

- dispute status is `OPEN` or `UNDER_REVIEW`
- the order is in `IN_DISPUTE`
- ops placed a manual hold
- a provider-side dispute or chargeback exists

### Why

It is easier to release slightly late than to claw funds back after a bad payout.

## Decision 10: Auto-Release And Auto-Complete Must Pause For Open Concerns

### Chosen rule

If a concern opens:

- auto-release pauses
- auto-complete should not finalize the order

### Why

No background automation should outrun an unresolved concern.

## Decision 11: Self-Serve Concern Window Ends At Auto-Complete Cutoff

### Chosen rule

For V1, the customer should raise a concern before the order auto-complete cutoff.

After that:

- the issue becomes support/manual review only

### Why

Transactions need a clear end point.

### Important nuance

That does not mean all later problems are ignored. It means the self-serve path closes and ops judgment takes over.

## Decision 12: Ops Triage Should Be Fast, But Final Resolution Can Be Contextual

### Chosen rule

For V1, a good operating target is:

- first ops triage within `24 hours`
- resolution target within `72 hours` when enough evidence already exists

### Why

- this matches the seriousness of payout blocking
- it also fits the current mobile expectation that the team reviews concerns quickly

## Decision 13: Not Every Concern Should End In Refund Or Release Only Because The Parties Argue Loudly

### Chosen rule

Ops should lean on:

- order truth
- fulfillment evidence
- remedy feasibility
- responsibility split

and not only on who writes the stronger message.

### Why

Custom-work disputes are often more about sequence and evidence than about rhetoric.

## Decision 14: Future Data Model Should Support Better Intake

### Chosen rule

When we implement this later, useful fields likely include:

- `concern_category`
- `requested_resolution`
- `seller_response_requested_at`
- `seller_response_received_at`
- `evidence_checklist_status`
- `manual_hold_reason`
- `provider_dispute_reference`

### Why

Current `reason + description + evidence_urls` is a good start, but it is not enough for a mature operating layer.

## Recommendation Summary

The cleanest V1 concern posture is:

- friendly customer-facing `concern` language
- internal dispute record opens immediately
- payout stays blocked
- evidence is structured by issue type
- auto-release pauses
- ops uses order truth plus uploaded evidence to decide refund or release

## Sources

- [Etsy: How to Get Help with an Order](https://help.etsy.com/hc/en-us/articles/4402660818583-How-to-Get-Help-with-An-Order)
- [Etsy: How to Open a Case](https://help.etsy.com/hc/en-us/articles/5745586898199-How-to-Open-a-Case)
- [Etsy: How to Resolve a Case from a Buyer](https://help.etsy.com/hc/en-us/articles/360016126873-How-to-Resolve-a-Case-from-a-Buyer)
- [Etsy: Purchase Protection for Sellers](https://help.etsy.com/hc/en-us/articles/5850122619287-What-is-Etsy-s-Purchase-Protection-for-Sellers)
- [Stripe: Respond to disputes](https://docs.stripe.com/disputes/responding)
- [Stripe: Klarna disputes](https://docs.stripe.com/payments/klarna/disputes)
- [Stripe Connect: Handle refunds and disputes](https://docs.stripe.com/connect/saas/tasks/refunds-disputes?locale=en-GB)
- [Paystack: Manage disputes](https://paystack.com/docs/payments/manage-disputes/)
- [Paystack: Dispute API](https://paystack.com/docs/api/dispute/)
