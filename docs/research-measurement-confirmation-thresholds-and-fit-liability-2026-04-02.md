# Research Notes: Measurement Confirmation Thresholds, Fit Confidence, And Fit Liability

Date: April 2, 2026

## Why This Exists

Drape already made an important V1 call:

- measurements should have a source
- tailors should be able to request confirmation before cutting

The next ambiguity is more specific:

- when are measurements strong enough to proceed
- when should a tailor be required to pause for fit confirmation
- when is a fit problem mostly customer risk, tailor risk, or shared risk

This note is the research layer for that question.

## High-Signal Takeaways

- Measurement quality is not binary.
- Good fit businesses treat first-order fit confidence as a spectrum, not a guarantee.
- Self-measurement can be useful, but it is weaker when garment complexity is high or the customer measured alone.
- In-person or fitter-assisted measurement is stronger, but still does not eliminate the need for fit clarification.
- Fit liability should depend on source, completeness, warning signals, and whether the tailor explicitly requested confirmation before cutting.

## 1. What Drape Already Does Today

Drape already has several useful signals in-product:

- the customer measurement flow requires:
  - `chest`
  - `waist`
  - `fitStyle`
  before the user can proceed through the first step
- the custom brief currently treats a measurement profile as “complete enough” when it has:
  - core measurements
  - garment context
  - body shape context
- the tailor diary currently requires at least `5` measurements before saving
- orders already store `customer_measurements_snapshot`
- tailor diary and passport already create a strong `tailor-captured` pathway

Important Drape gap:

- the product does not yet formally store:
  - measurement source
  - measurement confidence
  - confirmation-required state
  - confirmation-completed state

So the product already carries the raw fit data, but not the confidence model.

## 2. Market Pattern: Multiple Measurement Paths Still Lead To First-Fit Review

Proper Cloth’s current fit model is useful because it supports several ways to create size:

- questionnaire / algorithmic sizing
- at-home measurement
- showroom fitting
- Home Try-On with a fit specialist

But even with those inputs, Proper Cloth still offers:

- remakes
- local alteration support / credit
- full refund path in some cases

Important Drape takeaway:

- more accurate capture does not eliminate first-fit uncertainty
- fit systems improve confidence, then refine after first delivery

## 3. Market Pattern: Fit Issues Can Exist Even When Measurements Were Not “Wrong”

INDOCHINO’s current help center says:

- first-time orders can still be slightly off
- measurements are not an exact science
- fit preference matters and may still need refinement

That matters because it separates two different things:

- bad measurement capture
- natural first-order refinement

Important Drape takeaway:

- not every fit complaint means someone lied or measured badly
- Drape should distinguish clear measurement failure from ordinary first-fit calibration

## 4. Market Pattern: Saved Measurement Profiles Become More Valuable Over Time

Suitsupply’s current Size Passport is a strong signal:

- measurements are saved in one place
- used across in-store and online
- basic alterations are encouraged before advanced changes

Important Drape takeaway:

- measurement systems get stronger when they become persistent, reusable, and refined over time
- one-off raw numbers are weaker than a living fit profile

This lines up very well with Drape’s tailor passport idea.

## 5. Confidence Depends On More Than Source

Source matters, but it is not enough by itself.

Important confidence drivers include:

- who captured the measurements
- how many useful fields are present
- whether garment context exists
- whether fit preference is explicit
- whether asymmetry / posture / problem areas are noted
- whether this is a first order or a repeat with successful history
- whether the garment is forgiving or highly fit-sensitive

Important Drape takeaway:

- `TAILOR_CAPTURED` is stronger than `SELF_GUIDED`
- but `TAILOR_CAPTURED` on an unusual high-stakes garment may still need confirmation
- and `SELF_GUIDED` plus strong context can still be good enough to quote

## 6. Measurement Confidence Should Be Tiered

The cleanest model is probably:

### `LOW`

Examples:

- self-guided only
- sparse measurements
- little garment context
- complex custom garment
- first order
- strong fit ambiguity

### `MEDIUM`

Examples:

- self-guided or helper-guided with a fuller profile
- external pro without much metadata
- clear fit note and garment context
- straightforward garment

### `HIGH`

Examples:

- tailor-captured passport
- strong external-pro measurements with enough coverage
- repeat customer with known fit baseline
- consultation clarified fit before production

Important Drape takeaway:

- confidence should be computed from a few facts, not guessed ad hoc by ops later

## 7. Quote Confidence And Cutting Confidence Should Not Be The Same

This is a major product distinction.

A tailor may have enough confidence to:

- quote

without yet having enough confidence to:

- cut fabric

This matters because quoting often needs:

- rough fit confidence
- time estimate
- complexity judgment

Whereas cutting needs:

- stronger confidence
- less ambiguity
- fewer unresolved assumptions

Important Drape takeaway:

- Drape should allow more flexibility at quote time than at cutting time

## 8. Good Confirmation Triggers

The strongest triggers for a required confirmation step are:

- `SELF_GUIDED` or `HELPER_GUIDED` source on a first order
- sparse measurement profile
- event-critical order
- highly fitted or structured garment
- customer note suggests unusual fit sensitivity
- measurements look internally inconsistent
- measurements changed materially from a prior saved profile
- tailor is uneasy and marks confirmation required

Important Drape takeaway:

- “tailor discomfort” is itself a valuable signal and should be allowed to pause production

## 9. Liability Should Follow Warning + Decision, Not Just Source

This is the most important fit-liability principle.

A weak source does not automatically make every later fit issue the customer’s fault.

And a strong source does not automatically make every fit issue the tailor’s fault.

Liability should depend on:

- what source the measurements had
- whether the tailor saw clear warning signs
- whether the tailor asked for confirmation
- whether the customer ignored or rejected that confirmation request
- whether the problem was actually about fit preference rather than numeric measurement

## 10. Best Liability Shape For Drape

### Tailor-leaning responsibility

Usually stronger when:

- tailor captured the measurements
- tailor accepted a passport / pro measurement and ignored obvious mismatch risks
- tailor proceeded to cut without required confirmation
- tailor ignored fit preference or contextual notes

### Customer-leaning responsibility

Usually stronger when:

- measurements were self-guided
- tailor clearly warned or required confirmation
- customer insisted on proceeding without clarifying
- the issue maps closely to the customer’s own inaccurate or outdated measurement input

### Shared-risk responsibility

Usually stronger when:

- first-order fit refinement is the main issue
- measurements were plausible but not perfect
- fit preference was not fully expressed
- external pro measurements were decent but the garment still needed interpretation

Important Drape takeaway:

- many first-order fit disputes should be treated as remedy questions before they become blame questions

## 11. V1 Product Gaps This Research Exposes

Drape will likely want these later:

- `measurement_source`
- `measurement_source_label`
- `measured_at`
- `measured_by_name`
- `measurement_confidence`
- `measurements_require_confirmation`
- `measurements_confirmed_at`
- `measurements_confirmation_note`
- `prior_successful_fit_orders`

This would let Drape:

- show tailors how much confidence to place in the numbers
- let ops resolve fit disputes with more clarity
- avoid reconstructing fit context from messages later

## Working Recommendation

The cleanest Drape answer is:

- use source-aware fit confidence, not raw measurements alone
- allow quotes on lower confidence than cutting
- require confirmation before cutting when source or context is weak
- treat liability as a combination of:
  - source
  - completeness
  - warnings
  - confirmation behavior
- keep many first-order fit issues in the remedy lane before escalating them into fault allocation

## Sources

Official sources:

- [Proper Cloth Perfect Fit Guarantee](https://propercloth.com/perfect-fit-guarantee)
- [Proper Cloth Home Try-On](https://propercloth.com/home-try-on)
- [INDOCHINO: My suit doesn't fit, what options do I have?](https://support.indochino.com/hc/en-us/articles/360034773473-My-suit-doesn-t-fit-what-options-do-I-have)
- [INDOCHINO: Why does my first order have fit issues?](https://support.indochino.com/hc/en-us/articles/360045066794-Why-does-my-first-order-have-fit-issues)
- [Suitsupply Size Passport](https://suitsupply.com/en-us/journal/size-passport.html)

Directional community signal:

- [Reddit: I need help taking my measurements pls.](https://www.reddit.com/r/Tailors/comments/1f1vfps/)
- [Reddit: Tailors, what's some basic info about properly fitting clothes you wish everyone knew?](https://www.reddit.com/r/Tailors/comments/197ngr7/)
- [Reddit: Measured at home and ordered a suit on Etsy... it's huge](https://www.reddit.com/r/Tailors/comments/10q6idj/)
