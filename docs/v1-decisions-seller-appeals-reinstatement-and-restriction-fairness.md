# V1 Decisions: Seller Appeals, Reinstatement, And Restriction Fairness

Date: April 2, 2026

## Why This Exists

Drape needs a practical answer to:

- when a seller should self-resolve an issue
- when a seller should file an appeal
- what happens to open orders and payouts during review
- when reinstatement should be partial, full, or denied

This document turns the research into a working V1 stance.

## Core Principle

Not every restriction needs an appeal, and not every appeal should restore full access.

## Decision 1: Separate Self-Resolvable Holds From True Appeals

### Chosen rule

For V1, Drape should separate:

- operational holds a seller can fix directly
- trust restrictions that require human review
- severe suspensions that require a true appeal

### Best V1 examples of self-resolve

- missing or expired payout details
- missing ID follow-up
- incomplete onboarding requirement
- unresolved request for additional verification evidence

### Why

This is faster, clearer, and less emotionally loaded than calling every blockage an appeal.

## Decision 2: Sellers Must See Reason, Scope, And Next Step

### Chosen rule

If Drape restricts a seller, the seller should be able to see:

- reason category
- restriction scope
- whether the issue is self-fixable or appeal-only
- what evidence or action is needed next

### Why

Opaque enforcement creates unnecessary support pain and distrust.

## Decision 3: Appeals Must Be Evidence-Based

### Chosen rule

An appeal should succeed only if the seller shows:

- Drape made a factual mistake
- new relevant information materially changes the case
- the seller has completed the required corrective action

### What should not be enough

- simple disagreement
- emotional pleading without new facts
- repeating the same explanation without added evidence

### Why

This keeps appeals fair without making them endless.

## Decision 4: Use One Active Appeal At A Time

### Chosen rule

For V1, a seller should generally have:

- one active appeal per restriction event

If the appeal is denied, a second pass should only happen if materially new information appears.

### Why

This reduces spam, duplicate handling, and ops confusion.

## Decision 5: Appeals Should Be Time-Bounded

### Chosen rule

For V1, Drape should aim for:

- seller appeal submission within `14 days` of notice
- acknowledgment within `24 hours`
- decision target within `5 business days`

Complex cross-border, trust-safety, or payment-provider cases can take longer, but the seller should still get a status update.

### Why

Appeals that drag on indefinitely are bad for both trust and operations.

## Decision 6: Open Orders Should Be Handled By Risk Level

### Chosen rule

For V1, Drape should not treat all restricted sellers the same.

### Lower-risk review examples

- payout-readiness issue
- document follow-up
- reliability watch

Possible posture:

- no new risky orders
- existing safe orders may continue under observation

### Higher-risk examples

- confirmed or strongly supported off-platform payment pressure
- fake identity
- stolen portfolio work
- abusive conduct
- suspicious financial behavior

Possible posture:

- no new orders
- open orders reviewed case by case
- payout blocked until decision

### Why

Open-order handling should reflect actual customer risk, not just the existence of a restriction.

## Decision 7: Payout Handling During Appeal Should Stay Conservative

### Chosen rule

If a seller is under serious review or appeal, Drape should lean conservative on payout release.

### Best V1 posture

- low-risk operational holds may preserve already-earned release paths if no customer-risk issue exists
- trust, fraud, or severe fulfillment concerns should block payout release until review is complete

### Why

It is much easier to release money later than to recover it after a bad reinstatement decision.

## Decision 8: Reinstatement Can Be Partial Or Probationary

### Chosen rule

Reinstatement should not be forced into:

- fully restored
- permanently gone

### Better V1 options

- `REINSTATED_CLEAR`
- `REINSTATED_WATCHED`
- `REINSTATED_NO_HIGH_RISK_CUSTOM`
- `REINSTATED_NO_NEW_ORDERS_UNTIL_PAYOUT_READY`

### Why

This matches the scoped-restriction logic already chosen elsewhere.

## Decision 9: Some Severe Cases Should Be Near-Final

### Chosen rule

For V1, some categories should only allow a narrow factual-error appeal, not a broad discretionary second chance.

### Best examples

- proven identity fraud
- clear stolen portfolio or delivery work
- deliberate payment circumvention
- severe abusive conduct
- legal or sanctions-driven prohibition

### Why

The cost of a bad reinstatement can be higher than the cost of a false leniency in minor reliability cases.

## Decision 10: Duplicate-Account Evasion Should Be Treated As A New Violation

### Chosen rule

If a seller tries to evade a restriction by creating another account, that should count as a fresh trust breach.

### Why

An appeal system cannot work if restriction evasion is tolerated.

## Decision 11: Drape Should Support Low-Bandwidth Appeal Intake

### Chosen rule

For V1, Drape should not assume appeals happen only through a rich in-app experience.

### Best V1 channels

- in-app when available
- reply-to-email
- support-assisted fallback where needed

If support helps collect evidence over a fallback channel, the final record should still be logged back into Drape’s evidence trail.

### Why

This fits the operating reality of mobile-first and infrastructure-variable markets.

## Decision 12: Every Appeal Needs A Durable Audit Trail

### Chosen rule

When implemented, Drape should record:

- restriction event
- reason category
- scope
- appeal submitted at
- evidence requested
- evidence received
- decision maker
- decision outcome
- reinstated scope
- reinstated at

### Why

Appeals without durable history create repeat confusion and inconsistent enforcement.

## Decision 13: Seller-Facing Copy Should Distinguish “Fix”, “Review”, And “Appeal”

### Chosen rule

For V1, Drape should use different language for:

- `Fix this to regain access`
- `We are reviewing this`
- `You may appeal this decision`

### Why

Those are different states, and sellers should not have to guess which one they are in.

## Recommendation Summary

The cleanest V1 posture is:

- self-fixable holds should not be over-lawyered
- real appeals should require evidence
- one active appeal at a time is enough
- open orders and payouts should be handled by risk
- reinstatement can be scoped or probationary
- some severe cases should only allow narrow error correction
- appeal intake must work in low-bandwidth conditions

## Sources

- [Upwork: How to appeal an account suspension](https://support.upwork.com/hc/en-us/articles/5313574196627-Appeal-an-account-suspension)
- [Upwork: How to check your account health](https://support.upwork.com/hc/en-us/articles/46290897918995-How-to-check-your-account-health-on-Upwork)
- [Upwork: Why you can’t have two Upwork accounts](https://support.upwork.com/hc/en-us/articles/39505058710163-Why-you-can-t-have-two-Upwork-accounts)
- [Etsy: How to File an Appeal for a Permanently Suspended Account](https://help.etsy.com/hc/en-gb/articles/6298920789271-How-to-File-an-Appeal-for-a-Permanently-Suspended-Account)
- [Etsy: How to Reinstate Your Suspended Account](https://help.etsy.com/hc/en-in/articles/115015672628-How-to-Reinstate-Your-Suspended-Account)
- [Airbnb: What happens if a listing or account is suspended, restricted, or removed under ground rules for home hosts](https://www.airbnb.com/help/article/1303)
- [Airbnb: Appeal period for pending account removal](https://www.airbnb.com/help/article/3835)
- [Airbnb: How appeals work for content moderation decisions](https://www.airbnb.com/help/article/3508)
- [Fiverr: Account restrictions](https://help.fiverr.com/hc/en-us/articles/37333328644625-Account-restrictions)
- [GSMA: closing the usage gap as more than 3 billion people remain offline despite coverage](https://www.gsma.com/newsroom/press-release/gsma-calls-for-renewed-focus-on-closing-the-usage-gap-as-more-than-3-billion-people-remain-offline-despite-available-mobile-internet-services/)
- [World Bank: Financial Inclusion in Sub-Saharan Africa](https://www.worldbank.org/en/publication/globalfindex/brief/financial-inclusion-in-sub-saharan-africa-overview.print)
