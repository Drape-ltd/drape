# V1 Decisions: Consultation And Order Gating

Date: April 2, 2026

## Why This Exists

Drape already supports consultation as an order stage.

What we need for V1 is a clear rule for:

- when consultation should be used
- when it should be skipped
- what it should accomplish
- whether it should be paid

## Decision 1: Consultation Is A Pre-Quote Alignment Step

### Chosen rule

In V1, consultation should be treated as a pre-quote alignment gate.

That means:

- it sits before `QUOTE_SENT`
- it exists to reduce uncertainty
- it should end in `QUOTE_SENT` or `DECLINED`

### Why

- keeps the state machine clear
- matches how custom-clothing businesses use consultations
- avoids turning consultation into a vague social feature

## Decision 2: Consultation Should Not Be Mandatory For Every Order

### Chosen rule

Consultation should be optional by default.

### Why

- many orders are simple enough to quote directly
- mandatory consultation would add friction to low-risk orders
- repeat and low-ambiguity flows do not always need a call

## Decision 3: Consultation Should Be Strongly Encouraged For High-Ambiguity Custom Work

### Chosen rule

Consultation should be strongly encouraged or effectively required when:

- measurements are incomplete or low-confidence
- the tailor needs fit confirmation
- customer-supplied fabric is risky or unclear
- tailor-sourced fabric direction is not yet aligned
- garment complexity is high
- event timing is sensitive
- the brief is unclear or conflicting

### Why

- these are the cases where downstream mistakes are most expensive

## Decision 4: Consultation Should Usually Be Skipped For Straightforward Ready-Made And Low-Risk Orders

### Chosen rule

Consultation can usually be skipped when:

- the order is `READY_MADE`
- the brief is clear
- the measurements are strong enough
- the material path is already understood
- the tailor is comfortable quoting immediately

## Decision 5: Consultation Is Not A Paid Standalone Service In V1

### Chosen rule

V1 should not treat consultation as a paid standalone service.

### Operational stance

- keep consultation fees off by default
- do not build customer-facing policy around consultation-only billing

### Why

- aligns with the current product direction
- avoids no-show and refund complexity
- keeps consultation focused on order safety, not monetization

## Decision 6: Consultation Must Not Become A Hiding Place For Non-Response

### Chosen rule

Consultation should stay time-bounded.

Working V1 posture:

- target resolution within `24 hours`
- if still unresolved, follow-up reminders
- if abandoned, expire rather than lingering

### Why

- protects customer trust
- keeps seller responsiveness meaningful

## Decision 7: Messaging Remains The Fallback Even If Calls Fail

### Chosen rule

Calls are helpful, but consultation should still be viable through messages when room creation or call opening fails.

### Why

- avoids blocking order progress on call infrastructure
- keeps the pre-quote alignment goal intact

## Decision 8: Later Product Work Can Add Smarter Consultation Triggers

### Chosen rule

The future product can get smarter about when consultation is required, but V1 does not need a heavy rule engine.

Likely later signals:

- measurement source
- fit confidence
- fabric source
- order complexity
- event deadline

## Recommendation Summary

The cleanest V1 stance is:

- consultation is a pre-quote risk-reduction tool
- optional by default
- strongly encouraged for ambiguous custom work
- usually skipped for clear low-risk flows
- not a paid standalone service
- time-bounded so it does not become limbo

## Sources

- [Proper Cloth showrooms](https://propercloth.com/showrooms)
- [Proper Cloth Home Try-On](https://propercloth.com/home-try-on)
- [Men's Wearhouse measurements](https://tuxedo.menswearhouse.com/measurements/get)
- [docs/order-automation-and-abuse-rules.md](/Users/onaopemipodimowo/drape/docs/order-automation-and-abuse-rules.md)
- [docs/v1-launch-blockers.md](/Users/onaopemipodimowo/drape/docs/v1-launch-blockers.md)
