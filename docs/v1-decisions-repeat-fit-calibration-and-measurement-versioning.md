# V1 Decisions: Repeat Fit Calibration And Measurement Versioning

Date: April 2, 2026

## Why This Exists

Drape needs a practical answer to:

- what the current fit profile means
- what measurement truth belongs to each order
- when repeat experience should improve trust in future fit

This document turns the research into a working V1 stance.

## Core Principle

The customer’s current fit profile is for future work.

The order measurement snapshot is the historical truth for that order.

## Decision 1: Keep Order Measurement Snapshots Immutable

### Chosen rule

For V1, once an order is created, `customer_measurements_snapshot` should be treated as the authoritative fit basis for that order.

### Why

Past orders need stable historical truth for:

- disputes
- remakes
- support review
- liability assessment

## Decision 2: Future Profile Updates Must Not Retroactively Rewrite Old Orders

### Chosen rule

If the customer later edits their measurements, that should improve future orders only.

### Why

Otherwise Drape loses the ability to explain what fit basis was actually used at the time of production.

## Decision 3: One Living Customer Fit Profile Is Acceptable For V1

### Chosen rule

V1 can keep a single current customer fit profile in the customer profile.

### Why

This is simple enough to ship while still working safely if order snapshots remain authoritative.

## Decision 4: Repeat Successful Orders Should Raise Fit Confidence

### Chosen rule

If a customer has successful repeat orders without meaningful fit concerns, that should increase future fit confidence.

### Why

A repeat success history is a real trust signal even when the original measurement source was weaker.

## Decision 5: Repeat Success Improves Confidence, Not Historical Evidence

### Chosen rule

Successful repeat orders should affect:

- future quote confidence
- whether consultation is encouraged
- whether confirmation is required

But not:

- the stored measurement truth of past orders

### Why

Confidence evolution and evidence preservation are different jobs.

## Decision 6: Profile Updates Should Be Deliberate

### Chosen rule

The safest V1 profile update moments are:

- customer edits the profile directly
- customer accepts imported tailor-captured measurements as the new baseline
- a remake or fit review leads to an agreed updated profile

### Why

Fit memory should improve intentionally, not silently.

## Decision 7: Do Not Auto-Update The Profile From Every Order Outcome

### Chosen rule

Drape should not automatically overwrite the customer profile after every completed order, complaint, or remake.

### Why

That creates too much hidden mutation and too much dispute confusion.

## Decision 8: Passport Imports Should Be Treated As Strong New Input, Not Invisible History Rewrite

### Chosen rule

Tailor passport measurements are strong, but they should conceptually become a new current baseline for future work, not a rewrite of old order history.

### Why

Passport is about improving the next order, not changing what happened on past ones.

## Decision 9: Major Fit Changes Should Lean Toward Remeasure, Not Tiny Edits

### Chosen rule

If the customer’s body or fit basis changes significantly, Drape should later treat that as a remeasure trigger rather than a minor tweak.

### Examples

- major weight change
- pregnancy / postpartum
- large training / muscle change
- long time gap with no recent successful orders
- tailor identifies a materially different baseline

### Why

Some changes are too large for confidence to survive as “same profile, slightly edited.”

## Decision 10: V1 Should Defer Full Multi-Profile Fit Management

### Chosen rule

V1 does not need:

- unlimited named fit profiles
- garment-category profile switching
- archived profile management UI

### Why

Those are valuable later, but immutable order snapshots plus a deliberate living profile are enough for V1.

## Decision 11: Future Product Should Model Versioning Explicitly

### Chosen rule

Useful later fields likely include:

- `measurement_profile_version`
- `measurement_profile_label`
- `fit_calibrated_from_order_id`
- `successful_repeat_fit_count`
- `profile_staleness_state`

### Why

Right now Drape has the right intuition but not yet the explicit fit-versioning model.

## Recommendation Summary

The cleanest V1 posture is:

- one living customer fit profile
- immutable order measurement snapshots
- repeat successful orders raise future fit confidence
- profile updates happen deliberately
- past orders never silently change when the profile improves
- major fit change should push toward remeasure, not quiet drift

## Sources

- [Proper Cloth: Managing Your Saved Custom Sizes](https://propercloth.com/reference/managing-saved-custom-sizes/)
- [Proper Cloth: How to Request a Remake](https://propercloth.com/reference/how-to-request-a-remake/)
- [Proper Cloth FAQs](https://propercloth.com/faqs)
- [INDOCHINO: How do I update my existing measurements?](https://support.indochino.com/hc/en-us/articles/4413021436691-How-do-I-update-my-existing-measurements)
- [INDOCHINO: Can I change the body measurements in my account?](https://support.indochino.com/hc/en-us/articles/360034192694-Can-I-change-the-body-measurements-in-my-account)
- [INDOCHINO: Can I buy now and measure later?](https://support.indochino.com/hc/en-us/articles/360039822133-Can-I-buy-now-and-measure-later)
- [Suitsupply Size Passport](https://suitsupply.com/en-us/journal/size-passport.html)
