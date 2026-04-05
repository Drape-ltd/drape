# Research Notes: Fabric Sourcing, Local Handoff, And Billing Risk

Date: April 2, 2026

## Why This Exists

The current Drape model already supports:

- `fabric_source = CUSTOMER_SUPPLIES`
- `fabric_source = TAILOR_SOURCES`

But that is not enough to cover real-world sourcing and handoff complexity.

We still need to answer:

- what if the customer physically brings fabric to the tailor locally?
- what if the tailor picks fabric up from the customer?
- what if the tailor is sourcing the fabric but needs funding first?
- when does the customer approve sourced fabric?
- when and how is the customer billed for sourced fabric?

This document is a research and product-gap deep dive, not an implementation plan.

## High-Signal Takeaways

- `Who sources the fabric` is not the same as `how fabric is handed over`.
- Local handoff is a real scenario and should not be forced into a "shipping only" mental model.
- Many custom makers use deposits to cover materials before work begins.
- Many tailors either refuse customer-supplied fabric or only accept it with clear limitations because the liability is high.
- If Drape wants tailors to source fabric without carrying cash-flow risk, the platform needs an explicit funding moment before sourcing begins.
- If Drape wants customer-supplied fabric to be safe, the platform needs basic chain-of-custody and approval signals.

## 1. What Drape Supports Today

Current product support:

- customer chooses:
  - `CUSTOMER_SUPPLIES`
  - `TAILOR_SOURCES`
- customer chooses finished-garment delivery:
  - `SHIPPING`
  - `LOCAL_COLLECTION`
- customer can save `fabric_tracking` when they are shipping fabric
- tailor includes sourcing cost inside the quote if they choose to do that

Current product wording already implies:

- if the customer supplies fabric, they are expected to ship it
- if the tailor sources fabric, the cost is included in the quote

## Current gap

Drape does not yet model:

- local fabric dropoff to the tailor
- local fabric pickup by the tailor
- fabric received / not received confirmation
- fabric approval before purchase
- swatch approval
- a separate material funding step before tailor sourcing
- customer acknowledgment of fabric quality or substitution risk

## 2. Real-World Sourcing Patterns

## Pattern A: Customer brings their own fabric

This is common enough in tailoring and custom dressmaking, but not universal.

Public signal:

- tailoring and sewing discussions repeatedly show that some makers accept customer-provided fabric, some decline it entirely, and some will only do it if the material is reviewed first
- a number of tailor FAQs explicitly say "yes, bring your own fabric"

Examples:

- Smart Fashion Tailor FAQ says customers can bring their own fabric
- LALEDA Tailor says customers can bring their own fabric or choose from the tailor's range
- Nashala says customers can bring their own fabric and also get suggestions

## Pattern B: Tailor helps customer choose fabric

This appears to be a common middle ground:

- customer does not know what to buy
- tailor gives advice or goes through swatches
- customer either buys it or funds the tailor to buy it

Social signal:

- Reddit tailoring/sewing threads often describe customers being expected to at least bring swatches or discuss fabric suitability before a maker commits
- some makers are uncomfortable sourcing fabric without explicit customer buy-in because they do not want blame for color or feel mismatch

## Pattern C: Tailor fully sources fabric

This is the polished "full-service tailoring" path.

Official and market signal:

- made-to-measure and bespoke businesses commonly present fabric selection as part of the consultation itself
- doorstep tailoring services often bring swatch books to the customer

Examples:

- Bharat Tailor says the tailor brings a fabric sample book to the appointment
- Indie Darzi says customers choose fabric during the home visit
- Tailors 2 U describes an at-home fitting with fabric samples
- Taylor Richards & Conger describes a custom appointment where the customer chooses fabric and then pays a deposit

## 3. Local Handoff Is A Separate Scenario

This is the part that Drape is not modeling yet.

There are at least four different customer-supplied-material handoff modes:

- customer ships fabric to tailor
- customer drops fabric off locally
- tailor picks fabric up locally
- customer arrives for consultation or fitting with fabric already in hand

These are not the same operationally.

## Why local handoff matters

With shipping:

- there is at least some tracking evidence

With local handoff:

- there may be no shipping evidence at all
- disputes become "I gave it to them" vs "I never got it" unless the platform records the handoff

Public signal:

- some tailoring services explicitly offer pickup of customer fabric from home
- some local custom services offer doorstep measurement and fabric pickup as part of the service
- legal-advice discussions show how messy it gets when a maker receives customer fabric and then the relationship breaks down

## Product inference

If Drape wants to support local customer-supplied fabric safely, the product needs a `fabric handoff mode`, not just `fabric_source`.

Recommended future handoff modes:

- `CUSTOMER_SHIPS_TO_TAILOR`
- `CUSTOMER_DROPS_OFF_LOCALLY`
- `TAILOR_PICKS_UP_LOCALLY`
- `FABRIC_ALREADY_WITH_TAILOR`

## 4. Tailor-Sourced Fabric And The Cash-Flow Problem

## The core problem

If the tailor is expected to source fabric before the customer pays, the tailor may need to front money.

That is risky for:

- independent tailors
- low-cash-flow sellers
- expensive fabrics
- volatile or low-availability materials

## What the market often does

Custom work in many industries uses deposits to cover materials and commitment.

Examples:

- Taylor Richards & Conger requires a 50% deposit on made-to-measure orders after the appointment, with balance at pickup
- Anthony's Bespoke Tailor says work begins when availability is confirmed and the 50% deposit is paid
- Studio 1867 says a 50% deposit lets them commence work and order fabrics
- House of Cavone says 50% deposit is required to start production, with the balance due later

## Product inference

If Drape wants tailors to source fabric reliably, the platform should not assume the tailor can carry material cost on credit.

That means one of these product models is needed:

- quote includes sourcing cost and customer pays before sourcing begins
- a separate material-reserve deposit exists before final production
- the tailor explicitly chooses to self-fund sourcing at their own risk

## Best V1 interpretation

For V1, the safest read is:

- tailor-sourced fabric should be priced into the quote
- customer pays the quote before the tailor is expected to buy fabric
- Drape should not implicitly require the tailor to buy materials on credit

This is simpler and protects smaller sellers.

## 5. Customer Experience If Tailor Sources Fabric

Right now, Drape copy says:

- "Tailor buys the fabric — cost included in their quote."

That is directionally okay, but the real experience is still underspecified.

There are several possible customer experiences:

## Experience A: Tailor sources without showing options

Flow:

1. customer describes garment
2. tailor sends one all-in quote
3. customer pays
4. tailor buys material

Pros:

- simple

Risks:

- customer may dislike final material choice
- quality, color, weight, and texture expectations may drift

## Experience B: Tailor proposes material options before final quote

Flow:

1. customer describes garment
2. tailor shares a few sourcing options or a fabric plan
3. customer approves direction
4. tailor sends quote
5. customer pays
6. tailor sources

Pros:

- better alignment

Risks:

- more steps
- more messaging friction

## Experience C: Tailor sends labor quote first, then fabric quote later

Flow:

1. customer describes garment
2. tailor estimates labor first
3. fabric is chosen later
4. final price is revised

Pros:

- transparent

Risks:

- much more state complexity
- customer confusion
- harder payment logic

## Best V1 recommendation

Use a simpler version of Experience B:

- tailor explains the sourcing plan in the quote note
- tailor sends one quote with sourcing included
- customer pays once
- tailor sources only after payment

What the quote should make clear:

- whether the quoted total includes fabric
- whether the fabric is already identified or still approximate
- whether substitutions require customer approval

## 6. Customer-Supplied Fabric Risk Still Needs Guardrails

Public and official analogies show a repeated pattern:

- customer-supplied materials are often accepted only with conditions
- providers may reserve the right to reject unsuitable materials
- providers may disclaim responsibility for hidden flaws, shortages, or bad outcomes caused by the client material

Examples:

- Winters Sewing explains extra complexity and suitability expectations for customer materials
- ArtLab says it does not accept liability for problematic results on client-supplied fabrics
- Eilersen says it reserves the right to reject customer-supplied material if unsuitable
- Tailor.com says the process may take longer if the customer brings fabric, because it may need washing and processing

## Product inference

Drape should eventually support customer-supplied-fabric rules like:

- fabric may be reviewed before work starts
- tailor can reject unsuitable material
- customer remains responsible for shortages or hidden defects in supplied material
- the platform records whether the material was shipped, dropped off, or picked up

## 7. The Missing Product Model

Today the model is mostly:

- `fabric_source`
- finished-garment `delivery_method`

That is not enough.

The real model probably needs three distinct concepts:

## A. Fabric source

- `CUSTOMER_SUPPLIES`
- `TAILOR_SOURCES`

## B. Fabric handoff mode

- `CUSTOMER_SHIPS_TO_TAILOR`
- `CUSTOMER_DROPS_OFF_LOCALLY`
- `TAILOR_PICKS_UP_LOCALLY`
- `FABRIC_ALREADY_WITH_TAILOR`
- `NO_CUSTOMER_HANDOFF_REQUIRED`

## C. Fabric funding model

- `INCLUDED_IN_QUOTE`
- `CUSTOMER_PREPAYS_MATERIALS`
- `TAILOR_SELF_FUNDS`

Without these, some important business questions remain ambiguous.

## 8. Recommended Product Direction

## For V1

- keep `fabric_source`
- do not add a separate material-deposit payment flow yet
- assume `TAILOR_SOURCES` means:
  - tailor includes sourcing cost in the quote
  - customer pays before sourcing starts
- explicitly add local handoff as a supported scenario for customer-supplied fabric
- add a basic "fabric received" confirmation for customer-supplied fabric

## For slightly later

- add `fabric_handoff_mode`
- add evidence / receipt behavior for local handoff
- add sourced-fabric approval expectations
- add a material-issue flow tied to handoff and sourcing state

## If Drape wants to support lower-cash-flow tailors better

The next reasonable step would be:

- customer funds materials before sourcing
- but that should be a deliberate product/payment feature, not an accidental expectation hidden inside the current quote flow

## 9. Concrete Scenarios Drape Should Cover

## Scenario 1: Customer ships fabric

Current support:

- mostly yes

Still missing:

- explicit confirmation that tailor received the fabric
- material-issue flow after receipt

## Scenario 2: Customer drops fabric off locally

Current support:

- no clear product support

Needed:

- local handoff mode
- handoff confirmation
- optional pickup note / timestamp / evidence

## Scenario 3: Tailor picks up fabric locally

Current support:

- no clear product support

Needed:

- local pickup flow
- custody confirmation
- possibly pickup fee later

## Scenario 4: Tailor sources after payment

Current support:

- closest to current Drape intent

Needed:

- clearer quote language and customer expectation setting

## Scenario 5: Tailor needs material money first

Current support:

- only indirectly through the single quote flow

Needed later if we want to optimize this:

- explicit material funding or deposit model

## 10. Current Recommendation

For now, the cleanest Drape answer is:

- if the customer supplies fabric:
  - support both shipping and local handoff conceptually
  - record fabric receipt clearly
- if the tailor sources fabric:
  - fabric cost belongs inside the quote
  - customer should pay before the tailor is expected to buy
  - sourced-fabric substitutions should not happen silently

This keeps the product understandable and avoids forcing tailors to become lenders.

## Sources

Official / primary / business-process sources:

- Taylor Richards & Conger made-to-measure deposit:
  - https://shop-trcstyle.com/pages/made-to-measure
- Anthony's Bespoke Tailor deposit / order start:
  - https://anthonysbespoketailor.com/
- LALEDA Tailor FAQ:
  - https://laledatailor.com/faqs
- Smart Fashion Tailor FAQ:
  - https://smartfashiontailor.com/faq/
- Tailor.com FAQ:
  - https://www.tailor.com/faq/
- Nashala FAQ:
  - https://www.nashala.com/ladies-tailors-faqs
- CloudTailor FAQ / measurements:
  - https://www.cloudtailor.com/faqs/
  - https://www.cloudtailor.com/faqs/measurements
- MakeMyDesign FAQ:
  - https://www.makemy.design/faq
- Bharat Tailor:
  - https://bharattailors.com/index.html
- Indie Darzi:
  - https://indiedarzi.com/about/
- Tailors 2 U:
  - https://www.tailors2u.com/
- Studio 1867 custom work deposit policy:
  - https://studio1867.com/deposits-custom-work-policy/
- House of Cavone custom design policy:
  - https://www.houseofcavone.com/pages/customer-design
- Winters Sewing on customer-owned material:
  - https://www.winterssewing.com/node/155
- Eilersen COM FAQ:
  - https://www.eilersen-helpdesk.eu/faq
- ArtLab terms on client-supplied fabric:
  - https://www.artlab.co.za/artlab-terms
- Stripe Klarna:
  - https://docs.stripe.com/payments/klarna
- Stripe Affirm:
  - https://docs.stripe.com/payments/affirm
- Stripe Afterpay / Clearpay:
  - https://docs.stripe.com/payments/afterpay-clearpay

Social / public pain points:

- Reddit `r/Tailors`: custom commission with no fabric in hand
  - https://www.reddit.com/r/Tailors/comments/uvywpj
- Reddit `r/malefashionadvice`: gifted fabric and difficulty finding a tailor
  - https://www.reddit.com/r/malefashionadvice/comments/ca9glr
- Reddit `r/legaladvicecanada`: seamstress keeps customer fabric
  - https://www.reddit.com/r/legaladvicecanada/comments/j2a02v
- Reddit `r/ClothingStartups`: fabric sourcing and outsourcing opacity
  - https://www.reddit.com/r/ClothingStartups/comments/1s1dx4v
