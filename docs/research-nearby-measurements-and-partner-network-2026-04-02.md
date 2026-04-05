# Research Notes: Nearby Measurements, Measurement Partners, And Fit Trust

Date: April 2, 2026

## Why This Exists

There is a real product opportunity in letting customers get measured by someone nearby instead of relying only on self-measurement.

But "go somewhere like Nordstrom" can mean several different things:

- a one-time professional measurement
- an alterations/fitting appointment
- a full custom-clothing showroom experience
- a Drape-verified measurement partner

Those are not the same thing.

This document looks at what the market does, what Drape already has, and what the safest V1 direction is.

## High-Signal Takeaways

- Serious custom-clothing businesses rarely bet everything on raw self-measurement.
- In-person fitting or measurement support is common, but the market usually treats it as part of a broader service relationship, not a neutral public utility.
- Retailers like INDOCHINO, Proper Cloth, Suitsupply, and Men's Wearhouse all use some version of showroom or expert fitting support.
- Nordstrom clearly has tailoring/fitting capability, but that does not make it a standardized Drape-ready measurement network.
- Quality and consistency vary by location and fitter, even inside recognizable brands.
- Drape should treat "professional measurement" as a measurement source, not as a guaranteed quality badge.
- The strongest Drape-specific asset we already have is the tailor measurement passport flow, which already supports offline capture turning into reusable profile data.

## 1. What Drape Supports Today

Drape currently supports:

- customer self-managed measurement profile
- tailor-captured offline client measurements in the diary flow
- measurement passport claim into the customer profile
- order-level measurement snapshots

This is already an important foundation.

What it means:

- Drape can already preserve fitter-captured measurements
- Drape can already move measurements from a real-world appointment into the product

## Important current gap

Drape does not yet explicitly model:

- measurement source on profile or order
- external professional measurement metadata
- nearby measurement directory
- verified measurement partners
- measurement confidence level

## 2. What The Market Actually Does

## Pattern A: Brand-owned showroom fitting

This is common among serious custom-clothing brands.

Examples:

- INDOCHINO showrooms take measurements, help customize, and then handle follow-up alterations
- Proper Cloth showrooms help customers create or refine a custom size
- Suitsupply stores can create and save a "Size Passport"
- Men's Wearhouse lets customers get measured in store or use an online fit tool

## Product lesson

The market pattern is:

- measurement is a service relationship
- measurements are saved
- fit usually still gets refined later

## Pattern B: Guided remote measurement with human help

This is also common.

Examples:

- INDOCHINO offers a guided at-home process with a friend and a measuring tape
- Proper Cloth offers virtual consultation when a physical showroom is not available

## Product lesson

Self-measurement is usually not presented as:

- "just enter some numbers and trust the result forever"

It is usually framed as:

- guided capture
- sometimes with helper support
- with fit refinement later

## Pattern C: Tailor passport / saved size profile

This is the pattern Drape is already closest to.

Examples:

- Suitsupply stores measurements in a reusable Size Passport
- Drape already has a tailor diary plus measurement passport claim flow

## Product lesson

This is strong because:

- the customer keeps reusable fit data
- the platform can remember who captured it
- later reorders become easier

## Pattern D: AI / body-scan measurement

This exists and is getting better, but it is still a product choice with real tradeoffs.

Examples:

- 3DLOOK markets remote body scanning and a "Mobile Tailor" flow for made-to-measure businesses

## Product lesson

This is promising later, but it is not the safest trust-first V1 move because:

- it adds vendor dependence
- it still needs fit accountability rules
- it can create overconfidence if framed carelessly

## 3. What "Professional Measurement" Should Mean For Drape

The phrase sounds simple, but it needs a product definition.

Recommended Drape meaning:

- measurements captured in person by a tailor, fitter, alteration specialist, bridal fitter, or showroom specialist

It should not automatically mean:

- Drape endorses the provider
- perfect fit is guaranteed
- no fit review is needed later

## Important product lesson

Professional measurement should improve confidence.
It should not erase accountability or the need for follow-up fit review.

## 4. Why Nordstrom Is Useful Signal, But Not A Product Dependency

Official Nordstrom signal shows:

- Nordstrom Local includes onsite alterations and tailoring
- Nordstrom tailoring roles explicitly include measuring customers, fitting garments, and marking alteration areas

This supports the idea that Nordstrom staff can be a legitimate source of measurement help.

But it does not mean:

- there is a public measurement API
- every location provides the same measurement experience
- Drape should present Nordstrom as an official structured pipeline

## Product inference

"Go to Nordstrom" is a real user instinct.

But V1 should translate that instinct into:

- "Get measured by a nearby professional and record the source"

not:

- "Use Nordstrom as a Drape integration"

## 5. The Strongest Existing Drape Route: Tailor-Captured Passport

This is the best near-term Drape-specific path because it already fits how tailoring really works.

Drape already supports:

- offline fitting sessions
- captured measurement context
- passport sharing
- customer profile import

That means Drape already has a usable story for:

- a local fitting with a real tailor
- a walk-in measurement session
- a follow-up "bring these measurements into Drape" flow

## Product inference

Before building a partner network, Drape should probably strengthen and explain the passport path better.

## 6. Three Product Shapes Drape Could Choose

## Option A: Freeform external source

Flow:

- customer says they were measured by a professional
- customer enters values
- customer records business name, city, and date

Pros:

- fast
- flexible
- low ops burden

Cons:

- weak verification
- easy to fake

## Option B: Nearby measurement directory

Flow:

- Drape suggests local categories or partner-like locations
- customer books outside Drape
- customer returns with measurements

Pros:

- more guidance
- still low integration burden

Cons:

- stale listings risk
- weak quality control
- customer may assume endorsement

## Option C: Verified Drape partner network

Flow:

- Drape vets specific fitters or shops
- customer books them as a trusted source
- source is treated differently in-product

Pros:

- strongest trust signal
- best long-term marketplace moat

Cons:

- heavy ops
- local-market complexity
- quality assurance burden
- hard to do well across cities and countries early

## 7. Best V1 Recommendation

The safest V1 shape is:

- do not build a verified partner network yet
- do not hard-code Nordstrom or any single chain
- support measurement source as metadata
- explain that nearby professional measurement is valid
- keep the tailor passport path as the strongest existing in-product source

### Practical V1 source types

- `SELF_GUIDED`
- `HELPER_GUIDED`
- `TAILOR_CAPTURED`
- `EXTERNAL_PRO_CAPTURED`
- `IMPORTED`

### Useful metadata for `EXTERNAL_PRO_CAPTURED`

- business name
- city / location
- measured date
- optional notes
- optional receipt / card / photo upload later

## 8. What A Nearby Measurement Experience Should Feel Like

The clean V1 customer experience is not:

- "Find an official Drape fitter now"

It is more like:

1. customer sees that self-measurement is one path
2. customer can choose "measured by a professional"
3. Drape explains acceptable sources:
   - local tailor
   - alteration specialist
   - bridal fitter
   - menswear showroom
4. customer enters or uploads the measurements
5. tailor sees the source and can still request confirmation if needed

## 9. Nearby Measurement Risks

If Drape moves too fast into a partner story, these risks appear:

- stale partner information
- uneven service quality
- customer assumes Drape guarantees fit
- blame becomes messy when measurements were taken by a third party
- ops has to mediate disputes involving businesses that are not really inside Drape

## 10. Best Product Lesson

The market lesson is not:

- "everyone needs a measurement network"

The real lesson is:

- customers need a credible way to get fit data into the system
- tailors need to know how much to trust that data
- the platform needs to preserve source and accountability

## Recommended Future Direction

### V1

- strengthen measurement-source language
- support nearby professional measurement conceptually
- rely on self-guided, passport, and external-pro capture

### Slightly later

- add source metadata and confidence state
- add "needs measurement confirmation" flag
- maybe add a curated non-endorsed resource list by city

### Much later

- verified Drape fit partners
- booking workflow
- partner SLAs or standards

## Sources

Official brand / retailer / fitting-process sources:

- [Nordstrom Local press release](https://press.nordstrom.com/news-releases/news-release-details/nordstrom-announces-latest-retail-concept-nordstrom-local/)
- [Nordstrom tailor role](https://careers.nordstrom.com/alterations-tailor-shop-tailor-easton-town-center/job/EC7CCA1FE5E8C665D9B91D68172A9217)
- [INDOCHINO showrooms](https://www.indochino.com/showrooms)
- [INDOCHINO process](https://support.indochino.com/hc/en-us/articles/360038002894-How-does-our-process-work)
- [Proper Cloth showrooms](https://propercloth.com/showrooms)
- [Suitsupply Size Passport](https://suitsupply.com/en-ie/journal/size-passport.html)
- [Men's Wearhouse get measured](https://tuxedo.menswearhouse.com/measurements/get)
- [CloudTailor FAQs](https://www.cloudtailor.com/faqs/)

Measurement-tech / alternative-capture sources:

- [3DLOOK Mobile Tailor](https://3dlook.ai/mobile-tailor/for-made-to-measure/)
- [3DLOOK product overview](https://3dlook.ai/mobile-tailor/)

Directional social signal:

- [Reddit: suit buying and needing measurements](https://www.reddit.com/r/malefashionadvice/comments/1s5jhq5/buy_a_suit_at_nordstrom_rack_etc_or_jos_a_bank/)
