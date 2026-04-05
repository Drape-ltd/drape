# Research Notes: Refunds, Disputes, And Payout Liability

Date: April 2, 2026

## Why This Exists

As Drape gets closer to real payments and fulfillment, we need a grounded answer to questions like:

- when should a customer get a full refund, partial refund, remake, or alteration support?
- when can a tailor fairly be paid out?
- who carries dispute liability on Stripe and Paystack?
- how should custom orders behave when measurements, fabric, or expectations go wrong?

This document is research and product guidance, not final policy text.

## High-Signal Takeaways

- Stripe and Paystack both support refunds, but they do not make Drape an escrow platform.
- On Stripe Connect, the platform is often the party that gets hit first for refunds and disputes, especially with destination charges and separate charges and transfers.
- Paystack disputes move fast; merchants are expected to respond quickly and provide evidence.
- Custom-work businesses commonly use deposits, short fit-remedy windows, and limited refundability after work or material ordering begins.
- The biggest customer pain points are not just bad fit. They are ambiguity, slow resolution, and feeling trapped by "no refunds" without a credible remedy path.
- Drape should use stage-based remedies, evidence requirements, and delayed payout release instead of a vague one-size-fits-all refund rule.

## 1. Processor Reality: Stripe

## Refund and dispute liability

Stripe's marketplace docs say that for destination charges and separate charges and transfers:

- refunds come from the platform balance
- dispute amounts and dispute fees are debited from the platform balance
- the platform can often recover from the connected account by reversing the transfer

That means Drape should assume platform exposure first, then recovery second.

## Escrow and payout timing

Stripe explicitly says it does not provide escrow services.

What Stripe does provide is payout timing control.

For connected accounts using manual payouts:

- funds can be held in the connected account balance
- payout timing can be delayed
- holding periods depend on country

Current Stripe docs say:

- United States: up to 2 years
- all other countries: up to 90 days
- Thailand: 10 days

That means "escrow-like" behavior is possible operationally, but it is not legally the same as escrow.

## Important Drape inference

For Drape, Stripe supports the conservative release model we have been discussing:

- hold payout until fulfillment evidence exists
- block payout on disputes or refund flags
- use manual payout timing where appropriate

But the platform still needs enough balance discipline to survive refunds and chargebacks.

## 2. Processor Reality: Paystack

## Refunds

Paystack supports:

- full refunds
- partial refunds
- refund webhooks and statuses

Refunds can move through statuses like:

- `pending`
- `processing`
- `needs-attention`
- `failed`
- `processed`

The docs also note that some refunds can require customer bank details, and processed refunds may still take time to arrive.

## Disputes

Paystack's dispute docs are stricter operationally than many teams expect:

- merchants should respond quickly
- evidence matters
- chargeback reminders are sent
- unresolved disputes can be auto-accepted on the merchant's behalf

Current Paystack docs say disputes should be handled within `16 hours`, or Paystack may automatically accept them and trigger refunds from the merchant balance.

## Important Drape inference

If Drape uses Paystack for Nigeria-first flows:

- the ops layer cannot be lazy about dispute response
- receipts, delivery evidence, chat context, and order history need to be easy to retrieve
- payout release should stay conservative because a late or weak response can turn into a fast loss

## 3. What Custom-Work Businesses Commonly Do

Across custom tailoring, custom dressmaking, and adjacent custom-work businesses, the market pattern looks like this:

- deposits are common
- deposits are often used to start work or order materials
- made-to-measure garments are frequently final sale
- fit issues are often handled through an alterations or remake path first
- cancellation rights shrink materially once materials are ordered or work has begun

## Official/business examples

- INDOCHINO says its made-to-measure garments are not returnable or refundable, but it offers a limited fit-remedy path through alterations and claims windows.
- Studio 1867 says deposits let them commence work and order fabrics, and once custom work has started or materials have been ordered, refundability narrows sharply.
- House of Cavone uses a 50% deposit, gives a short cancellation window, and makes clear that the materials funded by the deposit are not simply refundable as cash if work has already started.

## Important Drape inference

Customers will accept narrower refund rights if:

- expectations are clear upfront
- there is a credible remedy path
- the platform is not hiding behind blanket "no refunds" language after obvious seller failure

## 4. Customer-Supplied Material Changes Liability

Multiple business-process sources show the same pattern:

- client-supplied material may be accepted only after review
- the maker may reserve the right to reject unsuitable material
- the maker may disclaim responsibility for hidden defects or shortages in client-supplied material

That means customer-supplied fabric is not normal inventory risk. It is shared-risk work.

## Important Drape inference

For `CUSTOMER_SUPPLIES`, Drape should likely treat the customer as responsible for:

- hidden flaws in the fabric
- insufficient yardage
- instability or unsuitability not obvious until review

But Drape should still hold the tailor responsible for:

- using the wrong fabric if they accepted and confirmed it
- cutting or proceeding after obvious problems without warning the customer

## 5. Social Pain Points

Reddit and similar public discussion spaces repeatedly show a few pain themes:

- the seller changed or "corrected" measurements behind the scenes
- the garment is so wrong that alterations are not a real fix
- the business says "no refunds" but offers no honest remedy
- the customer cannot tell whether the issue is measurements, fabric choice, or workmanship
- the tailor asks the customer to source material, but the customer does not understand that exact matching is difficult and expensive
- expectations around custom work and made-to-measure are badly misunderstood

The strongest recurring signal is this:

People can tolerate imperfection more than they can tolerate feeling trapped, misled, or ignored.

## Important Drape inference

Drape needs a visible remedy ladder:

- fix
- alter
- remake
- partial refund
- full refund
- dispute / ops review

Without that ladder, every hard case becomes an emotional "refund or scam" argument.

## 6. Recommended Drape Remedy Model

Instead of a global refund rule, Drape should evaluate custom-order problems by stage.

## Before quote acceptance

Suggested stance:

- customer can walk away
- no production refund issue yet
- consultation fee rules can still apply if we later choose to charge one

## After payment but before material ordering or receipt confirmation

Suggested stance:

- highest chance of full refund
- except possibly non-refundable consultation or platform fees if we later introduce them

## After tailor-sourced material has been bought

Suggested stance:

- refund should probably exclude clearly documented non-recoverable material cost
- especially if the customer approved the direction and the tailor bought accordingly

## After customer-supplied fabric has been received but before cutting

Suggested stance:

- customer can still potentially cancel
- but material issues should first go through the material-issue flow
- refund logic should depend on whether meaningful labor has started

## After cutting

Suggested stance:

- labor becomes materially non-refundable
- tailor-sourced fabric is usually also no longer safely reversible
- the remedy should shift toward remake, alteration, partial refund, or dispute review instead of clean cancellation

## After shipment / collection

Suggested stance:

- payout should still wait for the dispute window
- customer remedy should depend on defect, mismatch, damage, and evidence

## 7. Recommended Drape Payout Posture

The safest posture still looks like:

- collect customer payment
- do not treat processor balances as escrow
- delay seller payout until fulfillment evidence exists and the dispute window passes
- hold or reverse payout when a credible refund or dispute event occurs

For `READY_MADE`, this matches the earlier recommendation:

- payout after `DELIVERED` or `COLLECTED` plus the `72-hour` no-dispute window

For `CUSTOM`, the same principle still makes sense, but the evidence gate should reflect the real workflow:

- material received or sourced
- production milestones
- shipment or collection evidence
- no unresolved dispute or manual hold

## 8. Recommended Evidence Expectations

If Drape wants fair disputes, the platform should know what evidence matters for each failure mode.

## Measurement dispute

Useful evidence:

- measurement source
- measurement timestamp
- who captured it
- alteration feasibility from the tailor
- photos or fitting notes

## Customer-supplied fabric dispute

Useful evidence:

- handoff mode
- tracking or handoff confirmation
- received timestamp
- photos of the material
- shortage or defect explanation

## Tailor-sourced fabric dispute

Useful evidence:

- quote note describing the sourcing plan
- any swatch, photo, or fabric description sent
- customer approval trail
- proof of actual purchase if material cost is being withheld from refund

## Fulfillment dispute

Useful evidence:

- carrier
- tracking number
- delivery event
- collection confirmation
- damage photos if relevant

## 9. Best Drape Product Lesson

The best marketplace lesson here is:

Do not copy "all sales final" language from custom-fashion businesses without also copying the remediation structure and expectations discipline that makes it survivable.

Drape is a trust layer between two parties, not just a tailor's single-shop policy page.

That means Drape needs:

- explicit production stages
- evidence-aware ops review
- delayed payout release
- specific material and measurement rules
- customer-visible remedies before chargebacks become the default

## 10. Buyer Financing Is Helpful But Not A Free Pass

One tempting answer to the "tailor cannot afford to source materials first" problem is:

- let the customer use buy-now-pay-later
- let the platform get paid upfront
- let the tailor buy materials immediately

That can help cash flow, but it comes with its own constraints.

## Relevant signals

- Stripe says Afterpay pays the business upfront, but it also treats pre-orders as a higher-risk category and may restrict them.
- Klarna disputes can stay open a long time and have formal inquiry and chargeback windows.
- Both BNPL providers still expect the merchant to fulfill clearly and defend disputes with evidence.

## Important Drape inference

BNPL might eventually help for:

- higher-ticket `READY_MADE`
- certain lower-risk custom flows with clear fulfillment timing

But BNPL should not be treated as a universal solution for:

- long custom production timelines
- vague sourcing plans
- orders that behave like open-ended pre-orders

For Drape, that means:

- first solve the stage logic and evidence model
- then evaluate financing methods against those rules
- avoid introducing BNPL into custom flows until fulfillment promises are tight enough to defend

## Open Questions Worth Turning Into Decisions

- Should `CUSTOM` orders have a formal remake path before refund?
- Exactly which costs remain non-refundable once cutting starts?
- Should tailor-sourced fabric cost be recoverable only with proof of purchase?
- Should Drape ever allow immediate seller payout on any custom order?
- Should a customer-favoring first-order policy exist while trust signals are still thin?

## Sources

Official/platform/payment sources:

- [Stripe: Handle refunds and disputes](https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes)
- [Stripe: Disputes on Connect](https://docs.stripe.com/disputes/connect)
- [Stripe: Using manual payouts](https://docs.stripe.com/connect/manual-payouts)
- [Stripe: Payouts to connected accounts](https://docs.stripe.com/connect/payouts-connected-accounts)
- [Paystack: Refunds](https://paystack.com/docs/payments/refunds/)
- [Paystack: Refund API](https://paystack.com/docs/api/refund/)
- [Paystack: Manage disputes](https://paystack.com/docs/payments/manage-disputes/)
- [Paystack: Split payments](https://paystack.com/docs/payments/split-payments)
- [Stripe: Afterpay and Clearpay payments](https://docs.stripe.com/payments/afterpay-clearpay)
- [Stripe: Klarna disputes](https://docs.stripe.com/payments/klarna/disputes)
- [Afterpay merchant support on pre-orders](https://help.business.afterpay.com/hc/en-au/articles/4708302037785-What-s-wrong-with-merchants-selling-pre-orders)

Business policy / industry-process sources:

- [INDOCHINO return policy](https://support.indochino.com/hc/en-us/articles/360034710293-What-is-the-Return-Policy)
- [INDOCHINO fit options](https://support.indochino.com/hc/en-us/articles/360034773473-My-suit-doesn-t-fit-what-options-do-I-have)
- [INDOCHINO terms](https://www.indochino.com/terms-conditions)
- [Studio 1867 deposits policy](https://studio1867.com/deposits-custom-work-policy/)
- [House of Cavone custom design policy](https://www.houseofcavone.com/pages/customer-design)
- [Winters Sewing: customer materials](https://www.winterssewing.com/node/155)
- [Eilersen: customers own material](https://www.eilersen-helpdesk.eu/faqs/customers-own-material)

Social / pain-point signal:

- [Reddit: customer asked to source their own repair fabric](https://www.reddit.com/r/Tailors/comments/1d4r5kr)
- [Reddit: custom suit came wrong size](https://www.reddit.com/r/Tailors/comments/12las7k)
- [Reddit: custom work fit issues and refund pressure](https://www.reddit.com/r/Tailors/comments/19e8fbe)
- [Reddit: credit card dispute after bad custom suit](https://www.reddit.com/r/CreditCards/comments/vkjwvr)
- [Reddit: online MTM disappointment / no-refund frustration](https://www.reddit.com/r/Tailors/comments/179i55j)
- [Reddit: custom garment wrong / partial court remedy](https://www.reddit.com/r/legaladvice/comments/ed6oki)
