# V1 Decisions: Support SLA And Ops Priority Matrix

Date: April 2, 2026

## Why This Exists

Drape needs a practical operating answer to:

- what gets same-day attention
- what gets `24 hours`
- what can wait `48-72 hours`
- what should jump the queue automatically

This document turns the research into a working V1 stance.

## Core Principle

Not every support item is equally expensive to delay.

Money risk, trust risk, and time-sensitive order failure should outrank routine admin work.

## Decision 1: Use A Four-Band V1 Priority Ladder

### Chosen rule

For V1, Drape should use:

- `P0`
- `P1`
- `P2`
- `P3`

### Why

This is simple enough to operate and strong enough to prevent flat queues.

## Decision 2: `P0` Means Same-Day / Interrupt Work

### Chosen rule

`P0` should be treated as same-day and interruption-worthy.

### Best V1 examples

- processor dispute timer
- trust or safety escalation
- active off-platform payment risk
- severe event-critical order failure happening now

### Why

These are the issues where slow response is most likely to create irreversible loss.

## Decision 3: `P1` Means First Human Triage Within `24 Hours`

### Chosen rule

`P1` items should get first human triage within `24 hours`.

### Best V1 examples

- new customer concern / dispute
- seller-side failure after payment
- payout blocked on an active order
- active workflow issue blocking a live order
- urgent verification needed to unblock a real order

### Why

These are active product problems with real customer or money consequences, but not every one is processor-emergency level.

## Decision 4: `P2` Means First Human Triage Within `48 Hours`

### Chosen rule

`P2` items should get first human triage within `48 hours`.

### Best V1 examples

- pending verification review
- payout onboarding issue without live order risk
- routine active-order support without urgent timing risk
- deletion request acknowledgement

### Why

These still matter, but delay is less likely to cause immediate commercial harm.

## Decision 5: `P3` Means `72 Hours` Or Next Ops Batch

### Chosen rule

`P3` items can be handled within `72 hours` or the next normal review batch.

### Best V1 examples

- ordinary tailor application review
- lower-severity moderation cleanup
- general policy questions
- non-urgent support that is not tied to a live order risk

### Why

This keeps the urgent queue from drowning in admin work.

## Decision 6: Disputes Need Their Own Internal Priority Split

### Chosen rule

Not every dispute should sit at the same priority.

### Faster dispute examples

- event-critical order failure
- payout release approaching with weak delivery evidence
- off-platform or harassment concern
- zero seller response

### Slower dispute examples

- non-urgent fit issue with time to gather evidence
- moderate workmanship issue without deadline pressure

### Why

The dispute queue itself contains very different business risks.

## Decision 7: Triage And Resolution Should Use Different Clocks

### Chosen rule

Drape should distinguish:

- first human triage
- final resolution

### Why

Fast triage is realistic and calming.
Instant final resolution is not realistic for every case.

## Decision 8: Event-Critical Orders Jump The Queue

### Chosen rule

If the order is event-critical and failure risk is near-term, the issue should move up at least one priority band.

### Why

The value of the order may collapse quickly as the date approaches.

## Decision 9: Processor Timers Override Normal Queue Order

### Chosen rule

If Stripe or Paystack dispute timing is in play, that item should jump normal support order.

### Why

External deadlines can create immediate financial loss.

## Decision 10: Ops Dashboard Should Eventually Surface Priority Explicitly

### Chosen rule

When we implement this later, useful fields likely include:

- `ops_priority`
- `ops_priority_reason`
- `triaged_at`
- `triaged_by`
- `next_action_due_at`
- `escalation_trigger`

### Why

Right now `/ops` is useful context, but not yet a true priority-driven queue.

## Recommendation Summary

The cleanest V1 ops posture is:

- `P0` same day
- `P1` within `24 hours`
- `P2` within `48 hours`
- `P3` within `72 hours` or next batch
- event-critical, payment-risk, trust-risk, and seller-failure issues jump the queue
- triage time and final resolution time stay distinct

## Sources

- [Etsy: How to Answer a Help Request from a Buyer](https://help.etsy.com/hc/en-us/articles/13241489600919-How-to-Answer-a-Help-Request-from-a-Buyer)
- [Etsy: How to Open a Case](https://help.etsy.com/hc/en-us/articles/5745586898199-How-to-Open-a-Case)
- [Etsy: How to Resolve a Case from a Buyer](https://help.etsy.com/hc/en-us/articles/360016126873-How-to-Resolve-a-Case-from-a-Buyer)
- [Etsy: Customer service standards](https://help.etsy.com/hc/en-us/articles/29654393638679-How-Do-Star-Seller-Metrics-Compare-to-Customer-Service-Standards)
- [Paystack: Manage disputes](https://paystack.com/docs/payments/manage-disputes/)
- [Stripe: Respond to disputes](https://docs.stripe.com/disputes/responding)
- [Airbnb: If your host cancels your home reservation](https://www.airbnb.com/help/article/170)
