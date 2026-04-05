# Research Notes: Quote Structure, Revisions, And Scope Locking

Date: April 2, 2026

## Why This Exists

Drape already supports quoting, quote acceptance, quote expiry, and payment handoff.

What is still ambiguous is the business rule layer:

- what exactly a quote should lock
- when a quote can be revised
- when a customer change requires a fresh quote
- when the order should be cancelled and recreated instead of silently repriced

This document turns the current flow into a clearer commercial policy direction.

## High-Signal Takeaways

- Drape already has a solid transactional base: one quote, expiry, acceptance, payment, confirmation.
- What is missing is a sharper rule for when the economic terms become fixed.
- Custom businesses commonly allow limited changes before production, then become much stricter once work or material commitment begins.
- The external pattern is consistent: pre-production changes may be allowed, but once production starts, either changes are blocked, charged extra, or require a more formal rework path.
- Drape should treat quote replacement before acceptance very differently from scope changes after acceptance.
- Silent repricing after the customer starts payment is especially dangerous and should stay prohibited.

## 1. What Drape Supports Today

Current quote structure already includes:

- `quoted_amount`
- `quoted_currency`
- `quoted_completion_date`
- `quote_note`
- `quote_expires_at`
- `fulfillment_fee`

Current sending behavior already enforces:

- only certain stages can send a quote
- quoted completion date cannot exceed customer deadline
- quote expiry is set server-side

Current automation guidance already says:

- only one active quote snapshot per order
- tailor can replace an open quote before acceptance
- no silent quote edits after payment has started

This is a strong foundation.

## 2. What The Market Actually Does

## Pattern A: Pre-production changes are sometimes allowed

Official and business-policy signal:

- INDOCHINO allows adjustments while an order is still on a pre-production hold
- eShakti says order changes should be requested quickly and often require cancelling and replacing the order

## Product lesson

Before production starts, custom businesses are willing to be flexible.
But even then, the clean way to handle a meaningful change is often:

- stop the original commercial promise
- replace it with a new one

## Pattern B: After production begins, flexibility narrows sharply

Official and business-policy signal:

- INDOCHINO says once the order is in production, adjustments cannot be made
- House of Cavone says changes after the original consultation can create additional cost

## Product lesson

Once production or material commitment starts, businesses stop treating the order like a floating estimate.

That is the key commercial boundary Drape needs too.

## 3. What A Quote Should Mean In Drape

A Drape quote should not just mean:

- "here is a price"

It should mean:

- this is the tailor's current commercial commitment for this exact scope

That scope should include, at minimum:

- price
- currency
- fulfillment fee if separate
- expected completion date
- the current garment/fabric/fulfillment assumptions reflected in the note

## Product lesson

The quote note matters because it is where Drape can explain assumptions without creating a huge schema immediately.

## 4. The Most Important Boundary: Acceptance And Payment Start

The biggest commercial boundary in Drape should be:

- customer acceptance and payment start

Why:

- before that, quote replacement is normal
- after that, the customer has acted on a specific offer

## Product inference

This means:

- replacing an open quote is fine
- silently mutating an accepted quote is not fine

## 5. Replace Quote Vs Change Order

These are different things and should be treated differently.

## Replace quote

Use when:

- customer has not accepted yet
- tailor wants to change price, timing, or assumptions
- the order is still pre-acceptance

Expected behavior:

- old quote becomes inactive
- new quote snapshot becomes the only active one
- quote expiry resets

## Change order

Use when:

- customer already accepted and payment started or completed
- one side wants to materially alter scope

Expected behavior in V1:

- do not silently reprice the same accepted quote
- handle as support, mutual cancel/rebook, or later explicit change-request logic

## 6. What Counts As A Material Change

The quote should probably be treated as materially changed if any of these move:

- garment type or overall design direction
- fabric source switches between `CUSTOMER_SUPPLIES` and `TAILOR_SOURCES`
- sourced-fabric expectations change materially
- fulfillment mode changes in a way that affects cost
- deadline becomes materially earlier
- quantity changes
- major new fit or complexity requirements appear

These should usually require a fresh quote before acceptance.

## 7. What Counts As A Minor Clarification

These are more likely to stay inside the same quote:

- slight note clarification
- non-material style clarification
- delivery note cleanup with no cost impact
- confirming assumptions already implied by the note

## Product lesson

The real distinction is:

- does this change cost, risk, or timing in a meaningful way?

If yes, it should probably not stay under the old quote.

## 8. Best V1 Rule After Acceptance

Once the customer has accepted and payment has started:

- the commercial quote should be treated as locked

If something material changes after that:

- do not silently increase price
- do not silently push the deadline
- do not silently swap material assumptions

Instead, the order should move into one of these:

- proceed under the accepted terms
- mutual cancel before meaningful work begins
- ops-mediated resolution
- later, an explicit change-order flow

## 9. Best V1 Rule After Payment Confirmation

After payment confirmation, Drape should be even stricter.

Recommended stance:

- no re-quoting on the same paid order in V1
- major customer-driven changes should usually mean cancel/rebook if still early enough
- seller-driven scope change should be treated as seller risk unless the customer agrees through a clear support path

## 10. Deadlines Need Clear Handling Too

Current Drape already correctly blocks:

- quoted completion date later than customer deadline

But later deadline changes also need policy.

Suggested V1 stance:

- if the customer later wants an earlier deadline, the tailor is not automatically bound to it
- if the new deadline materially changes feasibility, the old quote should not be assumed to cover it

## 11. Best Product Lesson

The commercial heart of Drape should be:

- one active quote
- one clear acceptance moment
- one payment handoff
- no hidden repricing after commitment

That is what makes a marketplace feel trustworthy instead of slippery.

## 12. Recommended V1 Direction

- quote must lock total, currency, expected completion date, and key assumptions
- tailor may replace quote before acceptance
- only one active quote snapshot exists per order
- quote replacement resets expiry
- once payment starts, no silent edits
- once payment is confirmed, no re-quote on the same order in V1
- major post-acceptance scope changes should route to cancel/rebook or ops

## Sources

Official / business policy sources:

- [INDOCHINO: order changes after purchase](https://support.indochino.com/hc/en-us/articles/360039985353-How-do-I-make-changes-to-my-order-after-it-s-been-purchased)
- [INDOCHINO: order cancellation](https://support.indochino.com/hc/en-us/articles/4412908730771-How-do-I-cancel-my-order)
- [INDOCHINO: buy now, measure later](https://support.indochino.com/hc/en-us/articles/360039822133-Can-I-buy-now-and-measure-later)
- [eShakti returns and cancellations](https://www.eshakti.com/ReturnsPolicy.aspx)
- [House of Cavone custom design policy](https://www.houseofcavone.com/pages/customer-design)

Internal Drape sources:

- `supabase/functions/tailor-order-action/index.ts`
- `docs/order-automation-and-abuse-rules.md`
- `docs/checkout-and-fulfillment-flow.md`
- `apps/mobile/app/(tailor)/orders/[id].tsx`
