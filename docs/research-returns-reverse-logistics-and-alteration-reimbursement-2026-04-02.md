# Research Notes: Returns, Reverse Logistics, And Alteration Reimbursement

Date: April 2, 2026

## Why This Exists

Drape now has stronger thinking around:

- concerns and disputes
- remedy ladders
- payout blocking

But there is still a practical gap around what happens when a garment needs to move backward instead of forward.

We still need a clear answer to:

- when a garment must be returned
- who pays return shipping
- when local alteration credit is better than a return
- when a customer can keep the garment and still get a partial refund

This note is the research layer for that policy.

## High-Signal Takeaways

- Mature marketplaces separate the cash decision from the logistics decision.
- Return logistics are usually coordinated explicitly: destination, deadline, and who pays.
- Custom-clothing businesses often prefer local alterations or remakes over retail-style returns.
- Alteration reimbursement only works well when it has:
  - a deadline
  - a receipt requirement
  - a cap
  - a rule against stacking with remake/refund
- For Drape, reverse logistics should depend heavily on:
  - `READY_MADE` vs `CUSTOM`
  - seller-fault vs customer-fault
  - whether the garment is still salvageable
  - whether returning it actually helps

## 1. What Drape Models Today

Current Drape order and fulfillment modeling includes:

- `SHIPPING`
- `LOCAL_COLLECTION`
- shipped delivery updates
- collection code flow
- concern/dispute state

Important gap:

- there is no real return stage
- there is no return-label workflow
- there is no alteration-reimbursement field
- there is no reverse-logistics tracking model

Important Drape inference:

For V1, returns and alteration reimbursement should likely be handled as an ops-mediated concern subflow, not as a fake fully-automated return system.

## 2. Marketplace Pattern: Return Logistics Must Be Explicit

Etsy’s current return-help guidance says sellers and buyers should explicitly coordinate:

- where the item should be sent
- the time frame
- who pays return shipping

Etsy also says the seller can:

- purchase the return label
- let the buyer buy it
- issue a partial refund to recoup shipping costs depending on the agreement

Important Drape takeaway:

- return logistics should not be assumed
- even on a mature marketplace, these details are spelled out directly

## 3. Marketplace Pattern: Retail Returns And Custom Garments Behave Differently

Etsy’s return help also makes clear that returns are often seller-policy-led unless the issue fits purchase-protection criteria.

That feels normal for marketplace retail.

But custom-clothing brands usually do not act like open retail return systems.

INDOCHINO’s current return policy says:

- no refunds are offered because garments are custom
- fit issues should go through alteration support
- claims must be raised within `14 days`

Proper Cloth’s current policy is more flexible, but still structured:

- remakes require the original garment to be returned
- some garments can be altered locally instead of remade
- tailored items that have already been altered are not eligible for return/remake/refund

Important Drape takeaway:

- `READY_MADE` can be somewhat more return-like
- `CUSTOM` should usually be remedy-led first

## 4. Alteration Reimbursement Is A Real Custom-Apparel Pattern

Proper Cloth’s current policy says:

- it reimburses local tailoring as store credit for certain garment types
- requests must be initiated within `60 days`
- a photo of the receipt is required
- the credit has garment-based caps
- items that receive tailoring reimbursement are not eligible for remake, refund, or store-credit return

INDOCHINO’s current help center says:

- if the customer is not near a showroom, they can use a local tailor
- reimbursement requires an itemized receipt and a claim opened within `14 days`
- there are maximum reimbursement amounts by garment type
- the customer should not proceed if the local tailor quote exceeds the allowance

Important Drape takeaway:

- local tailoring credit can be a strong remedy for minor fit problems
- but only if it is controlled tightly

## 5. Reverse Logistics For Remakes Is Different From Reverse Logistics For Refunds

Proper Cloth’s current remake help says:

- customers must send back the original custom garment when a remake is provided
- a prepaid return label is included for eligible orders
- the item should be sent back within `30 days` of the remake order date

Its return policy also says:

- if a customer later wants a full refund after receiving a complimentary remake, both the original and remade garments must be returned

Important Drape takeaway:

- remake logistics and refund logistics are related, but not identical
- if Drape later offers remake support, it should not casually leave the original garment floating around with no policy

## 6. Not Every Seller-Fault Issue Needs A Physical Return

Some issue types are better handled without forcing the garment back immediately.

Examples:

- minor fit issue that a local tailor can correct
- minor workmanship fix that is cheaper than reverse shipping
- a damaged or clearly incorrect low-value item with little salvage value

Important Drape takeaway:

- a blanket “return first, then we’ll talk” rule is too rigid
- sometimes the return adds more friction than evidence

## 7. Some Cases Do Need A Return Or Handoff

Examples:

- wrong ready-made item shipped
- non-trivial seller-fault issue where replacement/refund depends on getting the item back
- high-value item where keeping the item plus refund creates fraud risk
- remake where the tailor needs the original back

Important Drape takeaway:

- return requirement should be tied to remedy and fraud risk
- not every dispute should create a return, but some definitely should

## 8. Social Signal

Directional community signal around custom clothing keeps pointing to the same problems:

- customers get frustrated when alteration allowances are too low to fix the real problem
- customers hate vague “no refund” answers after multiple failed fit attempts
- local tailoring reimbursement is appreciated when it avoids shipping delays for minor fixes

The signal is not policy by itself, but it reinforces the official patterns above.

## 9. Main Drape Product Questions

## A. Should Drape require a return before every refund?

Likely answer:

- no

Why:

- some garments are custom and low-resale
- some issues are obvious from evidence
- some remedies work better without reverse shipping

## B. Should Drape allow keep-item partial refunds?

Likely answer:

- yes, in bounded cases

Best cases:

- low-value seller-fault issue
- minor damage or imperfection
- alteration reimbursement
- return cost exceeds salvage value

## C. Should alteration reimbursement be stackable with remake or full refund?

Likely answer:

- no, not by default

Why:

- Proper Cloth and INDOCHINO both show that local alterations need guardrails
- stacking makes abuse and double-compensation much easier

## 10. Working Recommendation

The cleanest V1 posture is:

- no universal return-first rule
- `READY_MADE` can use return-required remedies more often
- `CUSTOM` should prefer:
  - local alteration credit
  - remake
  - partial refund
before forcing retail-style returns
- seller-fault return shipping should not be pushed onto the customer
- alteration reimbursement should require:
  - concern still open
  - receipt
  - deadline
  - cap
  - no stacking with remake/full refund by default

## Sources

Official sources:

- [Etsy: How to Help a Buyer With a Return](https://help.etsy.com/hc/en-us/articles/360022953514-How-to-Help-a-Buyer-With-a-Return)
- [Etsy: How to Return or Exchange an Item on Etsy](https://help.etsy.com/hc/en-us/articles/115015440807-How-to-Return-or-Exchange-an-Item-on-Etsy)
- [Etsy: How to Purchase a USPS Return Shipping Label](https://help.etsy.com/hc/en-us/articles/360044108353-How-to-Purchase-a-USPS-Return-Shipping-Label)
- [Etsy: How to Issue a Full or Partial Refund For an Order](https://help.etsy.com/hc/en-us/articles/360002089188-How-to-Issue-a-Full-or-Partial-Refund-For-an-Order)
- [Proper Cloth Return Policy](https://propercloth.com/return-policy)
- [Proper Cloth: How to Return a Product](https://propercloth.com/reference/how-to-return-a-product)
- [Proper Cloth: Remake Requested - How to Return the Original Item](https://propercloth.com/reference/remake-requested-how-to-return-the-original-item/)
- [Proper Cloth: Having a Garment Altered by Your Tailor](https://propercloth.com/reference/how-to-have-your-garment-altered-locally/)
- [INDOCHINO: What is the Return Policy?](https://support.indochino.com/hc/en-us/articles/360034710293-What-is-the-Return-Policy)
- [INDOCHINO: My suit doesn't fit, what options do I have?](https://support.indochino.com/hc/en-us/articles/360034773473-My-suit-doesn-t-fit-what-options-do-I-have)
- [INDOCHINO: How much does INDOCHINO reimburse for local alterations?](https://support.indochino.com/hc/en-us/articles/360051485553-How-much-does-INDOCHINO-reimburse-for-local-alterations)
- [INDOCHINO: How do I get reimbursed for alterations?](https://support.indochino.com/hc/en-us/articles/360034710213-How-do-I-get-reimbursed-for-alterations)
- [INDOCHINO: My garment is not alterable, what do I do next?](https://support.indochino.com/hc/en-us/articles/360050400954-My-garment-is-not-alterable-what-do-I-do-next)
