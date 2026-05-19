# Drape Order Automation And Abuse Rules

## Goal

Define the time-based business logic and guardrails that keep Drape fair,
predictable, and hard to abuse across:

- custom orders
- ready-made inquiries
- ready-made checkout
- consultation flows
- messaging
- disputes

This is the operational layer that sits on top of the current order machine.

## Core Principle

Every open state should answer three questions:

1. Who needs to act next?
2. How long do they have?
3. What happens automatically if they do nothing?

If the app cannot answer those clearly, it will feel loose and people will
abuse the gaps.

## Recommended V1 Defaults To Review This Week

These are the defaults worth pressure-testing with product and ops before we
lock implementation:

- custom brief first response target: `24 hours`
- consultation resolution target: `24 hours`
- quote validity window: `48 hours`
- custom payment checkout timeout: `30 minutes`
- ready-made checkout timeout: `30 minutes`
- failed-payment retry window before auto-cancel: `2 hours`
- delivered / collected review window: `7 days`
- ready-made per-checkout quantity cap before full inventory exists: `3`
- consultation no-show grace period before follow-up: `10 minutes`

## 1. Customer Brief Sent, Tailor Has Not Responded

### State

- `PENDING_QUOTE`
- applies to custom orders

### Rule

- tailor should respond within `24 hours`

### System Behavior

- at `12 hours`
  - send reminder to tailor
- at `24 hours`
  - send final reminder to tailor
  - tell customer response is delayed
- at `48 hours`
  - auto-expire if still untouched
  - set order to `EXPIRED`
  - reopen customer path to browse other sellers

### Why

- prevents briefs from sitting forever
- protects customer trust
- forces seller responsiveness to matter

## 2. Consultation Requested, But Nothing Happens

### State

- `CONSULTATION`
- applies to either:
  - customer-requested consultation waiting on tailor approval
  - scheduled consultation waiting on the call, quote, or decline

### Rule

- customer-requested consultation should be approved/declined within `24 hours`
- scheduled consultation should move to quote or decline within `24 hours` after the scheduled slot

### System Behavior

- at `12 hours`
  - if customer-requested and not approved, remind tailor to approve, price, schedule, or decline
  - if already scheduled and the slot has passed, remind tailor to send quote or decline
- at `24 hours`
  - remind both parties that the consultation is still open
- at `48 hours`
  - auto-expire consultation if no quote is sent
  - return order to quote review with consultation metadata marked expired
- 2026-05-09 implementation note:
  - scheduled reminder automation now also handles the post-slot loop
  - customer-requested consultations get follow-up and expiry handling
  - unresolved scheduled consultations create an ops review, send push + email to both parties, and return to quote review after the consultation window

### Why

- consultation should not become a hiding place for non-response

## 3. Quote Sent, Customer Does Nothing

### State

- `QUOTE_SENT`

### Rule

- quote stays valid for `48 hours`

### System Behavior

- at `24 hours`
  - remind customer quote is waiting
- at `42 hours`
  - send final reminder that quote will expire soon
- at `48 hours`
  - auto-expire
  - set order to `EXPIRED`
  - notify tailor and customer

### Recommended Guardrail

- tailor can replace an open quote before acceptance, but the system should keep
  only one active quote snapshot per order
- do not allow silent quote edits after payment has started

### Current Status

- there is already an `expire-quotes` function in:
  - [expire-quotes/index.ts](/Users/onaopemipodimowo/drape/packages/db/supabase/functions/expire-quotes/index.ts)
- this should be moved into active Supabase deployment/runtime and scheduled properly

## 4. Custom Quote Accepted, But Payment Is Not Finished

### Planned State

- `PAYMENT_PENDING`
- applies to custom orders once online payment is active

### Current Status

- Stripe sandbox is now wired through quote acceptance
- customer flow now moves through:
  - `QUOTE_SENT`
  - `PAYMENT_PENDING`
  - `CONFIRMED` after server-side confirmation
- `stripe-webhook` exists for payment confirmation and failure visibility
- abandoned payment windows now have a deployed timeout worker:
  - `expire-pending-payments`

### Rule

- customer should finish payment within `30 minutes`

### System Behavior

- when customer taps accept quote
  - create exactly one open payment session for that order
  - move order into `PAYMENT_PENDING`
- at `15 minutes`
  - remind customer payment is still incomplete
- at `30 minutes`
  - expire the payment session
  - if quote validity is still open, move order back to `QUOTE_SENT`
  - if the quote validity window has already ended, move order to `EXPIRED`

### Guardrails

- do not allow multiple open payment sessions for one order
- do not move to `CONFIRMED` until payment succeeds server-side
- if payment succeeds but order update fails, route to ops/manual-recovery queue
  instead of leaving the order invisible

### Why

- avoids duplicate charges
- avoids fake acceptance without payment
- gives customers a clean retry path

## 5. Ready-Made Inquiry, Seller Does Not Reply

### State

- `READY_MADE` order in `PENDING_QUOTE`
- this is really an inquiry, not a quote request

### Rule

- seller should respond within `24 hours`

### System Behavior

- at `12 hours`
  - remind seller
- at `24 hours`
  - tell customer the seller is delayed
- at `48 hours`
  - auto-expire inquiry
  - set order to `EXPIRED`

### Why

- shop messaging cannot be a dead-end

## 6. Ready-Made Checkout Started, Payment Not Finished

### State

- `READY_MADE` order in `PAYMENT_PENDING`

### Rule

- checkout should complete within `30 minutes`

### System Behavior

- if payment session is abandoned
  - auto-cancel or auto-expire checkout after `30 minutes`
- inventory should not stay blocked forever

### Recommendation

- use a dedicated payment/session expiry timestamp
- do not keep `PAYMENT_PENDING` open indefinitely
- if a temporary quantity hold exists, release it immediately when the payment
  window expires

### Current Status

- server-side duplicate checkout protection already exists
- abandoned ready-made `PAYMENT_PENDING` orders now expire through the same
  `expire-pending-payments` worker
- quantity is still guarded, but true numeric inventory / hold release is still
  the next implementation layer

## 7. Ready-Made Quantity And Stock Rules

### Goal

Keep V1 simple without pretending inventory is more mature than it is.

### V1 Recommendation

- every live ready-made item should have either:
  - a simple `available_quantity`
  - or a strict operational stock bucket that still resolves to a numeric limit
- until a richer inventory model exists:
  - max quantity per checkout should default to `3`
  - seller can lower availability per item

### System Behavior

- before checkout:
  - validate requested quantity against current available quantity
- when payment starts:
  - create a temporary hold or soft reservation
- when payment succeeds:
  - decrement available quantity atomically server-side
- when payment fails or expires:
  - release the held quantity

### Guardrails

- if two buyers race for the last units, server-side validation decides the winner
- never partially charge without explicit customer confirmation
- if quantity becomes unavailable mid-checkout, fail clearly and tell the buyer to
  re-open the item

### Why

- this is the fastest way to avoid overselling before a full inventory engine exists

## 8. Seller Accepts Work Beyond Customer Deadline

### Current Status

- already enforced in:
  - [tailor-order-action/index.ts](/Users/onaopemipodimowo/drape/supabase/functions/tailor-order-action/index.ts)
  - [orders/[id].tsx](/Users/onaopemipodimowo/drape/apps/mobile/app/(tailor)/orders/[id].tsx)

### Rule

- quoted completion date cannot be later than customer deadline

### Keep

- this should remain a hard server-side rule

## 9. Production Stalls After Quote Acceptance

### States

- `CONFIRMED`
- `DESIGNING`
- `SOURCING`
- `CUTTING`
- `SEWING`
- `FINISHING`

### Rule

- if the order stays untouched for too long, the system should nudge

### V1 Automation

- any production stage idle for `5 days`
  - create or refresh a `PRODUCTION_STALL` ops issue
  - remind the tailor to post a production update
  - notify the customer: "Your order hasn't been updated recently. We're following up."
- any production stage idle for `10 days`
  - create or refresh a critical `PRODUCTION_STALL` ops issue
  - open or refresh the order dispute row
  - move the order to `IN_DISPUTE`
  - notify both customer and tailor
  - block payout release until ops resolves the dispute

### Why

- keeps “accepted but abandoned” orders visible
- protects customers without requiring manual ops monitoring every active order

## 10. Delivered / Collected But Customer Never Finishes Order

### States

- `DELIVERED`
- `COLLECTED`

### Rule

- customer gets a review/finish window

### Suggested Behavior

- at `3 days`
  - remind customer to review and finish
- at `6 days`
  - warn customer that the order will auto-complete soon
- at `7 days`
  - auto-complete if no dispute raised

### Why

- mirrors marketplace behavior like Airbnb/Fiverr style “action window”
- prevents earnings from being stuck forever

## 11. Dispute Window

### Rule

- customers must raise a concern before auto-complete

### Suggested Window

- dispute allowed until auto-complete cutoff
- after auto-complete, disputes become support/manual-review only

### Why

- creates a clear end to transaction ambiguity

## 12. Call And Consultation Rules

### Goal

Calls should help orders move forward, not become a new source of ambiguity.

### V1 Recommendation

- use one hosted provider for both voice and video
- allow one active consultation room per order at a time
- keep the order itself as the source of truth, not the call room
- allow either customer or tailor to start the scheduled room once the schedule and payment gates are satisfied

### System Behavior

- room can be created only for valid pre-production stages:
  - `PENDING_QUOTE`
  - `CONSULTATION`
  - optional later: `QUOTE_SENT` if follow-up clarification is needed
- customer-requested consultations must be approved by the tailor before a room can be created
- paid consultations must be paid before the room can be created when payment timing is `BEFORE_CALL_STARTS`
- scheduled consultations open `15 minutes` before the scheduled start time
- the same tailor cannot have overlapping scheduled consultation slots
  - Drape stores confirmed consultation slots in `consultation_bookings`
  - Postgres enforces a no-overlap constraint, so simultaneous booking attempts cannot double-book the same tailor
  - customer requests only preflight availability; the slot is reserved when the tailor schedules or approves it
- reminders are sent to both parties:
  - `30 minutes` before scheduled start
  - `5 minutes` before scheduled start
- if nobody joins within `10 minutes`
  - mark it as a no-show in logs
  - keep the order open
  - prompt the tailor to continue in messages or send/decline the quote
- if the room fails to open
  - do not block the order forever in a broken call state
- after a consultation ends
  - tailor still needs to send quote or decline within the existing response window

### Guardrails

- do not make live calls a hard dependency for all orders
- do not allow expired or terminal orders to create fresh rooms
- camera/mic denial should fail gracefully and return users to messages/order detail

## 13. Response Rate And Seller Quality Signals

These should affect ranking over time:

- average first response time
- quote acceptance rate
- order completion rate
- on-time delivery rate
- dispute rate
- cancellation rate
- quote expiry rate
- ready-made inquiry expiry rate

### Recommendation

- do not surface every number publicly yet
- use them internally for search ranking and quality review first

## 14. Abuse Prevention Rules

### Contact Bypass

Keep enforcing:

- text filtering in messages
- text filtering in reviews
- text filtering in diary/profile fields
- OCR/media scanning later
- contact info hidden until the right order milestone

### Spam

Keep and extend:

- per-user rate limits on:
  - messages
  - quote actions
  - review writes
  - diary writes
  - saved-seller toggles

### Fake Seller Behavior

Add internal flags for:

- repeated non-response
- repeated quote expiry
- repeated cancellations
- repeated disputes

These should feed moderation and ranking.

## 15. Preflight Checks Before Critical Actions

These are the checks that should happen before the user reaches a broken state.

### Before tailor sends quote

- order still active and not expired
- caller owns the order
- quoted amount is positive and sane
- completion date does not exceed customer deadline
- fulfillment path is coherent with the order
- payment configuration is present if online payment is required next

### Before customer accepts custom quote

- quote still valid
- order has not already moved forward elsewhere
- no open dispute exists
- payment provider is configured
- delivery address exists if shipping is required

### Before ready-made checkout starts

- item is still live
- item is not sold out or hidden
- selected size is valid if sizes exist
- requested quantity is valid
- fulfillment option is allowed for the item
- address is complete for delivery/shipping
- there is no conflicting open checkout for the same item/order

### Before tailor marks order shipped

- order is in the right stage
- tracking number is present
- carrier is present
- shipping address exists
- payment state is valid for fulfillment

### Before voice/video call starts

- order is in a call-eligible stage
- room token or URL was created successfully
- camera/mic permissions are granted if needed
- consultation has not already expired

## 16. Notifications Needed For This To Work

For the above rules to feel real, notifications need to exist for:

- brief received
- consultation requested
- quote sent
- quote expiring soon
- custom payment pending
- inquiry waiting
- checkout pending
- production stalled
- delivered / collected
- finish order reminder
- auto-complete warning
- consultation no-show or failed join fallback

## 17. Minimum V1 Automation We Should Actually Implement This Week

If we keep this lean, the highest-value automation set is:

1. auto-expire unanswered custom briefs after `48 hours`
2. auto-expire untouched consultations after `48 hours`
3. auto-expire quotes after `48 hours`
4. custom-order payment timeout that returns to `QUOTE_SENT` or `EXPIRED`
5. auto-expire ready-made inquiries after `48 hours`
6. auto-expire abandoned ready-made `PAYMENT_PENDING` checkouts after `30 minutes`
7. quantity/stock revalidation before finalizing ready-made payments
8. remind customer to finish delivered/collected orders
9. auto-complete delivered/collected orders after `7 days` if no concern exists

## 18. Recommended Implementation Order This Week

1. add preflight checks for custom quote acceptance and ready-made checkout
2. wire Stripe sandbox into custom and ready-made payment flows
3. add quantity limits and stock revalidation for ready-made items
4. wire shipping dependency and tracking lifecycle
5. add voice/video provider with graceful fallback rules
6. deploy scheduled expiry/reminder jobs
7. feed response and expiry metrics into ranking/moderation

## 19. Partner Review Questions

These are the decisions worth getting a second opinion on before hard-coding them:

1. Should quote validity be `48 hours` or `72 hours`?
2. Should a tailor get one manual quote extension, or none?
3. If custom payment times out, should the order return to `QUOTE_SENT` or expire immediately?
4. What is the right V1 max quantity per ready-made checkout: `1`, `3`, or `5`?
5. Should ready-made checkout hold stock for the full `30 minutes`, or only soft-hold until payment confirmation?
6. Is a `10-minute` consultation no-show window too short, right, or too long?
7. Should some sellers be allowed inquiry-only ready-made listings before direct checkout is enabled?

## 20. What This Means Product-Wise

Drape should not just track stages.

It should enforce:

- response expectations
- payment deadlines
- quantity limits
- clean closure
- marketplace accountability

That is what makes the system feel trustworthy, especially when customers and
sellers are testing boundaries.
