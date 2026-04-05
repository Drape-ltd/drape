# Research Notes: Post-Acceptance Change Requests And Change-Order Risk

Date: April 2, 2026

## Why This Exists

Once a customer accepts a quote and starts payment, a harder business question appears:

- what happens if the customer wants to change the design, deadline, fabric, or delivery plan?

Drape currently has:

- quote replacement before acceptance
- payment handoff after acceptance
- messages
- disputes / support paths

But it does not yet have a first-class change-order flow.

This document explores the safest V1 stance.

## High-Signal Takeaways

- Drape already behaves like a system that locks the commercial promise after acceptance, even if that rule is not yet fully written down.
- Many custom businesses allow quick pre-production corrections, but they become far stricter once the order is accepted and especially once work begins.
- There is a real difference between:
  - minor clarification
  - material scope change
  - remedy for a problem
- If Drape tries to support post-acceptance repricing too early, it will create trust and refund complexity fast.
- The clean V1 answer is not "support every change." It is "decide which changes stay inside the order and which should become cancel/rebook or ops review."

## 1. What Drape Supports Today

Current practical reality:

- before acceptance, a quote can be replaced
- once accepted, payment starts against a specific quote
- current help copy tells customers to discuss changes early in Messages
- if something goes wrong later, they should raise a concern from the order

That means Drape already implies:

- messages can handle discussion
- but there is no structured commercial change-order mechanism yet

## Important product lesson

The system is already closer to:

- "quote locks after acceptance"

than to:

- "orders stay commercially editable forever"

## 2. What The Market Actually Does

## Pattern A: Businesses allow limited early changes

Official/business examples:

- eShakti says order changes should be requested quickly, and in many cases the clean path is cancel and replace
- INDOCHINO allows some early changes while the order is still on hold or before production fully starts

## Product lesson

Custom businesses often allow:

- quick correction
- clean re-order

They are less likely to allow:

- endless mutation of the same commercial promise

## Pattern B: Once production starts, change flexibility collapses

Official/business examples:

- INDOCHINO says changes are no longer possible once an order has started production
- House of Cavone says changes after the original consultation can create extra cost

## Product lesson

The practical boundary is:

- after acceptance and especially after material or labor commitment, custom orders should not behave like editable shopping carts

## 3. Three Different Things Drape Must Not Confuse

## A. Minor clarification

Examples:

- confirming color wording already implied in the note
- clarifying pickup timing with no cost impact
- confirming the exact meaning of an already-agreed styling note

These can often stay inside messages and the same order.

## B. Material change request

Examples:

- changing garment type
- changing from customer-supplied to tailor-sourced fabric
- changing to a more expensive material direction
- moving to a much earlier deadline
- changing delivery mode with real cost impact

These are not mere clarifications.

They affect scope, risk, timing, or money.

## C. Problem / remedy

Examples:

- tailor cannot source the promised material
- customer-supplied fabric is unsuitable
- measurement confidence collapses
- seller missed the promised timeline

These should not be treated as casual change requests.
They belong in remedy, support, or material-issue handling.

## 4. The Best V1 Commercial Boundary

The cleanest boundary is still:

- accepted quote + payment start

Before that:

- replace quote freely

After that:

- no silent repricing
- no silent deadline drift
- no silent scope substitution

## 5. Best V1 Handling By Change Type

## Minor clarification with no cost or timing impact

Recommended V1 handling:

- keep inside messages
- no new quote
- no cancel / rebook

## Material customer-requested change before meaningful work begins

Recommended V1 handling:

- do not mutate the paid order commercially
- prefer mutual cancel / rebook if both sides still want to proceed with the new scope
- ops can help if needed

Why:

- avoids hidden repricing
- preserves clean accounting

## Material customer-requested change after sourcing or cutting has begun

Recommended V1 handling:

- not a normal change-order case anymore
- should go through support / remedy review
- refund or remake logic may apply depending on what has already been committed

## Seller-caused scope problem before meaningful work begins

Examples:

- promised fabric unavailable
- seller mis-scoped difficulty
- seller now says they need much more time

Recommended V1 handling:

- seller should not silently upcharge
- customer can accept an alternative, or the order can move toward mutual cancel / support review

## Seller-caused scope problem after meaningful work begins

Recommended V1 handling:

- treat as support / remedy issue
- not a fresh quote opportunity

## 6. Deadline Changes Need Special Care

If the customer asks for an earlier deadline after acceptance:

- the original quote should not silently stretch to cover it

If the tailor later says the timeline must slip materially:

- that is not just a note change
- it may become support, cancellation, or a customer-facing remedy issue

Why:

- deadline is part of value, especially for event-based garments

## 7. Fabric Changes Need Special Care Too

If the customer wants a materially different fabric after acceptance:

- that is usually a scope change

If the tailor cannot source the expected fabric:

- they should propose an alternative clearly
- customer should not be forced into silent substitution

This is not the same as simply "updating the note."

## 8. The Best V1 Product Lesson

The simplest safe rule is:

- minor clarification can stay in the order
- material change should not silently rewrite a paid order

If Drape stays disciplined on that, it avoids:

- hidden repricing
- mid-order money arguments
- messy refund logic from half-mutated promises

## 9. Recommended V1 Direction

- no explicit change-order pricing flow yet
- allow message-based clarification
- route material post-acceptance changes to:
  - mutual cancel / rebook if early enough
  - support / ops if meaningful work has started
- treat seller-caused post-acceptance changes as support/remedy issues, not normal re-quoting

## Sources

Official / business policy sources:

- [INDOCHINO order changes](https://support.indochino.com/hc/en-us/articles/360039985353-How-do-I-make-changes-to-my-order-after-it-s-been-purchased)
- [INDOCHINO cancellation](https://support.indochino.com/hc/en-us/articles/4412908730771-How-do-I-cancel-my-order)
- [eShakti returns and cancellations](https://www.eshakti.com/ReturnsPolicy.aspx)
- [House of Cavone custom design policy](https://www.houseofcavone.com/pages/customer-design)

Internal Drape sources:

- `apps/mobile/app/(customer)/profile/help.tsx`
- `apps/mobile/app/(customer)/orders/[id].tsx`
- `supabase/functions/customer-order-action/index.ts`
- `docs/v1-decisions-quote-structure-and-change-policy.md`
- `docs/v1-decisions-remedy-ladder-and-refund-matrix.md`
