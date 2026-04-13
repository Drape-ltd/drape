# Research Notes: Customer Concern Intake, Evidence, And Dispute Escalation

Date: April 2, 2026

## Why This Exists

Drape already lets a customer raise a concern from an order, and the system already pauses the order and opens a dispute record.

But the business logic is still not fully locked on:

- when a concern should be raised
- whether a concern is the same thing as a dispute
- what evidence should be gathered
- when payout should be blocked automatically
- when ops should refund, release, or ask for more information

This note is the research layer for that policy.

## High-Signal Takeaways

- Mature marketplaces usually distinguish between a first help request and a formal case or chargeback stage.
- They strongly encourage seller-buyer resolution first, but they also define a moment where platform review can begin.
- Good evidence policy starts before a processor dispute exists.
- Shipping status, timeline, listing/quote truth, and in-platform communication often decide more than long arguments do.
- Card and payment-provider dispute systems are unforgiving about time and evidence completeness.
- Because Drape handles custom work, payout should stay conservative when a real concern is opened.

## 1. What Drape Does Today

Today, the customer can raise a concern from the order screen.

Current behavior:

- customer picks a reason
- customer enters a description
- contact details are filtered out
- the order moves to `IN_DISPUTE`
- a row is inserted into `disputes`
- ops can later resolve to refund or release

This is already a reasonable V1 baseline.

## Current gap

The current intake is still thinner than the business logic around it:

- the mobile concern flow does not collect evidence files yet
- it does not ask what resolution the customer wants
- it does not distinguish light concern from severe trust/safety issue
- the dispute row has an `evidence_urls` field, but the current customer flow does not populate it

Important Drape inference:

The current product acts like a dispute system, but the intake still behaves more like a simple support form.

## 2. Marketplace Pattern: Help Request First, Case Second

Etsy’s current help flow is a strong pattern for early marketplace support:

- the buyer first contacts the seller through a help request
- the buyer can describe the issue, request a resolution, and provide images
- if the seller does not resolve it and the order is eligible, the buyer can open a case

Etsy’s current help docs say:

- most issues are resolved by working with the seller
- buyers can provide images in the help flow
- for physical items, a case generally opens only after both:
  - the estimated delivery date has passed
  - 48 hours have passed since the seller was contacted

Important Drape takeaway:

- concern intake and formal dispute are often separate moments
- the platform usually wants a first attempt at direct resolution

## 3. Marketplace Pattern: Case Outcomes Often Depend On Platform Data

Etsy’s current seller guidance says that for many cases:

- shipping status
- order eligibility state

are enough to decide the outcome

and if more information is needed, Etsy requests it through the case log.

Important Drape takeaway:

- not all cases should become free-form argument battles
- a lot of outcomes should come from:
  - stage history
  - payment truth
  - tracking / collection evidence
  - the order thread

## 4. Payment-Provider Pattern: Inquiry Stage Vs Formal Dispute

Stripe’s Klarna dispute docs show a useful pattern:

- inquiry disputes give early notice that a customer has an issue
- the merchant can resolve it before chargeback
- if the issue is ignored, it escalates
- funds are withheld once it becomes a chargeback dispute

The same docs also say Klarna does not accept evidence during the inquiry stage; evidence comes after escalation.

Important Drape takeaway:

- a concern can exist before a true payment dispute exists
- that first stage is still important because it pauses harm and creates a resolution path

## 5. Payment-Provider Pattern: Evidence Must Be Structured And Timely

Stripe’s current dispute docs emphasize:

- dispute deadlines are short
- merchants should keep a record of all customer communication
- there is only one evidence submission round in the standard flow
- evidence often includes:
  - shipping details
  - refund policy details
  - customer details
  - product details

Paystack’s current dispute docs emphasize:

- retrieve pending disputes
- retrieve relevant receipts and documents
- upload all relevant documents
- resolve quickly

Paystack currently says disputes should be handled within `16 hours`, or Paystack may auto-accept and trigger a refund from the merchant balance.

Important Drape takeaway:

- if Drape waits until an external payment dispute appears, it is already late
- Drape needs its own evidence trail before processor escalation

## 6. What Should Count As Evidence In Drape

For Drape, evidence should not mean just attachments.

Strong evidence can include:

- order stage history
- quote amount and quoted completion date
- shipping or delivery status
- collection code / handoff confirmation
- in-platform messages
- production photos or updates
- customer-submitted photos
- tailor-submitted explanations
- sourcing or fabric receipts where relevant
- refund records or payment state

Important Drape takeaway:

- the order object itself is part of the evidence packet
- Drape should not rely only on whatever the customer remembers to upload

## 7. Concern Reasons Should Be Narrower Than “Something Went Wrong”

Etsy limits cases to specific reason buckets like:

- non-delivery
- not as described
- damaged
- significantly late arrival

This is useful because it shapes the evidence needed.

For Drape, likely V1 concern buckets should stay fairly small, such as:

- `NOT_RECEIVED`
- `NOT_AS_DESCRIBED`
- `DAMAGED`
- `FIT_OR_MEASUREMENT_ISSUE`
- `TAILOR_UNRESPONSIVE`
- `WRONG_ITEM`
- `OFF_PLATFORM_OR_TRUST_ISSUE`
- `OTHER`

Important Drape takeaway:

- reason categories should help ops know what evidence to look for
- not every concern needs the same packet

## 8. Concern Timing Matters

Marketplaces often tie concern timing to the delivery window and completion window.

Drape already has a useful default in local docs:

- self-serve concern should be raised before auto-complete cutoff
- after auto-complete, it becomes support/manual review only

Important Drape takeaway:

- Drape should keep a clear self-serve window
- but it should still preserve a manual support path for edge cases or latent defects

## 9. Not Every Concern Needs The Same Operational Response

Examples:

### A. Late or missing delivery

Main evidence:

- tracking
- carrier status
- delivery estimate
- fulfillment timeline

### B. Wrong item / not as described / damaged

Main evidence:

- customer photos
- listing / quote expectation
- packaging and handoff evidence
- order photos or stage updates

### C. Fit issue

Main evidence:

- measurement source
- customer photos if the customer is comfortable
- tailor notes
- whether the issue is alterable or remake-level

### D. Tailor unresponsive

Main evidence:

- in-platform message history
- missed deadlines
- lack of stage progress

### E. Off-platform pressure or harassment

Main evidence:

- in-app messages
- screenshots if the pressure moved elsewhere
- contact-bypass flags

Important Drape takeaway:

- the same intake form should not ask for the exact same evidence every time

## 10. The Main Product Question

Should every Drape concern immediately become a formal payout-blocking dispute?

### Option A: Yes, every concern becomes a full dispute immediately

Pros:

- simple
- conservative for payout
- strong early protection

Cons:

- may over-escalate softer issues
- can create more ops load
- may make normal fixable problems feel too adversarial

### Option B: Help request first, dispute later

Pros:

- closer to Etsy’s case logic
- softer customer experience

Cons:

- more product complexity
- more chance of payout timing bugs during early launch
- more state management immediately

### Option C: Keep the customer-facing word “concern,” but treat it as a payout-blocking internal dispute in V1

Pros:

- simpler than a full two-stage product
- still uses friendlier language in the app
- safer for early payout control

Cons:

- internal naming and public language stay slightly asymmetric

Important Drape inference:

Option C is probably the cleanest V1 posture.

## 11. Recommended V1 Concern Packet

For Drape V1, the cleanest minimum concern packet would be:

- structured reason
- free-text description
- optional desired resolution
- optional evidence upload
- automatic inclusion of:
  - order timeline
  - messages
  - fulfillment state
  - payment state

And then a stage-aware prompt for what else helps:

- photos for damaged / wrong item / not as described
- tracking or handoff details for non-delivery
- measurement / fit notes for fit issues

## 12. Recommended V1 Ops Behavior

The best V1 operating posture looks like:

- concern opens
- payout stays blocked
- auto-release pauses
- seller is notified
- ops can mark:
  - open
  - under review
  - resolved with refund
  - resolved with release

And if more information is needed:

- ops asks for it in the order-support thread or a dedicated review note later

## Working Recommendation

The best V1 concern policy is:

- keep the customer-facing language as `concern`
- keep the internal record as a `dispute`
- let active-order concerns pause payout immediately
- do not wait for an external payment dispute
- gather structured evidence early
- rely heavily on order truth, not just attachments

## Sources

Official sources:

- [Etsy: How to Get Help with an Order](https://help.etsy.com/hc/en-us/articles/4402660818583-How-to-Get-Help-with-An-Order)
- [Etsy: How to Open a Case](https://help.etsy.com/hc/en-us/articles/5745586898199-How-to-Open-a-Case)
- [Etsy: How to Resolve a Case from a Buyer](https://help.etsy.com/hc/en-us/articles/360016126873-How-to-Resolve-a-Case-from-a-Buyer)
- [Etsy: Purchase Protection for Sellers](https://help.etsy.com/hc/en-us/articles/5850122619287-What-is-Etsy-s-Purchase-Protection-for-Sellers)
- [Stripe: Respond to disputes](https://docs.stripe.com/disputes/responding)
- [Stripe: Klarna disputes](https://docs.stripe.com/payments/klarna/disputes)
- [Stripe Connect: Handle refunds and disputes](https://docs.stripe.com/connect/saas/tasks/refunds-disputes?locale=en-GB)
- [Paystack: Manage disputes](https://paystack.com/docs/payments/manage-disputes/)
- [Paystack: Dispute API](https://paystack.com/docs/api/dispute/)
