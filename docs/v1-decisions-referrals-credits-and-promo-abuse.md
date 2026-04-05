# V1 Decisions: Referrals, Credits, Promotions, And Abuse Risk

Date: April 2, 2026

## Why This Exists

Drape needs a practical answer to:

- whether referrals should earn rewards in V1
- how promo codes should work if introduced
- how credits should be limited
- how abuse should be prevented

This document turns the research into a working V1 stance.

## Core Principle

Treat incentives as controlled liabilities, not casual growth copy.

## Decision 1: Sharing Is Allowed, Rewarding Is Separate

### Chosen rule

For V1, Drape should separate:

- sharing a link
- earning value from a link

### Why

The first is easy and low-risk.
The second creates fraud, accounting, and support complexity.

## Decision 2: Do Not Launch Bilateral Referral Rewards In V1

### Chosen rule

For V1, Drape should not launch a full “invite a friend and both earn a discount” economy yet.

### Why

The current system does not yet have:

- a reward ledger
- qualification rules
- reversal rules
- duplicate-account controls
- abuse review flow

## Decision 3: Narrow Promo Codes Are Safer Than Open Referral Rewards

### Chosen rule

If Drape introduces any incentive before a full referral system, it should prefer tightly bounded promo codes over open-ended referral rewards.

### Best V1 characteristics

- first-order only
- minimum order value
- expiry date
- redemption cap
- active/inactive control

### Why

This is simpler to govern and easier to revoke.

## Decision 4: Referral Qualification Must Depend On A Real Completed Milestone

### Chosen rule

If Drape ever enables referral rewards later, a referral should not qualify at signup alone.

### Better qualification event

- first real paid order
- completed without refund, reversal, or fraud flag

### Why

Signup-only rewards are one of the easiest abuse vectors.

## Decision 5: Self-Referral, Duplicate Accounts, And Known Relationship Abuse Should Not Qualify

### Chosen rule

The following should be non-qualifying:

- referring yourself
- duplicate or linked duplicate accounts
- one person farming multiple “new” accounts
- obvious same-operator or same-business circular referrals where prohibited

### Why

This is basic hygiene for any incentive system.

## Decision 6: Referral Sharing Should Stay Personal, Not Commercial

### Chosen rule

If Drape uses referrals later, the sharing rule should stay closer to:

- personal invitation

Not:

- coupon-site distribution
- paid ads
- spam
- bots
- misleading promotion

### Why

That matches the most durable platform patterns and reduces abuse surface.

## Decision 7: Rewards Must Be Reversible

### Chosen rule

Any future credit, coupon, or referral reward should be retractable if:

- the qualifying order is refunded
- the account is abusive
- the referral is fraudulent
- platform policy was violated

### Why

Non-reversible rewards make abuse too cheap.

## Decision 8: Drape Should Not Promise A Discount Before The System Exists

### Chosen rule

Until the economic rules are real, Drape should not present referral-discount language as if it is already operational truth.

### Why

Promise-first incentive copy creates expectation debt and support burden.

## Decision 9: No Wallet Or General Credit Balance In V1

### Chosen rule

For V1, Drape should avoid launching:

- open wallet balances
- reusable store-credit systems
- layered referral-credit balances

### Why

That expands abuse, refund, accounting, and legal complexity too early.

## Decision 10: Credits Should Never Replace A Rightful Cash Remedy

### Chosen rule

This remains consistent with the earlier goodwill-credit stance:

- credits or promo value should never replace a cash remedy that is actually owed

### Why

Growth incentives and customer-remedy policy must stay separate.

## Decision 11: African-Market Conditions Argue For More Conservative Incentives

### Chosen rule

For Drape’s target market, incentive systems should launch only after stronger controls exist around:

- identity confidence
- device/account abuse review
- reward reversals
- ops authority over suspicious cases

### Why

In markets with more infrastructure variability and more off-platform coordination pressure, casual reward systems are easier to game.

### Important note

This is a Drape product inference grounded in the earlier infrastructure/trust work.

## Decision 12: Future Product Should Model Incentives Explicitly

### Chosen rule

When implemented later, useful fields and primitives likely include:

- `referral_code`
- `referred_by`
- `qualified_at`
- `reward_status`
- `reward_reversed_at`
- `promo_restriction_type`
- `promo_max_redemptions`
- `promo_first_order_only`

### Why

Right now incentives exist mostly as share surfaces and implied future promises.

## Recommendation Summary

The cleanest V1 posture is:

- keep sharing
- defer reward economics
- if incentives appear early, use narrow promo codes
- qualification should depend on real completed value
- rewards must be reversible
- no wallet or broad store-credit system yet
- do not promise referral discounts before the control layer exists

## Sources

- [Stripe: Coupons and promotion codes](https://docs.stripe.com/billing/subscriptions/coupons)
- [Stripe: Add discounts for Checkout](https://docs.stripe.com/payments/checkout/discounts)
- [Uber: Referral Program Rules](https://www.uber.com/legal/en/document/?name=referral-program-rules)
- [Uber Help: Refer-a-friend Program](https://help.uber.com/en/riders/article/refer-a-friend-program?nodeId=4d918571-17ab-4d8f-8967-2be24bea8800)
- [DoorDash Merchant Referral Program](https://merchants.doordash.com/en-us/about/merchant-referral-program)
