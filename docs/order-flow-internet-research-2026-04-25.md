# Drape Order Flow Internet Research

Date: April 25, 2026

## Purpose

This note captures external evidence from marketplace docs, tailoring businesses, bridal content, and community discussions.

The goal is not to blindly copy another product.

It is to answer:

- where our current ready-made and custom flows already look strong
- where real-world orders still tend to break
- what outside evidence supports the gaps we already mapped
- what new gaps showed up from external behavior

Use this with:

- [order-flow-gap-map.md](/Users/onaopemipodimowo/drape/docs/order-flow-gap-map.md)
- [order-flow-research-brief.md](/Users/onaopemipodimowo/drape/docs/order-flow-research-brief.md)
- [ops-order-runbook.md](/Users/onaopemipodimowo/drape/docs/ops-order-runbook.md)

## High-Signal Findings

### 1. Ready-made return and cancellation policy should be visible before checkout

Marketplace help centers treat refunds, returns, and cancellations as first-class customer trust topics.

That supports a Drape rule that ready-made listings should show:

- whether return is allowed
- whether exchange is allowed
- how long the customer has to report a problem
- what counts as seller fault versus change of mind

Sources:

- Etsy seller refunds, returns, and exchanges:
  https://help.etsy.com/hc/en-us/articles/360000572888-Refunds-Returns-and-Exchanges-for-Sellers
- Etsy sale cancellation flow:
  https://help.etsy.com/hc/en-us/articles/115015587347-How-to-Cancel-a-Sale

### 2. Bundle and multi-item disputes become messy fast

Marketplace support flows often resolve order problems at the line-item level, even when the buyer thinks in one cart.

That supports a Drape rule that future multi-item checkout should keep:

- per-line dispute logic
- per-line cancellation or refund logic
- clear handling when one item is missing and another was delivered

Sources:

- Depop order not received support:
  https://depophelp.zendesk.com/hc/en-gb/articles/360038456253-I-haven-t-received-my-order-and-I-paid-with-Depop-Payments
- Depop item not as described support:
  https://depophelp.zendesk.com/hc/en-gb/articles/360037961174-My-purchase-is-not-as-described

### 3. Paid consultations are normal enough to treat seriously

External tailoring businesses and community discussions support the idea that consultation time has value, especially for bespoke or higher-ambiguity work.

That supports the Drape direction that:

- consultation can stay optional
- consultation can be free or paid
- a paid consultation should be disclosed and paid before the slot is confirmed
- the fee may optionally be credited toward later work

Sources:

- Rowe Bespoke consultation:
  https://www.roweiz.com/bespoke-consultation/
- TOL Bespoke alterations and consultation framing:
  https://www.tolbespoke.com/alterations
- Reddit discussion on charging for wedding or tailoring appointments:
  https://www.reddit.com/r/weddingplanning/comments/1axbgt4
- Reddit discussion on how tailors handle consultation time:
  https://www.reddit.com/r/Tailors/comments/1cvbxr3

### 4. Custom-size and made-to-order work often has stricter remedy rules

That supports a Drape distinction between:

- ready-made exchange or return rules
- custom or altered work, which may have narrower refund or return rights after irreversible work begins

Source:

- Azazie custom-size return policy:
  https://support.azazie.com/hc/en-us/articles/43297475246619-Can-I-return-my-custom-size-order

### 5. Group orders need consistency controls, not just more fields

Bridal and group-order content repeatedly surfaces the same issue:

- one payer may coordinate several recipients
- color and dye-lot consistency matters
- measurements and delivery timing often vary across the group

That supports a Drape gap that bulk custom needs:

- recipient-level measurements
- group-level fabric consistency or dye-lot checks
- parent-order coordination
- split-progress handling

Sources:

- Brides explanation of dye lots:
  https://www.brides.com/story/dye-lots-for-bridesmaid-dresses-explained
- Reddit wedding-party ordering discussion:
  https://www.reddit.com/r/weddingplanning/comments/vgq4w1
- Reddit discussion on bridesmaid order coordination:
  https://www.reddit.com/r/weddingplanning/comments/pjx2xi
- Reddit budget wedding discussion with group-order pitfalls:
  https://www.reddit.com/r/Weddingsunder10k/comments/10usht3

### 6. Customer-supplied fabric is risky enough that some tailors reject it

External tailoring sources and tailoring communities support what we already suspected:

- some tailors will not work with outside fabric at all
- some will only do so after inspection
- rejection happens because of quality, drape, weave, structure, or quantity

That supports a Drape rule that fabric rejection before cutting must be explicit and policy-backed.

Sources:

- Tailor perspective on bringing your own fabric:
  https://cuttingroombespoke.com/custom-bespoke-suits-tailor/2025/11/1/can-i-bring-my-own-fabric-to-my-custom-tailor
- Reddit tailoring discussion on customer-supplied fabric:
  https://www.reddit.com/r/Tailors/comments/1d4r5kr

### 7. Yardage is not only about total length

Sewing communities repeatedly point out that failure often happens because:

- the fabric is not one continuous usable piece
- the usable width is too narrow
- the fabric shrinks or shifts after prep

That supports a Drape rule that “yardage enough” is not just one numeric field.

Sources:

- Reddit sewing discussion on not-enough yardage:
  https://www.reddit.com/r/sewing/comments/1gnfl9x
- Reddit sewing discussion on fabric usage assumptions:
  https://www.reddit.com/r/sewing/comments/f6e9ih
- Fabric buying mistakes and continuity issues:
  https://www.canvasetc.com/fabric-by-the-yard-mistakes/

### 8. Delivery support windows and proof handling matter

Marketplace support content puts a lot of weight on:

- when a buyer must raise a problem
- what delivery proof exists
- when the seller or platform takes over

That supports a Drape rule that missed delivery, return to sender, and “says delivered but not received” should be explicit ops flows, not ad hoc support improvisation.

Sources:

- Depop paid-order support:
  https://depophelp.zendesk.com/hc/en-gb/articles/360038456253-I-haven-t-received-my-order-and-I-paid-with-Depop-Payments
- Etsy seller support and cancellation guidance:
  https://help.etsy.com/hc/en-us/articles/360000572888-Refunds-Returns-and-Exchanges-for-Sellers

## New Gaps Confirmed By External Research

These are the strongest additions or upgrades to the current Drape gap map.

### Ready-made

- Listing-level visibility for return, exchange, and final-sale posture
- Clear bundle or line-item dispute logic for future multi-item checkout
- Delivery issue timing and evidence rules

### Custom

- Consultation fee credit model
- Fabric continuity and usable-width verification
- Explicit fabric rejection reason codes before cutting
- Group-order consistency controls, especially dye-lot and recipient privacy

### Cross-flow

- Better proof and deadline handling when delivery fails or is late
- Cleaner distinction between reversible and irreversible work before refunds are narrowed

## Recommended Product Updates From This Benchmark

### Short term

- Put ready-made return or exchange posture on the listing itself
- Add consultation credit decision to the custom policy backlog
- Add fabric continuity and usable-width thinking to fabric review rules
- Keep bulk custom as a managed special-case flow until product support exists

### Medium term

- Give multi-item checkout line-level refund and issue handling from day one
- Add group-consistency checks for bulk custom or ashoebi-style orders
- Add stronger dispatch issue reason codes and proof expectations

## Bottom Line

The current Drape flow is moving in the right direction.

The strongest outside evidence supports the exact areas we already felt were risky:

- ready-made remedy clarity
- paid consultation flexibility
- fabric logistics and rejection
- bulk custom coordination
- delivery proof and failure handling

The main value of this research is not that another platform has the same product.

It is that the same failure patterns keep appearing across marketplaces, bridal ordering, tailoring businesses, and sewing communities.

If Drape solves those patterns cleanly, the two core flows will be much harder to beat.
