# V1 Decisions: International Shipping, Customs, And Loss Liability

Date: April 2, 2026

## Why This Exists

Drape needs a practical rule for:

- when a tailor can ship internationally
- who pays duties and taxes
- what must be disclosed before payment
- when a delay is seller fault versus normal customs friction
- how payout and remedy should behave if a cross-border shipment goes wrong

This document turns the research into a working V1 stance.

## Core Principle

Treat international shipping as a higher-risk, disclosure-heavy capability.

## Decision 1: International Shipping Stays A Higher-Risk Seller Capability

### Chosen rule

For V1, international shipping should stay inside the higher-risk capability bucket.

### What that means

- not every payout-ready seller automatically gets it
- ops approval or stronger trust signals should remain normal at first

### Why

Cross-border shipping adds customs, transport, and last-mile risk that domestic flows do not carry.

## Decision 2: Duties And Taxes Payer Must Be Explicit Before Payment

### Chosen rule

For any international shipping order, Drape should make the customs-charge mode explicit before payment.

### Minimum V1 modes

- `RECEIVER_PAYS`
- `SELLER_PAYS_INCLUDED`

### Not allowed

- silent receiver charges
- vague “customs may apply” language after payment

### Why

Surprise import charges are one of the easiest avoidable dispute triggers in cross-border commerce.

## Decision 3: V1 Should Default To Conservative Cross-Border Disclosure

### Chosen rule

If the seller is not truly shipping duties-paid, Drape should default to a clear receiver-pays disclosure model rather than pretending the total is all-in.

### Why

That is safer than hiding border costs inside ambiguity.

## Decision 4: “Shipped” Requires Real Shipment Evidence

### Chosen rule

For international shipping, a seller should not be treated as fully shipped unless there is real shipment evidence, at minimum:

- carrier
- tracking number
- carrier acceptance or actual dispatch event

### Why

Cross-border risk is too high for soft or informal shipment claims.

## Decision 5: Documentation Error Is Seller-Side Responsibility

### Chosen rule

If a shipment is delayed, held, or rejected because of seller-side documentation problems, Drape should treat that as seller fault.

### Examples

- inaccurate or incomplete paperwork
- vague item descriptions
- wrong customs coding
- prohibited or improperly declared goods
- promised all-in shipping that was not actually arranged

### Why

These are avoidable operational errors, not neutral shipping luck.

## Decision 6: Ordinary Customs Friction Is Not Automatically Seller Fault

### Chosen rule

If customs delay happens despite apparently proper shipment preparation, Drape should not instantly classify it as seller fault.

### Best V1 stance

- keep payout blocked while the order is unresolved
- keep the customer protected
- route uncertain cases to ops review

### Why

Border processes can create delay without obvious seller misconduct.

## Decision 7: Receiver Non-Payment Of Disclosed Duties Is Not The Same As Seller Failure

### Chosen rule

If the customer was clearly told that import charges would be receiver-paid and then does not pay them, Drape should not treat that as standard seller fault.

### Important nuance

This only applies if disclosure was genuinely clear before payment.

### Why

Undisclosed charges are a seller/platform problem.
Disclosed charges refused by the receiver are a different issue.

## Decision 8: International Shipping Should Use More Conservative Payout Handling

### Chosen rule

For V1, cross-border shipments should not use the loosest payout assumptions.

### Best V1 recommendation

- keep payout blocked until delivery is evidenced and the concern window is clear
- use longer or more ops-visible review before release if the route is especially risky

### Why

Cross-border failure recovery is slower and more ambiguous than domestic shipping.

## Decision 9: Event-Critical International Orders Need Stronger Caution

### Chosen rule

International shipping should not casually carry event-date promises.

### Best V1 stance

- if the garment is event-critical and the route is cross-border, the seller should be more cautious about accepting
- first-order custom plus international delivery should be treated as especially risky

### Why

Customs and long-haul logistics reduce deadline certainty too much for casual promises.

## Decision 10: Reverse Logistics For International Orders Stay Ops-Mediated

### Chosen rule

If an international order needs return, remake, or cross-border recovery, V1 should keep that flow ops-mediated.

### Why

Drape does not yet have first-class customs-aware reverse logistics tooling.

## Decision 11: International Loss Cases Need Marketplace-Level Customer Protection

### Chosen rule

If a cross-border package is genuinely lost or never properly reaches the customer, Drape should not treat “carrier problem” as a reason to release seller payout casually.

### Best V1 stance

- payout stays blocked
- ops determines whether remedy is replacement, refund, or carrier-claim waiting path

### Why

The customer should not carry cross-border operational risk alone.

## Decision 12: Future Product Should Model Cross-Border Shipping More Explicitly

### Chosen rule

When implemented later, useful fields likely include:

- `destination_country`
- `ship_from_country`
- `customs_charge_mode`
- `customs_disclosed_at`
- `customs_hold_reason`
- `cross_border_status`
- `cross_border_review_required`

### Why

Current shipping fields are not expressive enough for cross-border trust and liability.

## Recommendation Summary

The cleanest V1 posture is:

- keep international shipping in the higher-risk seller bucket
- require explicit duties/taxes payer disclosure before payment
- require stronger shipment proof
- treat documentation mistakes as seller fault
- treat ordinary customs delay as ops-reviewable, not automatically seller fault
- keep payout conservative
- keep international reverse logistics and loss cases ops-mediated

## Sources

- [UPS: Understanding Customs](https://www.ups.com/us/en/support/international-tools-resources/understanding-customs)
- [DHL Express: Customs Duties and Taxes guide](https://www.dhl.com/us-en/home/express/shipping-and-tracking/customs/customs-clearance/customs-duties-and-taxes.html)
- [African Development Bank: Dry ports operations in Africa](https://www.afdb.org/en/documents/multinational-developing-guidelines-dry-ports-operations-africa)
- [African Development Bank: Impediments to Regional Trade Integration in Africa](https://www.afdb.org/en/documents/document/africa-economic-brief-impediments-to-regional-trade-integration-in-africa-24698)
- [UNCTAD: Global e-commerce logistics interview](https://unctad.org/news/global-e-commerce-logistics-2018-interview-experts-transport-intelligence-ti)
