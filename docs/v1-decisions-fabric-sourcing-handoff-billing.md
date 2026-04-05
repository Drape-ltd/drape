# V1 Decisions: Fabric Sourcing, Handoff, And Billing

Date: April 2, 2026

## Why This Exists

Drape already supports:

- `fabric_source = CUSTOMER_SUPPLIES`
- `fabric_source = TAILOR_SOURCES`

But that does not fully answer the product questions around:

- local fabric handoff
- tailor-sourced material approval
- when the customer is billed
- whether the tailor is expected to front material costs

This document locks the recommended V1 direction so we can keep product, ops, and payment logic aligned.

## Current Product Reality

Right now, Drape mostly models:

- `fabric_source`
- finished-garment `delivery_method`
- optional `fabric_tracking` for shipped customer fabric

That means the current product covers:

- customer ships fabric to tailor
- tailor includes sourced-fabric cost in the quote

But it does not yet explicitly cover:

- customer drops fabric off locally
- tailor picks fabric up locally
- fabric receipt confirmation
- fabric custody evidence
- swatch or material approval before purchase
- a separate material-funding step

## Decision 1: Local Fabric Handoff Is A Real Supported Scenario

### Chosen rule

For V1 product policy, Drape should treat local handoff as valid for customer-supplied fabric.

That means customer-supplied fabric should conceptually support:

- shipping to the tailor
- local dropoff
- local pickup
- bringing fabric to an in-person consultation or fitting

### Why

- forcing everything into shipping is not realistic for local markets
- local handoff is common in tailoring
- without recognizing local handoff, the app makes a real workflow feel like an unsupported exception

### V1 caveat

Even if we do not fully implement the model right away, product and ops should behave as if local handoff is allowed.

## Decision 2: Fabric Handoff Must Be Separated From Fabric Source

### Chosen rule

We should treat these as two different ideas:

1. `who sources the fabric`
2. `how the fabric reaches the tailor`

### Why

These are different operational risks.

Examples:

- customer supplies fabric + ships it
- customer supplies fabric + drops it off locally
- customer supplies fabric + tailor picks it up
- tailor sources fabric + no customer handoff is needed

### Future model

The likely future field is:

- `fabric_handoff_mode`

Suggested values:

- `CUSTOMER_SHIPS_TO_TAILOR`
- `CUSTOMER_DROPS_OFF_LOCALLY`
- `TAILOR_PICKS_UP_LOCALLY`
- `FABRIC_ALREADY_WITH_TAILOR`
- `NO_CUSTOMER_HANDOFF_REQUIRED`

## Decision 3: Tailor-Sourced Fabric Should Follow A Single Payment Moment In V1

### Chosen rule

If the tailor is sourcing fabric in V1:

- tailor explains the sourcing plan
- tailor sends one quote with fabric included
- customer pays once
- tailor sources only after payment

### What the customer experience should feel like

1. customer describes the garment
2. tailor clarifies the fabric plan in chat or consultation
3. tailor sends one all-in quote
4. customer accepts and pays
5. tailor buys fabric and continues production

### Why

- easier to explain
- easier to support
- avoids surprise add-on billing later
- protects low-cash-flow tailors from being forced to front material money

## Decision 4: Drape Should Not Assume Tailors Can Buy Fabric On Credit

### Chosen rule

V1 should not quietly assume the tailor can self-fund materials.

If a tailor does not have enough cash to buy fabric before being paid, that should still be okay under the product design.

### Product implication

The quote should be the funding moment for tailor-sourced fabric.

That means:

- the customer is billed when they accept the quote
- not after the tailor already spent money
- not through an off-platform arrangement

### What we avoid

- tailors acting like lenders
- inconsistent off-platform cash requests
- disputes where the tailor claims they spent money before the customer committed

## Decision 5: No Separate Material Deposit Flow In V1

### Chosen rule

We should not add a second billing step for materials in V1.

### Why

- separate deposit logic adds state complexity
- harder refunds and reversals
- more confusing customer experience
- more ops burden when material plans change

### Later option

If we need to help lower-cash-flow tailors more, a future feature can add:

- `CUSTOMER_PREPAYS_MATERIALS`

But that should be deliberate and explicit, not implied by the current quote flow.

## Decision 6: Tailor-Sourced Fabric Needs Approval Expectations

### Chosen rule

V1 should not allow silent material substitution when the tailor is sourcing fabric.

The quote or conversation should make clear:

- whether the quote includes fabric
- whether the fabric is already identified or still approximate
- whether substitution needs customer approval

### Best V1 expectation

If the exact fabric is not already locked, the tailor should still describe:

- type
- quality level
- color family
- any important constraint

That gives the customer enough context to approve the direction without building a heavy swatch system yet.

## Decision 7: Customer-Supplied Fabric Needs Receipt Confirmation

### Chosen rule

If the customer is supplying fabric, the product should eventually record that the fabric was actually received before production continues.

### Why

- shipped fabric has some evidence from tracking
- local handoff has little or no evidence unless we record it
- fabric disputes get messy fast when custody is unclear

### Minimum future signals

- handoff mode
- received / not received
- received timestamp
- optional note or photo

## V1 Scenario Answers

## Scenario A: Customer ships fabric

V1 answer:

- valid
- customer can share tracking
- tailor should confirm receipt before cutting

## Scenario B: Customer drops fabric off locally

V1 answer:

- should be treated as valid
- ops and product copy should not imply shipping is the only path
- later product work should add a local handoff confirmation

## Scenario C: Tailor picks up fabric locally

V1 answer:

- should be treated as valid but not deeply automated yet
- later product work should add pickup confirmation and optional fee support

## Scenario D: Tailor sources fabric and customer asks when they get billed

V1 answer:

- the customer gets billed when they accept the quote
- the quote should already include the sourcing cost
- the tailor should not be expected to buy first and chase payment later

## Scenario E: Tailor does not have money to buy fabric first

V1 answer:

- that is exactly why the quote should be paid before sourcing begins
- Drape should not require the tailor to front material costs

## Scenario F: Customer and tailor disagree about sourced fabric later

V1 answer:

- if the tailor sourced against an agreed direction, support can review
- if the customer approved only a general direction, Drape should judge against that stated direction
- silent substitutions are the thing we should avoid most

## Happy Path

For `TAILOR_SOURCES`:

1. customer creates custom request
2. tailor clarifies material plan
3. tailor sends one quote including sourcing
4. customer pays
5. tailor buys fabric
6. production continues

For `CUSTOMER_SUPPLIES`:

1. customer creates custom request
2. customer and tailor align on fabric suitability
3. fabric reaches tailor by shipping or local handoff
4. tailor confirms receipt
5. production continues

## Negative Paths

- customer says they dropped fabric off, tailor says they never got it
- customer ships fabric, but wrong material arrives
- tailor sources a fabric that does not match the promised direction
- tailor cannot afford to source materials before payment
- customer expects fabric to be included but the quote was ambiguous
- customer wants to change material after quote acceptance

## Recommendation Summary

The cleanest V1 rule set is:

- support both shipping and local handoff conceptually for customer-supplied fabric
- treat `fabric_source` and `fabric handoff` as separate concepts
- for tailor-sourced fabric, use one all-in quote and one payment before sourcing starts
- do not assume tailors can self-fund materials
- do not add a separate material deposit flow yet
- require clearer sourcing expectations so substitutions do not become disputes

## Sources

- [Taylor Richards & Conger made-to-measure](https://shop-trcstyle.com/pages/made-to-measure)
- [Anthony's Bespoke Tailor](https://anthonysbespoketailor.com/)
- [LALEDA Tailor FAQ](https://laledatailor.com/faqs)
- [Smart Fashion Tailor FAQ](https://smartfashiontailor.com/faq/)
- [Tailor.com FAQ](https://www.tailor.com/faq/)
- [Nashala FAQ](https://www.nashala.com/ladies-tailors-faqs)
- [CloudTailor FAQs](https://www.cloudtailor.com/faqs/)
- [Bharat Tailor](https://bharattailors.com/index.html)
- [Indie Darzi](https://indiedarzi.com/about/)
- [Tailors 2 U](https://www.tailors2u.com/)
- [Studio 1867 custom work deposit policy](https://studio1867.com/deposits-custom-work-policy/)
- [House of Cavone custom design policy](https://www.houseofcavone.com/pages/customer-design)
- [Winters Sewing](https://www.winterssewing.com/node/155)
- [Eilersen FAQ](https://www.eilersen-helpdesk.eu/faq)
- [ArtLab terms](https://www.artlab.co.za/artlab-terms)
- [Stripe Affirm](https://docs.stripe.com/payments/affirm)
- [Stripe Klarna](https://docs.stripe.com/payments/klarna)
