# V1 Decisions: Tailor Response And Remedy Offer Policy

Date: April 2, 2026

## Why This Exists

Once a customer raises a concern, Drape needs a clear answer to:

- how fast the tailor must respond
- what counts as a meaningful response
- what remedy offers are acceptable
- when silence starts favoring the customer

This document turns the research into a working V1 stance.

## Core Principle

A fast empty reply is not enough.

For V1, Drape should distinguish:

- acknowledgment
- substantive response
- remedy offer

## Decision 1: Use A Two-Step Tailor Response Rule

### Chosen rule

For V1:

- tailor should acknowledge the concern within `24 hours`
- tailor should provide a substantive response within `48 hours`

### Why

- fast acknowledgment reduces customer anxiety
- the second deadline prevents placeholder stalling
- this is stricter than a simple Etsy-style help-request window, but better suited to live custom-work risk

## Decision 2: Acknowledgment Means “I See This,” Not “Issue Resolved”

### Chosen rule

A valid acknowledgment can be short, but it should confirm:

- the issue was seen
- the tailor is responding inside Drape
- a fuller answer is coming

### Why

Customers should not feel ghosted while money is blocked.

## Decision 3: A Substantive Response Must Move The Issue Forward

### Chosen rule

A substantive response should include at least one of:

- evidence-backed disagreement
- concrete status update
- structured remedy offer
- request for one clearly missing fact

### Why

“Looking into it” is not enough once the order is paused.

## Decision 4: Remedy Offers Must Be Concrete

### Chosen rule

A remedy offer should state:

- what the remedy is
- who acts next
- the timeline
- whether any return / handoff / measurement step is needed
- whether Drape or ops must approve the cash side

### Why

Customers should not be asked to trust vague promises while the concern is open.

## Decision 5: Keep Remedy Offers Inside Drape

### Chosen rule

In V1, concern resolution should stay inside:

- the order thread
- ops review
- platform-controlled payout/refund logic

### Why

Off-platform fixes weaken evidence and create payment ambiguity.

## Decision 6: Tailor Can Propose Remedies, But Cash Movement Stays Ops-Mediated In V1

### Chosen rule

For V1, the tailor may propose:

- explanation or update
- alteration / fix
- remake
- partial refund
- full refund / cancellation

But the actual payout-release or refund execution should remain ops-mediated until self-serve remedy tools are mature.

### Why

- cash decisions are the riskiest part to get wrong
- Drape’s current ops flow already resolves to refund or release

## Decision 7: Remedy-First Is Best For Fixable Seller-Fault Issues

### Chosen rule

For fit, workmanship, or other plausibly fixable seller-fault issues:

- alteration should be considered first when realistically sufficient
- remake should be considered when alteration is not credible
- refund becomes stronger when recovery is weak, slow, or no longer trustworthy

### Why

This matches the earlier remedy ladder and the real behavior of custom-clothing businesses.

## Decision 8: Silence Starts Counting Against The Tailor Quickly

### Chosen rule

If the tailor does not provide a substantive response within `48 hours`:

- ops should be free to move the concern into a more customer-favoring review posture

If there is still no meaningful participation by `72 hours`:

- ops should be able to decide based on available evidence without waiting indefinitely

### Why

Customer funds and timeline should not be trapped by silence.

## Decision 9: Some Concern Types Should Escalate Faster

### Chosen rule

The following should move faster than ordinary quality disputes:

- `OFF_PLATFORM_OR_TRUST_ISSUE`
- harassment or pressure to close the concern
- obvious ghosting tied to missed deadlines
- missing-delivery cases with no credible tracking or handoff proof

### Why

These are high-trust-risk scenarios, not normal back-and-forth quality issues.

## Decision 10: A Tailor Should Not Get Credit For Pressuring The Customer To Close The Concern

### Chosen rule

Replies like these should count badly, not well:

- “Close the concern first and I’ll fix it”
- emotional pressure to protect the shop
- repeated vague promises without action

### Why

That behavior weakens trust and mirrors the bad marketplace patterns we want to avoid.

## Decision 11: Use Reason-Aware Remedy Defaults

### Chosen rule

For `TAILOR_UNRESPONSIVE` or missed deadline:

- explanation must be credible
- update, cancellation, or refund path should come quickly

For `NOT_RECEIVED`:

- tracking or handoff proof should lead the response

For `NOT_AS_DESCRIBED`, `WRONG_ITEM`, `DAMAGED`:

- tailor should say whether they propose fix, remake, or refund path

For `FIT_OR_MEASUREMENT_ISSUE`:

- tailor should classify the issue as minor/alterable or structural/remake-level

### Why

Not every concern should trigger the exact same seller script.

## Decision 12: Future Product Should Model Response Timing Explicitly

### Chosen rule

When we implement this later, helpful fields likely include:

- `tailor_acknowledged_at`
- `tailor_substantive_response_at`
- `requested_remedy`
- `proposed_remedy`
- `proposed_resolution_deadline`
- `ops_escalation_reason`

### Why

This will make concern operations measurable instead of subjective.

## Recommendation Summary

The cleanest V1 posture is:

- `24-hour` acknowledgment
- `48-hour` substantive response
- concrete remedy offers only
- ops-mediated cash movement
- faster customer-favoring escalation if the tailor stalls or pressures the buyer

## Sources

- [Etsy: How to Answer a Help Request from a Buyer](https://help.etsy.com/hc/en-us/articles/13241489600919-How-to-Answer-a-Help-Request-from-a-Buyer)
- [Etsy: How to Resolve a Case from a Buyer](https://help.etsy.com/hc/en-us/articles/360016126873-How-to-Resolve-a-Case-from-a-Buyer)
- [Etsy: How to Open a Case](https://help.etsy.com/hc/en-us/articles/5745586898199-How-to-Open-a-Case)
- [Fiverr: Cancel an order with the Resolution Center](https://help.fiverr.com/hc/en-us/articles/4417622226833-Cancel-an-order-with-the-Resolution-Center)
- [Fiverr: Using the Resolution Center](https://help.fiverr.com/hc/en-us/articles/37552897293329-How-to-use-the-Resolution-Center)
- [Fiverr: Partial refunds](https://help.fiverr.com/hc/en-us/articles/15770574712977-Partial-refunds)
- [Stripe: Klarna disputes](https://docs.stripe.com/payments/klarna/disputes)
- [Proper Cloth Perfect Fit Guarantee](https://propercloth.com/perfect-fit-guarantee)
- [Proper Cloth: How to Request a Tailored Clothing Remake](https://propercloth.com/reference/how-to-request-tailored-clothing-remake/)
- [INDOCHINO: My suit doesn't fit, what options do I have?](https://support.indochino.com/hc/en-us/articles/360034773473-My-suit-doesn-t-fit-what-options-do-I-have)
- [INDOCHINO: What is the Return Policy?](https://support.indochino.com/hc/en-us/articles/360034710293-What-is-the-Return-Policy)
