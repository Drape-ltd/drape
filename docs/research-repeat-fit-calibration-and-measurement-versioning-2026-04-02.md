# Research Notes: Repeat Fit Calibration, Measurement Versioning, And Historical Fit Truth

Date: April 2, 2026

## Why This Exists

Drape already has:

- a mutable customer measurement profile
- tailor diary and passport capture
- order-level measurement snapshots

That is a strong start, but there is still a product ambiguity:

- when should a customer’s saved fit profile update
- what should happen after a successful remake or alteration
- should past orders keep their original fit basis even if the customer later edits their measurements

This note is the research layer for that question.

## High-Signal Takeaways

- Good fit systems treat size as something that gets refined over time.
- The customer’s “current size profile” and the “size used for a particular order” should not be the same thing.
- Mature custom-clothing flows preserve order-time size truth while still letting the customer improve future fit profiles.
- Repeat successful orders should increase fit confidence, but should not silently rewrite history.
- Versioning does not need a huge V1 data model to be useful; the most important principle is immutable order snapshots plus deliberate profile updates.

## 1. What Drape Already Does Today

Drape already has the beginnings of the right shape:

- `customer_profiles.measurements` is one mutable JSON profile
- `orders.customer_measurements_snapshot` preserves the measurement basis that traveled with the order
- passport claim currently merges tailor-captured measurements into the customer profile
- the brief flow can update a saved measurement field and optionally write it back to the profile

Important Drape takeaway:

- the order snapshot concept already exists
- the profile versioning concept does not yet exist explicitly

Current risk:

- because the customer profile is one mutable blob, later edits could create confusion unless Drape is disciplined about treating the order snapshot as the historical source of truth for that order

## 2. Market Pattern: Saved Size Profiles Are Persistent, Reusable, And Editable

Proper Cloth’s current help content is a strong signal here.

It supports:

- saved custom sizes
- multiple saved size profiles
- edit / update / archive behavior
- archived size records linked to particular order numbers

That is especially useful because it shows a mature answer to the tension between:

- current preferred size
- historical order fit truth

Important Drape takeaway:

- a “living size profile” and an “order-specific archived size record” can coexist cleanly

## 3. Market Pattern: Fit Systems Often Use Prior Garments As The Update Baseline

INDOCHINO’s current help center says:

- stored measurements are reused for future orders
- updates to existing measurements go through the customer experience or showroom team
- customers may be asked to describe desired adjustments relative to their most recent garment
- significant body-shape changes may require a full remeasure

Important Drape takeaway:

- repeat fit calibration is often not “start from scratch every time”
- it is “use the last successful fit as the reference point”

## 4. Market Pattern: Fit Profiles Can Be Category-Specific

Proper Cloth’s saved-size system also suggests an important nuance:

- shirt sizes
- jacket sizes
- pant sizes

are not always one interchangeable fit profile.

Community discussion around made-to-measure ordering reinforces that:

- one saved shirt profile may not cleanly translate to a jacket
- one fit profile may not even behave identically across different garment constructions

Important Drape takeaway:

- “one global measurement blob” is enough for early product velocity
- but eventually Drape will likely need category-aware fit memory or named profiles

## 5. Order Snapshot Should Be Treated As Historical Truth

This is the most important principle.

If the customer edits their measurements tomorrow, that should not mutate the fit basis that was used on an order created last week.

Why this matters:

- dispute review
- remake logic
- liability assessment
- order history clarity

Important Drape takeaway:

- the order snapshot should be immutable after order creation except where a structured remake / confirmed fit-revision flow explicitly creates a new order-level truth

## 6. Repeat Success Should Increase Confidence, Not Rewrite Evidence

A customer with:

- one successful order
- two successful repeat orders
- no fit concerns

should be treated differently from:

- a first-time self-measured customer

But this should mostly affect:

- fit confidence
- whether confirmation is required
- whether consultation is strongly encouraged

Not:

- whether the system rewrites what happened on old orders

Important Drape takeaway:

- historical success is a confidence signal, not a reason to delete old fit history

## 7. Good Profile Updates Should Be Deliberate

The safest profile-update moments are things like:

- customer manually edits measurements
- customer explicitly accepts tailor-captured passport as their new baseline
- successful remake or post-fit review results in an agreed updated size
- tailor-captured repeat appointment replaces an older baseline

The riskiest profile-update moments are:

- automatic overwrite after every order
- automatic overwrite during an active dispute
- silent overwrite from imported measurements without customer review

Important Drape takeaway:

- “fit got better” should not automatically mean “replace the profile now without consent or review”

## 8. Major Change And Staleness Need Their Own Rule

A saved fit profile can become stale because of:

- body-weight change
- pregnancy / postpartum
- muscle gain or loss
- posture change
- long time gap
- age-related change

INDOCHINO’s update guidance is especially useful here because it distinguishes:

- minor adjustment
- significant measurement reset

Important Drape takeaway:

- Drape should eventually treat some profile changes as `minor tweak`
- and others as `remeasure recommended`

## 9. V1 Does Not Need Full Multi-Profile Fit Memory Yet

Even though the mature answer might be:

- multiple saved fit profiles
- archived versions
- garment-specific defaults

the cleanest V1 answer can still be simpler:

- one current customer fit profile
- immutable order snapshots
- explicit future fields for source/confidence/version labels

Important Drape takeaway:

- the key thing is not full complexity
- the key thing is avoiding silent history corruption

## 10. Useful Future Fields

When Drape models this more fully later, useful fields likely include:

- `measurement_profile_id`
- `measurement_profile_version`
- `measurement_profile_label`
- `superseded_by_profile_version`
- `fit_calibrated_from_order_id`
- `fit_calibration_reason`
- `fit_calibrated_at`
- `successful_repeat_fit_count`
- `profile_staleness_state`

## Working Recommendation

The cleanest Drape answer is:

- keep one living customer fit profile for V1
- keep order measurement snapshots immutable and authoritative for historical review
- let repeat successful orders raise confidence
- allow profile updates deliberately, not silently
- do not retroactively rewrite old orders when the profile improves
- treat major body or fit changes as a remeasure trigger, not just a tiny edit

## Sources

Official sources:

- [Proper Cloth: Managing Your Saved Custom Sizes](https://propercloth.com/reference/managing-saved-custom-sizes/)
- [Proper Cloth: How to Request a Remake](https://propercloth.com/reference/how-to-request-a-remake/)
- [Proper Cloth FAQs](https://propercloth.com/faqs)
- [INDOCHINO: How do I update my existing measurements?](https://support.indochino.com/hc/en-us/articles/4413021436691-How-do-I-update-my-existing-measurements)
- [INDOCHINO: Can I change the body measurements in my account?](https://support.indochino.com/hc/en-us/articles/360034192694-Can-I-change-the-body-measurements-in-my-account)
- [INDOCHINO: Can I buy now and measure later?](https://support.indochino.com/hc/en-us/articles/360039822133-Can-I-buy-now-and-measure-later)
- [Suitsupply Size Passport](https://suitsupply.com/en-us/journal/size-passport.html)

Directional community signal:

- [Reddit: Proper Cloth may not be a good choice](https://www.reddit.com/r/malefashionadvice/comments/1j59ywz/)
