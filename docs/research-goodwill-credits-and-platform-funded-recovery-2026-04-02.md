# Research Notes: Goodwill Credits, Platform-Funded Recovery, And Trust Preservation

Date: April 2, 2026

## Why This Exists

Drape already has a growing policy framework for:

- refunds
- partial refunds
- remakes
- rebooking help
- payout blocking
- dispute review

But there is still a business ambiguity:

- when should Drape itself absorb some cost to save trust
- when should the seller carry the outcome
- when should a customer get something extra beyond the strict minimum remedy

This note is the research layer for that question.

## High-Signal Takeaways

- Customers usually accept fair rules better when the platform feels visibly helpful during failure.
- Forced store-credit-first resolution often feels platform-protective rather than customer-protective.
- Mature marketplaces sometimes fund refunds, rebooking help, or credits in narrow, high-severity cases.
- Platform-funded recovery works best when it is exception-shaped, not the default remedy for ordinary seller mistakes.
- Drape does not need a full wallet system to define a smart V1 posture.

## 1. What Drape Already Implies Today

Drape’s existing decisions already lean toward a few things:

- seller-caused failure should not trap the customer
- rebooking help may matter for event-critical failures
- alteration, remake, partial refund, and full refund should be stage-aware
- after completion, only limited goodwill support should remain

But Drape has not yet clearly answered:

- whether Drape ever adds platform-funded goodwill on top of a remedy
- whether that should be cash, credit, waived fee, or rescue support
- whether credits are a substitute for refunds

Important Drape gap:

- there is no real wallet, marketplace credit balance, or explicit goodwill object yet

## 2. Marketplace Pattern: Platforms Sometimes Step In Financially

Etsy’s current Purchase Protection program is a useful signal.

For qualifying orders up to a stated threshold, Etsy may refund the buyer while the seller keeps their earnings.

Important Drape takeaway:

- a marketplace can choose to fund limited customer protection itself
- this works best when eligibility is narrow and rules are explicit

This is not the same as saying:

- every unhappy customer gets a platform-funded payout

It is closer to:

- the platform absorbs selected trust-preserving cases because it is cheaper than breaking buyer confidence

## 3. Marketplace Pattern: Rescue Support Can Beat Strict Cash Logic

Airbnb’s current help center and AirCover materials show a second pattern:

- if the host cancels, the guest gets a full refund if they do not rebook
- some eligible guests may receive booking credit to rebook quickly
- if the credit is not used within a stated window, cash refund can follow
- Airbnb may help rebook or give full / partial refund depending on the issue

Important Drape takeaway:

- high-severity failure sometimes needs rescue support, not just a refund clock
- event-critical situations are especially likely to justify platform help

## 4. Marketplace Pattern: Credit-First Flows Can Feel Frustrating

Fiverr’s current refunds flow says canceled-order funds are credited to the Fiverr balance by default, with a separate step if the customer wants a refund back to the original payment provider.

That is a useful caution.

Even if the system is operationally convenient, credit-first behavior can feel like:

- extra hoops
- delayed closure
- platform self-protection

Important Drape takeaway:

- Drape should be careful not to replace rightful cash outcomes with “here is some credit instead”

## 5. Social Signal: Customers Hate Being Forced Into A Process That Feels Like Extra Work

Directional community signal from Reddit and similar threads is pretty consistent:

- customers dislike being bounced between seller, platform, and claims flow
- they especially dislike unclear ownership of who actually funds the refund
- inconsistent guidance damages trust almost as much as the original failure

That pain matters because Drape is still young.

Important Drape takeaway:

- if Drape offers goodwill, it should simplify the experience, not add another confusing layer

## 6. Goodwill Should Be Separate From Core Entitlement

This is the most important conceptual split.

### Core entitlement

This is what the customer is already fairly owed under the order:

- refund
- partial refund
- remake
- alteration support
- return shipping label
- rebooking help

### Goodwill

This is extra support that Drape may choose to add:

- service-fee waiver
- small future-order credit
- emergency rebooking credit
- shipping subsidy
- alteration top-up
- priority support handling

Important Drape takeaway:

- goodwill should not replace the core remedy
- it should sit on top of it in the narrow cases where the business wants to preserve trust

## 7. The Best Reasons For Platform-Funded Goodwill

The strongest candidates are:

### A. Drape-caused failure

Examples:

- checkout or payment bug
- broken notification or messaging flow that materially hurt the order
- support error or misleading guidance
- ops delay that worsened a resolvable issue

### B. Seller-caused event-critical failure where Drape wants to preserve the customer relationship

Examples:

- missed deadline destroys the original use case
- customer must rebook urgently
- customer trust is broken even after refund rights are honored

### C. Recovery friction where a small platform contribution meaningfully reduces harm

Examples:

- local alteration reimbursement cap needs a modest top-up
- emergency return or courier cost
- small rebooking assistance after seller failure

## 8. The Worst Reasons For Platform-Funded Goodwill

These are the cases where Drape should be careful not to create bad incentives:

- customer changed mind
- clear customer-caused measurement or fabric issue
- ordinary seller-fault case where the standard remedy already fully resolves it
- using credit to pressure a customer into closing a concern
- using credit instead of a rightful cash remedy

## 9. V1 Does Not Need A Wallet To Be Thoughtful

Because Drape does not yet have a wallet or store-credit system, the cleanest V1 approach is likely:

- manual ops-approved goodwill
- narrow use cases
- explicit internal logging
- customer-facing clarity about whether this is:
  - a refund
  - a reimbursement
  - a one-time future-order credit
  - or a waived fee / support gesture

Important Drape takeaway:

- the policy matters before the tooling exists

## 10. Best V1 Goodwill Shapes

The most practical V1 forms are probably:

- service-fee waiver on a rescue rebook
- limited future-order credit
- shipping or alteration subsidy
- priority rescue help for event-critical replacement

The least practical V1 forms are probably:

- open-ended cash guarantees
- automatic large booking credits
- invisible internal write-offs with no clear explanation

## 11. Goodwill Should Be Capped And Reviewable

If Drape uses goodwill, it should likely track:

- why it was granted
- whether failure was seller, platform, or shared-risk
- amount and currency
- whether it replaced or supplemented another remedy
- who approved it

Important Drape takeaway:

- uncapped goodwill becomes margin leakage
- untracked goodwill becomes inconsistent and unfair

## Working Recommendation

The cleanest Drape answer is:

- use refund / remake / alter / rebooking help as the main resolution tools
- never force store credit where cash remedy is rightly due
- allow narrow platform-funded goodwill when:
  - Drape itself materially contributed to the failure
  - the order is event-critical and trust rescue matters
  - a small platform contribution meaningfully softens unavoidable friction
- keep goodwill manual, capped, and clearly distinct from the core remedy in V1

## Sources

Official sources:

- [Etsy's Purchase Protection Program](https://help.etsy.com/hc/articles/7471925990807?segment=selling)
- [What is Etsy's Purchase Protection for Sellers?](https://help.etsy.com/hc/en-us/articles/5850122619287-What-is-Etsy-s-Purchase-Protection-for-Sellers)
- [Etsy: Refunds, Returns, and Exchanges for Sellers](https://help.etsy.com/hc/en-us/articles/360000572888-Refunds-Returns-and-Exchanges-for-Sellers)
- [Airbnb: If your host cancels your home reservation](https://www.airbnb.com/help/article/170)
- [AirCover for guests](https://www.airbnb.com/help/article/3218)
- [Fiverr: Refunds](https://help.fiverr.com/hc/en-us/articles/37332601153169-Refunds)
- [Fiverr: Partial refunds](https://help.fiverr.com/hc/en-us/articles/15770574712977-Partial-refunds)

Directional community signal:

- [Reddit: Purchase Protection - How Do You Handle It](https://www.reddit.com/r/EtsySellers/comments/1s7525s/purchase_protection_how_do_you_handle_it/)
