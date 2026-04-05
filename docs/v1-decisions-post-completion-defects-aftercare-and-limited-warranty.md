# V1 Decisions: Post-Completion Defects, Aftercare, And Limited Warranty

Date: April 2, 2026

## Why This Exists

Drape needs a practical answer to:

- what counts as a valid issue after delivery or collection
- how long customers have to report it
- what remedy should apply
- what is outside scope because it is ordinary wear, misuse, or late change

This document turns the research into a working V1 stance.

## Core Principle

Drape should offer limited aftercare, not an open-ended garment warranty.

## Decision 1: Separate Three Post-Completion Categories

### Chosen rule

For V1, Drape should separate:

- immediate fit or finish issue
- latent workmanship defect
- normal wear, misuse, care damage, or body-change issue

### Why

These are not the same problem, and they should not trigger the same remedy rights.

## Decision 2: `READY_MADE` And `CUSTOM` Need Different Aftercare Logic

### Chosen rule

For V1:

- `READY_MADE` can keep a more retail-like support posture
- `CUSTOM` should stay remedy-first, not return-first

### Why

That matches the rest of Drape’s product logic and avoids overpromising on handcrafted work.

## Decision 3: Initial Fit Or Finish Concerns Should Be Raised Within `14 Days`

### Chosen rule

For V1, obvious post-delivery or post-collection issues should generally be raised within `14 days`.

### Best examples

- fit feels materially wrong
- garment arrives damaged
- visible construction issue
- obvious mismatch from what was agreed

### Why

This is long enough to inspect, try on, or wear once for evaluation, but short enough to keep evidence credible.

## Decision 4: Credible Latent Workmanship Defects Can Be Reviewed Within `30 Days`

### Chosen rule

If the issue was not reasonably obvious at receipt, Drape can review a narrower class of workmanship defects within `30 days` of delivery or collection.

### Best examples

- seam failure after very limited normal use
- button, zip, or closure failure pointing to poor construction
- hidden structural issue that becomes visible shortly after first use

### Why

Some real defects only show up after the garment leaves the pickup or delivery moment.

### Important limit

This is not a lifetime workmanship guarantee.

## Decision 5: Ordinary Wear, Misuse, Care Damage, And Body Changes Are Out Of Scope

### Chosen rule

The following should normally fall outside Drape remedy coverage:

- repeated-use wear and tear
- improper washing or care damage
- accidental damage after receipt
- later body changes
- unauthorized alterations that create or worsen the problem

### Why

Drape should protect against seller-caused issues, not become a general garment-insurance product.

## Decision 6: One Careful Wear Does Not Automatically Waive A Valid Claim

### Chosen rule

A customer should not lose a valid claim just because they:

- tried the garment on properly
- wore it once to assess real fit
- discovered the issue during normal first use

### Important limit

Extensive wear, repeated use, or delayed reporting should weaken the claim.

### Why

For custom clothing, some meaningful issues only become obvious in real wear.

## Decision 7: Structured Evidence Is Required

### Chosen rule

For V1, aftercare intake should ask for:

- when the issue was first noticed
- current garment condition
- clear photos
- short description of the problem
- fit photos or simple measurement deltas when fit is the issue
- local tailor receipt if reimbursement is being requested

### Why

Post-completion issues are easier to blur with ordinary use unless evidence stays structured.

## Decision 8: The Default `CUSTOM` Remedy Ladder Is Repair, Alteration, Or Remake Before Refund

### Chosen rule

For most valid `CUSTOM` aftercare issues, the default order should be:

- clarify
- repair or local alteration
- remake
- bounded partial refund
- full refund only in stronger seller-fault cases

### Why

That fits how custom work is normally rescued and keeps remedies proportional.

## Decision 9: `READY_MADE` Can Use Return-Or-Refund More Often

### Chosen rule

For seller-fault `READY_MADE` issues, Drape can more readily use:

- return plus refund
- return plus replacement
- keep-item partial refund in low-value defect cases

### Why

Ready-made inventory behaves more like standard commerce than custom production.

## Decision 10: Payout Handling Depends On When The Issue Opens

### Chosen rule

If the issue opens before payout release, normal concern and dispute blocking rules apply.

If the issue opens after payout release but within the aftercare window:

- the issue is still reviewable
- remedies narrow
- automatic clawback should not be assumed
- future payout holds or manual recovery can be considered case by case

### Why

This keeps the payout model honest while still allowing valid post-completion support.

## Decision 11: Repeat Validated Aftercare Defects Should Affect Seller Trust

### Chosen rule

Repeated validated post-completion defects should count toward seller quality or trust review.

### Why

Aftercare issues are not just support cost, they are marketplace quality signals.

## Decision 12: Low-Infrastructure Paths Should Be First-Class

### Chosen rule

For V1, Drape should treat these as valid aftercare paths:

- local alteration
- local handoff
- async photo evidence
- support-assisted intake

Not every case should depend on:

- return labels
- showroom visits
- live calls

### Why

This fits Drape’s actual operating environment better.

## Decision 13: Future Product Should Model Aftercare Explicitly

### Chosen rule

When implemented, useful fields likely include:

- `aftercare_type`
- `issue_discovered_at`
- `aftercare_window`
- `workmanship_claim`
- `wear_and_tear_excluded`
- `repair_approved`
- `repair_receipt_url`
- `post_payout_recovery_status`

### Why

Right now Drape has concern and dispute logic, but no explicit post-completion aftercare model.

## Recommendation Summary

The cleanest V1 posture is:

- limited aftercare, not lifetime warranty
- `14-day` window for obvious fit and finish issues
- narrower `30-day` review window for credible latent workmanship defects
- `CUSTOM` stays remedy-first
- `READY_MADE` can use more retail-like return logic
- structured evidence is required
- ordinary wear, misuse, and body changes are out of scope
- post-payout cases stay reviewable, but with narrower remedies

## Sources

- [Proper Cloth Perfect Fit Guarantee](https://propercloth.com/perfect-fit-guarantee)
- [Proper Cloth Return Policy](https://propercloth.com/return-policy)
- [Proper Cloth: How to Request a Remake](https://propercloth.com/reference/how-to-request-a-remake/)
- [Proper Cloth: Having a Garment Altered by Your Tailor](https://propercloth.com/reference/how-to-have-your-garment-altered-locally/)
- [Proper Cloth: Remake Requested - How to Return the Original Item](https://propercloth.com/reference/remake-requested-how-to-return-the-original-item/)
- [INDOCHINO: My suit doesn't fit, what options do I have?](https://support.indochino.com/hc/en-us/articles/360034773473-My-suit-doesn-t-fit-what-options-do-I-have)
- [INDOCHINO: What is the Return Policy?](https://support.indochino.com/hc/en-us/articles/360034710293-What-is-the-Return-Policy)
- [INDOCHINO: My garment is not alterable, what do I do next?](https://support.indochino.com/hc/en-us/articles/360050400954-My-garment-is-not-alterable-what-do-I-do-next)
- [INDOCHINO: How much does INDOCHINO reimburse for local alterations?](https://support.indochino.com/hc/en-us/articles/360051485553-How-much-does-INDOCHINO-reimburse-for-local-alterations)
- [SUITSUPPLY Perfect Fit Guarantee](https://suitsupply.com/en-us/journal/perfect-fit-guarantee.html)
- [SUITSUPPLY Alterations](https://suitsupply.com/en-us/journal/alter-your-fit.html)
- [Etsy: How to Open a Case](https://help.etsy.com/hc/en-us/articles/5745586898199-How-to-Open-a-Case)
- [Etsy's Purchase Protection Program](https://help.etsy.com/hc/articles/7471925990807?segment=selling)
