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

### Rule

- consultation should move to quote or decline within `24 hours`

### System Behavior

- at `12 hours`
  - remind tailor to send quote or decline
- at `24 hours`
  - remind both parties that the consultation is still open
- at `48 hours`
  - auto-expire consultation if no quote is sent
  - set order to `EXPIRED`

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
- at `48 hours`
  - auto-expire
  - set order to `EXPIRED`
  - notify tailor and customer

### Current Status

- there is already an `expire-quotes` function in:
  - [expire-quotes/index.ts](/Users/onaopemipodimowo/drape/packages/db/supabase/functions/expire-quotes/index.ts)
- this should be moved into active Supabase deployment/runtime and scheduled properly

## 4. Ready-Made Inquiry, Seller Does Not Reply

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

## 5. Ready-Made Checkout Started, Payment Not Finished

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

## 6. Seller Accepts Work Beyond Customer Deadline

### Current Status

- already enforced in:
  - [tailor-order-action/index.ts](/Users/onaopemipodimowo/drape/supabase/functions/tailor-order-action/index.ts)
  - [orders/[id].tsx](/Users/onaopemipodimowo/drape/apps/mobile/app/(tailor)/orders/[id].tsx)

### Rule

- quoted completion date cannot be later than customer deadline

### Keep

- this should remain a hard server-side rule

## 7. Production Stalls After Quote Acceptance

### States

- `CONFIRMED`
- `DESIGNING`
- `SOURCING`
- `CUTTING`
- `SEWING`
- `FINISHING`

### Rule

- if the order stays untouched for too long, the system should nudge

### Suggested Timers

- `CONFIRMED` with no progress for `72 hours`
  - remind tailor to move the order into production
- any production stage idle for `5 days`
  - remind tailor
- any production stage idle for `7 days`
  - notify customer that progress has stalled

### Why

- keeps “accepted but abandoned” orders visible

## 8. Delivered / Collected But Customer Never Finishes Order

### States

- `DELIVERED`
- `COLLECTED`

### Rule

- customer gets a review/finish window

### Suggested Behavior

- at `3 days`
  - remind customer to review and finish
- at `7 days`
  - auto-complete if no dispute raised

### Why

- mirrors marketplace behavior like Airbnb/Fiverr style “action window”
- prevents earnings from being stuck forever

## 9. Dispute Window

### Rule

- customers must raise a concern before auto-complete

### Suggested Window

- dispute allowed until auto-complete cutoff
- after auto-complete, disputes become support/manual-review only

### Why

- creates a clear end to transaction ambiguity

## 10. Response Rate And Seller Quality Signals

These should affect ranking over time:

- average first response time
- quote acceptance rate
- order completion rate
- on-time delivery rate
- dispute rate
- cancellation rate

### Recommendation

- do not surface every number publicly yet
- use them internally for search ranking and quality review first

## 11. Abuse Prevention Rules

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

## 12. Notifications Needed For This To Work

For the above rules to feel real, notifications need to exist for:

- brief received
- consultation requested
- quote sent
- quote expiring soon
- inquiry waiting
- checkout pending
- production stalled
- delivered / collected
- finish order reminder
- auto-complete warning

## 13. Minimum V1 Automation We Should Actually Implement

If we keep this lean, the highest-value automation set is:

1. auto-expire unanswered custom briefs after `48 hours`
2. auto-expire untouched consultations after `48 hours`
3. auto-expire quotes after `48 hours`
4. auto-expire ready-made inquiries after `48 hours`
5. auto-expire abandoned payment-pending shop checkouts after `30 minutes`
6. remind customer to finish delivered/collected orders
7. auto-complete delivered/collected orders after `7 days` if no concern exists

## 14. Recommended Implementation Order

1. deploy real scheduled expiry for `QUOTE_SENT`
2. add scheduled expiry for `PENDING_QUOTE` and `CONSULTATION`
3. add scheduled expiry for `READY_MADE + PAYMENT_PENDING`
4. add delivered/collected auto-complete window
5. wire push/email reminders around those timers
6. feed response and expiry metrics into ranking/moderation

## 15. What This Means Product-Wise

Drape should not just track stages.

It should enforce:

- response expectations
- time windows
- clean closure
- marketplace accountability

That is what makes the system feel trustworthy, especially when customers and
sellers are testing boundaries.
