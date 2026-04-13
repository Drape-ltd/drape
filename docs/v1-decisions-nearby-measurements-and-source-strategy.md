# V1 Decisions: Nearby Measurements And Measurement Source Strategy

Date: April 2, 2026

## Why This Exists

Drape needs a clear answer to:

- how customers can get measured accurately
- whether nearby professional measurement is supported
- whether Drape should build a partner network now

This document locks the recommended V1 stance.

## Decision 1: Support Nearby Professional Measurement Conceptually

### Chosen rule

For V1, Drape should support the idea that a customer can get measured by a nearby professional.

Valid examples:

- local tailor
- alterations specialist
- bridal fitter
- menswear showroom fitter

### Why

- this matches how real customers already solve fit problems
- it is more realistic than forcing self-measurement for every case

## Decision 2: Do Not Build A Verified Partner Network In V1

### Chosen rule

Drape should not launch with a formal verified nearby-measurement partner network.

### Why

- heavy ops burden
- uneven quality across locations
- difficult accountability
- customers may misread a listing as a Drape fit guarantee

## Decision 3: Do Not Make Nordstrom Or Any Single Retailer The Product

### Chosen rule

We should not present Nordstrom, Suitsupply, or any single chain as the official path.

### Why

- quality varies by store and fitter
- Drape should not become dependent on one retailer relationship
- the real product idea is `measurement source`, not brand integration

## Decision 4: Measurement Source Matters More Than Measurement Location Branding

### Chosen rule

For V1 and slightly beyond, Drape should treat measurements as having a source.

Working source list:

- `SELF_GUIDED`
- `HELPER_GUIDED`
- `TAILOR_CAPTURED`
- `EXTERNAL_PRO_CAPTURED`
- `IMPORTED`

### Why

- source helps tailors judge confidence
- source helps ops resolve blame later
- source scales better than hard-coded partner logic

## Decision 5: Tailor Passport Is The Strongest In-Product Measurement Trust Path Right Now

### Chosen rule

Drape should lean on the existing tailor diary and measurement passport path before building a bigger network.

### Why

- it already supports real-world fitting sessions
- it preserves who captured the measurements
- it already brings offline measurement into the customer profile cleanly

## Decision 6: Nearby Measurement Should Be A Flexible Input Path First

### Chosen rule

The first usable product shape should be:

- customer can say they were measured by a professional
- customer can enter or upload those measurements
- the source can later include simple metadata

Suggested later metadata:

- business name
- city
- measured date
- optional notes

## Decision 7: Tailors Must Still Be Able To Request Confirmation

### Chosen rule

Even if measurements came from a professional, the tailor should still be able to request clarification before cutting.

### Why

- professional measurement improves confidence but does not eliminate fit risk
- garments, style, and body posture still matter

## Decision 8: A Curated Resource List Is Safer Than A Verified Network At First

### Chosen rule

If Drape wants to be more helpful soon, the next step should be a lightweight resource list or guidance page, not a deeply integrated partner marketplace.

### Example posture

- "You can get measured by a local tailor, alterations desk, bridal fitter, or menswear showroom."
- "Drape does not currently certify third-party measurement providers."

## Recommendation Summary

The cleanest V1 approach is:

- keep guided self-measurement
- recognize nearby professional measurement as valid
- do not launch a verified measurement-partner network yet
- use measurement source, not retailer branding, as the key concept
- lean on the tailor passport path as the strongest current trust story

## Sources

- [Nordstrom Local](https://press.nordstrom.com/news-releases/news-release-details/nordstrom-announces-latest-retail-concept-nordstrom-local/)
- [INDOCHINO showrooms](https://www.indochino.com/showrooms)
- [Proper Cloth showrooms](https://propercloth.com/showrooms)
- [Suitsupply Size Passport](https://suitsupply.com/en-ie/journal/size-passport.html)
- [Men's Wearhouse measurements](https://tuxedo.menswearhouse.com/measurements/get)
- [CloudTailor FAQs](https://www.cloudtailor.com/faqs/)
