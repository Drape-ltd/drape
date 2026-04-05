# V1 Decisions: Seller Quality Trust And Restriction Policy

Date: April 2, 2026

## Why This Exists

Drape needs a practical rule for when a tailor:

- stays fully trusted
- gets watched more closely
- loses access to riskier work
- stops receiving new orders
- gets suspended

This document turns the research into a working V1 stance.

## Core Principle

Do not treat all bad seller outcomes the same.

For V1, Drape should clearly separate:

- quality drift
- trust breach

## Decision 1: Separate Quality Drift From Trust Breach

### Chosen rule

For V1, Drape should use different enforcement logic for:

- reliability problems
- deception / abuse problems

### Quality drift examples

- repeated lateness
- weak response times
- preventable fulfillment mistakes
- repeated low-confidence complaints without proof of fraud

### Trust breach examples

- fake identity
- fake or stolen portfolio work
- off-platform pressure
- review manipulation or extortion
- harassment or abusive conduct

### Why

Reliability problems often justify friction.
Trust breaches often justify faster restriction.

## Decision 2: Repeat Reliability Problems Should Trigger Friction Before Suspension

### Chosen rule

For V1, repeated quality drift should usually trigger:

- watch status
- ops review
- reduced discovery visibility
- loss of higher-risk capabilities

before full suspension.

### Best V1 examples

- repeated missed deadlines
- multiple recent complaints about responsiveness
- repeated fulfillment sloppiness
- multiple preventable cancellations

### Why

This gives Drape room to protect customers without pretending every weak seller is a scammer.

## Decision 3: Off-Platform Pressure Is High-Severity

### Chosen rule

Confirmed or strongly substantiated off-platform pressure should escalate faster than ordinary quality issues.

### Best V1 posture

- first low-confidence signal: review
- repeated or high-confidence signal: restrict new orders
- confirmed payment-circumvention or deliberate bypass pattern: suspend

### Why

Once communication or payment moves off-platform:

- Drape loses evidence
- customer protection weakens
- dispute handling gets much harder

## Decision 4: Portfolio Authenticity Flags Need Review, Not Blind Auto-Bans

### Chosen rule

For V1, OCR or suspicious-media flags should send a tailor into review, but a single automated flag should not auto-suspend by itself.

### Best V1 response

- one suspicious image: review required
- multiple suspicious images or clear stolen-work proof: strong restriction or suspension

### Why

Automation helps triage, but false positives are real.

## Decision 5: Review Manipulation And Extortion Are Severe Violations

### Chosen rule

Review manipulation should be treated as a high-severity trust breach in V1.

### Includes

- offering compensation for a positive review
- pressuring someone to change a review
- threatening a customer over review outcome
- withholding resolution only to gain a better review

### Why

Reviews are one of the main trust systems customers rely on when choosing a tailor.

## Decision 6: Use Scoped Restrictions Before Full Suspension When Possible

### Chosen rule

Drape should not force every enforcement action into “fully live” or “fully banned.”

### Useful V1 scopes

- `DISCOVERY_DOWNRANK`
- `NO_NEW_HIGH_RISK_CUSTOM`
- `NO_INTERNATIONAL_SHIPPING`
- `NO_NEW_ORDERS`
- `PAYOUT_HOLD`
- `FULL_SUSPENSION`

### Why

Scope makes enforcement fairer and more legible.

## Decision 7: Seller Restrictions Must Be Explainable

### Chosen rule

If Drape restricts a tailor, the seller should be able to see:

- current status
- reason category
- what is blocked
- what action clears it
- whether ops or a provider is involved

### Why

Opaque enforcement creates avoidable distrust and support pain.

## Decision 8: Do Not Expose Raw Internal Accusations To Customers

### Chosen rule

Customer-facing behavior should stay simple:

- hide or down-rank risky sellers when needed
- pause new risky work when needed
- keep order-level explanations factual and calm

Do not show customers internal labels like “suspected fraud” before review is complete.

## Decision 9: Use A Simple V1 Seller-Trust Ladder

### Chosen rule

The working V1 ladder should be:

1. `CLEAR`
2. `WATCHED`
3. `REVIEW_REQUIRED`
4. `RESTRICTED_HIGH_RISK`
5. `RESTRICTED_ALL_NEW_ORDERS`
6. `SUSPENDED`

### What it means

- `CLEAR`: normal trust posture
- `WATCHED`: early reliability concerns
- `REVIEW_REQUIRED`: human review needed before confidence returns
- `RESTRICTED_HIGH_RISK`: tailor may keep simpler work but loses risky workflows
- `RESTRICTED_ALL_NEW_ORDERS`: active risk is high enough to stop intake
- `SUSPENDED`: severe or confirmed violation

## Decision 10: Current Public Trust Copy Should Stay Honest

### Chosen rule

V1 trust copy can keep saying that tailors submit ID and a portfolio before going live, but it should not imply that this is the only trust control Drape uses.

### Better posture

Drape should communicate that:

- initial review exists
- platform rules still apply after go-live
- ongoing reliability and abuse monitoring still matter

## Decision 11: Prefer Explicit Status Fields Over One Hidden Risk Score

### Chosen rule

When we implement this later, Drape should likely add explicit states such as:

- `seller_quality_state`
- `restriction_status`
- `restriction_scope`
- `restriction_reason`
- `portfolio_review_status`
- `appeal_status`

### Why

These are easier to explain, debug, and operate than one opaque internal score.

## Recommendation Summary

The cleanest V1 trust posture is:

- quality drift gets friction first
- off-platform pressure, portfolio deception, and review manipulation escalate faster
- restrictions should be scoped when possible
- sellers should be told what happened and what clears it
- customer-facing trust behavior should stay calm and factual

## Sources

- [Etsy Seller Policy](https://www.etsy.com/legal/sellers/)
- [Etsy Off-Platform Transactions](https://www.etsy.com/legal/policy/off-platform-transactions/1254654515806)
- [Etsy Extortion Policy](https://www.etsy.com/legal/policy/extortion/239966959186)
- [Etsy Payment Account Reserve](https://help.etsy.com/hc/en-us/articles/360058722214-What-is-a-Payment-Account-Reserve?segment=selling)
- [Upwork: Circumvention, and why it’s against the rules](https://support.upwork.com/hc/en-us/articles/360052511133-Circumvention-and-why-it-s-against-the-rules)
- [Upwork: What to do if someone contacts you outside Upwork](https://support.upwork.com/hc/en-us/articles/17995705476627--What-to-do-if-someone-contacts-you-outside-Upwork)
- [Fiverr Community Standards: Integrity and Authenticity](https://help.fiverr.com/hc/en-us/articles/37554436102289-Community-Standards-Integrity-and-Authenticity)
- [Fiverr Account Restrictions](https://help.fiverr.com/hc/en-us/articles/34551010553489-Account-Restrictions)
