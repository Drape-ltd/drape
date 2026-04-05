# V1 Decisions: Privacy, Account Deletion, And Retention Boundaries

Date: April 2, 2026

## Why This Exists

Drape needs a practical answer to:

- what happens when someone asks to delete their account
- what is deleted immediately
- what is retained temporarily
- what is anonymized later
- how Drape should explain those boundaries honestly

This document turns the research into a working V1 stance.

## Important Scope Note

This is a product-policy stance for V1, not final legal advice.

## Core Principle

Drape should offer honest staged deletion, not a fake instant total wipe.

## Decision 1: Separate Deletion Request, Account Closure, And Final Erasure

### Chosen rule

For V1, Drape should treat these as separate states:

- deletion requested
- deletion accepted / account closing
- deletion completed

### Why

This matches both store-policy reality and marketplace-operational reality.

## Decision 2: Keep Real In-App Deletion Initiation

### Chosen rule

Drape should continue to allow users to initiate account deletion inside the app.

### Why

This is required by Apple and Google for apps with account creation.

## Decision 3: Strengthen The Web Deletion Route

### Chosen rule

For V1, Drape should provide a clearly discoverable web deletion route outside the app.

### Best V1 acceptable path

- a prominent privacy-page deletion request path
- email or form is acceptable if it is clearly deletion-focused and easy to find

### Why

Google Play expects an outside-the-app deletion resource too.

## Decision 4: Use Honest Timing Targets

### Chosen rule

For V1, Drape should aim for:

- immediate in-app receipt confirmation
- human acknowledgment within `72 hours`
- substantive deletion response or completion target within `30 days`

### Why

This fits request-based store compliance and aligns better with data-rights timing than vague “we’ll get back to you.”

## Decision 5: Accepted Deletion Should Quickly Stop New Marketplace Activity

### Chosen rule

Once a deletion request is accepted for processing, Drape should quickly move the account into a closure state that blocks:

- new orders
- new listing or profile activity
- new discovery visibility
- marketing use
- push delivery where no longer needed

### Important nuance

If the account still has active obligations, Drape may need limited support or resolution access during the closure period.

### Why

People should not keep transacting normally while deletion is supposedly underway.

## Decision 6: Active Orders, Disputes, Payouts, Or Safety Holds Can Delay Final Erasure

### Chosen rule

If a deletion request collides with:

- active order obligations
- open concern or dispute
- payout risk or chargeback risk
- fraud review
- safety or abuse investigation
- legal hold

then Drape may delay final erasure while restricting the account.

### Why

This is where evidence, accountability, and legal-claims retention matter most.

## Decision 7: Retain Only What Still Has A Clear Justification

### Chosen rule

For V1, Drape may retain data only when it is still needed for reasons such as:

- legal obligation
- legal claims
- fraud prevention
- payment or payout risk
- dispute handling
- security or abuse review

### Why

Retention should be specific and defensible, not a vague “keep everything forever.”

## Decision 8: Profile, Preference, And Growth Data Should Be Easier To Remove

### Chosen rule

The easiest data to delete or anonymize on completion should be:

- marketing preferences
- analytics preferences
- saved-tailor state
- push tokens
- public profile visibility
- non-essential convenience metadata

### Why

This data usually has weaker retention justification than money, safety, or dispute records.

## Decision 9: Public-Facing Attribution Should Be Removed Faster Than Internal Evidence

### Chosen rule

When deletion completes, Drape should prefer:

- remove public profile visibility
- remove public attribution where possible
- anonymize public review authorship if the review itself must remain visible for product integrity

### Important nuance

If content must remain for legal or safety reasons, internal retained copies can be justified separately from public visibility.

### Why

This is the cleanest way to reconcile platform expectations, trust surfaces, and evidence needs.

## Decision 10: Core Order And Trust Records Can Be Retained Under Restricted Processing

### Chosen rule

For V1, records such as these may remain under restricted processing when justified:

- orders
- messages
- disputes
- payouts
- audit logs
- contact-bypass logs
- deletion requests

### Best V1 posture

- retain access only for support, ops, privacy, trust, or legal handling
- do not keep using them for normal product growth or personalization

### Why

Retention is easier to justify when ongoing use is tightly limited.

## Decision 11: Deletion Copy Must Stop Overpromising

### Chosen rule

Drape should not say:

- “all data will be permanently removed immediately”

if the true system is:

- request
- review
- closure
- justified retention
- later erasure or anonymization

### Better posture

Explain that Drape will delete or anonymize data it no longer needs and may retain certain records where legally required or necessary for fraud, safety, disputes, payouts, or legal claims.

### Why

Honest privacy copy is part of trust, not just legal hygiene.

## Decision 12: Data Export And Deletion Should Stay Distinct

### Chosen rule

For V1, Drape should keep:

- data export / access requests
- deletion requests

as distinct flows, even if both route through privacy handling today.

### Why

Users asking what data Drape holds are not always asking to erase it.

## Decision 13: Future Product Should Model Deletion State More Explicitly

### Chosen rule

When implemented more fully, useful fields likely include:

- `deletion_status`
- `deletion_hold_reason`
- `deletion_acknowledged_at`
- `deletion_restricted_at`
- `deletion_completed_at`
- `retention_basis`
- `anonymized_at`
- `public_profile_removed_at`

### Why

The current request table is a start, but not yet a complete deletion operating model.

## Recommendation Summary

The cleanest V1 posture is:

- real in-app deletion initiation
- a clearer web deletion path
- staged deletion, not fake instant wipe
- quick account closure after acceptance
- limited retention only where justified
- public visibility removed faster than internal evidence
- deletion copy that tells the truth

## Sources

- [Apple Developer: Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Apple Developer: Account deletion within apps](https://developer.apple.com/news/upcoming-requirements/?id=06302022b)
- [Google Play Console Help: Understanding Google Play’s app account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)
- [Google Play Console Help: User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en)
- [ICO: Right to erasure](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/)
- [ICO: Principle (e) Storage limitation](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/)
- [ICO: Right to restrict processing](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-restrict-processing/)
