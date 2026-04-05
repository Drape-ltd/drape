# V1 Decisions: Seller Ranking And Discovery Fairness

Date: April 2, 2026

## Why This Exists

Drape needs a practical rule for:

- who appears in discovery
- what influences rank
- how restrictions affect visibility
- how new sellers get a fair chance

This document turns the research into a working V1 stance.

## Core Principle

Discovery should reward relevance and reliability, not just popularity.

## Decision 1: Eligibility Comes Before Ranking

### Chosen rule

For V1, discovery should first decide who is eligible to appear at all.

### Minimum baseline

- live profile
- trust-cleared enough for customer discovery
- capable of the work being shown

### Why

Ranking should not be used to hide basic eligibility problems.

## Decision 2: Use Reliability Signals In Ranking, Not Just Aesthetic Signals

### Chosen rule

Once a seller is eligible, ranking should reflect a mix of:

- search relevance
- specialty fit
- availability
- response quality
- review health
- fulfillment reliability

### Why

The customer is not only choosing a look.
They are choosing whether the order is likely to go well.

## Decision 3: Ratings Matter, But They Should Not Be The Only Discovery Truth

### Chosen rule

V1 should not rely only on `avg_rating` or review count.

### Other important inputs

- recent response behavior
- case/concern pattern
- deadline reliability
- cancellation or fulfillment problems

### Why

A seller can look visually strong and still operate unreliably.

## Decision 4: Availability Should Influence Visibility

### Chosen rule

For V1:

- `FULLY_BOOKED` should usually be excluded from standard active discovery
- `LIMITED` can stay visible but should not outrank clearly available sellers by default

### Why

Discovery should reflect whether the seller can realistically take work now.

## Decision 5: Trust Restrictions Should Affect Discovery In A Scoped Way

### Chosen rule

Restriction status should influence visibility based on scope.

### Best V1 fit

- `WATCHED`
  - still visible
  - may lose some rank if reliability signals are weak
- `RESTRICTED_HIGH_RISK`
  - still discoverable for simpler work
  - not promoted for high-risk custom or international work
- `RESTRICTED_ALL_NEW_ORDERS`
  - removed from normal discovery for new business
- `SUSPENDED`
  - removed from discovery entirely

### Why

Discovery should reflect the actual work the seller is allowed to do.

## Decision 6: Higher-Risk Capabilities Should Not Be Overexposed

### Chosen rule

If a seller is not cleared for:

- higher-risk custom sourcing
- international shipping

then discovery should not casually present them as a strong option for those paths.

### Why

That creates false confidence and messy order failure.

## Decision 7: New Sellers Need A Fair Cold-Start Path

### Chosen rule

Newly approved sellers should receive bounded discovery exposure instead of being buried under older accounts forever.

### Best V1 posture

- modest cold-start visibility
- no fake badge inflation
- no permanent ranking boost

### Why

A marketplace that never lets new good sellers surface becomes stale and unfair.

## Decision 8: One Bad Order Should Not Instantly Destroy Discovery, But Repeated Drift Should Matter

### Chosen rule

V1 should avoid ranking whiplash from a single low signal.

### Better pattern

- repeated reliability issues create meaningful down-rank
- stronger trust breaches trigger gating or removal faster

### Why

This matches the earlier split between quality drift and trust breach.

## Decision 9: Public Trust Signals Should Stay Legible

### Chosen rule

Visible trust cues should stay simple and honest:

- live status
- verification or tier badge where real
- review count and rating
- availability

### Why

Customers should not have to reverse-engineer an opaque hidden score.

## Decision 10: Avoid Paid Or Arbitrary Promotion In V1

### Chosen rule

For V1, Drape should avoid discovery logic that depends on:

- paid boosts
- informal favoritism
- manual hidden promotion that ignores trust or service quality

### Why

That would weaken trust in the marketplace too early.

## Decision 11: Future Product Should Model Discovery Inputs More Explicitly

### Chosen rule

When implemented later, useful fields and primitives likely include:

- `discovery_status`
- `discovery_downrank_reason`
- `cold_start_boost_until`
- `service_quality_state`
- `discovery_capability_scope`

### Why

Today some of this lives only in implied ranking logic and policy docs.

## Recommendation Summary

The cleanest V1 posture is:

- eligibility first
- then relevance plus reliability
- ratings are important but not enough
- restrictions should affect visibility by scope
- new sellers get bounded exposure
- discovery should stay honest, not opaque or pay-to-play

## Sources

- [Airbnb Help: How search results work](https://www.airbnb.com/help/article/3374)
- [Airbnb Terms excerpt on search ranking factors](https://www.airbnb.com/help/article/2908)
- [Etsy Help: Customer service standards](https://help.etsy.com/hc/articles/360036207794-How-to-Offer-Great-Customer-Service-on-Etsy?segment=selling)
- [Etsy Help: Star Seller metrics compared to customer service standards](https://help.etsy.com/hc/en-us/articles/29654393638679-How-Do-Star-Seller-Metrics-Compare-to-Customer-Service-Standards)
- [Fiverr Help: Level system](https://help.fiverr.com/hc/en-us/articles/360010560118-Achieving-Levels)
- [Fiverr Help: Success score](https://help.fiverr.com/hc/en-us/articles/21965360854673-Success-score)
