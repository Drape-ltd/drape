# Research Notes: Seller-Side Cancellation, Capacity Failure, And Overbooking

Date: April 2, 2026

## Why This Exists

Drape already has a clean seller decline path before commitment:

- a tailor can decline from `PENDING_QUOTE`
- a tailor can decline from `CONSULTATION`

But Drape still needs a much clearer policy for what happens when a tailor says yes and later cannot fulfill.

This note is the research layer for:

- seller-side cancellation after acceptance
- capacity failure
- overbooking
- stock-outs or sourcing failures after commitment

## High-Signal Takeaways

- Pre-commitment decline is normal marketplace behavior.
- Post-commitment seller cancellation is much more serious and should not be treated like an ordinary change request.
- Mature marketplaces strongly discourage the seller from pushing the customer to cancel on the seller’s behalf.
- Overbooking and capacity failure should usually count as seller fault unless the underlying cause clearly sits outside the seller’s control.
- Availability controls and inventory controls are prevention tools, not excuses after acceptance.
- The customer should not absorb the operational cost of seller-side overbooking.

## 1. What Drape Does Today

Current Drape seller-side behavior is actually pretty clean:

- tailor can `decline-order` only from:
  - `PENDING_QUOTE`
  - `CONSULTATION`
- tailor cannot currently self-cancel after payment / acceptance through the normal order action
- tailor can set availability:
  - `OPEN`
  - `LIMITED`
  - `FULLY_BOOKED`
- ready-made inventory logic is still intentionally lightweight

Important Drape inference:

The current backend already nudges us toward a good business rule:

- decline before commitment is allowed
- cancellation after commitment should be exceptional and more controlled

## 2. Marketplace Pattern: Decline Before Commitment Is Fine

Airbnb’s current request/booking help says:

- if a reservation request is declined or expires, no reservation is made
- the guest is free to book elsewhere

That is the clean marketplace pattern for unaccepted work.

Important Drape takeaway:

- before quote acceptance and payment, the tailor should be allowed to say no
- the customer should then move on cleanly without feeling wronged

## 3. Marketplace Pattern: Post-Commitment Host/Seller Cancellation Is A Bigger Deal

Airbnb’s current host-cancellation guidance says:

- if a host cancels, the guest gets a full refund
- guests may get rebooking help
- Airbnb may apply fees or other consequences to the host
- active or near-check-in cancellations are treated as especially serious

Important Drape takeaway:

- once the customer has committed, seller-side cancellation is not a routine admin action
- it is a trust and operations event

## 4. Marketplace Pattern: The Seller Should Not Ask The Customer To Cancel For Them

Airbnb’s current guest guidance says:

- if the host can’t accommodate the reservation, the guest should not cancel on the host’s behalf

That rule exists because cancellation responsibility matters for:

- refund rights
- platform accountability
- trust metrics

Important Drape takeaway:

- if the tailor can no longer fulfill, Drape should not push the customer into being the one who “cancels”
- the seller-side failure should be recorded as seller-side failure

## 5. Marketplace Pattern: Late Or Unresponsive Delivery Starts Favoring The Buyer Quickly

Fiverr’s current help center says:

- if a freelancer is late and no extension is agreed, the buyer can cancel after `24 hours`
- very late orders can be canceled without freelancer approval
- cancellation requests and resolution requests generally run on `48-hour` response windows
- canceled orders can still carry review consequences in some cases

Important Drape takeaway:

- silence or lateness after commitment should not leave the customer trapped
- Drape should shift toward customer-favoring outcomes when the seller misses the promised path and does not recover credibly

## 6. Marketplace Pattern: Seller Cancellation Usually Refunds The Customer Fully

Etsy’s current seller cancellation help says:

- only the seller can cancel a sale
- canceling a sale gives the buyer a full refund
- Etsy recommends messaging the buyer first

Important Drape takeaway:

- if Drape lets a seller-side cancellation happen after commitment, the default cash posture should be strongly customer-protective

## 7. Capacity Failure And Overbooking Are Usually Seller Fault

Examples:

- tailor accepted too many custom jobs
- tailor promised a deadline they could not realistically hit
- ready-made item was effectively oversold
- material was not actually secured before being promised

Important Drape takeaway:

- these are not neutral acts of fate
- these are operational failures unless strong evidence shows an external exceptional cause

## 8. External Causes Need A Narrow Exception Lane

Some seller-side failures do happen for reasons outside the tailor’s control.

Examples:

- sudden medical emergency
- disaster / severe disruption
- carrier or supplier breakdown that could not reasonably be predicted

Important Drape takeaway:

- Drape should allow a narrow exception posture
- but “I got too busy” or “I misjudged my workload” should not live in that same lane

## 9. Availability Is Preventive, Not Retroactive

Drape already lets a tailor mark themselves:

- `LIMITED`
- `FULLY_BOOKED`

This is good, but it only helps before new work is accepted.

Important Drape takeaway:

- once the order is accepted, later flipping availability should not erase responsibility for existing commitments

## 10. Ready-Made Oversell Is A Special Case Of Seller-Side Cancellation

For `READY_MADE`, a seller-side cancellation can happen because:

- quantity was wrong
- the item was simultaneously sold elsewhere
- stock status drifted from reality

Important Drape takeaway:

- oversell should usually be treated as seller-fault cancellation
- the customer should not have to fight for a clean refund if the item was never truly available

## 11. Main Product Question

Should Drape allow a simple tailor-side cancel button after acceptance?

### Option A: Yes, seller can cancel self-serve after acceptance

Pros:

- operationally easy

Cons:

- too easy to abuse
- weakens customer trust
- hides whether the issue was overbooking, sourcing failure, or ghosting

### Option B: No self-serve cancel after acceptance; route through support / ops

Pros:

- stronger accountability
- better audit trail
- cleaner customer protection

Cons:

- more ops involvement

Important Drape inference:

Option B is the better V1 posture.

## 12. Working Recommendation

The cleanest V1 posture is:

- before quote acceptance / payment:
  - tailor can decline cleanly
- after acceptance / payment:
  - tailor should not have a casual self-serve cancel path
  - seller-side inability to fulfill should route through support / ops
- seller should never ask the customer to cancel on the seller’s behalf
- overbooking, capacity failure, stock-outs, and avoidable sourcing failures should usually count as seller fault
- repeat cases should feed:
  - ranking loss
  - higher-risk restriction
  - trust review

## Sources

Official sources:

- [Airbnb: What happens if your home reservation request is declined or expires](https://www.airbnb.com/help/article/315)
- [Airbnb: If your host asks you to cancel](https://www.airbnb.com/help/article/1250)
- [Airbnb: If your host cancels your home reservation](https://www.airbnb.com/help/article/170)
- [Airbnb: Cancel a reservation as a host](https://www.airbnb.com/help/article/166)
- [Airbnb: What happens to your guests if you have to cancel](https://www.airbnb.com/help/article/1360)
- [Etsy: How to Cancel a Sale](https://help.etsy.com/hc/en-us/articles/115015587347-How-to-Cancel-a-Sale)
- [Etsy: How to Return or Exchange an Item on Etsy](https://help.etsy.com/hc/en-us/articles/115015440807-How-to-Return-or-Exchange-an-Item-on-Etsy)
- [Fiverr: Cancel an order with the Resolution Center](https://help.fiverr.com/hc/en-us/articles/4417622226833-Cancel-an-order-with-the-Resolution-Center)
- [Fiverr: Using the Resolution Center](https://help.fiverr.com/hc/en-us/articles/37552897293329-How-to-use-the-Resolution-Center)
- [Fiverr: The complete guide to your Fiverr order: Statuses and process](https://help.fiverr.com/hc/en-us/articles/37332473202065-The-complete-guide-to-your-Fiverr-order-Statuses-and-process)
- [Fiverr: Reviews for canceled orders](https://help.fiverr.com/hc/en-us/articles/17120664805521-Reviews-for-canceled-orders)
