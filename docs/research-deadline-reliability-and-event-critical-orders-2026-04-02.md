# Research Notes: Deadline Reliability And Event-Critical Orders

Date: April 2, 2026

## Why This Exists

Custom garments are often tied to:

- weddings
- cultural events
- graduations
- trips
- specific ceremonies or parties

That means a missed deadline is not just a delay.
It can destroy most of the value of the order.

This document looks at what Drape already does with deadlines and what a safer V1 business stance should be.

## High-Signal Takeaways

- Drape already captures customer deadlines and blocks quoted completion dates that go past them.
- That is good, but deadline policy needs to go further than one validation rule.
- Serious custom-clothing businesses ask customers to plan well ahead and avoid implying that rush fulfillment is normal.
- Event-critical orders need clearer expectation setting because delay can transform a normal production issue into a near-total failure of value.
- Drape should treat deadlines as part of scope, not just a nice-to-have note.
- A missed deadline caused by the seller becomes much more serious if the garment no longer serves the event it was ordered for.

## 1. What Drape Supports Today

Drape already does some important things right:

- the customer brief requires a deadline
- the tailor sees that deadline while quoting
- quoted completion date cannot exceed customer deadline

This is already stronger than many informal tailoring workflows.

## Important current gap

What is still not fully explicit is:

- what promise the quoted completion date really creates
- what happens when the seller later realizes the date is at risk
- how event-critical misses should be treated in support and remedy

## 2. What The Market Actually Does

## Pattern A: Good custom businesses ask customers to start early

Current official INDOCHINO guidance says:

- place an order `10-12 weeks` before an important date to allow time for delivery and alterations

This matters because it shows the business reality:

- even mature operators do not treat event timelines casually

## Pattern B: Rush options are often limited or refused

Current official INDOCHINO guidance says:

- no, orders cannot be rushed
- their process is already running as fast as possible

## Product lesson

Drape should avoid pretending that every deadline can be rescued with urgency.

## Pattern C: First appointment and fitting exist to reduce later surprises

INDOCHINO's showroom guidance says the first appointment includes:

- consultation
- fabric discussion
- measurements
- ordering help

This supports the idea that:

- stronger intake reduces deadline risk later

## Pattern D: Businesses tie remedies to timing windows after delivery

INDOCHINO also uses fit-claim windows after delivery.

This matters because:

- time is part of their trust model before and after fulfillment

## 3. Why Deadline Is Part Of Scope

A customer deadline is not just a preference.

For event-based garments, deadline changes:

- feasibility
- material choice
- complexity tolerance
- shipping risk
- customer willingness to accept alterations later

## Product lesson

Deadline belongs in the commercial promise alongside:

- price
- fabric assumptions
- fulfillment method

## 4. Best V1 Product Stance

The safest V1 stance is:

- deadline is part of scope
- quote date is a real commitment, not decorative
- sellers should not over-promise to win the order
- Drape should not imply rush rescue as a normal fallback

## 5. Event-Critical Orders Need Clearer Risk Handling

If the ordered date is tightly linked to a single event, a miss can mean:

- the garment still exists
- but the economic value for the customer has fallen sharply

That means event-critical missed deadlines should be treated more seriously than ordinary lateness.

## Product inference

The remedy should depend on:

- whether the seller caused the miss
- whether the event date has passed
- whether the garment is still meaningfully useful

## 6. Recommended Drape Policy Direction

## Before quote acceptance

- sellers should only quote dates they can actually support
- consultation should be encouraged when the date feels risky

## After quote acceptance

- deadline should be treated as locked scope
- customer cannot silently make it earlier
- seller cannot silently make it later

## If the seller later sees risk

- surface the risk early
- move into support if needed
- do not wait until after the event to acknowledge the problem

## If the event date passes

- customer-favoring remedy becomes much more plausible
- especially if the seller caused the miss and the garment no longer serves its intended purpose

## 7. Best V1 Operational Lesson

The worst deadline failure mode is not simply:

- order was late

It is:

- order was late
- nobody said so early
- customer lost the event
- support then treats it like a normal delay

Drape should avoid that failure mode.

## 8. Recommended V1 Direction

- keep deadline capture mandatory for custom briefs
- keep server-side rule that quoted completion date cannot exceed deadline
- treat deadline as part of scope after acceptance
- treat seller-caused event-date misses as high-severity support cases
- avoid promising rush rescue as a default operating mode

## Sources

- [INDOCHINO: important event or date approaching](https://support.indochino.com/hc/en-us/articles/360057150993-Got-an-important-event-or-date-approaching)
- [INDOCHINO: can I rush my order?](https://support.indochino.com/hc/en-us/articles/360034194574-Can-I-rush-my-order)
- [INDOCHINO: first appointment](https://support.indochino.com/hc/en-us/articles/1500000212921-What-should-I-expect-during-my-first-appointment)
- [House of Cavone custom design policy](https://www.houseofcavone.com/pages/customer-design)

Internal Drape sources:

- `apps/mobile/app/(customer)/brief/[tailorId].tsx`
- `supabase/functions/tailor-order-action/index.ts`
- `docs/v1-decisions-remedy-ladder-and-refund-matrix.md`
