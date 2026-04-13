# V1 Decisions: Tailor Trust And Capability Gating

Date: April 2, 2026

## Why This Exists

For V1, Drape needs a simple answer to:

- when a tailor can go live
- when a tailor can accept paid orders
- when a tailor can take higher-risk custom work
- when a tailor should be restricted or held

This document turns the broader research into a practical working stance.

## Core Principle

Do not collapse all seller trust into one boolean.

For V1, Drape should treat these as separate:

- identity verification
- payout readiness
- seller capability level
- temporary hold or restriction state

## Decision 1: Public Trust And Payout Readiness Are Different

### Chosen rule

A tailor can be identity-verified without being fully payout-ready.

### Why

- ID review and provider payout onboarding are different workflows
- processors can surface additional requirements later
- we should not imply “you are ready to receive funds” just because ops approved ID

## Decision 2: Paid Order Acceptance Requires Payout Readiness

### Chosen rule

For V1, a tailor should not accept paid orders unless payout setup is actually ready.

### Minimum meaning of payout-ready

- a payout provider path exists
- bank details are connected
- provider verification is sufficiently complete for payout use
- no known blocking requirement is active

## Decision 3: Going Live In Discovery Requires Identity Review First

### Chosen rule

To appear publicly in search or customer-facing discovery, a tailor should have:

- profile basics complete
- portfolio present
- ID submitted and approved

### Why

- this keeps public trust messaging real
- customers should not discover unreviewed seller profiles as if they are normal live businesses

## Decision 4: Higher-Risk Capabilities Need Stronger Gates

### Chosen rule

Not every verified tailor needs every workflow on day one.

For V1:

- standard domestic work can open once the tailor is identity-verified and payout-ready
- `CUSTOM` with tailor-sourced fabric should be treated as a higher-risk capability
- international shipping should also be treated as a higher-risk capability

### Best V1 recommendation

Keep these two as manual or ops-approved capabilities at first:

- `CUSTOM` with tailor-sourced fabric
- international shipping

### Why

- both add more refund, dispute, and fulfillment risk
- both benefit from clearer ops visibility while the product is still learning

## Decision 5: Seller Holds Must Be Explainable

### Chosen rule

If Drape restricts a tailor or holds payout, the app should show a reason and next step.

### Minimum explanation standard

The tailor should be able to see:

- what is held or restricted
- why
- what action is needed
- whether ops or the payout provider is blocking it

### Why

- opaque trust controls feel arbitrary
- sellers tolerate risk controls better when the system is legible

## Decision 6: Use A Simple V1 Seller Ladder

### Chosen rule

The working V1 seller ladder should be:

1. `DRAFT`
2. `APPLICATION_COMPLETE`
3. `IDENTITY_VERIFIED`
4. `PAYOUT_READY`
5. `LIVE_STANDARD`
6. `LIVE_HIGHER_RISK`
7. `RESTRICTED`

### What it means

- `DRAFT`: not reviewable, not public
- `APPLICATION_COMPLETE`: waiting on ops / trust review
- `IDENTITY_VERIFIED`: public-trust layer passed
- `PAYOUT_READY`: can safely accept paid work
- `LIVE_STANDARD`: normal domestic work allowed
- `LIVE_HIGHER_RISK`: higher-risk flows allowed
- `RESTRICTED`: some or all activity temporarily limited

## Decision 7: Drape Should Prefer Order-Level Delayed Payout Over Heavy Seller Reserves In V1

### Chosen rule

For V1, keep payout protection mostly at the order level:

- delayed release
- dispute holds
- evidence-based release

Do not rush into a complex seller-reserve system unless real loss patterns force it.

### Why

- easier to explain
- less seller anxiety
- less ops complexity during early launch

## Decision 8: Future Data Model Should Reflect These Differences

### Chosen rule

When we implement this later, we should likely add explicit fields such as:

- `payout_status`
- `payout_status_reason`
- `seller_capability_level`
- `risk_hold_status`
- `risk_hold_reason`

### Why

Current fields like:

- `is_verified`
- `is_live`
- provider account ids

are not expressive enough on their own.

## Recommendation Summary

The cleanest V1 posture is:

- identity review before public discovery
- payout readiness before paid order acceptance
- manual approval for higher-risk custom sourcing and international shipping
- clear seller-visible reasons for restrictions
- simple delayed payout logic before any heavy reserve system

## Sources

- [Stripe account onboarding](https://docs.stripe.com/connect/supported-embedded-components/account-onboarding)
- [Stripe account management](https://docs.stripe.com/connect/supported-embedded-components/account-management)
- [Stripe manual payouts](https://docs.stripe.com/connect/manual-payouts)
- [Stripe Managed Risk](https://docs.stripe.com/connect/risk-management/managed-risk)
- [Paystack transfer recipients](https://paystack.com/docs/transfers/creating-transfer-recipients/)
- [Paystack verification API](https://paystack.com/docs/api/verification/)
- [Paystack subaccounts](https://paystack.com/docs/api/subaccount/)
- [Etsy payment reserve](https://help.etsy.com/hc/en-us/articles/360058722214-What-is-a-Payment-Account-Reserve-?segment=selling)
