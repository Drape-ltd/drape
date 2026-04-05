# V1 Decisions: Consultation No-Show, Reschedule, And Expiry Policy

Date: April 2, 2026

## Why This Exists

Drape needs a practical answer to:

- what counts as a missed consultation
- how much rescheduling is reasonable
- when consultation should expire

This document turns the research into a working V1 stance.

## Core Principle

Consultation should reduce risk, not create a new scheduling maze.

## Decision 1: Use A `15-Minute` Grace Period

### Chosen rule

For V1, consultation should use a `15-minute` grace period before a missed attempt is recorded.

### Why

This is practical for short virtual appointments and less brittle than a very tight cutoff.

## Decision 2: No Paid No-Show Penalty In V1

### Chosen rule

Because consultation is not a paid standalone service in V1, Drape should not apply fee-forfeiture or no-show penalties.

### Why

That would create monetization and refund complexity we explicitly decided to avoid.

## Decision 3: A Missed Attempt Should Not Instantly Kill The Order

### Chosen rule

If the consultation call is missed, the order should remain open.

### Immediate next step

- follow up in messages
- try one reschedule
- or proceed to quote / decline if enough clarity already exists

### Why

The goal is alignment, not punishing one missed meeting.

## Decision 4: Allow One Lightweight Reschedule

### Chosen rule

V1 should tolerate one lightweight reschedule without penalty.

### Why

That is enough flexibility for real life without turning consultation into endless back-and-forth.

## Decision 5: Keep Consultation Time-Bounded

### Chosen rule

Consultation should still aim to resolve quickly:

- reminder pressure inside `24 hours`
- expiry at `48 hours` if no quote or decline happens

### Why

Consultation should not become a soft form of ghosting.

## Decision 6: Seller-Side Stall Matters More Than Ordinary Customer Lateness

### Chosen rule

If the tailor requests consultation but then fails to start it, follow up, quote, or decline, that should weigh more heavily against seller responsiveness than an ordinary customer late join.

### Why

The seller controls whether the order can progress out of consultation.

## Decision 7: Messages Are The Primary Fallback

### Chosen rule

If the room fails, nobody joins, or device permissions block the call, the order should fall back to messages rather than dead-end.

### Why

Consultation is about clarity, not dependency on call infrastructure.

## Decision 8: Consultation Expiry Should Reopen Customer Choice

### Chosen rule

If consultation expires unresolved, the order should not sit indefinitely waiting.

### Best V1 outcome

- expire the consultation/order path cleanly
- let the customer re-engage later if they still want to proceed

### Why

Customers should not be trapped in hidden limbo.

## Recommendation Summary

The cleanest V1 posture is:

- `15-minute` grace period
- no paid no-show penalty
- one lightweight reschedule
- message fallback when calls fail
- stronger scrutiny on seller-side stall
- consultation should still resolve or expire within `48 hours`

## Sources

- [Proper Cloth virtual appointment booking](https://propercloth.com/appointment/)
- [Calendly: How to manage your meetings](https://help.calendly.com/hc/en-us/articles/14079031268375-How-to-manage-your-meetings)
- [Calendly: How to include cancel and reschedule links for invitees](https://help.calendly.com/hc/en-us/articles/28926585452951-How-to-include-cancel-and-reschedule-links-for-invitees)
- [docs/order-automation-and-abuse-rules.md](/Users/onaopemipodimowo/drape/docs/order-automation-and-abuse-rules.md)
