# V1 Decisions: Rush Orders, Deadline Premiums, And Late-Acceptance Policy

Date: April 2, 2026

## Why This Exists

Drape needs a working answer to:

- whether rush custom work is a real V1 product
- how urgency can affect pricing
- what happens when timing becomes shaky near acceptance

This document turns the research into a practical V1 stance.

## Core Principle

Urgency can affect feasibility and price.

It should not create fake promises.

## Decision 1: Do Not Launch A First-Class `CUSTOM` Rush-Order Product In V1

### Chosen rule

For V1, Drape should not ship a dedicated `rush order` product type or automated rush workflow for custom work.

### Why

Custom rush is mostly a feasibility and capacity problem, not a simple toggle.

## Decision 2: Tailors May Price Urgency Into The Quote Before Acceptance

### Chosen rule

If a tailor can genuinely meet a tight deadline, they may reflect urgency in the all-in quote amount before the customer accepts.

### Why

Urgency can create real cost.
But it should be part of the quoted commitment, not an afterthought.

## Decision 3: No Surprise Rush Premium After Acceptance

### Chosen rule

After the customer accepts, the tailor should not add a new rush fee just to preserve the already-agreed date.

### Why

That would rewrite the commercial deal after commitment.

## Decision 4: Quote Promises Must Survive The Full Quote-Validity Window

### Chosen rule

Because custom quotes stay open for `48 hours`, a tailor should only send a deadline-sensitive quote if they can still honor it at any reasonable acceptance point inside that window.

### Why

The customer is entitled to the window the product gives them.

## Decision 5: If Timing Is Too Tight, The Tailor Should Not Send A Normal Quote Yet

### Chosen rule

If the deadline is so tight that the promise would become unrealistic during the quote-validity window, the tailor should:

- decline
- request consultation
- or wait to quote until the timing is genuinely workable

### Why

This is safer than sending an optimistic quote and hoping the customer pays immediately.

## Decision 6: `READY_MADE` And `CUSTOM` Should Be Treated Differently

### Chosen rule

Later, Drape may support expedited logistics for `READY_MADE`, but that should not be confused with custom rush production.

### Why

Shipping acceleration and production acceleration are not the same commercial problem.

## Decision 7: Tight Deadline Does Not Automatically Mean Rush Is Available

### Chosen rule

If the customer enters a near-term deadline, Drape should not imply that the seller can or should rescue it just because the customer asked.

### Why

Urgent need is not proof of operational feasibility.

## Decision 8: Consultation Is The Best V1 Safety Valve For Tight Timelines

### Chosen rule

When the deadline is tight relative to complexity, sourcing, or measurement confidence, consultation should be the preferred pre-quote safety step.

### Why

That is the cleanest way to test feasibility without false commitment.

## Decision 9: Default Deadline Copy Should Not Be Read As Normal Lead-Time Guidance

### Chosen rule

The current `4-week` default can stay as an input convenience for now, but Drape should not present it as a recommended or typical safe lead time for important custom garments.

### Why

Otherwise convenience UX becomes accidental business guidance.

## Decision 10: Event-Critical Orders Should Bias Conservative

### Chosen rule

If the garment is event-critical, the platform should bias toward:

- conservative feasibility
- earlier consultation
- earlier decline when risk is obvious

### Why

The cost of a false yes is unusually high.

## Recommendation Summary

The cleanest V1 posture is:

- no dedicated custom rush product
- urgency can be priced only before acceptance
- no post-acceptance surprise rush fee
- a quoted date must survive the quote-validity window
- if the timeline is too tight, do not send a normal optimistic quote
- keep expedited logistics separate from custom rush
- treat the 4-week deadline default as convenience, not as implied lead-time guidance

## Sources

- [INDOCHINO: Got an important event or date approaching?](https://support.indochino.com/hc/en-us/articles/360057150993-Got-an-important-event-or-date-approaching)
- [INDOCHINO: Can I rush my order?](https://support.indochino.com/hc/en-us/articles/360034194574-Can-I-rush-my-order)
- [Proper Cloth product FAQ showing custom vs stocked rush policy](https://propercloth.com/products/jackson-jacket?color=navy)
