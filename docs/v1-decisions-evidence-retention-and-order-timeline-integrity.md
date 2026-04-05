# V1 Decisions: Evidence Retention And Order Timeline Integrity

Date: April 2, 2026

## Why This Exists

Drape needs a practical rule for:

- what counts as core order evidence
- what must be preserved
- what ops should trust most
- how timeline truth should survive weak infrastructure and messy disputes

This document turns the research into a working V1 stance.

## Core Principle

If it matters for payout, dispute, or trust, it should be durable, server-stamped, and hard to erase casually.

## Decision 1: The Order Timeline Is Part Of The Evidence Model

### Chosen rule

For V1, Drape should treat the order timeline itself as evidence.

### Minimum evidence packet

- order state
- quote and payment state
- stage history
- in-platform messages
- delivery or collection facts
- dispute timing
- audit events

### Why

The platform already knows important facts.
Ops should not have to reconstruct them from memory.

## Decision 2: Platform Facts Beat Rhetoric

### Chosen rule

When stories conflict, ops should prioritize:

1. server-recorded order facts
2. platform-native uploads and attachments
3. user narrative
4. off-platform screenshots

### Why

The parties will often remember events differently.
Durable platform records are usually the best anchor.

## Decision 3: Core Order Evidence Should Not Be Casually Deleted Or Rewritten In V1

### Chosen rule

V1 should avoid destructive editing of:

- messages
- stage updates
- dispute records
- shipping/tracking evidence
- audit-relevant notes tied to trust or payout decisions

### Better pattern

If a correction is needed:

- append a correction
- add a new stage update
- add a new ops note
- record the newer fact without erasing the older trail

### Why

Silent mutation makes dispute review and payout defense much weaker.

## Decision 4: Server Timestamps Matter More Than Client Memory

### Chosen rule

Important order facts should rely on server-side creation and update times wherever possible.

### Why

Weak connectivity, device drift, retries, and delayed sync make client-side recollection less reliable than server-recorded sequence.

## Decision 5: Customer Uploads Supplement Platform Facts, They Do Not Replace Them

### Chosen rule

For V1, uploads such as:

- fit photos
- damage photos
- package photos
- receipts

should strengthen the record, but the baseline evidence model should still work from platform facts alone.

### Why

Drape should not fail dispute review just because a customer forgot to upload everything perfectly.

## Decision 6: Off-Platform Screenshots Are Allowed, But Lower-Trust

### Chosen rule

If off-platform screenshots exist, Drape can consider them, especially for:

- harassment
- circumvention pressure
- off-platform payment solicitation
- trust breaches

But they should not outrank the core in-platform record.

### Why

Screenshots can help, but they are easier to fragment, lose, or contest than platform-native facts.

## Decision 7: Concern And Remedy Handling Should Add To The Timeline, Not Fork Away From It

### Chosen rule

When a concern opens or a remedy is proposed, the relevant facts should remain attached to the order record and dispute record rather than disappearing into side channels.

### Why

V1 needs one coherent system of truth, not a support shadow-world.

## Decision 8: Resolution Should Cite The Evidence Basis

### Chosen rule

Ops resolutions in V1 should ideally be explainable from a small set of visible facts such as:

- timeline mismatch
- missing tracking
- missed response SLA
- confirmed delivery
- seller documentation fault

### Why

This makes support more legible and less arbitrary for both sides.

## Decision 9: Retention Should Be Conservative In V1

### Chosen rule

For V1, Drape should preserve core order evidence through:

- the active order lifecycle
- the concern/dispute lifecycle
- payout release risk
- manual support follow-up windows

### Best V1 posture

- no user-facing deletion for core order evidence
- no automatic purge of evidence-critical artifacts during early launch

### Why

It is easier to tighten retention later than to lose evidence too early while the business is still learning.

## Decision 10: Weak-Infrastructure Recovery Depends On Timeline Integrity

### Chosen rule

The timeline should be good enough to recover from:

- missed pushes
- duplicate taps
- call failures
- delayed payment confirmation
- local handoff confusion

### Why

This is part of Drape’s African-market fit, not just ops hygiene.

## Decision 11: Future Product Should Model Evidence More Explicitly

### Chosen rule

When we implement this later, useful fields and primitives likely include:

- `evidence_manifest`
- `evidence_source_type`
- `evidence_uploaded_by`
- `ops_resolution_basis`
- `message_redacted_at`
- `message_redaction_reason`
- `timeline_correction_note`

### Why

Right now the evidence model exists implicitly across several tables.
Later it should become easier to review explicitly.

## Recommendation Summary

The cleanest V1 posture is:

- treat the order timeline as evidence
- preserve core order facts conservatively
- prefer append-over-erase behavior
- trust platform facts first
- let uploads strengthen the record
- keep resolution logic explainable from recorded facts

## Sources

- [Stripe: Respond to disputes](https://docs.stripe.com/disputes/responding)
- [Stripe: How disputes work](https://docs.stripe.com/disputes/how-disputes-work)
- [Paystack: Manage disputes](https://paystack.com/docs/payments/manage-disputes/)
- [Etsy: How to Resolve a Case from a Buyer](https://help.etsy.com/hc/en-us/articles/360016126873-How-to-Resolve-a-Case-from-a-Buyer)
- [Etsy Seller Policy](https://www.etsy.com/legal/sellers/)
