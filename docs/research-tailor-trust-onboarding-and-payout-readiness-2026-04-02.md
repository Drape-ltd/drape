# Research Notes: Tailor Trust, Onboarding, And Payout Readiness

Date: April 2, 2026

## Why This Exists

Drape already has pieces of trust and seller onboarding:

- tailor profiles
- ID verification
- payout provider account ids
- payout records
- a lightweight ops review surface

But those pieces do not yet form a complete answer to:

- when is a tailor safe to go live?
- when is a tailor actually payout-ready?
- when should a tailor be allowed to accept higher-risk custom jobs?
- what happens when the payout provider blocks or limits the seller?

This document is a research and product-gap deep dive.

## High-Signal Takeaways

- Identity verification and payout readiness are not the same thing.
- A tailor can be manually approved by ops but still not be able to receive payout cleanly.
- Processor onboarding is dynamic. Stripe and Paystack can both surface new requirements later, even after an account looks usable at first.
- Drape should not use one binary `verified / unverified` status for all seller risk decisions.
- Higher-risk work like `CUSTOM` plus tailor-sourced fabric should have stricter readiness requirements than simpler flows.
- Sellers hate opaque reserves and unexplained payout holds. If Drape ever holds funds or restricts capabilities, the reason and next step must be visible.

## 1. What Drape Models Today

Current tailor profile fields already include:

- `is_verified`
- `is_live`
- `id_verification_status`
- `stripe_account_id`
- `paystack_account_id`

Current payout history also exists:

- `payouts` table with amount, currency, provider, provider payout id, order id, processed time

Current ops support exists for:

- pending verification review
- tailor applications
- payout visibility

## Current gaps

Drape does not yet model a first-class:

- payout readiness state
- payout restriction reason
- provider requirements state
- reserve / hold state
- seller capability level by order risk

That means a tailor can conceptually be:

- identity verified
- live in search
- still not actually payout-ready

And the app may not explain that cleanly.

## 2. Important Current Product Mismatch

Current public/help language is simpler than the real operational picture.

Examples in the app currently say things like:

- payment stays protected until handoff closes out
- funds transfer 24–48 hours after escrow releases
- ops manually reviews ID and then profile goes live

That is directionally okay for trust marketing, but operationally incomplete.

Why:

- Drape does not have a true payout-readiness state machine yet
- processor accounts can be missing requirements after onboarding
- payout can be blocked for reasons unrelated to identity approval

## 3. Processor Reality: Stripe

Stripe onboarding is not just "connect account once and done."

Current Stripe Connect docs say:

- platforms can choose up-front onboarding or incremental onboarding
- up-front onboarding collects `eventually_due` requirements
- incremental onboarding collects only `currently_due` requirements
- connected accounts can later surface more requirements

Stripe also distinguishes between:

- account onboarding
- account management

And explicitly notes that account management is not optimized for collecting missing information or handling risk verifications.

## Important Drape inference

For Drape, Stripe seller readiness should not just mean:

- `stripe_account_id` exists

It should also mean something like:

- required onboarding is complete enough for the intended use case
- payouts are enabled
- charges or transfers are enabled if needed
- no critical `currently_due` or `past_due` requirement is blocking the account

## 4. Processor Reality: Paystack

Paystack also has a stronger operational model than a simple account id suggests.

Current Paystack docs show:

- transfer recipients should have bank details verified
- account number resolution is part of the flow
- subaccounts expose fields like `is_verified` and `settlement_schedule`
- settlement schedule can be `auto`, `weekly`, `monthly`, or `manual`

## Important Drape inference

For Drape, a Paystack-linked tailor should not just mean:

- `paystack_account_id` exists

It should also mean:

- bank details were resolved correctly
- the subaccount or payout path is active enough for the intended flow
- the settlement mode is understood by ops and by the seller

## 5. Marketplace Signal: Risk Holds Are Normal, But Sellers Hate Opaque Ones

Official Etsy reserve guidance says marketplaces commonly hold part of seller funds when risk is elevated, and release can depend on things like valid tracking or time windows.

Public seller discussions show the emotional failure mode clearly:

- sellers get confused about why the hold happened
- support explanations feel canned or inconsistent
- cash-flow pain becomes the real problem, not just the rule itself

## Important Drape inference

If Drape ever introduces:

- payout reserve
- temporary seller restriction
- delayed release for new or risky sellers

Then the seller must be able to see:

- why the restriction exists
- what evidence or action clears it
- whether it is order-level or account-level
- the expected timeline

Opaque restrictions create distrust faster than the restriction itself.

## 6. Drape Should Separate Four Different Ideas

The clean seller-trust model likely needs four distinct concepts.

## A. Identity trust

Questions:

- has the tailor submitted ID?
- has ops approved identity?
- is the profile trustworthy enough to appear publicly?

Possible state examples:

- `NOT_SUBMITTED`
- `PENDING`
- `VERIFIED`
- `REJECTED`

## B. Payout setup

Questions:

- has the tailor connected Stripe or Paystack properly?
- are bank details present?
- has the provider verified enough data?

Possible state examples:

- `NOT_STARTED`
- `CONNECTED_INCOMPLETE`
- `CONNECTED_REVIEWING`
- `READY`
- `BLOCKED`

## C. Risk / reserve state

Questions:

- is payout temporarily held for trust or dispute reasons?
- is the seller currently restricted from new high-risk work?

Possible state examples:

- `CLEAR`
- `TRACKING_REQUIRED`
- `DISPUTE_HOLD`
- `PROVIDER_RESTRICTED`
- `OPS_REVIEW`

## D. Capability level

Questions:

- what kind of orders can this tailor safely accept on Drape?

Possible examples:

- `DISCOVERY_ONLY`
- `READY_MADE_ONLY`
- `CUSTOM_CUSTOMER_SUPPLIES`
- `CUSTOM_TAILOR_SOURCES`
- `INTERNATIONAL_SHIPPING_ENABLED`

## 7. Recommended Seller Readiness Ladder

The cleanest V1 ladder looks like this.

## Level 0: Draft

Requirements:

- account exists
- profile incomplete

Allowed:

- no public discovery
- no orders

## Level 1: Application Complete

Requirements:

- profile basics complete
- portfolio uploaded
- ID submitted

Allowed:

- waiting for ops review
- not live

## Level 2: Identity Verified

Requirements:

- ops approved identity

Allowed:

- can become publicly discoverable
- should still not imply payout is ready

## Level 3: Payout Ready

Requirements:

- identity verified
- payout provider connected
- provider requirements complete enough for payout use
- bank details verified or resolved

Allowed:

- low-risk paid order acceptance

## Level 4: Live Low-Risk

Requirements:

- identity verified
- payout ready
- basic trust profile complete

Allowed:

- `READY_MADE`
- `CUSTOM` with safer constraints if desired

## Level 5: Live Higher-Risk

Requirements:

- identity verified
- payout ready
- ops confidence in profile quality
- clear shipping / handoff capabilities
- maybe initial successful history or explicit manual approval

Allowed:

- `CUSTOM` with tailor-sourced fabric
- international shipping
- other higher-liability flows

## Level 6: Restricted / Held

Triggered by:

- provider requirements became due
- payout blocked
- unusual dispute activity
- repeated fulfillment issues
- bank details changed
- ops manual hold

Allowed:

- maybe existing order completion only
- maybe no new higher-risk orders

## 8. Recommended Capability Gating For Drape

Not every tailor needs every workflow on day one.

## V1 conservative recommendation

To go live in discovery:

- complete profile
- portfolio
- ID verified

To accept paid orders:

- payout ready

To accept `READY_MADE` shipping orders:

- payout ready
- shipping mode configured

To accept `CUSTOM` with customer-supplied fabric:

- payout ready
- custom orders enabled
- clear material-issue policy path

To accept `CUSTOM` with tailor-sourced fabric:

- payout ready
- custom orders enabled
- ops is comfortable with sourcing and refund posture

To accept international shipping:

- payout ready
- shipping enabled
- explicit manual approval or stronger trust signal

## Best V1 shortcut

If we want to keep the product simple:

- let `ID verified + payout ready` unlock normal domestic work
- treat `tailor-sourced custom + international shipping` as manual-approval features for now

## 9. What Sellers Should See In Product

If Drape wants trust, the seller-facing status copy must become more precise.

The seller should be able to tell the difference between:

- profile under review
- identity verified
- payout setup incomplete
- payout provider requires more info
- payout temporarily held
- live but restricted to some order types

The current "you’ll get paid after escrow releases" wording is too coarse if the account itself is not fully ready.

## 10. Reserve And Hold Rules Worth Considering

Marketplaces often need some seller-level restrictions even after onboarding.

Reasonable Drape hold reasons later could include:

- new seller reserve
- payout provider requirement came due
- dispute spike
- missing tracking behavior
- suspicious off-platform activity
- recent bank update

## Important product lesson

If Drape introduces holds, the app should always show:

- hold reason
- affected scope
- what the tailor needs to do next
- what ops is reviewing
- when the next status check should happen

## 11. Suggested V1 Data Model Direction

Without implementing it yet, the likely future additions are:

- `payout_status`
- `payout_status_reason`
- `provider_requirements_state`
- `seller_capability_level`
- `risk_hold_status`
- `risk_hold_reason`

And likely a stronger separation between:

- identity verification
- provider onboarding
- payout execution history

## 12. Best Drape Product Lesson

The most important trust lesson is this:

Being "verified" is not the same as being "safe to take any paid job."

Drape should avoid collapsing:

- identity trust
- payout readiness
- risk posture
- seller quality

into one badge or boolean.

That simplification feels convenient early, but it usually creates support pain later.

## Open Questions Worth Turning Into Decisions

- Should `ID verified` tailors be visible publicly before payout setup is complete?
- Should `CUSTOM` with tailor-sourced fabric require manual approval at first?
- Should `INTERNATIONAL_SHIPPING` be a later ops unlock instead of a self-serve toggle?
- Should Drape create a seller reserve model for new high-risk sellers, or stay with order-level delayed payout only?
- Should payout issues be visible in mobile settings only, or also inside the tailor dashboard and earnings screen?

## Sources

Official processor / marketplace sources:

- [Stripe account onboarding](https://docs.stripe.com/connect/supported-embedded-components/account-onboarding)
- [Stripe onboard your connected account](https://docs.stripe.com/connect/marketplace/tasks/onboard)
- [Stripe API onboarding](https://docs.stripe.com/connect/api-onboarding)
- [Stripe account management](https://docs.stripe.com/connect/supported-embedded-components/account-management)
- [Stripe manual payouts](https://docs.stripe.com/connect/manual-payouts)
- [Stripe Managed Risk](https://docs.stripe.com/connect/risk-management/managed-risk)
- [Paystack transfer recipients](https://paystack.com/docs/transfers/creating-transfer-recipients/)
- [Paystack verification API](https://paystack.com/docs/api/verification/)
- [Paystack subaccounts](https://paystack.com/docs/api/subaccount/)
- [Paystack settlements](https://paystack.com/docs/api/settlement/)
- [Etsy payment account reserve](https://help.etsy.com/hc/en-us/articles/360058722214-What-is-a-Payment-Account-Reserve-?segment=selling)
- [Etsy payment account management](https://help.etsy.com/hc/en-us/articles/115015747228-How-to-Manage-Your-Payment-Account?segment=selling)

Directional social pain-point signal:

- [Reddit: Etsy reserve confusion](https://www.reddit.com/r/EtsySellers/comments/10m7n18)
- [Reddit: Etsy reserve and delayed releases](https://www.reddit.com/r/EtsySellers/comments/1gq9he4)
- [Reddit: Etsy reserve cash-flow pain](https://www.reddit.com/r/Etsy/comments/wrwtd7)
