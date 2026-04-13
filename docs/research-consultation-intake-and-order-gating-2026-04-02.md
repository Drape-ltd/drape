# Research Notes: Consultation, Intake, And Order Gating

Date: April 2, 2026

## Why This Exists

Consultation sits at the point where several Drape risks meet:

- measurement uncertainty
- fabric uncertainty
- sourcing ambiguity
- quote confidence
- customer expectation management

Drape already supports consultation as an order stage, but we still need a cleaner product answer to:

- when consultation should be optional
- when it should be strongly encouraged
- when it should effectively be required before quoting
- whether consultation should be monetized in V1

This document is a research and product-decision precursor.

## High-Signal Takeaways

- In custom clothing, consultation is usually a fit and expectation-alignment step, not just a casual chat feature.
- Market leaders often use showrooms, virtual fit calls, or fitter assistance before or around first custom orders.
- Consultation is most valuable when the brief is ambiguous, the fit is risky, or the material plan is not yet trustworthy.
- Drape’s current model is already directionally good because consultation is a stage inside the order, not a separate product.
- For V1, consultation should remain a workflow control, not a paid standalone service.
- Consultation should not become a place where slow or indecisive sellers hide instead of quoting or declining.

## 1. What Drape Supports Today

Drape already models:

- `CONSULTATION` as a first-class `OrderStage`
- tailor-requested consultation from `PENDING_QUOTE`
- optional `consultation_fee`
- in-app call room creation during the consultation stage
- fallback to messages if the call path is unavailable

This is a good foundation.

## Important current ambiguity

What is still unclear is not the existence of the stage.
It is the product policy around when the stage should be used.

## 2. What The Market Actually Does

## Pattern A: Showroom or expert fitting before first custom size

Examples:

- Proper Cloth showrooms help customers create a first custom size, refine existing fit, and get fabric and style advice
- Proper Cloth also offers virtual consultation as a fallback
- Men's Wearhouse lets customers get measured in store by experts

## Product lesson

Consultation is often used when:

- this is the first order
- the fit basis is weak
- style and material decisions are still fluid

## Pattern B: Appointment as a fit-creation step

Examples:

- Proper Cloth Home Try-On uses a virtual consultation plus try-on garments to create a reliable custom size
- custom houses often treat measurement, style choice, and fabric selection as part of one intake flow

## Product lesson

The real role of consultation is:

- reduce pre-production uncertainty
- improve quote confidence
- reduce expensive downstream mistakes

## Pattern C: Consultation tied to service relationship, not standalone marketplace service

The strongest market pattern is that consultation usually exists to help a later purchase or production flow.

It is not usually a separate neutral marketplace product in its own right.

## Product lesson

This matches the user’s stated V1 instinct:

- no paid standalone measurement or consultation service right now

## 3. Where Consultation Creates Value In Drape

Consultation is most useful when at least one of these is true:

- measurements are incomplete or low-confidence
- the customer wants `CUSTOM`
- the garment is complex or event-critical
- the customer is supplying fabric and suitability is unclear
- the tailor is sourcing fabric and material direction is still ambiguous
- local handoff or pickup needs to be clarified
- the brief is visually or technically unclear

## Product lesson

Consultation is an ambiguity-reduction step.

If ambiguity is already low, consultation should not be mandatory.

## 4. When Consultation Is Probably Unnecessary

Consultation is often not needed for:

- straightforward `READY_MADE`
- simple custom orders with clear references and complete measurements
- repeat customers with known fit and low-risk garment changes
- cases where the tailor is already confident enough to quote immediately

## Product lesson

Making consultation mandatory for everything would add friction without improving outcomes.

## 5. The Best V1 Role For Consultation

The cleanest V1 role is:

- pre-quote alignment gate

That means:

- it happens before a quote
- it should end in `QUOTE_SENT` or `DECLINED`
- it should not become a long-lived pre-production limbo state

This aligns with the existing Drape automation notes:

- consultation resolution target: `24 hours`
- auto-expire if still unresolved at `48 hours`

## 6. Consultation Fees In V1

Drape already supports an optional `consultation_fee`.

But based on both product simplicity and the user’s direction:

- consultation should not be treated as a paid standalone service in V1

## Product inference

The safest operational stance is:

- leave consultation-fee support dormant or rare
- default consultations to free
- do not build policy around collecting or refunding consultation-only revenue yet

Why:

- adds billing complexity too early
- creates edge cases around no-shows, refunds, and conversion
- weakens the clean story that consultation exists to make the order safer

## 7. Recommended Consultation Triggers

Consultation should be strongly encouraged or effectively required when:

- measurement profile is incomplete
- measurement source is low-confidence
- the tailor flags `measurements_need_confirmation`
- fabric source is `CUSTOMER_SUPPLIES` and material suitability is unclear
- fabric source is `TAILOR_SOURCES` and the sourcing direction is not yet aligned
- garment complexity is high
- deadline/event sensitivity is high
- customer references conflict or are unclear

## 8. Recommended Consultation Skip Conditions

Consultation can be skipped when:

- the order is `READY_MADE`
- the custom brief is complete and coherent
- measurements are strong enough
- material path is already clear
- the tailor is comfortable quoting immediately

## 9. Best Product Lesson

Consultation should be treated as:

- a risk-reduction tool

not:

- a generic extra step
- a seller stalling tactic
- a paid side product

## 10. Recommended Future Data/Policy Direction

Likely future additions:

- consultation required / recommended flag
- consultation reason list
- no-show handling if scheduling becomes deeper
- measurement confirmation requirement tied to consultation

But those are later.

For V1, the product mostly needs cleaner rules and better copy.

## Sources

Official fitting / consultation process sources:

- [Proper Cloth showrooms](https://propercloth.com/showrooms)
- [Proper Cloth showroom appointments](https://propercloth.com/showrooms/chicago)
- [Proper Cloth Home Try-On](https://propercloth.com/home-try-on)
- [Men's Wearhouse get measured](https://tuxedo.menswearhouse.com/measurements/get)
- [Proper Cloth custom sizing](https://propercloth.com/custom)

Internal Drape sources:

- `docs/order-automation-and-abuse-rules.md`
- `docs/v1-launch-blockers.md`
- `apps/mobile/lib/consultation.ts`
- `supabase/functions/create-consultation-room/index.ts`
- `supabase/functions/tailor-order-action/index.ts`
