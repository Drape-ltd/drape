# Research Notes: Seller Ranking And Discovery Fairness

Date: April 2, 2026

## Why This Exists

Drape already has customer discovery and search surfaces, and those surfaces already use trust-adjacent inputs like:

- ratings
- reviews
- availability
- response time
- `is_live`
- ranking score

What is still ambiguous is:

- what discovery should reward
- how trust or reliability problems should affect visibility
- how new sellers get a fair chance
- whether high-risk capability restrictions should also change what the customer sees

This note is the research layer for that ambiguity.

## High-Signal Takeaways

- Mature marketplaces rank on a mix of relevance and service quality, not only popularity.
- Search visibility is often affected by response quality, fulfillment reliability, and case history.
- Badges and public trust signals work best when they reflect real underlying performance rules.
- Discovery fairness is not only about helping new sellers; it is also about not overexposing risky sellers.
- Drape should avoid a black-box ranking story in V1.

## 1. What Drape Already Does Today

The current mobile discovery and search flows already expose a meaningful trust surface.

Important current inputs include:

- `is_live`
- `availability`
- `avg_rating`
- `total_reviews`
- `avg_response_hours`
- seller tier
- specialty tags
- support for custom or ready-made work

The repo also already relies on a backend `ranking_score` in customer discovery and search.

Important Drape strength:

- the product already thinks in terms of relevance plus trust signals

Important Drape gap:

- the business rules for that ranking are not yet clearly documented
- there is no written answer for how seller restrictions or reliability drift should change discovery
- the difference between “eligibility gate” and “ranking boost” is still too implicit

## 2. Airbnb Pattern: Search Mixes Relevance With Quality And Reliability

Airbnb’s current help and terms materials are helpful here.

Their current search explanations say ranking considers factors like:

- price
- quality
- popularity
- location
- availability
- reviews and ratings
- customer service and cancellation history
- host status
- booking ease

Important Drape takeaway:

- good marketplace discovery is not just “who looks nicest”
- operational reliability is part of search quality

## 3. Etsy Pattern: Service Standards Affect Search Visibility

Etsy’s current seller guidance makes this even more explicit.

Their help center says customer service standards cover:

- message response rate
- on-time shipping and tracking
- average review rating
- case rate

And Etsy explicitly says not maintaining those standards can:

- lower search visibility
- affect account status

Important Drape takeaway:

- discovery should react to service quality, not only public reviews
- case rate and fulfillment quality belong in marketplace visibility decisions

## 4. Fiverr Pattern: Public Levels Reflect Consistent Multi-Metric Performance

Fiverr’s current level system adds another useful pattern:

- visible seller levels
- a broader success score
- response rate
- ratings
- completed orders
- unique clients
- manual evaluation for top-tier status

Important Drape takeaway:

- public trust badges can be useful
- but they work better when they reflect a broader pattern than “one big order went well”

## 5. Drape Should Separate Eligibility From Ranking

This is the most important Drape-specific conclusion.

Some things should be hard eligibility gates:

- `is_live`
- trust approval
- payout readiness for paid work
- higher-risk capability approval where relevant

Other things should be ranking inputs:

- ratings
- review count
- response time
- availability
- deadline reliability
- recent concern/case patterns

Important Drape takeaway:

- do not mix “allowed to appear” with “ranked higher once eligible”

## 6. Restrictions Should Affect Discovery In A Scoped Way

This connects directly to the earlier trust-restriction research.

Important Drape takeaway:

- `WATCHED` should not necessarily vanish from discovery
- `RESTRICTED_HIGH_RISK` should likely lose visibility for high-risk custom or international pathways while staying discoverable for simpler work
- `RESTRICTED_ALL_NEW_ORDERS` and `SUSPENDED` should not keep normal discovery exposure

This helps Drape avoid two bad outcomes:

- over-punishing recoverable reliability problems
- under-reacting to serious trust risk

## 7. New Seller Fairness Matters Too

A marketplace can accidentally become unfair if:

- old sellers accumulate all the trust
- new sellers never get enough visibility to prove themselves

The outside signal suggests a better approach:

- allow trust-gated new sellers into discovery
- give them some bounded exposure
- do not let a single order swing rank too hard either way

Important Drape takeaway:

- new sellers need a real cold-start path
- but that path should still sit inside trust and capability gates

## 8. What This Means For Drape

The cleanest current direction is:

- trust gates determine who can appear at all
- ranking then blends relevance and reliability
- restrictions should change both ranking and capability exposure where needed
- cold-start should be fair but bounded
- Drape should resist a mysterious internal score as the only explanation

## 9. Strong Working Recommendation

The best V1 stance is:

- reward relevance, availability, responsiveness, and fulfillment reliability
- down-rank repeat service problems before full suspension when appropriate
- remove or sharply limit discovery for sellers who should not receive new orders
- keep high-risk capabilities from being overexposed when a seller is only approved for simpler work
- support fair cold-start visibility for newly approved sellers

## Sources

- [Airbnb Help: How search results work](https://www.airbnb.com/help/article/3374)
- [Airbnb Terms excerpt on search ranking factors](https://www.airbnb.com/help/article/2908)
- [Etsy Help: Customer service standards](https://help.etsy.com/hc/articles/360036207794-How-to-Offer-Great-Customer-Service-on-Etsy?segment=selling)
- [Etsy Help: Star Seller metrics compared to customer service standards](https://help.etsy.com/hc/en-us/articles/29654393638679-How-Do-Star-Seller-Metrics-Compare-to-Customer-Service-Standards)
- [Fiverr Help: Level system](https://help.fiverr.com/hc/en-us/articles/360010560118-Achieving-Levels)
- [Fiverr Help: Success score](https://help.fiverr.com/hc/en-us/articles/21965360854673-Success-score)
