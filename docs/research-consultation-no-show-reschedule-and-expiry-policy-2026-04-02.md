# Research Notes: Consultation No-Show, Reschedule, And Expiry Policy

Date: April 2, 2026

## Why This Exists

Drape already decided that consultation is:

- a pre-quote alignment step
- optional by default
- not a paid standalone service in V1
- time-bounded so it does not become limbo

The next ambiguity is:

- what counts as a no-show
- how many reschedules should be tolerated
- when an open consultation should expire

This note is the research layer for that question.

## High-Signal Takeaways

- Because consultation is not monetized in V1, harsh no-show penalties would create more friction than value.
- A grace period matters; real appointment businesses often allow a short lateness buffer before treating the meeting as missed.
- Rescheduling is normal and should be easy, but open consultations still need a hard expiry.
- The order thread should remain the source of truth even when the call room fails or nobody joins.
- Seller-side stall during consultation is more dangerous than customer-side lateness, because the seller controls whether the order ever progresses to quote or decline.

## 1. What Drape Already Does Today

Drape already has several relevant local rules and primitives:

- consultation is an actual order stage
- consultation should resolve to quote or decline within `24 hours`
- automation notes suggest:
  - reminder at `12 hours`
  - reminder at `24 hours`
  - expiry at `48 hours`
- consultation call rooms are created only by the tailor
- Daily rooms currently expire `48 hours` after creation
- the mobile fallback path already tells users to continue through messages if calls fail

Important Drape takeaway:

- the state machine already expects consultation to be short-lived
- what is missing is the human policy around lateness, reschedule, and missed sessions

## 2. Market Pattern: Appointment Businesses Usually Use A Short Grace Period

Proper Cloth’s current virtual appointment booking page says:

- appointments have a `15-minute` grace period
- customers should let them know if they are running late

That is a good fit reference because Drape consultations are:

- short
- pre-sales / pre-production
- relationship-building rather than full paid project execution

Important Drape takeaway:

- `15 minutes` feels more realistic than an immediate or ultra-tight no-show mark

## 3. Market Pattern: Rescheduling Should Be Easy When The Meeting Still Matters

Calendly’s current help docs emphasize:

- easy rescheduling
- easy cancellation
- clear notification to the other party
- explicit no-show marking after the meeting rather than assuming it automatically

That is useful because it suggests a sane sequencing model:

- lateness
- reschedule
- no-show marker

instead of:

- instant blame

Important Drape takeaway:

- the product should not escalate ordinary scheduling friction into commercial conflict too quickly

## 4. Consultation No-Show Is Different From Paid Session No-Show

Because Drape consultation is not a paid standalone product in V1:

- the platform should not build fee-forfeiture logic
- the platform should not create a punitive refund/cancellation policy around missing one call

Important Drape takeaway:

- the consequence of a no-show should mainly be:
  - reminder
  - fallback to messages
  - reschedule
  - eventual expiry

not:

- immediate money consequences

## 5. Seller Stall Is Worse Than Ordinary Lateness

This is the most important business distinction.

If the customer misses a call:

- the order can often still recover

If the tailor requests consultation and then:

- never starts the room
- never follows up
- never sends a quote
- keeps the order sitting in consultation

then consultation becomes a soft form of ghosting.

Important Drape takeaway:

- seller-side consultation stall should count more heavily toward trust and responsiveness than customer-side lateness

## 6. One Lightweight Reschedule Fits V1 Better Than Open-Ended Back-And-Forth

Since Drape does not yet have:

- deep scheduling UX
- calendar sync
- no-show workflows
- fee-backed consultation slots

the simplest V1 answer is:

- one informal reschedule path
- then resolve or expire quickly

Important Drape takeaway:

- this keeps the flow human without letting it turn into appointment chaos

## 7. Message Fallback Matters More Than Perfect Call Attendance

Drape already has message fallback when:

- room creation fails
- link opening fails
- consultation room is unavailable

That is the right direction.

Important Drape takeaway:

- a missed or broken call should not trap the order in a dead state
- the objective is alignment, not call attendance for its own sake

## 8. Expiry Should Be Short And Predictable

The current local automation notes already suggest:

- consultation reminder cadence
- expiry at `48 hours`

That still feels right for V1 because consultation is supposed to be:

- pre-quote
- low-latency
- not a long sales process

Important Drape takeaway:

- if a consultation cannot produce quote/decline within `48 hours`, the order is probably not moving cleanly enough

## 9. Best V1 No-Show Shape

The cleanest V1 policy is likely:

- `15-minute` grace period
- if no one joins, mark it as a missed attempt rather than a commercial breach
- keep the order open
- prompt the tailor to:
  - follow up in messages
  - reschedule once
  - or send quote / decline if enough clarity already exists

## 10. Best V1 Reschedule Shape

The cleanest V1 answer is likely:

- allow one lightweight reschedule without penalty
- keep it inside the consultation window
- after repeated missed attempts, the tailor should choose:
  - quote based on available info
  - decline
  - or let the consultation expire

## Working Recommendation

The cleanest Drape answer is:

- use a `15-minute` grace period for consultation lateness
- do not introduce paid no-show penalties in V1
- allow one lightweight reschedule
- keep messages as the fallback if the call fails or nobody joins
- treat seller-side consultation stall more seriously than ordinary customer lateness
- expire unresolved consultations at `48 hours` so they do not become a hiding place for non-response

## Sources

Official sources:

- [Proper Cloth virtual appointment booking](https://propercloth.com/appointment/)
- [Calendly: How to manage your meetings](https://help.calendly.com/hc/en-us/articles/14079031268375-How-to-manage-your-meetings)
- [Calendly: How to include cancel and reschedule links for invitees](https://help.calendly.com/hc/en-us/articles/28926585452951-How-to-include-cancel-and-reschedule-links-for-invitees)
- [docs/order-automation-and-abuse-rules.md](/Users/onaopemipodimowo/drape/docs/order-automation-and-abuse-rules.md)
- [supabase/functions/create-consultation-room/index.ts](/Users/onaopemipodimowo/drape/supabase/functions/create-consultation-room/index.ts)
