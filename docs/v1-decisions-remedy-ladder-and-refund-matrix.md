# V1 Decisions: Remedy Ladder And Refund Matrix

Date: April 2, 2026

## Why This Exists

Drape needs a predictable answer to these questions:

- when do we alter instead of refund?
- when do we remake instead of alter?
- when is a partial refund fair?
- when is a full refund fair?
- when should payout stay blocked?

This document turns the research into a practical V1 framework.

## Core Principle

Drape should not use one blanket rule like:

- "custom work is non-refundable"
- or "customer always gets refunded"

Instead, Drape should use the least-destructive fair remedy based on:

1. what went wrong
2. who likely caused it
3. how far production has progressed
4. what evidence exists

## Remedy Ladder

Drape should think in this order:

1. clarify
2. fix
3. alter
4. remake
5. partial refund
6. full refund
7. dispute / ops decision

This matters because many custom-order issues are still recoverable without treating the whole order like a retail return.

## Responsibility Buckets

## Tailor-responsible examples

- wrong measurements used after confirmed intake
- tailor ignored obvious fit or fabric warnings
- sourced fabric clearly does not match agreed direction
- workmanship defect
- missed deadline with no credible recovery plan
- shipped wrong item

## Customer-responsible examples

- changed mind after quote/payment
- supplied wrong or insufficient fabric
- gave inaccurate self-measurements after clear guidance
- refused agreed remedy that would reasonably solve the issue

## Shared-risk examples

- self-measurement produced a near miss
- customer approved only a broad sourcing direction and later dislikes the exact feel
- production assumptions were ambiguous

These should usually go through remedy and ops review before cash decisions.

## Stage Windows

For Drape V1, the cleanest windows are:

## Window A: Before quote acceptance

Typical stages:

- `PENDING_QUOTE`
- `CONSULTATION`
- `QUOTE_SENT`

Default stance:

- customer can walk away
- no production refund issue yet
- no seller payout

Best remedies:

- clarification
- revised quote
- cancel cleanly

## Window B: After payment but before sourcing or fabric receipt

Typical stages:

- `PAYMENT_PENDING`
- `CONFIRMED`
- early `DESIGNING`

Default stance:

- highest likelihood of full refund
- no seller payout
- tailor should not yet be out-of-pocket for material unless proven otherwise

Best remedies:

- full refund
- revised quote
- clean cancellation

## Window C: After sourcing or fabric receipt but before cutting

Typical stages:

- `SOURCING`
- late `DESIGNING`
- `CONFIRMED` with material already received

Default stance:

- still reversible, but no longer a clean retail-style cancellation
- payout still blocked
- refund may need to exclude documented non-recoverable cost

Best remedies:

- material issue flow
- revised quote
- replacement fabric
- alteration of plan
- partial refund
- full refund only if little irreversible cost exists

## Window D: After cutting through finishing

Typical stages:

- `CUTTING`
- `SEWING`
- `FINISHING`

Default stance:

- labor is materially consumed
- tailor-sourced material is usually no longer safely reversible
- payout should still remain blocked until fulfillment/dispute window logic is satisfied

Best remedies:

- alteration
- remake
- partial refund
- dispute review

Full refund should be rarer here unless failure is extreme or the garment is effectively unusable due to seller fault.

## Window E: After shipment or collection, before completion

Typical stages:

- `SHIPPED`
- `READY_FOR_COLLECTION`
- `DELIVERED`
- `COLLECTED`

Default stance:

- payout stays blocked until the no-dispute window passes
- remedy depends heavily on evidence, severity, and whether a fix is feasible

Best remedies:

- alteration support
- remake
- partial refund
- full refund for serious seller failure
- dispute / ops review

## Window F: After completion

Typical stages:

- `COMPLETE`

Default stance:

- refund rights should narrow further
- truly latent defects or severe misrepresentation can still justify review

Best remedies:

- limited goodwill support
- partial refund in exceptional cases
- case-by-case ops review

## Default Remedy Matrix

## 1. Customer changed their mind

Before payment:

- clean cancel

After payment, before sourcing / receipt:

- usually full refund

After sourcing / receipt:

- likely partial refund at most
- especially if tailor can prove material commitment

After cutting:

- usually no clean refund
- maybe partial goodwill refund at ops discretion

## 2. Tailor-sourced fabric does not match agreed direction

Before fabric purchase:

- revise plan or cancel cleanly

After fabric purchase, before cutting:

- strongest default remedy is replace fabric or partial refund if customer wants to exit

After cutting:

- strongest default remedy is remake or substantial partial refund

When full refund makes sense:

- if the mismatch is major and clearly seller-caused
- especially if the garment is no longer acceptable for the promised use

## 3. Customer-supplied fabric is unsuitable

Before receipt:

- pause and request correct fabric

After receipt, before cutting:

- material issue flow
- customer replaces fabric, revises design, asks tailor to source, or cancels

After cutting:

- customer-favoring refund becomes much weaker if the problem was truly in the customer material

Default cash stance:

- customer usually carries the fabric-quality risk
- tailor still carries the risk of proceeding after obvious warnings were available

## 4. Measurement issue

If caused by tailor capture or confirmed tailor override:

- alteration first if realistically fixable
- remake if alteration cannot achieve the promised fit
- partial or full refund if remake is not credible

If caused by customer self-measurement:

- alteration first
- remake only if Drape promised strong measurement support or the guidance flow was misleading
- refund less likely unless the final result is far outside reasonable tolerance

If source is ambiguous:

- ops review with measurement evidence

## 5. Workmanship defect

Examples:

- poor stitching
- asymmetry
- incorrect construction
- broken finishing

Default stance:

- seller-responsible

Best remedies:

- fix if minor
- remake if structural
- partial or full refund if repair is not credible or customer confidence is broken

## 6. Shipping damage or wrong item

Default stance:

- seller or fulfillment side is responsible unless evidence says otherwise

Best remedies:

- replacement / remake
- full refund if recovery is not practical

Payout posture:

- keep blocked until resolved

## 7. Missed deadline

If still pre-production or pre-cutting:

- customer should be able to cancel more easily

If meaningful work is already done:

- refund should depend on delay severity and whether the order is still usable for the event

If the event date has passed:

- full or near-full refund becomes much more plausible if seller caused the miss and the garment no longer serves the intended purpose

## Drape V1 Default Outcomes By Window

| Window | Default cash posture | Strongest default remedies |
| --- | --- | --- |
| Before quote acceptance | no charge or reversible acceptance | revise, clarify, cancel |
| After payment, before sourcing/receipt | customer-favoring | full refund, revise, cancel |
| After sourcing/receipt, before cutting | mixed | replace material, revise, partial refund |
| After cutting through finishing | seller work has real sunk cost | alter, remake, partial refund |
| After delivery/collection, inside dispute window | evidence-driven | alter, remake, partial/full refund, ops |
| After complete | narrow | limited support, exceptional partial refund |

## Payout Rules That Pair With This

The remedy model only works if payout is conservative.

Recommended pairing:

- no payout before fulfillment evidence
- no payout while remedy or dispute is open
- no payout while refund decision is unresolved
- custom-order payout should remain more conservative than ready-made payout

## What Counts As Good Evidence

## To support a non-refundable material claim

- proof that tailor-sourced material was actually purchased
- date of purchase
- amount or at least credible cost evidence
- link to the approved sourcing direction

## To support a measurement decision

- measurement source
- measurement snapshot
- who captured it
- any later adjustment by tailor or customer

## To support customer-supplied fabric liability

- handoff mode
- tracking or local receipt
- photos on receipt
- recorded warning before cutting

## Recommended V1 Decisions

- do not promise blanket refunds on `CUSTOM`
- do not copy blanket "all sales final" custom-tailor language either
- default to remedy first when seller fault is plausibly fixable
- default to stronger customer refund rights before sourcing or cutting
- treat cutting as the strongest boundary where refundability narrows
- require proof before withholding money for tailor-sourced material cost
- keep payout blocked whenever remedy or dispute is open

## Open Questions

- Should Drape give one free remake by policy for certain measurement cases?
- Should event-date miss create automatic customer-favoring review?
- Should tailor-sourced material cost only be recoverable with uploaded receipt evidence?
- Should self-measurement orders carry different default remedy limits than tailor-captured measurements?

## Sources

- [Stripe: Handle refunds and disputes](https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes)
- [Stripe: Using manual payouts](https://docs.stripe.com/connect/manual-payouts)
- [Paystack: Manage disputes](https://paystack.com/docs/payments/manage-disputes/)
- [Paystack: Refunds](https://paystack.com/docs/payments/refunds/)
- [INDOCHINO fit options](https://support.indochino.com/hc/en-us/articles/360034773473-My-suit-doesn-t-fit-what-options-do-I-have)
- [INDOCHINO return policy](https://support.indochino.com/hc/en-us/articles/360034710293-What-is-the-Return-Policy)
- [INDOCHINO order cancellation](https://support.indochino.com/hc/en-us/articles/4412908730771-How-do-I-cancel-my-order-)
- [Proper Cloth Perfect Fit Guarantee](https://propercloth.com/perfect-fit-guarantee)
- [Proper Cloth remake guidance](https://propercloth.com/reference/how-to-request-tailored-clothing-remake/)
- [Studio 1867 deposits policy](https://studio1867.com/deposits-custom-work-policy/)
- [House of Cavone custom design policy](https://www.houseofcavone.com/pages/customer-design)
- [Winters Sewing customer material guidance](https://www.winterssewing.com/node/155)
