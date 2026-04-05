# V1 Decisions: Data Access, Export, Rectification, And Disclosure Honesty

Date: April 2, 2026

## Why This Exists

Drape needs a practical answer to:

- what data users can correct directly
- what data needs a request
- what a V1 export should include
- how privacy and store disclosures should map to reality

This document turns the research into a working V1 stance.

## Important Scope Note

This is a V1 product-policy stance, not final legal advice.

## Core Principle

Do not make users ask for rights they should already have, and do not claim controls the system does not actually enforce.

## Decision 1: Self-Serve Rectification Should Cover Factual User Data

### Chosen rule

For V1, users should usually be able to correct factual, user-owned data directly in-product.

### Best examples

- display name
- phone number
- measurement profile
- garment-context preferences
- marketing and analytics preferences

### Why

These are normal accuracy controls, not exceptional legal workflows.

## Decision 2: Evidence-Critical History Should Not Be Directly Rewritten

### Chosen rule

For V1, users should not be able to directly rewrite:

- orders
- stage history
- disputes
- payouts
- audit history
- trust logs
- already-published reviews outside the allowed review policy

### Better pattern

- add correction context
- add support note
- add supplementary statement where appropriate

### Why

Rectification should not destroy marketplace evidence.

## Decision 3: Data Export Stays Request-Based In V1

### Chosen rule

For V1, Drape can keep data export as a request-based flow instead of an instant one-tap download, as long as the path is real and clear.

### Why

This is acceptable for an early marketplace and fits the current app structure.

## Decision 4: Access And Rectification Requests Should Have Time Targets

### Chosen rule

For V1, Drape should aim for:

- acknowledgment within `72 hours`
- substantive response within `30 days`

for access and rectification requests, unless the case is unusually complex or identity needs confirmation first.

### Why

This is consistent with ICO guidance and gives the team a real operational target.

## Decision 5: V1 Export Should Be A User-Centric Bundle, Not A Raw Dump

### Chosen rule

If Drape provides a data export, it should prioritize a user-readable bundle of the requester’s own data rather than a raw internal database extract.

### Best likely V1 contents

- profile data
- measurements
- privacy preferences
- order list and key order facts
- user-authored messages
- user-authored reviews
- deletion-request history

### Important nuance

Third-party information and legally restricted material may need redaction or exclusion.

### Why

Useful export is better than noisy export.

## Decision 6: Self-Serve Editing And Formal Rights Requests Must Stay Distinct

### Chosen rule

For V1, Drape should clearly distinguish:

- “edit my data”
- “request a copy of my data”
- “request deletion”

### Why

These are different user intents and should not blur together.

## Decision 7: Privacy Preferences Must Be Honest About Enforcement

### Chosen rule

If a privacy preference is only stored but not yet fully enforced against runtime SDK behavior, Drape should not present it as a complete effective control.

### Why

Stored preference is not the same as enforced control.

## Decision 8: App Privacy And Play Data Safety Must Follow Real SDK Behavior

### Chosen rule

For V1, Drape’s App Store and Play disclosures must reflect:

- first-party collection
- third-party SDK collection
- diagnostics
- analytics
- any messaging or content data sent off-device and retained

### Why

Developers are responsible for keeping those declarations accurate and up to date.

## Decision 9: Privacy Copy Should Distinguish Functional Data From Growth Data

### Chosen rule

Drape should clearly separate:

- functional / marketplace data
- diagnostics
- analytics
- marketing preferences

### Why

Users are more likely to trust the product when they can tell what is necessary for orders versus what is for improvement or growth.

## Decision 10: Measurement Editing Should Not Rewrite Old Order Snapshots

### Chosen rule

Current measurement profile edits should affect future work, not retroactively rewrite old order snapshots.

### Why

This stays consistent with the earlier measurement-versioning decision and protects evidence integrity.

## Decision 11: Public Privacy Surfaces Should Become More Operationally Specific

### Chosen rule

For V1, Drape’s public privacy routes should move beyond principles-only language and explain at least:

- how to request access
- how to request deletion
- where users can manage privacy choices
- that disclosures and store labels are kept aligned with actual data use

### Why

Trust improves when the route is concrete, not abstract.

## Decision 12: Future Product Should Model Rights Handling More Explicitly

### Chosen rule

When implemented further, useful fields and primitives likely include:

- `access_request_status`
- `rectification_request_status`
- `export_generated_at`
- `export_scope`
- `privacy_preference_enforced_at`
- `sdk_disclosure_audit_at`

### Why

Today, too much of this is implied by copy or manual handling.

## Recommendation Summary

The cleanest V1 posture is:

- self-serve factual edits
- request-based export and broader access handling
- no direct rewriting of evidence-critical history
- one-month response target for access and rectification handling
- privacy toggles that do not overclaim
- store disclosures that match real SDK behavior

## Sources

- [ICO: What is the right of access?](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/right-of-access/what-is-the-right-of-access/)
- [ICO: What should we consider when responding to a request?](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/right-of-access/what-should-we-consider-when-responding-to-a-request/)
- [ICO: Right to rectification](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-rectification/)
- [ICO: A guide to individual rights](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/)
- [Apple Developer: App privacy details on the App Store](https://developer.apple.com/app-store/app-privacy-details/)
- [Apple Developer: Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)
- [Apple Developer: App privacy reference](https://developer.apple.com/help/app-store-connect/reference/app-privacy/)
- [Apple Developer: App Privacy Configuration](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration)
- [Google Play Console Help: Provide information for Google Play’s Data safety section](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en-EN)
- [Google Play Console Help: User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en)
