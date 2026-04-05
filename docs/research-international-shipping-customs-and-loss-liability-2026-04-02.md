# Research Notes: International Shipping, Customs, And Loss Liability

Date: April 2, 2026

## Why This Exists

Drape already supports shipping as a fulfillment concept, and seller profiles already expose international-shipping capability.

What is still ambiguous is:

- who pays duties and taxes
- what must be disclosed before payment
- when a customs delay is seller fault versus normal border friction
- what proof a tailor needs before saying an order is truly shipped
- how loss liability should work when a package crosses borders

This note is the research layer for that ambiguity.

## High-Signal Takeaways

- International shipping is not just domestic shipping with a longer ETA.
- Customs payer ambiguity is one of the fastest ways to create avoidable disputes.
- Documentation quality is not optional; it is part of whether a shipment moves at all.
- Africa’s cross-border logistics and trade costs are still high enough that international shipping should be treated as a higher-risk capability.
- For Drape, cross-border shipping should be disclosure-heavy, payout-conservative, and ops-aware.

## 1. What Drape Already Does Today

The product already has some of the right building blocks:

- tailor profiles can expose shipping and international-shipping capability
- orders already store `delivery_method`, `delivery_address`, `tracking_number`, and `carrier`
- `delivery-webhook` already handles tracking-provider updates
- the customer and tailor order screens already expose shipment state and tracking

But several important things are still not explicit:

- no clear `duties/taxes payer` field
- no customs-hold state
- no explicit international-shipping SLA or disclosure rule
- no strong distinction between domestic shipping risk and cross-border shipping risk

Important Drape ambiguity:

- the product can mark a seller as shipping-capable
- but the business rules for cross-border trust and loss allocation are still underdefined

## 2. Carrier Reality: Customs Charges Must Be Assigned Clearly

UPS’s current customs guidance is useful because it is very direct:

- either the shipper or receiver can be responsible for duties, taxes, and fees
- if the shipper pays, that is `DDP`
- if the receiver pays, that is `DDU`
- if the receiver is expected to pay, they should be told in advance
- if the receiver does not pay, the carrier may still recover the outstanding amount from the shipper

Important Drape takeaway:

- cross-border shipping cannot rely on vague assumptions like “the customer will handle customs somehow”
- the payer rule should be explicit before checkout or quote acceptance

## 3. Carrier Reality: Documentation Errors Cause Delays And Holds

DHL’s customs guidance makes the operational point very clearly:

- complete and accurate customs paperwork is required
- generic item descriptions are not acceptable
- HS code quality matters
- missing or incomplete documentation causes delays
- country-specific rules can restrict or prohibit certain goods

Important Drape takeaway:

- “shipped” should not mean “I handed a package to someone with weak paperwork”
- the seller side needs stronger expectations for documentation quality if Drape ever expands cross-border shipping

## 4. Africa Trade Reality: Cross-Border Logistics Are Still Expensive And Friction-Heavy

African Development Bank material still points to the same structural problems:

- poor transport and communications infrastructure remain trade constraints
- unreliable power still interferes with trade
- complex customs arrangements still slow cross-border movement
- transport and logistics costs in Africa remain unusually high

This matters for Drape because a cross-border fashion order is sensitive to:

- delay
- documentation quality
- last-mile visibility
- buyer surprise charges
- event timing

Important Drape takeaway:

- international shipping should not be treated as a casual capability toggle
- it should be treated as a higher-risk operating mode

## 5. The Biggest Marketplace Risk Is Surprise At Delivery

The most avoidable cross-border dispute shape is:

- the order looked paid and complete inside the marketplace
- the customer then gets hit with duties, taxes, brokerage fees, or customs requests they did not expect
- delivery stalls
- everyone blames everyone else

Important Drape takeaway:

- if the receiver is expected to pay import charges, that has to be disclosed before payment
- if the seller is claiming an all-in price, that promise has to be real

## 6. Loss And Delay Need Better Blame Allocation Than “Carrier Problem”

Cross-border shipping creates several different failure modes:

### Before carrier acceptance

- seller still controls the goods
- if the package is never properly accepted into the shipment network, this is usually seller-side risk

### After carrier acceptance, before delivery

- loss may sit with the carrier operationally
- but customer protection still matters at marketplace level
- payout should stay conservative while the situation is unresolved

### Customs hold

This is not automatically one party’s fault.

Possible causes include:

- incomplete or inaccurate paperwork
- wrong or vague product description
- unpaid duties or taxes
- restricted goods
- random or normal inspection delay

Important Drape takeaway:

- Drape needs a rule that separates seller documentation fault from ordinary customs friction

## 7. Event-Critical Orders And International Shipping Are A Dangerous Mix

This layer overlaps heavily with deadline policy.

Important cross-border reality:

- customs, border processing, and last-mile delivery add uncertainty that a seller cannot fully control
- that uncertainty is especially dangerous for wedding, ceremony, or other fixed-date garments

Important Drape takeaway:

- event-critical international shipments should be treated as higher risk than standard domestic shipping
- first-order custom garments plus international delivery should not get casual deadline promises

## 8. What This Means For Drape

The cleanest current business direction is:

- keep international shipping behind stronger seller capability gates
- require customs-charge disclosure before payment
- require stronger shipping evidence
- keep payout more conservative than normal domestic shipping
- use ops review more often on cross-border failures

## 9. Strong Working Recommendation

The best V1 stance is not:

- disable every international order forever

But it is also not:

- let any verified tailor ship anywhere as long as they type a tracking number

The better answer is:

- international shipping is higher risk
- it needs explicit duties/taxes disclosure
- it needs better documentation expectations
- it needs conservative payout handling
- it should stay more ops-visible than domestic shipping

## Sources

- [UPS: Understanding Customs](https://www.ups.com/us/en/support/international-tools-resources/understanding-customs)
- [DHL Express: Customs Duties and Taxes guide](https://www.dhl.com/us-en/home/express/shipping-and-tracking/customs/customs-clearance/customs-duties-and-taxes.html)
- [African Development Bank: Dry ports operations in Africa](https://www.afdb.org/en/documents/multinational-developing-guidelines-dry-ports-operations-africa)
- [African Development Bank: Impediments to Regional Trade Integration in Africa](https://www.afdb.org/en/documents/document/africa-economic-brief-impediments-to-regional-trade-integration-in-africa-24698)
- [UNCTAD: Global e-commerce logistics interview](https://unctad.org/news/global-e-commerce-logistics-2018-interview-experts-transport-intelligence-ti)
