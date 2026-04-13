# Research Notes: Privacy, Account Deletion, And Retention Boundaries

Date: April 2, 2026

## Why This Exists

Drape now has an in-app account deletion request flow and a public privacy surface.

What is still ambiguous is:

- what “delete my account” should actually mean
- what must be deleted
- what can be anonymized
- what must be retained for legal, fraud, payout, or dispute reasons
- how Drape should stay honest in-app and on the web about those boundaries

This note is the research layer for that ambiguity.

## Important Scope Note

This is a product and operations policy note, not legal advice.

It is meant to give Drape a safer V1 operating posture before final legal review.

## High-Signal Takeaways

- Apple and Google both require real account deletion access for apps with account creation.
- Neither requirement forces a fake “instant total wipe” promise.
- Both allow deletion to take time, as long as the path is real and the user is informed clearly.
- Google explicitly recognizes that some data may need to be retained for legitimate reasons like security, fraud prevention, or regulatory compliance.
- ICO guidance makes the same boundary clearer: the right to erasure is not absolute, and data may still be retained for legal obligations or the establishment, exercise, or defence of legal claims.
- Storage limitation still matters, which means Drape needs both:
  - conservative short-term retention for evidence and money movement
  - a real later plan to erase or anonymize data once it is no longer needed

## 1. What Drape Already Does Today

Drape already has meaningful deletion and privacy building blocks:

- in-app deletion initiation on customer and tailor mobile surfaces
- `request-account-deletion` edge function
- `account_deletion_requests` table
- `/ops` visibility for deletion request follow-up
- privacy contact routes on web
- evidence-retention policy work already done for orders, disputes, messages, and payouts

Important local product reality:

- the current deletion flow is request-based, not immediate hard delete
- that is fine for store policy, but the product copy must stay honest about it

Important local tension:

- the customer privacy screen includes language like “Permanently remove your account and all data”
- but the request confirmation and other copy already say Drape may retain some transaction records where legally required

Important Drape takeaway:

- the underlying request architecture is reasonable
- the deletion promise is currently more absolute than the actual system

## 2. Apple’s Current Rule: In-App Deletion Must Be Real And Transparent

Apple’s current account deletion guidance is the clearest practical rule for iOS:

- if an app supports account creation, it must let users initiate account deletion within the app
- the path should be easy to find
- deleting the account should remove the account and associated data the developer is not legally required to keep
- if deletion completes on the web, the app should link directly to the specific page
- if deletion takes time, users should be told
- user-generated content is expected to be deleted too, unless local law requires retaining some of it

Important Drape takeaway:

- request-based manual processing is acceptable
- vague “contact support somewhere” is not enough unless it is part of a real deletion flow
- if Drape keeps some data, it should say why

## 3. Google Play’s Current Rule: In-App Deletion Plus A Web Route

Google Play’s current help and User Data policy are similarly explicit:

- if the app supports account creation, users must be able to request account deletion
- that path must exist in the app
- there must also be a web link resource where users can request account deletion and associated data deletion
- the web resource should be functional, relevant, and prominently feature the deletion request path
- certain data may still be retained for legitimate reasons such as security, fraud prevention, or regulatory compliance, but users should be clearly informed

Important Drape takeaway:

- the current web privacy page is directionally useful, but Drape should eventually make the deletion path itself more explicit there
- mailto may be workable as a V1 fallback, but the deletion route should not feel hidden

## 4. ICO / UK GDPR Guidance: Erasure Is Not Absolute

ICO’s current guidance makes the privacy-law boundary clear:

- the right to erasure is not absolute
- organisations generally have one month to respond
- the right does not apply where processing is necessary to comply with a legal obligation
- it also does not apply where processing is necessary for the establishment, exercise, or defence of legal claims
- under storage limitation, organisations must not keep personal data for longer than needed
- when data is no longer needed, it should be erased or anonymized
- simply taking data offline is not the same as deletion
- restricted processing is a real concept: you may store data while limiting further use

Important Drape takeaway:

- Drape does not need to pretend that deletion always means immediate physical obliteration of every record
- Drape does need to justify what it keeps, reduce use of retained data, and remove or anonymize data when the retention basis ends

## 5. The Most Useful Drape Distinction

The strongest distinction for Drape is not:

- deleted
- not deleted

The strongest distinction is:

- account closure
- restricted retention
- final erasure or anonymization

## A. Account closure

Examples:

- user can no longer sign in normally
- public profile is hidden
- no new orders or marketplace activity
- push and marketing use stop

## B. Restricted retention

Examples:

- orders
- messages
- disputes
- payouts
- audit logs
- contact-bypass logs
- deletion requests themselves

These may still need to exist for:

- legal obligations
- fraud prevention
- chargebacks
- support follow-up
- legal claims

## C. Final erasure or anonymization

Examples:

- profile preferences
- saved items
- non-essential metadata
- stale support-side convenience data
- public attribution that no longer needs to identify the person

## 6. Drape’s Marketplace Reality Makes Full Immediate Erasure Risky

Drape is not a notes app or a low-stakes social tool.

It handles:

- identity
- measurements
- payments
- disputes
- shipping or handoff records
- trust and abuse logs

That means a deletion request can collide with:

- active orders
- payout risk windows
- refund or chargeback risk
- open concern or dispute
- trust or abuse review
- legal holds

Important Drape takeaway:

- deletion cannot be defined only by customer expectation
- it has to be defined in relation to money movement, safety, and marketplace accountability

## 7. Public Content Needs A More Careful Drape Rule

Apple’s guidance says users expect account deletion to remove user-generated content like reviews.

That is a strong signal, but Drape also has trust and legal-evidence needs.

The cleanest Drape product inference is:

- public-facing attribution and public-facing visibility should be removed or anonymized on deletion completion
- internal evidence copies may still need retention where legal claims, fraud, trust, or dispute defense require it

Important Drape takeaway:

- “remove from public surfaces” and “erase every internal trace immediately” are not always the same thing

## 8. What This Means For V1

The strongest V1 direction is:

- keep in-app deletion initiation
- strengthen the web deletion route
- treat deletion as a staged process
- close account access and public visibility quickly once the request is accepted
- retain only what is still justified for legal, fraud, payout, dispute, or safety reasons
- erase or anonymize the rest
- keep deletion copy honest about those boundaries

## Sources

- [Apple Developer: Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Apple Developer: Account deletion within apps](https://developer.apple.com/news/upcoming-requirements/?id=06302022b)
- [Google Play Console Help: Understanding Google Play’s app account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)
- [Google Play Console Help: User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en)
- [ICO: Right to erasure](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/)
- [ICO: Principle (e) Storage limitation](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/)
- [ICO: Right to restrict processing](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-restrict-processing/)
