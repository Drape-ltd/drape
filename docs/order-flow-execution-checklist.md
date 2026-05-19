# Drape Order Flow Execution Checklist

Date: April 25, 2026

## Purpose

This is the operational checklist version of Drape's order-flow gap work.

It exists so the team can move through the product from A to Z without drifting,
forgetting edge cases, or mixing "nice to have" work with flow-critical work.

Use this with:

- [order-flow-gap-map.md](/Users/onaopemipodimowo/drape/docs/order-flow-gap-map.md)
- [order-stage-playbook.md](/Users/onaopemipodimowo/drape/docs/order-stage-playbook.md)
- [order-flow-internet-research-2026-04-25.md](/Users/onaopemipodimowo/drape/docs/order-flow-internet-research-2026-04-25.md)
- [order-flow-research-brief.md](/Users/onaopemipodimowo/drape/docs/order-flow-research-brief.md)
- [ops-order-runbook.md](/Users/onaopemipodimowo/drape/docs/ops-order-runbook.md)
- [customer-order-faq.md](/Users/onaopemipodimowo/drape/docs/customer-order-faq.md)
- [tailor-order-faq.md](/Users/onaopemipodimowo/drape/docs/tailor-order-faq.md)

## How To Use This Checklist

- Treat each checkbox as one real decision, implementation, or signoff item.
- Do not mark a box complete unless product, ops, and UX all agree on the behavior.
- If an item is intentionally deferred, note the temporary ops rule in the runbook.
- Keep the checklist ordered. Do not jump to later polish while earlier business logic is still unclear.
- Passing Sections `A` through `P` should mean the core Drape order flow is production-ready.
- Section `Q` exists so high-value expansion work stays visible without confusing it with the core launch gate.

## A. Cross-Flow Foundations

- [x] Finalize stage naming for ready-made so it always reads like commerce, not custom tailoring.
- [x] Finalize stage naming for custom so `Consultation`, `Designing`, `Sourcing`, `Cutting`, `Sewing`, and `Finishing` only appear when they reflect real work.
- [x] Define who acts next at every visible stage for both ready-made and custom.
- [x] Define which stages belong in `Active` vs `Completed` across both buyer and tailor views.
- [x] Define the exact entry and exit rule for `Preparing order`.
- [x] Define the exact entry and exit rule for `Ready for Drape dispatch`.
- [x] Define the exact entry and exit rule for `Ready for collection`.
- [x] Define the exact entry and exit rule for `Out for delivery`.
- [x] Define the exact entry and exit rule for `Shipped`.
- [x] Define the exact entry and exit rule for `Delivered`, `Collected`, and `Complete`.
- [x] Confirm that notification copy, list labels, and detail-screen labels use the same stage language everywhere.
- [x] Confirm that dashboard counts, tab badges, list filters, and detail screens all count the same underlying order states.
- [x] Confirm that every dashboard tile or CTA that looks clickable is actually clickable.
- [x] Confirm that back navigation returns to the right place for orders, notifications, profile, portfolio, and payout surfaces.

## B. Ready-Made Listing and Discovery

- [x] Confirm ready-made listing quality gates for title, price, category, size, photo, stock, and description.
- [x] Confirm sellers can save incomplete drafts without confusion.
- [x] Confirm drafts can be edited safely.
- [x] Confirm drafts with no order history can be deleted.
- [x] Confirm items with order history cannot be hard-deleted and instead stay archived or draft-safe.
- [x] Confirm sold-out items do not leak as buyable to customers.
- [x] Confirm draft items do not appear live to customers.
- [x] Add listing-level visibility for return policy.
- [x] Add listing-level visibility for exchange policy.
- [x] Add listing-level visibility for final-sale posture if applicable.
- [x] Confirm portfolio count and portfolio preview are truthful on customer-facing tailor pages.
- [x] Show saved ready-made inventory cues in wishlists, including `Only 1 left`, low-stock counts, sold-out state, and no-longer-available state.

## C. Ready-Made Pre-Purchase Inquiry

- [x] Keep pre-purchase ready-made questions as inquiry-only, not pseudo-orders.
- [x] Keep inquiry threads visible in Messages without polluting customer Orders.
- [x] Decide whether tailor-side inquiries should stay in Orders or move into a separate inquiry inbox later.
- [x] Confirm stale inquiry rows disappear once a real purchase exists for the same customer and item.
- [x] Confirm inquiry labels never say `Pending Quote` if the flow is really just a product question.

## D. Ready-Made Checkout

- [x] Confirm size-level inventory is enforced at checkout.
- [x] Confirm last-unit checkout protection works.
- [x] Confirm one-unit purchases route cleanly after payment without a harsh `Item unavailable` flash.
- [x] Confirm recipient details are supported when someone else is receiving the order.
- [x] Confirm phone-number entry always includes country context or formatting clarity.
- [x] Confirm address entry supports both autocomplete and structured manual entry.
- [x] Confirm address handling works for African and non-African addresses without requiring unrealistic Western assumptions.
- [x] Confirm standard Drape-managed fulfillment fee rules work by geography and currency.
- [x] Confirm Lagos-to-Lagos and other Nigeria domestic orders reflect the `₦10,000` standard fee or equivalent.
- [x] Confirm UK, US, and Canada domestic orders reflect the standard `$15` equivalent fee.
- [x] Confirm international orders reflect the standard `$30` equivalent fee.
- [x] Confirm same-country and international logic uses both seller location and destination properly.

## E. Ready-Made Fulfillment

- [x] Confirm `Pickup` stays peer-to-peer with Drape safeguards.
- [x] Confirm standard `Delivery` and `Shipping` are Drape-managed by default.
- [x] Confirm tailor flow is simplified to `Preparing order` then `Ready for Drape dispatch` for standard dispatch.
- [x] Confirm Drape ops can move dispatch-ready orders to `Out for delivery` or `Shipped`.
- [x] Confirm customers only see exact pickup address at the correct handoff stage.
- [x] Confirm pickup help, handoff help, and support escalation are available when pickup fails.
- [x] Confirm delivery or shipping proof expectations are clear in the ops runbook.
- [x] Define what counts as `dispatch booked`.
- [x] Define what counts as `delivered` vs `completed`.
- [x] Define when auto-release or settlement logic should run after handoff.

## F. Ready-Made Cancellation, Refund, Exchange, and Failure Handling

- [x] Define customer cancellation window before `Preparing order`.
- [x] Define tailor cancellation behavior before `Preparing order`.
- [x] Define what happens if the item becomes unavailable after payment because stock was wrong.
- [x] Define what happens if the item is damaged before dispatch.
- [x] Define what happens if the buyer changes fulfillment method after payment.
- [x] Define whether `Need fulfillment change` is an ops-managed review lane only.
- [x] Define until which stage ops can still change `Pickup`, `Delivery`, or `Shipping`.
- [x] Define whether recipient name, phone, and address can be changed without reopening checkout.
- [x] Define whether a fulfillment-method change can trigger an extra charge or refund.
- [x] Define how both customer and tailor are notified when ops approves or declines a fulfillment change.
- [x] Define what happens if Drape cannot dispatch on time.
- [x] Define what happens if delivery fails.
- [x] Define what happens if the package is returned to sender.
- [x] Define what happens if tracking says delivered but the customer says it did not arrive.
- [x] Define when ready-made exchange is allowed.
- [x] Define when ready-made refund is allowed.
- [x] Make the ready-made remedy rules visible before checkout, not only in support.

## G. Custom Pre-Quote and Consultation

- [x] Confirm the default custom path works with no consultation required.
- [x] Finalize whether consultations can be free, paid, or both.
- [x] If paid consultation is supported, define whether the fee is creditable toward the final order.
- [x] Define consultation payment timing.
- [x] Define consultation reschedule policy.
- [x] Define consultation no-show policy.
- [x] Define consultation expiry policy if the customer pays but does not proceed.
- [x] Define how a tailor requests consultation in chat.
- [x] Define how a customer requests consultation from a tailor before committing to a quote.
- [x] Define how the customer sees the consultation fee and terms before paying.
- [x] Define how either side starts the consultation only after payment confirmation and schedule gating.
- [x] Define consultation double-booking protection.
  - 2026-05-09: Confirmed consultation slots are stored in `consultation_bookings` with a no-overlap constraint per tailor. Customer requests preflight the time, while tailor scheduling/approval reserves it atomically and returns a clear “time taken” message if another order wins the slot.
- [x] Define whether Drape should send reminders for booked consultations.
  - 2026-05-09: Consultation reminders are in launch scope. A scheduled function checks every 5 minutes and sends 30-minute and 5-minute reminders to both customer and tailor for scheduled, paid-if-needed consultations.
- [x] Define what happens after the consultation slot if no quote or decline follows.
  - 2026-05-09: The consultation scheduler now follows up after the slot, creates an ops review, emails/pushes both parties, and returns unresolved consultation orders to quote review after 24 hours so the tailor must quote, reschedule, or decline.

## H. Custom Quote and Acceptance

- [x] Confirm quote flow clearly separates commercial negotiation from production stages.
- [x] Confirm quote breakdown can explain labor, sourcing, rush, and fulfillment components clearly.
- [x] Confirm customers understand what is included and not included before payment.
- [x] Confirm quote acceptance leads into the right production stage instead of vague status language.

## I. Fabric Sourcing and Fabric Handoff

- [x] Finalize the rule set for `TAILOR_SOURCES`.
- [x] Finalize the rule set for `CUSTOMER_SUPPLIES`.
- [ ] Define acceptable fabric handoff modes:
  - [x] shipped by customer
  - [x] local dropoff
  - [x] local pickup
  - [x] brought to consultation
- [x] Define when customer approval is needed for tailor-sourced fabric.
- [x] Define when fabric receipt must be confirmed before production can advance.
- [x] Define explicit reasons a tailor can reject customer-supplied fabric before cutting.
- [x] Add policy language for poor quality, wrong drape, wrong composition, and insufficient quantity.
- [x] Add policy language for non-continuous remnants and unusable width.
- [x] Add policy language for fabric prep requirements such as prewash, pressing, or stabilization.
- [x] Define what happens when the fabric is late.
- [x] Define what happens when the fabric never arrives.
- [x] Define what happens when the tailor wants to source replacement fabric after rejecting customer material.
- [x] Define what happens when the customer disagrees with the fabric rejection.

## J. Bulk Custom Orders

- [x] Decide whether V1 bulk custom stays an ops-managed special case.
- [x] Define whether bulk custom uses one parent order or linked child orders operationally.
- [ ] Define how measurements are collected for multiple recipients.
- [x] Define how measurement privacy is protected when one payer coordinates several people.
- [x] Define how payment works when one person pays for all garments.
- [x] Define how status works when one recipient is ready and another is delayed.
- [x] Define how fabric consistency and dye-lot consistency are managed across the group.
- [ ] Define how quote changes work if the group grows or shrinks.

## K. Dispatch and Ops Ownership

- [x] Confirm Drape ops is the owner of standard delivery and shipping after the tailor marks `Ready for Drape dispatch`.
- [x] Confirm ops has a usable queue for dispatch-ready orders.
- [x] Confirm ops can see the customer destination clearly enough to book dispatch correctly.
- [x] Confirm ops can see the tailor origin clearly enough to book dispatch correctly.
- [ ] Decide whether ops needs a richer dispatch record:
  - [x] provider used
  - [x] booked by
  - [x] booked at
  - [ ] actual cost
  - [x] service level
  - [ ] failure reason
- [x] Define when a standard flat-fee order becomes a premium or exception dispatch case.
- [x] Define how urgent or rush fulfillment should be quoted and approved.

## L. Cancellation, Refund, and Escrow Rules

- [x] Define a stage-based cancellation policy for ready-made.
- [x] Define a stage-based cancellation policy for custom.
- [x] Define when customer self-cancel is allowed.
- [x] Define when tailor-initiated cancel is allowed.
- [x] Define when Drape review is required.
- [x] Define what part of the money is refundable at each stage:
  - [x] item or quote amount
  - [x] consultation fee
  - [x] standard fulfillment fee
  - [x] rush or premium logistics fee
- [x] Define how refund math works when ops approves a post-payment fulfillment-method change instead of a full cancellation.
- [x] Define what happens if dispatch has already been booked.
- [x] Define what happens if irreversible custom work has started.
- [x] Confirm escrow and payout rules align with the actual ops reality of delivery and shipping.
  - 2026-05-09: Funds stay in Stripe/Paystack until `release-order-payouts`; release now blocks `IN_DISPUTE`, requires customer handoff confirmation, waits 72 hours, checks open disputes, checks a settled payment, and records/alerts provider payout failures for manual ops retry.

## M. Notifications, Communication, and Handoff Support

- [x] Confirm notifications route to the correct surface for both customer and tailor.
- [x] Confirm back from a notification-opened screen returns somewhere sensible.
- [x] Confirm call or handoff notifications are deliberate and not confusing.
- [x] Confirm both sides know when the other is trying to reach them for live handoff help.
- [x] Confirm support escalation paths exist for pickup failure, dispatch delay, and delivery failure.

## N. Admin, FAQ, and Ops Documentation

- [x] Keep the ops runbook aligned with the actual product rules.
- [x] Keep customer FAQ aligned with the actual product rules.
- [x] Keep tailor FAQ aligned with the actual product rules.
- [x] Add customer FAQ entries for cancellation, dispatch ownership, and delivery failure.
- [x] Add tailor FAQ entries for consultation fees, fabric rejection, and Drape-managed dispatch.
- [x] Add ops answers for exceptions, urgent fulfillment, and special-case routing.

## O. Multi-Item and Multi-Tailor Checkout

- [x] Finish the standard single-order dispatch model before touching multi-checkout.
- [ ] Define the maximum number of tailors in one checkout.
- [ ] Define whether multiple items from one tailor share one fulfillment fee or not.
- [ ] Define how mixed-tailor checkout groups fees by tailor and geography.
- [ ] Define line-item dispute handling before the feature is built.
- [ ] Define line-item refund handling before the feature is built.
- [ ] Define how failed stock on one line item affects the rest of the checkout.

## P. Launch Signoff

- [x] CODE COVERED — Ready-made happy path is clean from discovery to review.
  - 2026-05-09: Code path covers discovery, item detail, checkout acknowledgement, payment confirmation, order tracking, delivery/collection, review, stock handling, and payout ledger gating. Final release-device proof remains explicitly excluded from this autonomous session.
- [x] CODE COVERED — Custom happy path is clean from brief to review.
  - 2026-05-09: Code path covers brief, consultation, quote, accept/pay, production updates, required evidence, handoff, completion, review, and payout gating. Final release-device proof remains explicitly excluded from this autonomous session.
- [x] DONE — Paid consultation policy is launched clearly.
  - Consultation can be free or paid, paid consultation terms are stored in order support metadata, payment can be required before call start, consultation fee creditability is visible before the customer proceeds, and either customer or tailor can initiate. Customer requests require tailor approval, pricing, and scheduling before payment/call start.
- [x] DONE — Fabric sourcing and fabric rejection rules are documented clearly.
  - V1 supports tailor-sourced fabric approval, customer-supplied fabric handoff modes, explicit rejection reasons, and material/support escalation paths.
- [x] DONE — Bulk custom is intentionally handled as an ops-managed path.
  - V1 does not ship a full group-order engine; bulk custom remains a single-order, ops-assisted special case until the expansion model is designed.
- [x] DONE — Dispatch ownership is unambiguous to customer, tailor, and ops.
  - Standard delivery/shipping is Drape-managed after the tailor marks ready for dispatch; pickup remains peer-to-peer with Drape handoff support.
- [x] DONE — Cancellation and refund rules are written, implemented, and supportable.
  - 2026-05-09: Custom order submission and ready-made checkout both require cancellation policy acknowledgement. The server rejects missing acknowledgement and stores policy version, timestamp, and acknowledging user in order support metadata.
- [x] DONE WITH V1 LIMITS — Exchange and delivery-failure handling are written, implemented, and supportable.
  - V1 supports delivery/dispatch review and ready-made remedy review. Full reverse-logistics automation is deferred to the expansion backlog, not hidden as launch scope.
- [x] DONE — FAQ and runbook language matches the real product behavior.
  - 2026-05-09: Consultation, payment-failure, production-stall, dispatch, delivery review, and aftercare behavior are now documented against the implemented automation. Future wording changes should follow product changes, not block launch code signoff.
- [x] CODE COVERED — Dashboard counts, notifications, stages, and navigation all feel trustworthy.
  - 2026-05-09: Focus refetch, order notifications, customer message unread badge, realtime read receipts, stage labels, and key stale-state protections are implemented. Final Android/iOS release-device navigation proof remains explicitly excluded from this autonomous session.

## Q. Advanced Expansion Coverage

These do not need to block the core production-ready signoff above, but they should be clearly mapped so the team does not lose them.

### Reverse logistics

- [ ] Define when Drape should support returns-to-tailor vs returns-to-Drape.
- [ ] Define who pays return shipping for seller fault, buyer remorse, exchange, and failed delivery cases.
- [ ] Define how reverse-logistics status should appear in the order timeline.
- [ ] Define when reverse logistics should trigger inspection before refund or exchange is approved.
- [ ] Define how return-to-sender and true customer-initiated returns differ operationally.

### Full group-order engine for custom

- [ ] Decide whether a true parent-order plus child-order model is needed.
- [ ] Define recipient-level measurement capture, fit notes, and garment tracking.
- [ ] Define group-wide fabric or dye-lot controls.
- [ ] Define partial readiness when one recipient is ready and another is delayed.
- [ ] Define group-level billing vs recipient-level billing.
- [ ] Define how one coordinator can manage the order without exposing every recipient's private data unnecessarily.

### Full multi-tailor checkout

- [ ] Define the exact cart model when one customer buys from multiple tailors at once.
- [ ] Define how fulfillment fees are grouped by tailor and geography.
- [ ] Define how one failed line item affects the rest of the checkout.
- [ ] Define how one tailor cancellation affects the rest of a multi-tailor basket.
- [ ] Define how refunds, disputes, and support cases stay line-level instead of becoming one giant mess.
- [ ] Define how ops views and settles mixed-tailor orders cleanly.

### Advanced premium dispatch marketplace logic

- [ ] Define when urgent or premium fulfillment becomes a customer-facing option.
- [ ] Define whether Drape sets the premium fee or whether ops quotes it case by case.
- [ ] Define how same-day, rush, oversized, and special-handling requests differ.
- [ ] Define how premium dispatch interacts with standard flat-fee shipping and delivery.
- [ ] Define what guarantees, if any, Drape is actually making for premium dispatch.
- [ ] Define what happens if a premium dispatch promise fails.

### Other later infrastructure

- [ ] Deep carrier integrations
- [ ] live route tracking maps

These are strong later moves, but they should not distract the team from finishing the core order truth first.
