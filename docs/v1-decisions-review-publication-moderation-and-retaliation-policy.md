# V1 Decisions: Review Publication, Moderation, And Retaliation Policy

Date: April 2, 2026

## Why This Exists

Drape needs a practical answer to:

- when reviews can be submitted
- when they become public
- when they can be edited or responded to
- what should be removed
- how review retaliation should be handled

This document turns the research into a working V1 stance.

## Core Principle

Honest negative reviews should be allowed.

Manipulated, abusive, or retaliatory review behavior should not.

## Decision 1: Use A `14-Day` Review Window

### Chosen rule

For V1, both sides should generally have `14 days` after `DELIVERED` or `COLLECTED` to submit a review.

### Why

This is long enough to evaluate the order while keeping the feedback timely and credible.

## Decision 2: Customer Reviews Of Tailors Are Public; Tailor Reviews Of Customers Are Not Public In V1

### Chosen rule

For V1:

- customer reviews of tailors can be public
- tailor reviews of customers should stay seller-side and ops-visible only

### Why

Public seller reputation is core marketplace trust.

Public customer scoring creates more retaliation and dignity risk than value in Drape’s category.

## Decision 3: Reviews From Eligible Orders Should Usually Auto-Publish Unless Held For Risk

### Chosen rule

For V1, a customer review of a tailor should usually publish once submitted if:

- the order is eligible
- no concern or dispute is open
- automated checks do not flag it

### Hold cases

- open concern or dispute
- contact detail or off-platform attempt
- threats, slurs, or harassment
- suspicious manipulation or fake-review signal

### Why

This keeps normal review flow simple without giving up moderation control.

## Decision 4: Open Concerns Should Delay Public Publication

### Chosen rule

If a valid concern or dispute is open, Drape should allow review capture but delay public publication until the issue is resolved or moderation decides it is safe to publish.

### Why

This reduces real-time retaliation pressure and one-sided public escalation while facts are still being sorted.

## Decision 5: Negative But Relevant Reviews Should Stay Up

### Chosen rule

Drape should not remove a review just because it is:

- low-rated
- harsh in tone but still civil
- embarrassing to the seller
- different from the seller’s view of events

If it is relevant to the actual order experience and follows policy, it should usually stay.

### Why

Reviews lose trust value when the platform sanitizes honest bad outcomes.

## Decision 6: Remove Reviews Only For Policy Violations Or System Abuse

### Chosen rule

V1 removal or suppression should focus on:

- private information
- off-platform contact details
- threats, extortion, or harassment
- hate or discriminatory abuse
- spam or advertising
- fake, insider, or coordinated review manipulation
- content clearly unrelated to the actual order
- content focused only on factors outside the tailor’s control, where that is the entire review

### Why

This is a moderation boundary, not a fairness-to-every-opinion engine.

## Decision 7: Review Editing Should Be Limited

### Chosen rule

For V1, the customer who wrote the review should be able to edit it only within the `14-day` review window and only until:

- the tailor posts a public response
- moderation action is taken
- or the window closes

### Why

This gives room to correct or update feedback without creating endless post-publication churn.

## Decision 8: Tailors Can Leave One Public Response

### Chosen rule

For V1, a tailor may leave:

- one public response
- within `28 days` of publication
- focused on facts, tone, and resolution context

The response should become non-editable once posted.

### Why

A bounded response right is fair, but endless reply chains are not.

## Decision 9: Review Requests Must Stay Non-Coercive

### Chosen rule

Tailors may ask for honest feedback.

They may not:

- demand a positive review
- offer money, discount, or remedy in exchange for a better review
- threaten consequences for a bad review
- withhold support to influence a review

### Why

That is manipulation, not customer service.

## Decision 10: Retaliation Over Reviews Is A Trust Violation

### Chosen rule

If a tailor retaliates against a customer over a review or threatened review, Drape should treat that as a trust and enforcement issue, not just a moderation note.

### Examples

- threatening the customer
- refusing an otherwise-valid remedy because of the review
- trying to shame, intimidate, or expose the customer
- taking the conflict off-platform to pressure the customer

### Why

Retaliation weakens both safety and review honesty.

## Decision 11: Reviews Should Not Be The Remedy Engine

### Chosen rule

For V1, support decisions and review decisions should stay separated.

That means:

- a bad review does not automatically win a refund
- a resolved remedy does not automatically erase a review
- ops can consider both, but one should not silently rewrite the other

### Why

This keeps trust content and money decisions from collapsing into each other.

## Decision 12: Future Product Should Use Existing Publication Fields Properly

### Chosen rule

When implemented, Drape should make real use of:

- `published_at`
- `flagged`
- `tailor_response`
- `tailor_responded_at`

And likely add:

- `review_status`
- `review_hold_reason`
- `reported_at`
- `reported_by`
- `moderated_at`
- `moderated_by`

### Why

The schema already points toward controlled publication, but the product logic is not fully using it yet.

## Recommendation Summary

The cleanest V1 posture is:

- `14-day` review window
- customer reviews of tailors are public
- tailor reviews of customers stay non-public in V1
- honest negative reviews remain visible
- only policy-violating or manipulated reviews get removed
- open disputes delay publication
- one factual, non-editable tailor response is allowed
- review retaliation is a serious trust violation

## Sources

- [Airbnb's Reviews Policy](https://www.airbnb.com/help/article/3048)
- [Airbnb: How long you have to write a review](https://www.airbnb.com/help/article/995)
- [Airbnb: Editing a review](https://www.airbnb.com/help/article/367)
- [Upwork: How to give feedback to your clients](https://support.upwork.com/hc/en-us/articles/211068438-How-to-give-feedback-to-your-clients)
- [Upwork: Respond to or report feedback](https://support.upwork.com/hc/en-us/articles/17975121967891)
- [Upwork: When can Upwork remove feedback I've received?](https://support.upwork.com/hc/en-us/articles/219801228-When-can-Upwork-remove-feedback-I-ve-received)
- [Upwork: How to respond to feedback from your client](https://support.upwork.com/hc/en-us/articles/211068448-How-to-respond-to-feedback-from-your-client)
- [Etsy: What to Do if You Receive a Negative Review](https://help.etsy.com/hc/en-us/articles/115015808588-What-to-Do-if-You-Receive-a-Negative-Review)
- [Etsy Harassment Policy](https://www.etsy.com/legal/policy/harassment/1395642333448)
- [Fiverr: Fake Reviews in Gig Violations](https://help.fiverr.com/hc/en-us/articles/37333366372881-Gig-violations)
