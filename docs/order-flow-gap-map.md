# Drape Order Flow Gap Map

Date: April 25, 2026

## Purpose

This document is the practical gap map for Drape's two core order lanes:

- ready-made
- custom

It is meant to answer one question clearly:

What is already strong enough for launch, and what still needs tightening so real-world orders do not break?

Use this with:

- [order-flow-execution-checklist.md](/Users/onaopemipodimowo/drape/docs/order-flow-execution-checklist.md)
- [order-stage-playbook.md](/Users/onaopemipodimowo/drape/docs/order-stage-playbook.md)
- [checkout-and-fulfillment-flow.md](/Users/onaopemipodimowo/drape/docs/checkout-and-fulfillment-flow.md)
- [manual-qa-runbook.md](/Users/onaopemipodimowo/drape/docs/manual-qa-runbook.md)
- [order-automation-and-abuse-rules.md](/Users/onaopemipodimowo/drape/docs/order-automation-and-abuse-rules.md)
- [v1-launch-blockers.md](/Users/onaopemipodimowo/drape/docs/v1-launch-blockers.md)

## Current Product Decisions

These are the working fulfillment rules we have now:

- `Pickup` remains tailor-to-customer with Drape safeguards.
- Standard `Delivery` and `Shipping` are Drape-managed, not tailor-managed.
- Standard fulfillment fees are flat and paid upfront in the main checkout.
- Tailors do not need to arrange normal dispatch in-app.
- Tailors move the order to `Ready for Drape dispatch`.
- Drape ops moves the order forward from the internal ops surface.
- Exact-cost logistics should be treated as an exception path later, not the default path.

## Stage Truth

The launch stage definitions, next-actor rules, and entry or exit rules now live in:

- [order-stage-playbook.md](/Users/onaopemipodimowo/drape/docs/order-stage-playbook.md)

## Standard Fulfillment Fee Rules

Current rule set:

- Nigeria domestic: `₦10,000`
- Same-country domestic outside Nigeria: `$15` equivalent in checkout currency
- International: `$30` equivalent in checkout currency

Examples:

- Lagos seller to Lagos customer, paid in `USD`: charge the USD equivalent of `₦10,000`
- UK to UK: charge the checkout-currency equivalent of `$15`
- US to US: charge the checkout-currency equivalent of `$15`
- Canada to Canada: charge the checkout-currency equivalent of `$15`
- cross-border: charge the checkout-currency equivalent of `$30`

This should stay simple for launch.

## What Ready-Made Already Does Well

- Real inventory by size exists.
- Last-unit checkout protection exists.
- Seller draft vs live vs sold states are much cleaner than before.
- Seller live-publish preflight checks are much more honest.
- Drape-managed dispatch is clearer than the earlier tailor-managed courier flow.
- Customer order stages now read more like commerce, not custom tailoring leakage.
- Pickup privacy is stronger.
- Inquiry flow is cleaner than before and no longer behaves like a fake purchase on the customer side.
- Ops now has a dispatch queue on web for Drape-managed fulfillment.

## What Custom Already Does Well

- Brief flow is much stronger.
- Consultation path exists and is usable.
- Quote flow is much cleaner than it was.
- Guided fit and measurement context are stronger.
- Fabric-risk and pre-cutting safeguards are better than before.
- Pickup details and handoff support are much safer than earlier versions.
- Custom now shares more of the same fulfillment language as ready-made.

## Launch-Strong Ready-Made Path

The intended ready-made happy path now looks like this:

1. Customer opens item.
2. Customer selects size and fulfillment method.
3. Customer pays item plus standard fulfillment fee.
4. Order enters paid state.
5. Tailor marks `Preparing order`.
6. Tailor marks `Ready for Drape dispatch` or `Ready for collection`.
7. Drape ops marks `Out for delivery` or `Shipped` for standard non-pickup fulfillment.
8. Customer confirms receipt or collection.
9. Review and aftercare close the loop.

That is a good V1 path.

## Launch-Strong Custom Path

The intended custom happy path now looks like this:

1. Customer submits brief.
2. Tailor replies with quote or consultation.
3. Customer pays accepted quote.
4. Tailor works through production and fit checkpoints.
5. Tailor marks `Preparing order` near handoff.
6. Tailor marks `Ready for Drape dispatch` or `Ready for collection`.
7. Drape ops handles standard non-pickup dispatch.
8. Customer confirms receipt or collection.
9. Review and aftercare close the loop.

This is the right shape for V1.

## Critical Gaps Still Open Before Full Signoff

These are the real risks still worth treating as launch-sensitive.

### 1. Cancellation and refund policy is not fully productized

We still need a clean rule ladder for:

- customer cancellation before work starts
- tailor cancellation before work starts
- cancellation after `Preparing order`
- cancellation after a standard dispatch fee has been collected
- cancellation after Drape has already booked or arranged dispatch

Recommended ready-made rule:

- before `Preparing order`: customer can self-cancel inside a short window
- before `Preparing order`: tailor can cancel with a required reason
- after `Preparing order`: no silent self-serve cancel, route through Drape review
- after Drape dispatch has been arranged: support or dispute path only

Recommended custom rule:

- before quote payment: no refund issue, because payment has not completed
- after payment but before cutting or irreversible work: Drape-reviewed cancellation path
- after cutting or irreversible work: refund and resolution should follow a stricter ops policy

### 2. Dispatch SLA and extension logic

We now have a better state model, but we still need operational timers.

Examples:

- how long does a tailor have to move from `Preparing order` to `Ready for Drape dispatch`
- how long does Drape ops have to arrange dispatch after an order becomes dispatch-ready
- what happens if a tailor needs one extra day
- what happens if Drape ops cannot dispatch the same day

This should be defined before launch, even if the first version is manual.

### 3. Delivery failure and return scenarios

We still need a clear path for:

- missed delivery attempt
- customer not reachable
- wrong address
- return to sender
- package lost after dispatch
- delivered but customer says it did not arrive

These are where real e-commerce starts to get expensive.

### 4. Exchanges for ready-made

Ready-made usually needs a practical policy for:

- wrong size
- item not as expected
- wants exchange instead of refund

Even if V1 is manual, the policy should be written down and reflected in support flows.

We should also make the customer-facing rule much clearer before payment:

- whether the item is final sale
- whether exchange is allowed
- whether refund is allowed
- how long the customer has to report a problem

This should live at listing level too, not only inside support policy docs.

### 4a. Ops-managed fulfillment changes after payment

This should be tracked explicitly as a later fulfillment improvement.

Real-world example:

- the customer paid for shipping but now needs local delivery
- the customer paid for delivery but now wants shipping instead
- the customer needs a different recipient or address after payment
- the order is still pre-dispatch, but the fulfillment method needs to change

The cleaner Drape model is:

- customer raises `Need fulfillment change`
- Drape ops gathers the new fulfillment details
- ops reviews whether the change is still possible before dispatch starts
- ops applies the change once, and both customer and tailor see the updated fulfillment method and details

Recommended rule:

- allow this only before Drape dispatch is actually booked
- once the order is `Ready for Drape dispatch`, `Out for delivery`, or `Shipped`, it should stop being a self-serve customer action
- from that point onward it should stay an ops decision, not a customer-side editable setting

Questions we still need to answer:

- can ops switch between `LOCAL_DELIVERY` and `SHIPPING`
- can ops edit recipient name, phone, and address without reopening checkout
- when should a fulfillment change trigger an extra fee or refund
- how should both sides be notified when ops accepts or declines the change
- should the accepted change write a visible order-timeline note

### 5. Paid consultation as an optional custom-order path

This was not written clearly enough before and should be treated as a real custom-order gap.

In the real world, many tailors charge for consultation time:

- because it takes real time
- because it can involve styling, fit advice, and fabric discussion
- because the customer may decide not to proceed after the consultation

The cleaner Drape model is:

- consultation stays optional, not mandatory for every tailor
- a tailor can leave consultation free
- or a tailor can set a consultation fee
- if a paid consultation is requested, the customer should pay before the slot is confirmed
- the tailor should only be able to start the consultation call after payment is confirmed

The likely shape is:

1. Tailor requests consultation.
2. Customer sees whether it is free or paid.
3. If paid, customer pays the consultation fee.
4. Tailor and customer agree a time in chat.
5. Drape sends reminder timing and opens the call path when the session is due.
6. Tailor either sends a quote after the consultation or closes the thread without a paid order.

Questions we still need to answer:

- is the consultation fee kept separate from the later order total
- or can a tailor choose to credit it toward the final order
- what is the cancellation and no-show rule for paid consultations
- when does the consultation expire if the customer pays but nobody completes the call

This should be documented in ops rules and FAQs before launch if we decide to monetize consultation.

### 6. Bulk custom orders such as family or ashoebi orders

This is the second major custom-order gap that should be tracked explicitly.

Some real orders are not one garment for one person. They are:

- family occasion orders
- wedding-party orders
- ashoebi orders
- multiple looks for one event
- one buyer paying for several recipients

That creates real product questions:

- do we model one parent order with multiple recipients
- or multiple linked custom orders under one event
- how do we store measurements for several people cleanly
- how do we track status if one garment is delayed and another is ready
- how do we handle quote changes when the group size changes
- how does payment work if one person is paying for all looks
- how do we preserve fabric consistency or dye-lot consistency across the group
- how do we protect each recipient's measurements and fit notes if one payer is coordinating the whole order

For launch, this does not need a full bulk-order engine if ops is prepared.

But we should make one explicit temporary rule:

- if bulk custom is not productized yet, Drape should treat it as a managed special-case flow
- ops can either split it into linked orders or keep it under one manually supervised commercial flow

The important part is to not pretend ordinary one-person custom checkout already solves this.

### 7. Fabric sourcing and fabric handoff logistics

This is another major custom-order gap and it affects far more than native wear.

It applies to:

- dresses
- suits
- bridal
- occasionwear
- asoebi
- structured garments that need specific yardage or quality

The current product understands:

- `CUSTOMER_SUPPLIES`
- `TAILOR_SOURCES`

But the real-world logistics are still underspecified.

We still need clean rules for:

- how a tailor sources material
- when a customer approves the sourced material direction
- how customer-supplied fabric reaches the tailor
- what happens if the tailor rejects customer fabric
- what happens if the fabric quality is poor
- what happens if the fabric yardage is not enough
- what happens if the fabric quantity is technically enough on paper but not in one continuous usable piece
- what happens if the fabric usable width is wrong for the design
- what happens if the fabric must be prewashed, pressed, or stabilized before cutting
- what happens if the fabric arrives late or never arrives

The two key ideas that must stay separate are:

1. who sources the fabric
2. how the fabric reaches the tailor

Those are not the same operational risk.

Examples:

- customer supplies fabric and ships it
- customer supplies fabric and drops it off locally
- customer supplies fabric and tailor picks it up locally
- customer brings fabric to consultation
- tailor sources fabric and no customer handoff is needed

Recommended launch rule set:

- if `TAILOR_SOURCES`, the sourcing cost should be included in the quote and paid before the tailor is expected to buy fabric
- if `CUSTOMER_SUPPLIES`, the order should not move into real production until the tailor confirms fabric receipt
- local fabric handoff should be treated as valid, not forced into a shipping-only model
- Drape should not assume a tailor must work with customer fabric if the material is unsuitable

Clear real-world cases we need to support:

- tailor says the customer fabric is low quality
- tailor says the fabric composition or drape is wrong for the design
- tailor says the yardage is not enough
- tailor says the fabric is split across remnants and not usable for the planned cut
- tailor says the fabric width is too narrow for the agreed design
- customer and tailor disagree on whether the fabric matches what was discussed
- customer wants the tailor to source a replacement after the original customer fabric is rejected

The likely product rule is:

- tailor can reject customer-supplied fabric before cutting begins
- reason should be explicit
- customer then chooses one next step:
  - send more fabric
  - approve tailor-sourced replacement
  - change the design
  - cancel through Drape review

This area needs a dedicated ops rule and FAQ because these arguments are extremely common in real tailoring.

### 8. Multi-item and multi-tailor checkout

This is not implemented yet and should stay out of the launch-critical path until the single-order fulfillment model is stable.

The desired future shape:

- allow multiple ready-made items in one checkout
- support multiple items from one tailor
- support up to three tailors in one checkout
- group fulfillment fee logic correctly by tailor and delivery geography
- keep dispute and refund logic clear when only one line item in the checkout has a problem

Important:

- this is a strong next feature
- it should not block single-order launch readiness

### 9. Production-stage clarity and lane-specific arrangement

The current stage model is usable, but it still needs a cleaner product story.

The biggest question is not just what the stages are called. It is:

- when should each stage appear
- for which order type
- and what work is actually happening there

Current pressure point:

- `Designing` exists, but it is not always clear when design work belongs there versus earlier consultation or quote preparation

Recommended rule:

- pre-quote idea clarification belongs in `Messages` or `Consultation`
- post-payment `Designing` should only be used when real design or pattern work still needs to happen after acceptance
- not every custom order should pass through every production stage
- ready-made should never leak custom production language

The clean target shape is:

- `Consultation` if needed
- `Quote sent`
- `Confirmed`
- optional `Designing`
- optional `Sourcing`
- `Cutting`
- `Sewing`
- `Finishing`
- `Preparing order`
- `Ready for Drape dispatch` or `Ready for collection`
- `Out for delivery` or `Shipped`
- `Delivered` or `Collected`
- `Complete`

This needs a final product decision so customers and tailors always understand:

- what stage they are in
- who acts next
- whether the order is on time

### 10. Dispatch booking from ops is still basic

The current ops path is useful, but it is still a lightweight queue.

Later we will likely need:

- explicit dispatch booking records
- provider used
- booked at timestamp
- booked by ops user
- real cost vs standard fee
- delivery issue reason codes

### 11. Notification polish is still a launch-quality concern

We have fixed several routing issues already, but notifications still need final polish:

- push opens the right surface
- back navigation is stable after opening from notification
- stage updates feel clean
- call and handoff notifications feel deliberate, not accidental

### 12. Some CTA and navigation polish is still needed

This is not architecture, but it matters.

We should keep checking:

- stat cards are clickable when they imply an action
- back behavior returns to the right place
- no screen leaves the user stranded
- no order state disappears from the list that should visibly own it

## Things That Should Not Block Launch

These are good, but they are not the final reason Drape fails or succeeds in V1.

- deep courier integrations
- automatic carrier webhooks for every country
- rider assignment automation
- full multi-tailor cart
- live route tracking map
- automatic reverse logistics

They matter later, but the business can launch without them if ops is strong.

## Recommended Launch Operating Rules

### Ready-made

- Standard `Delivery` and `Shipping` are Drape-managed.
- Tailors do not promise their own courier dispatch inside the app for standard flows.
- Tailors only move to `Preparing order` and then `Ready for Drape dispatch`.
- Drape ops owns dispatch booking and movement to `Out for delivery` or `Shipped`.

### Custom

- Keep the same Drape-managed dispatch rule for standard `Delivery` and `Shipping`.
- Keep `Pickup` separate and privacy-safe.
- Do not allow dispatch states until the order is truly packed and handoff-ready.
- Keep consultation optional by default, but leave room for paid consultation as a seller-level choice later.
- Treat bulk family or ashoebi orders as a special managed case until the product supports multi-recipient custom work properly.
- Treat fabric sourcing and fabric handoff as a first-class operational path, not an informal side conversation.

### Premium or urgent fulfillment

The exact-cost workflow we built should not be thrown away.

It should become the premium or exception path later:

- urgent delivery
- same-day request
- oversized shipment
- special courier requirement
- non-standard destination

That is a better use of that complexity.

## Real-World Scenarios To Pressure-Test

### Ready-made

- buyer changes mind shortly after paying
- seller realizes the stock record was wrong
- item is damaged before dispatch
- Drape cannot dispatch same day
- buyer pays for delivery but later switches to pickup
- address entered is informal but still valid
- order is for another recipient
- recipient phone is different from buyer phone

### Custom

- buyer pays quote, then goes quiet
- tailor requests a paid consultation and the customer wants to reschedule
- customer pays for consultation but never proceeds with the order
- tailor uses `Designing` where the customer thought the creative work was already settled in consultation
- customer sees a stage name that does not explain what is actually happening next
- customer wants to bring their own fabric to consultation
- customer ships fabric but the tracking shows delivered and the tailor says nothing arrived
- tailor rejects the customer fabric because the quality or drape is wrong
- customer fabric is not enough for the agreed design
- tailor proposes sourcing a replacement fabric after seeing the customer material
- tailor needs more time before dispatch
- tailor finishes, but customer wants one more adjustment
- customer-supplied fabric is delayed
- final handoff is to another recipient
- buyer wants delivery after originally planning pickup
- one buyer wants outfits for several family members under one event
- one recipient is ready but another person in the same family order is still pending

### Cross-flow

- weak network during payment
- push notification opens the wrong nested screen
- order opened from dashboard behaves differently from order opened from messages
- ops advances dispatch but mobile list does not refresh cleanly
- refund decision must touch both item value and fulfillment fee

## What We Should Build Next

### First priority

- cancellation and refund rules
- dispatch SLA and extension rules
- Drape dispatch failure / missed delivery handling

### Second priority

- exchange policy for ready-made
- richer ops dispatch bookkeeping
- customer-facing delivery issue reporting that ties to ops queue

### Third priority

- multi-item checkout
- multi-tailor checkout
- premium or urgent fulfillment pricing path

## Final Recommendation

Ready-made is in a good place now.

The biggest thing missing is not another UI layer. It is operational clarity:

- who can cancel
- when they can cancel
- what gets refunded
- who owns dispatch next
- how long each side has
- what happens when normal delivery goes wrong

Custom should keep borrowing the same clarity.

If we lock those rules next, both core flows will feel much more trustworthy and much less fragile in the real world.
