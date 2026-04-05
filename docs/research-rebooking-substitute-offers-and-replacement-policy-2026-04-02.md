# Research Notes: Rebooking, Substitute Offers, And Replacement Policy

Date: April 2, 2026

## Why This Exists

Once Drape has a clearer view of:

- seller-side failure
- remedy ladders
- customer concerns

the next practical question is:

- what happens besides “refund and leave”

We need a clear answer to:

- when a seller can offer an alternative
- when Drape should help the customer rebook
- when replacement is appropriate
- when substitution stops being fair

This note is the research layer for that policy.

## High-Signal Takeaways

- Mature marketplaces allow alternatives, but usually only with explicit customer acceptance.
- If the original promise breaks, refund rights should stay intact unless the customer knowingly accepts a new path.
- Cross-seller rescue usually creates a new booking, not a mutated old one.
- Rebooking help is most valuable when time pressure is high or the seller failed after commitment.
- Silent substitution is trust-breaking, especially for custom work.

## 1. What Drape Does Today

Current Drape already has a few useful pieces:

- customer discovery and search
- saved tailors / shortlist
- tailor availability
- ready-made shop browsing

But it does not yet have:

- cross-tailor order transfer
- platform rebooking credits
- a formal special-offer / rebooking object
- substitute-offer acceptance flow

Important Drape inference:

For V1, rebooking help should likely be:

- guided
- explicit
- mostly new-order based

not an automatic reassignment engine.

## 2. Marketplace Pattern: Alternatives Need Explicit Acceptance

Airbnb’s current help center says:

- if a host offers a different place to stay, it is completely up to the guest to accept or decline
- after a reservation is confirmed, if the guest does not want the alternative, the host should cancel so the guest can get a full refund or find somewhere else

Airbnb also says:

- if the host can accommodate different dates or a different listing and the guest agrees, the host can send a trip change request

Important Drape takeaway:

- alternatives can be valid
- but they must be explicit and accepted
- customer refusal should not weaken refund rights when the original seller failed

## 3. Marketplace Pattern: Rebooking After Cancellation Is Usually A New Booking

Airbnb’s current help center says:

- canceled reservations cannot be restored
- the host can invite the guest to rebook
- the guest can book again or accept a special offer

Important Drape takeaway:

- once the original commitment is broken, the cleanest follow-on is often a new booking
- that keeps old failure and new promise separate

## 4. Marketplace Pattern: Seller-Led Exchange Or Replacement Still Needs Agreement

Etsy’s current help says:

- the seller is the best person to help with returns or exchanges
- if the seller agrees to a return or exchange, the details should be settled in messages first

Etsy’s seller guidance also says:

- if the seller enters a return agreement via messages or the case system, they must fulfill it
- that can include proof of shipping for a replacement item

Important Drape takeaway:

- replacements and exchanges should be explicit agreements
- once agreed, the seller/platform should actually fulfill them

## 5. Marketplace Pattern: “Similar” Does Not Mean “Silent Swap”

Airbnb’s rebooking help says it may help a guest find:

- a similar place
- depending on availability at comparable pricing

But the guest still chooses whether to rebook.

Etsy’s order-help docs say a buyer can seek help if the item:

- differs significantly from the description or photos

Important Drape takeaway:

- “similar” can be a recovery aid
- it should not become silent substitution

## 6. Custom-Clothing Pattern: Replacement Usually Means Remake, Not Random Substitute

Custom-clothing businesses like Proper Cloth and INDOCHINO typically handle seller-fault recovery through:

- alteration
- remake
- refund

not through “different product, close enough” logic.

Important Drape takeaway:

- for `CUSTOM`, replacement usually means remake of the intended garment
- it does not usually mean swapping to a loosely similar garment or fabric without clear customer approval

## 7. Ready-Made And Custom Need Different Substitute Logic

### `READY_MADE`

Reasonable possible alternative offers:

- different size
- different color
- similar item from the same seller

But only if the customer explicitly agrees.

### `CUSTOM`

Reasonable possible alternative offers:

- revised timeline
- remake
- fabric-direction alternative
- different handoff plan

But again, only if the customer explicitly agrees.

Important Drape takeaway:

- `READY_MADE` can support more retail-like exchange logic
- `CUSTOM` should stay promise-specific

## 8. Main Product Questions

## A. Should Drape auto-transfer an order to another tailor?

Likely answer:

- no, not in V1

Why:

- fit, trust, pricing, and measurement context are too specific
- the new tailor is not bound by the failed tailor’s promise

## B. Should Drape help the customer rebook elsewhere after seller failure?

Likely answer:

- yes, but lightly

Best V1 forms:

- suggest similar available tailors
- send the customer back to search or their saved shortlist
- ops concierge for urgent cases later

## C. Should the failed seller be allowed to offer a new path?

Likely answer:

- yes, but explicitly

Examples:

- different date
- remake
- alternative ready-made item

But if the customer says no:

- the seller-side failure should still be resolved fairly

## 9. Working Recommendation

The cleanest V1 posture is:

- no silent substitutions
- no cross-tailor order transfer
- same-seller alternative offers must be explicit
- customer can decline a substitute and still keep the original protection path when seller failure caused the problem
- rebooking to a different tailor should create a new order
- original failed order should be resolved on its own terms

## Sources

Official sources:

- [Airbnb: If your host offers you a different place to stay](https://www.airbnb.com/help/article/250)
- [Airbnb: If your host cancels your home reservation](https://www.airbnb.com/help/article/170)
- [Airbnb: Rebook a canceled home reservation](https://www.airbnb.com/help/article/2988)
- [Airbnb: Restore a canceled home reservation for a guest](https://www.airbnb.com/help/article/2989)
- [Airbnb: What happens to your guests if you have to cancel](https://www.airbnb.com/help/article/1360)
- [Etsy: How to Return or Exchange an Item on Etsy](https://help.etsy.com/hc/en-us/articles/115015440807-How-to-Return-or-Exchange-an-Item-on-Etsy)
- [Etsy: Refunds, Returns, and Exchanges for Sellers](https://help.etsy.com/hc/en-us/articles/360000572888-Refunds-Returns-and-Exchanges-for-Sellers)
- [Etsy: How to Cancel a Sale](https://help.etsy.com/hc/en-us/articles/115015587347-How-to-Cancel-a-Sale)
- [Proper Cloth Return Policy](https://propercloth.com/return-policy)
- [INDOCHINO: What is the Return Policy?](https://support.indochino.com/hc/en-us/articles/360034710293-What-is-the-Return-Policy)
