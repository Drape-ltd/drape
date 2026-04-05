# Research Notes: Support SLA, Ops Priority, And Escalation Matrix

Date: April 2, 2026

## Why This Exists

Drape now has a growing set of policy decisions around:

- disputes
- seller trust
- payouts
- verification
- deletion requests
- shipping and delivery issues

The next ambiguity is not what the rules are, but how fast the team should act on them.

This note is the research layer for:

- ops triage timing
- priority bands
- what jumps the queue
- what can safely wait

## High-Signal Takeaways

- Good operations is mostly queue discipline.
- Marketplace support usually differentiates between urgent money / timing issues and lower-risk admin requests.
- External dispute timers can make slow internal triage very expensive.
- Event-critical failures and active payment risk deserve faster handling than ordinary profile or admin work.
- A simple priority ladder is better than vague “reply as soon as possible” language.

## 1. What Drape Already Implies Today

Current Drape product and docs already imply several service expectations:

- customer concern copy says the team reviews concerns within `72 hours`
- customer help email copy says support replies within `24 hours`
- tailor help email copy says support replies within `24 hours`
- concern policy now recommends:
  - first ops triage within `24 hours`
  - resolution target within `72 hours` when evidence is sufficient

Current ops surface already loads:

- disputes
- bypass logs
- applications
- pending verifications
- account deletion requests
- payouts
- workflow issues

Important Drape inference:

- the queue exists conceptually already
- what is missing is a clear priority model

## 2. Marketplace Pattern: Buyer Help Usually Gets A Short Response Window

Etsy’s current help-request docs say:

- sellers have `48 hours` to respond before a buyer can open a case

Etsy’s customer service standards currently say sellers should reply to at least `80%` of first messages within `24–48 hours`.

Important Drape takeaway:

- `24–48 hours` is a common baseline for standard customer service
- that is not enough for all money-risk or event-risk situations

## 3. Marketplace Pattern: Payments And Disputes Have Harder Timers

Paystack’s current disputes docs say:

- disputes should be handled within `16 hours`
- otherwise Paystack may automatically accept and trigger a refund from the balance

Stripe’s current disputes docs similarly emphasize:

- strict evidence deadlines
- one main submission window

Important Drape takeaway:

- processor-risk issues should be treated as urgent even if the customer-facing concern copy sounds softer

## 4. Marketplace Pattern: Host/Seller Cancellations Near The Event Are High Severity

Airbnb’s help center says:

- if a host cancels within `30 days` of check-in, Airbnb may help the guest rebook a similar place

Important Drape takeaway:

- deadline proximity matters
- failures close to the event date should jump the queue because the recovery window shrinks quickly

## 5. Not Every Ops Task Has The Same Cost Of Delay

Examples of high cost of delay:

- open payment dispute / processor timer
- event-critical order at risk
- active seller-failure on a paid order
- trust or safety issue
- open concern with payout blocked and no response

Examples of medium cost of delay:

- pending verification
- payout onboarding blocked
- delivery workflow issue without immediate dispute
- account deletion follow-up

Examples of lower cost of delay:

- ordinary application review
- non-urgent feature/help questions
- low-severity ops cleanup

Important Drape takeaway:

- one shared inbox without priority rules will create avoidable customer pain

## 6. Best Drape Queue Shape

The cleanest V1 queue is probably:

### `P0`

Immediate / same-day / interrupt-driven

Examples:

- processor dispute timer
- trust or safety escalation
- suspected off-platform payment issue on an active order
- severe delivery or event-date failure happening now

### `P1`

Within `24 hours`

Examples:

- new customer concern / dispute
- seller-side failure after acceptance
- payout blocked on an active order
- active workflow issue blocking order progress
- urgent verification needed to unblock real work

### `P2`

Within `48 hours`

Examples:

- pending verification review
- payout onboarding issue without active money risk
- routine support questions tied to an active order but not urgent
- deletion request acknowledgement

### `P3`

Within `72 hours` or next normal ops batch

Examples:

- ordinary tailor application review
- lower-severity moderation cleanup
- non-order general support or policy questions

## 7. Concerns And Disputes Should Not All Sit In One Flat Bucket

Even inside disputes, some cases deserve faster handling.

Faster concern examples:

- event-critical deadline miss
- not received with weak/no tracking and payout nearing release
- off-platform or harassment issue
- seller has not acknowledged at all

Slower but still active examples:

- fit issue with enough time for photos and evidence
- moderate workmanship issue where no immediate event deadline exists

Important Drape takeaway:

- dispute queue itself needs sub-priority

## 8. Ops Triage And Ops Resolution Are Different Clocks

A useful operational distinction is:

- triage clock
- resolution clock

Triage means:

- someone looked at it
- severity was assigned
- next step is clear

Resolution means:

- refund / release / approval / restriction / follow-up actually happened

Important Drape takeaway:

- promising fast triage is realistic
- promising instant final resolution for every case is not

## 9. Working Recommendation

The cleanest V1 ops timing posture is:

- `P0`: same day / as fast as possible
- `P1`: first human triage within `24 hours`
- `P2`: first human triage within `48 hours`
- `P3`: within `72 hours` or the next ops review batch

And the most important jump-the-queue triggers should be:

- processor dispute timers
- active payout-risk concern
- event-critical order failure
- trust / safety / off-platform issue
- seller-side failure after payment

## Sources

Official sources:

- [Etsy: How to Answer a Help Request from a Buyer](https://help.etsy.com/hc/en-us/articles/13241489600919-How-to-Answer-a-Help-Request-from-a-Buyer)
- [Etsy: How to Open a Case](https://help.etsy.com/hc/en-us/articles/5745586898199-How-to-Open-a-Case)
- [Etsy: How to Resolve a Case from a Buyer](https://help.etsy.com/hc/en-us/articles/360016126873-How-to-Resolve-a-Case-from-a-Buyer)
- [Etsy: Customer service standards](https://help.etsy.com/hc/en-us/articles/29654393638679-How-Do-Star-Seller-Metrics-Compare-to-Customer-Service-Standards)
- [Paystack: Manage disputes](https://paystack.com/docs/payments/manage-disputes/)
- [Stripe: Respond to disputes](https://docs.stripe.com/disputes/responding)
- [Airbnb cancellations overview](https://www.airbnb.com/help/article/3122)
- [Airbnb: If your host cancels your home reservation](https://www.airbnb.com/help/article/170)
