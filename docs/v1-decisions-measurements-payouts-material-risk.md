# Drape V1 Decisions: Measurements, Payouts, And Material Risk

> Historical decision record. Its single-release and no-material-advance rules are superseded for newly activated policy versions by `drapeon-commercial-money-tax-and-resolution-architecture.md`. Existing orders retain the policy accepted at checkout.

Date: April 2, 2026

## Purpose

This document converts the latest research and product discussion into working V1 decisions.

It is not a forever-policy doc.
It is the "what are we actually doing now?" doc.

## Scope

This covers:

- how customers get measurements into Drape
- how payout release should behave for `CUSTOM` and `READY_MADE`
- how we handle customer-supplied fabric risk
- what we are explicitly not doing in V1

## Existing Domain Terms

To stay aligned with the current codebase, this document uses:

- `order_kind`
  - `CUSTOM`
  - `READY_MADE`
- `fabric_source`
  - `CUSTOMER_SUPPLIES`
  - `TAILOR_SOURCES`

## Decision 1: Measurement Capture

## Chosen rule

V1 will support guided customer measurements plus externally captured measurements.

We will not build a retailer-specific measurement integration in V1.
We will not present Nordstrom as an official Drape partner path.

Instead, Drape should treat measurements as having a source.

Recommended measurement sources for the product model:

- `SELF_GUIDED`
- `HELPER_GUIDED`
- `TAILOR_CAPTURED`
- `EXTERNAL_PRO_CAPTURED`
- `IMPORTED`

## Why

- Self-measurement is useful but error-prone.
- In-person measurement is valuable, but a single retail chain should not become a platform dependency.
- Tailors need to know how confident to feel about the measurements before quoting or cutting.

## Happy path

1. Customer opens measurements.
2. Customer follows guided instructions and saves a complete profile.
3. Customer starts a `CUSTOM` order.
4. Tailor receives a measurement snapshot and can quote with confidence.

Alternative happy path:

1. Customer gets measured by a local professional.
2. Customer enters or uploads those numbers.
3. Tailor sees that the measurements came from an external source.

## Negative path

- Customer provides incomplete measurements.
- Customer provides suspicious measurements.
- Tailor cannot trust the fit basis yet.

V1 response:

- Tailor should be able to request clarification or confirmation before cutting.
- Tailor should not be forced to silently absorb measurement risk.

## V1 product implications

- Keep the current guided measurements flow.
- Add measurement-source support later rather than replacing the current profile.
- Add a tailor-side flag such as `measurements_need_confirmation` before production begins.

## Deferred

- official nearby measurement directory
- retailer or alteration-chain partnerships
- verified Drape measurement partners
- computer-vision measurement capture

## Decision 2: Shop-Now Scope And Payout Release

## Chosen rule

V1 `READY_MADE` should mean actual ready-made inventory, not made-to-order catalog production.

V1 should not automatically release partial payout for fabric or materials on `READY_MADE`.

V1 payout posture should be conservative:

- capture customer payment
- confirm order
- release seller payout after the appropriate fulfillment milestone and review window

## Why

- If an item is truly `READY_MADE`, the fabric/material cost is already sunk.
- Partial payout adds dispute complexity before we have enough real ops history.
- Mixing ready-made and made-to-order under one payout rule will create confusion fast.

## Happy path

1. Customer chooses a `READY_MADE` item.
2. Customer pays.
3. Order moves into fulfillment.
4. Tailor ships or hands off for collection.
5. Payout is released after the chosen settlement point.

## Negative path

- Customer pays, then cancels quickly.
- Tailor never ships.
- Order enters dispute.
- Item listed as "shop now" is not actually ready-made.

V1 response:

- payout stays conservative
- ops can see payout state
- dispute or fulfillment issues can block release
- product should not silently treat made-to-order work as ready-made

## V1 product implications

- keep `READY_MADE` narrow
- do not add auto material advances yet
- if payout state exists in product or ops, it should be simple and reviewable

## Deferred

- automatic partial materials release
- milestone-based split payout for catalog production
- made-to-order catalog as a first-class public order class
- complex seller financing behavior

## Important V1 boundary

For now, Drape should think in two public order families:

- `READY_MADE`
- `CUSTOM`

If we later introduce made-to-order catalog work, that should be deliberate and modeled separately, even if it still reuses parts of the `CUSTOM` backend.

## Decision 3: Customer-Supplied Fabric Risk

## Chosen rule

Tailors must have a structured path to reject or pause work when customer-supplied fabric is unsuitable.

V1 should distinguish between:

- pre-commitment decline
- pre-cutting material issue
- post-cutting dispute

## Why

- Customer-supplied fabric creates quality, suitability, and blame risk.
- A generic decline is too blunt once money or production has started.
- Tailors should not be forced to choose between bad workmanship and silent liability.

## Happy path

1. Customer creates a `CUSTOM` order with `fabric_source = CUSTOMER_SUPPLIES`.
2. Tailor reviews design, material expectations, and customer measurements.
3. Fabric arrives and is suitable.
4. Tailor proceeds to quote or production normally.

## Negative path

Examples:

- wrong fabric type for the garment
- poor fabric quality
- insufficient yardage
- damaged fabric
- unstable or difficult fabric

Recommended V1 response before cutting:

1. Tailor raises a `material issue`.
2. Customer chooses one of:
   - replace fabric
   - let tailor source fabric and revise quote
   - revise the garment/design
   - cancel

Recommended V1 response before acceptance or payment:

- tailor can decline with a material-based reason

Recommended V1 response after cutting starts:

- issue moves out of simple pre-production review and into dispute / support logic

## V1 product implications

- current `fabric_source` support is good groundwork
- next product layer should be reasoned status handling, not just notes
- material-issue flow matters more for `CUSTOMER_SUPPLIES` than for `TAILOR_SOURCES`

## Deferred

- automated compensation logic for wasted labor
- automatic partial refund math by production stage
- advanced evidence collection for fabric disputes

## Concrete V1 material-issue workflow

### Who can open it

V1 opener:

- tailor only

Why:

- this workflow is for "I received or reviewed this material and cannot safely proceed."
- customer concerns after production begins already map more naturally to dispute/support.

Ops role:

- ops can review, hold payout, or guide resolution if the issue stalls or becomes contested

### When it can be opened

The workflow should only open for `CUSTOM` orders before cutting starts.

Recommended eligible stages:

- `PENDING_QUOTE`
- `CONSULTATION`
- `QUOTE_SENT`
- `PAYMENT_PENDING`
- `CONFIRMED`
- `DESIGNING`
- `SOURCING`

Not eligible once the order reaches:

- `CUTTING`
- `SEWING`
- `FINISHING`
- `SHIPPED`
- `READY_FOR_COLLECTION`
- `DELIVERED`
- `COLLECTED`
- `COMPLETE`
- `IN_DISPUTE`

Hard boundary:

- once the garment has entered `CUTTING`, new fabric-quality problems are no longer treated as a simple pre-production material issue
- at that point the problem moves to dispute/support handling

### When it is most relevant

Most important case:

- `fabric_source = CUSTOMER_SUPPLIES`

Still potentially useful later:

- `fabric_source = TAILOR_SOURCES` if the tailor discovers sourcing failure or mismatch before cutting

### Trigger reasons

V1 allowed reasons should be structured, not freeform-only:

- `UNSUITABLE_FABRIC_TYPE`
- `POOR_FABRIC_QUALITY`
- `INSUFFICIENT_YARDAGE`
- `DAMAGED_FABRIC`
- `COLOR_OR_WEIGHT_MISMATCH`
- `FABRIC_NOT_RECEIVED`
- `OTHER`

The tailor should also provide:

- a short explanation
- at least one evidence photo when the issue is physical or visible
- optional note tying the issue to the saved `fabric_tracking` if the customer shipped the fabric

### What opening the issue does

When a material issue is opened:

- production progression pauses
- tailor cannot advance to `CUTTING` until the issue resolves
- payout release stays blocked
- customer gets a clear action request, not just a generic message

### Customer choices

V1 customer actions should be explicit:

- `REPLACE_FABRIC`
- `ASK_TAILOR_TO_SOURCE`
- `REVISE_DESIGN`
- `CANCEL_ORDER`

Expected outcome for each choice:

- `REPLACE_FABRIC`
  - customer sends better fabric
  - order stays paused until replacement is confirmed
- `ASK_TAILOR_TO_SOURCE`
  - tailor revises quote or confirms additional sourcing cost
  - customer accepts the revised terms before work continues
- `REVISE_DESIGN`
  - tailor and customer align on a design that suits the material reality
  - order stays in pre-production until confirmed
- `CANCEL_ORDER`
  - order moves into refund / support review according to whether payment happened and whether work started

### Suggested subflow statuses

- `OPEN`
- `WAITING_FOR_CUSTOMER`
- `WAITING_FOR_TAILOR`
- `WAITING_FOR_REPLACEMENT_FABRIC`
- `WAITING_FOR_REVISED_QUOTE`
- `RESOLVED_CONTINUE`
- `RESOLVED_CANCELLED`
- `ESCALATED_TO_SUPPORT`

### Timers and escalation

Recommended V1 timers:

- immediately:
  - notify customer
  - pause progression
- at `24 hours`:
  - remind customer the order is waiting on their choice
- at `72 hours`:
  - if unpaid or pre-payment, tailor may cancel cleanly
  - if already paid, move to ops review instead of blind auto-cancel

Why this split:

- unpaid/pre-payment issues can unwind more simply
- paid orders should not silently auto-cancel without a human review path

### Evidence rules

Minimum evidence to open a material issue:

- structured reason
- short explanation
- at least one photo for visible fabric defects or mismatch

Nice-to-have evidence:

- saved fabric tracking number
- delivery timestamp
- note about expected vs actual fabric

### Resolution rules

A material issue should only close as `RESOLVED_CONTINUE` when:

- customer chose a path
- tailor confirmed the issue is actually resolved
- order is still pre-cutting

If the issue is unresolved and the order needs human attention:

- move to `ESCALATED_TO_SUPPORT`

### Customer-facing copy rule

The product should frame this calmly:

- "Your tailor reviewed the fabric and needs your decision before production can continue."

Not this:

- "Your tailor rejected your order."

That distinction matters because this is often a recoverable production problem, not a hard failure.

## Decision 4: Trust And Auth Posture For These Flows

## Chosen rule

For V1, trust should come from:

- clear order-state rules
- conservative payout timing
- ownership checks
- structured issue handling
- consistent recovery and auth behavior

Not from:

- overcomplicated password rules
- vague promises about fit perfection
- hidden manual ops decisions

## Why

- Measurement, payout, and material problems are mostly trust problems before they become code problems.
- If the product rules are vague, support burden will explode.

## Happy path

- customer understands how measurements were captured
- tailor understands whether fit confidence is high or low
- payout release point is predictable
- material issues are handled before cutting, not after damage is done

## Negative path

- customer assumes self-measurement means guaranteed perfect fit
- tailor assumes payout will happen early
- customer assumes supplied fabric risk sits entirely with the tailor

V1 response:

- product copy and ops policy must make the boundaries visible

## What We Are Explicitly Not Doing In V1

- official Nordstrom integration
- formal nearby-measurement marketplace
- made-to-order catalog under the same payout logic as ready-made
- default partial payout for `READY_MADE`
- full escrow-style milestone finance
- advanced fabric-liability automation

## Product Copy Guidance

When we surface these flows in the app, the messaging should be plain:

- measurements:
  - "Self-measurements help your tailor quote and cut, but your tailor may still confirm fit before production."
- ready-made:
  - "Shop now is for items already available from this seller."
- customer-supplied fabric:
  - "Your tailor can review the fabric before production. If it is not suitable, you may need to replace it, revise the design, or cancel before work begins."

## Next Product Decisions Needed Later

- whether the ready-made no-dispute payout window should stay at 72 hours or shift after real ops learning
- whether `CUSTOM` should eventually support deposits or milestone billing after launch
- whether `MATERIAL_ISSUE` should graduate from subflow to top-level order state after launch
- whether measurement source should be stored on profile, on order snapshot, or both

## Concrete V1 Decision Tables

## A. `READY_MADE` payout release timing

### Options considered

| Option | Happy path upside | Negative path risk | Recommendation |
| --- | --- | --- | --- |
| Release on payment confirmation | seller gets paid fastest | almost no buyer protection if seller never fulfills | no |
| Release on shipment / ready-for-collection | helps seller cash flow earlier | customer can still receive wrong item or no item | no |
| Release on `DELIVERED` or `COLLECTED` immediately | simple enough to explain | weak buffer for wrong-item / quality / fraud issues | maybe later |
| Release on `DELIVERED` or `COLLECTED` plus short dispute window | balances seller payout and buyer protection | slightly slower seller cash flow, more ops tracking | yes |

### Chosen V1 rule

For `READY_MADE`, payout should release after:

- `DELIVERED` plus a short no-dispute window for shipped orders
- `COLLECTED` plus a short no-dispute window for collection orders

Recommended default window:

- 72 hours

Recommended fail-safe:

- if a dispute opens before release, payout stays blocked
- ops can manually release or hold if the case is obvious

### Why this is the best V1 call

- `COMPLETE` is too seller-hostile because customers may never tap it.
- `SHIPPED` is too risky because proof of dispatch is not proof of satisfactory handoff.
- a short post-handoff window is understandable and conservative.

### Happy path

1. Customer buys a ready-made item.
2. Seller fulfills it.
3. Order reaches `DELIVERED` or `COLLECTED`.
4. No dispute appears during the short window.
5. Payout releases.

### Negative path

- parcel says delivered but customer claims wrong item
- collection is marked but customer disputes the condition
- suspected fraud or fulfillment mismatch

V1 response:

- payout remains blocked if dispute opens in the window
- ops can review supporting evidence

### Operational payout evidence rules

For V1, payout should not rely on vague "looks complete" logic.
It should rely on specific observed signals plus an ops override path.

Minimum release evidence for shipped `READY_MADE`:

- payment was confirmed successfully
- order is still `READY_MADE`
- order reached `DELIVERED`
- a tracking number exists
- a carrier exists
- no open dispute exists
- no manual payout hold exists
- seller payout destination is valid

Minimum release evidence for collection `READY_MADE`:

- payment was confirmed successfully
- order is still `READY_MADE`
- order reached `COLLECTED`
- collection was confirmed through the order flow, not a freeform note
- no open dispute exists
- no manual payout hold exists
- seller payout destination is valid

Signals that should block release automatically:

- order stage is `IN_DISPUTE`
- order was cancelled, refunded, or otherwise reversed
- missing fulfillment evidence for the path used
- seller payout onboarding or payout destination is incomplete
- payment provider indicates the funds are not actually available for payout

Signals that should create an ops-review hold instead of blind auto-release:

- delivered very quickly after payment in a way that looks suspicious
- multiple customer complaints against the same seller in a short period
- a workflow issue exists around shipping mismatch, missing tracking, or fulfillment anomalies
- collection was forced through an unusual manual path

Recommended internal payout statuses for later implementation:

- `PENDING_FULFILLMENT`
- `READY_FOR_REVIEW`
- `RELEASE_SCHEDULED`
- `RELEASED`
- `HELD`
- `REVERSED`

### Manual ops override policy

Ops should be able to:

- place a payout hold
- release a payout early in obvious low-risk cases
- keep payout blocked when dispute facts are unclear
- annotate why a hold or release happened

This matters because payout mistakes are harder to recover from than delayed payouts.

### Customer and tailor expectation rule

The product should make one thing clear:

- shipment or collection starts payout review
- it does not mean payout is instantly final

That avoids promising sellers immediate money while still giving buyers a short protection window.

## B. `CUSTOM` labor deposit before cutting

### Options considered

| Option | Happy path upside | Negative path risk | Recommendation |
| --- | --- | --- | --- |
| No special labor deposit product | simplest pricing and ops logic | less flexibility for partial refund rules later | yes |
| Labor deposit plus later balance payment | clearer milestone economics | much more product, payment, refund, and support complexity | not for V1 |
| Non-refundable labor deposit only for customer-supplied fabric | addresses real tailor risk | hard to explain fairly without mature issue handling | not for V1 |

### Chosen V1 rule

V1 should not introduce a separate labor-deposit product.

Instead:

- `CUSTOM` continues to use one accepted-quote payment event
- payout release stays conservative on the platform side
- any non-refundable labor logic is deferred until dispute and material-issue handling are more mature

### Why this is the best V1 call

- splitting one custom payment into deposit + balance multiplies failure cases
- refunds get harder to explain
- ops burden rises before we have enough real order data

### Happy path

1. Tailor sends quote.
2. Customer accepts quote.
3. Customer pays once.
4. Order moves into production.

### Negative path

- customer changes mind before work starts
- tailor finds a fabric or measurement issue before cutting
- customer wants refund after quote payment

V1 response:

- treat this as order-policy and issue-handling logic, not split-payment logic
- do not create a second payment stage unless we have strong proof we need it

## C. `MATERIAL_ISSUE` as order stage vs subflow

### Options considered

| Option | Happy path upside | Negative path risk | Recommendation |
| --- | --- | --- | --- |
| Full top-level `MATERIAL_ISSUE` order stage | very visible and explicit | complicates order machine, notifications, payout rules, and QA immediately | later maybe |
| Structured material-issue subflow under existing pre-production stages | keeps logic contained while still being explicit | requires some UI/ops discipline so it does not become invisible | yes |
| Freeform notes only | fastest to build | too messy, weak accountability, easy to mishandle | no |

### Chosen V1 rule

V1 should treat material issues as a structured subflow, not a new top-level order stage.

That subflow should:

- only be available before cutting starts
- be most relevant when `fabric_source = CUSTOMER_SUPPLIES`
- block further production progression until resolved

Suggested subflow statuses:

- `OPEN`
- `WAITING_FOR_CUSTOMER`
- `RESOLVED_REPLACE_FABRIC`
- `RESOLVED_TAILOR_SOURCE`
- `RESOLVED_REVISED_DESIGN`
- `RESOLVED_CANCELLED`

### Why this is the best V1 call

- it keeps the order machine stable
- it gives ops and both parties a real workflow
- it avoids turning an exception case into a platform-wide state explosion too early

### Happy path

1. Tailor receives customer-supplied fabric.
2. Fabric is unsuitable.
3. Tailor opens material issue with reason.
4. Customer chooses a fix.
5. Issue resolves before cutting.
6. Order continues in the same pre-production stage path.

### Negative path

- customer ignores the issue
- parties disagree about fabric quality
- issue is discovered after cutting

V1 response:

- unresolved issue can pause production
- after cutting, issue moves to dispute/support logic rather than pretending it is still pre-production

## Summary Of The Three Calls

- `READY_MADE` payout: release after `DELIVERED` or `COLLECTED` plus a short no-dispute window
- `CUSTOM` labor deposit: no separate labor-deposit product in V1
- `MATERIAL_ISSUE`: structured subflow first, not a top-level order stage

## What These Choices Protect Us From

- overcomplicating payout before we understand disputes
- introducing split-payment refund chaos too early
- exploding the order-state machine with rare exceptions
- forcing tailors to absorb customer-fabric risk silently

## Immediate Recommendation

Build V1 around these assumptions:

- `READY_MADE` means real ready-made
- `CUSTOM` handles the more complex production logic
- customer-supplied fabric gets explicit issue handling
- measurements carry confidence and source context over time

That keeps the product understandable while we learn from real usage.
