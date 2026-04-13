# V1 Decisions: Measurement Confirmation And Fit Liability

Date: April 2, 2026

## Why This Exists

Drape needs a working answer to:

- when measurements are strong enough to proceed
- when a tailor should pause for confirmation
- when fit issues are more customer risk, tailor risk, or shared risk

This document turns the research into a practical V1 stance.

## Core Principle

Measurements are a confidence input, not a perfect-fit guarantee.

## Decision 1: Use Fit Confidence, Not Just Measurement Presence

### Chosen rule

For V1, Drape should treat measurements as having a confidence level, not just “present” or “missing.”

Working levels:

- `LOW`
- `MEDIUM`
- `HIGH`

### Why

Two profiles can both contain numbers while carrying very different fit risk.

## Decision 2: Quote Threshold Should Be Looser Than Cutting Threshold

### Chosen rule

A tailor may quote with lower confidence than they would need to cut.

### Why

Quote-stage uncertainty is tolerable.
Cutting-stage uncertainty is much more expensive.

## Decision 3: `LOW` Confidence Should Trigger Confirmation Before Cutting

### Chosen rule

If fit confidence is `LOW`, Drape should require a pre-cutting confirmation path before production moves into `CUTTING`.

### Best V1 examples

- self-guided measurements on a first order
- sparse profile
- unusual or highly fitted garment
- event-critical custom order
- tailor explicitly flags discomfort

### Why

This is the cleanest place to reduce preventable fit disputes.

## Decision 4: `MEDIUM` Confidence Can Quote Normally But May Still Need Confirmation

### Chosen rule

`MEDIUM` confidence can usually support quoting, but the tailor should still be able to require confirmation before cutting.

### Examples

- helper-guided profile with decent coverage
- external pro measurements with limited metadata
- self-guided profile with strong context and clear fit notes

### Why

Many workable orders sit in the middle, not at either extreme.

## Decision 5: `HIGH` Confidence Should Usually Proceed Without Forced Confirmation

### Chosen rule

`HIGH` confidence should generally allow the order to proceed normally unless the tailor spots a specific fit concern.

### Examples

- tailor-captured passport
- repeat customer with proven fit baseline
- well-documented pro measurement plus consultation clarity

### Why

The product should not create unnecessary friction when confidence is legitimately strong.

## Decision 6: Fit Confidence Depends On More Than Source

### Chosen rule

Confidence should later consider:

- source
- coverage / completeness
- garment context
- fit preference clarity
- repeat-order history
- garment complexity

### Why

`TAILOR_CAPTURED` is usually stronger than `SELF_GUIDED`, but source alone is not enough.

## Decision 7: Tailor-Requested Confirmation Is A Valid Safety Lever

### Chosen rule

If the tailor believes the fit basis is weak, they should be allowed to require clarification before cutting.

### Why

The tailor is the closest operator to the actual risk of proceeding.

## Decision 8: First-Order Fit Issues Should Often Be Treated As Remedy Problems First

### Chosen rule

For V1, not every first-fit issue should immediately be treated as a blame decision.

Best default posture:

- assess whether alteration or remake can realistically solve it
- then decide whether liability should affect refund logic

### Why

Fit calibration is often a real part of custom work, especially on a first order.

## Decision 9: Liability Should Follow Source Plus Warning Behavior

### Chosen rule

Fit liability should not be assigned from source alone.

It should depend on:

- source
- visible warning signs
- whether the tailor required confirmation
- whether the customer ignored or rejected that request

### Why

This is fairer than making every self-measurement issue automatically the customer’s fault.

## Decision 10: Tailor-Captured Measurements Increase Tailor Responsibility

### Chosen rule

If measurements were captured by the tailor or brought in through a tailor passport, later fit liability leans more toward the tailor if the issue reflects basic measurement or interpretation failure.

### Why

The stronger the tailor’s control over the fit basis, the stronger the tailor’s accountability.

## Decision 11: Self-Guided Measurements Increase Customer Risk Only If Drape And Tailor Did Their Part

### Chosen rule

Customer-side fit risk should increase mainly when:

- the source was self-guided or helper-guided
- the tailor requested clarification or confirmation
- the customer chose to proceed without resolving the ambiguity

### Why

Without warning or confirmation behavior, it is too easy to dump all ambiguity on the customer unfairly.

## Decision 12: External-Pro Measurements Are Stronger, But Not Absolute

### Chosen rule

`EXTERNAL_PRO_CAPTURED` measurements should generally carry more confidence than raw self-measurement, but they should not be treated as a perfect guarantee.

### Why

A professional can capture the body accurately and still miss:

- intended silhouette
- posture nuance
- garment-specific interpretation
- later body changes

## Decision 13: Drape Should Add Explicit Fit-Confidence Fields Later

### Chosen rule

Useful future fields likely include:

- `measurement_source`
- `measurement_confidence`
- `measurements_require_confirmation`
- `measurements_confirmed_at`
- `measured_at`
- `prior_successful_fit_orders`

### Why

Right now Drape carries fit data, but not enough fit confidence state.

## Recommendation Summary

The cleanest V1 posture is:

- measurements are confidence-bearing, not certainty-bearing
- quote threshold is looser than cutting threshold
- `LOW` confidence requires confirmation before cutting
- `MEDIUM` confidence can quote, but tailor can still require confirmation
- `HIGH` confidence usually proceeds unless a specific concern appears
- first-order fit problems should usually go remedy-first
- liability should depend on source plus warning / confirmation behavior

## Sources

- [Proper Cloth Perfect Fit Guarantee](https://propercloth.com/perfect-fit-guarantee)
- [Proper Cloth Home Try-On](https://propercloth.com/home-try-on)
- [INDOCHINO: My suit doesn't fit, what options do I have?](https://support.indochino.com/hc/en-us/articles/360034773473-My-suit-doesn-t-fit-what-options-do-I-have)
- [INDOCHINO: Why does my first order have fit issues?](https://support.indochino.com/hc/en-us/articles/360045066794-Why-does-my-first-order-have-fit-issues)
- [Suitsupply Size Passport](https://suitsupply.com/en-us/journal/size-passport.html)
