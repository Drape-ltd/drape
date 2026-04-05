# V1 Decisions: Goodwill Credits And Platform-Funded Recovery

Date: April 2, 2026

## Why This Exists

Drape needs a practical answer to:

- when the seller remedy is enough
- when Drape should add something extra to preserve trust
- whether credits should replace refunds
- how to avoid building a slippery “store credit instead of help” posture

This document turns the research into a working V1 stance.

## Core Principle

Goodwill is an exception tool.

It should protect trust without replacing the customer’s core remedy rights.

## Decision 1: Do Not Use Goodwill As A Substitute For A Rightful Refund

### Chosen rule

If the customer is fairly owed a refund, remake, partial refund, or other core remedy, Drape should not replace that with:

- store credit only
- platform credit only
- vague “next time” compensation

### Why

Goodwill should sit on top of a fair resolution, not distract from one.

## Decision 2: Platform-Funded Goodwill Should Be Narrow In V1

### Chosen rule

For V1, Drape should use platform-funded goodwill only in limited cases.

### Why

This preserves trust without turning goodwill into default margin leakage.

## Decision 3: Drape-Caused Failure Can Justify Platform Goodwill

### Chosen rule

If Drape materially caused or worsened the problem, platform-funded goodwill is reasonable.

### Best examples

- checkout or payment bug
- broken communication flow that materially harmed the order
- misleading support guidance
- ops delay that worsened a solvable issue

### Why

The platform should own its own mistakes.

## Decision 4: Event-Critical Seller Failure Can Justify Limited Rescue Goodwill

### Chosen rule

If a seller-caused failure ruins an event-critical order, Drape may add narrow goodwill on top of the main remedy.

### Best V1 examples

- small rebooking credit
- waived Drape fee on a rescue replacement order
- limited emergency shipping or alteration subsidy

### Why

In high-stakes failures, preserving trust may be worth more than rigidly minimizing every platform expense.

## Decision 5: Goodwill Should Not Reward Clear Customer-Caused Problems

### Chosen rule

Drape should generally avoid platform-funded goodwill for:

- change of mind
- clearly wrong self-measurement after guidance
- clearly unsuitable customer-supplied fabric
- ordinary customer delay or non-response

### Why

Goodwill should not train the marketplace to treat preventable customer-side issues as platform liability.

## Decision 6: V1 Should Prefer Manual, Ops-Mediated Goodwill Over A Wallet Build

### Chosen rule

Because Drape has no wallet or credit ledger yet, the cleanest V1 posture is:

- manual ops-approved goodwill
- explicit case-by-case reasoning
- clear customer explanation

### Why

The policy matters now.
The full product machinery can come later.

## Decision 7: The Best V1 Goodwill Shapes Are Small And Specific

### Chosen rule

The most practical V1 goodwill types are:

- waived Drape fee on a rescue order
- limited future-order credit
- shipping subsidy
- alteration top-up
- priority rescue handling

### Why

These are easier to explain and control than open-ended cash promises.

## Decision 8: Avoid Forced Store Credit As The Default Recovery Shape

### Chosen rule

Drape should not copy a “credit first, cash only if the customer asks later” posture for order-failure recovery.

### Why

That pattern often feels frustrating, defensive, and harder to trust.

## Decision 9: Goodwill Needs Caps, Ownership, And Logging

### Chosen rule

If goodwill is granted, Drape should eventually track:

- `goodwill_type`
- `goodwill_reason`
- `goodwill_amount`
- `goodwill_currency`
- `goodwill_funded_by`
- `goodwill_approved_by`
- `goodwill_related_order_id`

### Why

Without tracking, goodwill becomes inconsistent and hard to govern.

## Decision 10: Goodwill Should Supplement, Not Blur, The Resolution Record

### Chosen rule

Customer-facing communication should clearly distinguish:

- refund
- partial refund
- remake
- rebooking help
- goodwill credit
- reimbursement

### Why

Confusing those layers creates distrust and support churn.

## Recommendation Summary

The cleanest V1 goodwill posture is:

- resolve the core order fairly first
- never force store credit where cash remedy is due
- use platform-funded goodwill sparingly
- reserve it mainly for Drape-caused failures or high-severity event-critical rescue
- keep V1 goodwill manual, capped, and clearly labeled
- use small, specific gestures instead of open-ended guarantees

## Sources

- [Etsy's Purchase Protection Program](https://help.etsy.com/hc/articles/7471925990807?segment=selling)
- [What is Etsy's Purchase Protection for Sellers?](https://help.etsy.com/hc/en-us/articles/5850122619287-What-is-Etsy-s-Purchase-Protection-for-Sellers)
- [Etsy: Refunds, Returns, and Exchanges for Sellers](https://help.etsy.com/hc/en-us/articles/360000572888-Refunds-Returns-and-Exchanges-for-Sellers)
- [Airbnb: If your host cancels your home reservation](https://www.airbnb.com/help/article/170)
- [AirCover for guests](https://www.airbnb.com/help/article/3218)
- [Fiverr: Refunds](https://help.fiverr.com/hc/en-us/articles/37332601153169-Refunds)
- [Fiverr: Partial refunds](https://help.fiverr.com/hc/en-us/articles/15770574712977-Partial-refunds)
