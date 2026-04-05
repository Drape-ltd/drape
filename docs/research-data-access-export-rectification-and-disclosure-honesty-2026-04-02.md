# Research Notes: Data Access, Export, Rectification, And Disclosure Honesty

Date: April 2, 2026

## Why This Exists

Drape already exposes privacy settings, a data-export request route, and several self-serve profile editing flows.

What is still ambiguous is:

- what users should be able to correct themselves
- what needs a formal data-rights request
- what a V1 data export should look like
- how privacy disclosures should map to actual SDK and product behavior

This note is the research layer for that ambiguity.

## Important Scope Note

This is a product-policy note, not final legal advice.

## High-Signal Takeaways

- Users should not need a legal request just to fix normal profile or measurement data.
- Access and export rights are broader than self-serve editing and usually need a bounded request flow.
- Rectification is strongest for factual personal data, not for rewriting marketplace history.
- App Store and Google Play privacy disclosures must include third-party SDK behavior, not just first-party code.
- Privacy controls become trust debt if the UI implies a control exists but the underlying SDK behavior does not follow it.

## 1. What Drape Already Does Today

Drape already has meaningful privacy and data-control surfaces:

- self-serve customer and tailor profile edits
- self-serve customer measurements editing
- privacy preferences stored in `user_metadata`
- in-app deletion initiation
- a “Download my data” path that currently opens an email request
- public privacy page and support routes

Important local strengths:

- customers can already self-correct factual profile and measurement data
- current measurement profile is separate from order snapshots, so historical order truth is not silently rewritten

Important local gaps:

- data export is request-based but not yet a real export workflow
- privacy preferences are stored, but current analytics and Sentry init paths do not appear to read those preferences before sending data
- that means at least some current privacy controls are preference capture, not fully enforced runtime controls
- current privacy/disclosure surfaces are more principle-oriented than operationally specific

Important Drape takeaway:

- Drape has real privacy UI
- but not every privacy promise is yet backed by full behavioral enforcement

## 2. ICO Guidance: Access And Rectification Are Distinct Rights

ICO’s current UK GDPR guidance is a strong operational reference here.

Current ICO right-of-access guidance says:

- people have the right to obtain a copy of their personal information and supplementary information
- the right of access helps them understand how and why their information is being used
- organisations generally must respond without undue delay and within one month

Current ICO rectification guidance says:

- people have the right to have inaccurate personal data rectified, or completed if incomplete
- requests can be verbal or written
- organisations generally must respond within one month
- rectification is closely tied to the accuracy principle

Important Drape takeaway:

- “see my data”
and
- “fix my data”

are related but different workflows

## 3. Self-Serve Rectification Should Cover Factual, User-Owned Data

The most useful product distinction for Drape is:

- factual profile data the user should usually self-correct
- platform or transaction history the user should not be able to rewrite directly

### Best examples of self-serve rectification

- display name
- phone number
- measurements
- garment-context preferences
- marketing and analytics preferences

### Best examples of non-self-serve historical records

- past orders
- order-stage history
- dispute records
- reviews
- payouts
- trust or abuse logs

Important Drape takeaway:

- self-serve editing is good for accuracy
- but marketplace history should not be mutable by default

## 4. Rectification Does Not Mean Rewriting Disputed History

ICO’s rectification guidance is about inaccurate personal data.

That does not mean platforms should let users rewrite:

- old review text
- dispute descriptions
- ops decisions
- order timelines

The stronger product inference for Drape is:

- factual user-owned profile data can be corrected directly
- disputed narrative records may need:
  - annotation
  - supplementary statement
  - or a new support note

rather than destructive replacement

Important Drape takeaway:

- rectification should improve accuracy
- it should not destroy evidence

## 5. V1 Data Export Does Not Need To Be A Raw Database Dump

ICO access guidance says people have the right to a copy of their personal data plus supplementary information.

That does not require Drape to send a raw internal dump full of unrelated operational noise.

A good V1 export is better thought of as:

- a user-readable bundle
- scoped to the requester’s own data
- redacted where necessary for third-party privacy or legal reasons

Best likely V1 contents:

- profile data
- measurement profile
- order list and key order facts
- user-authored messages
- user-authored reviews
- privacy preferences
- deletion requests
- support or dispute records that are properly attributable to the user and can be shared lawfully

Important Drape takeaway:

- export should be useful, not just technically possible

## 6. Store Disclosures Must Match SDK Reality

Apple’s current App Privacy Details guidance says:

- app privacy labels must include third-party partner collection too
- developers are responsible for keeping responses accurate and up to date
- if data is sent off-device and retained longer than servicing a real-time request, it counts as collected

Google Play’s current User Data and Data safety guidance says:

- developers must make complete and accurate declarations
- declarations must include third-party SDK behavior
- the privacy policy and Data safety section must stay consistent
- if collection occurs, it must be disclosed accurately

Important Drape takeaway:

- if PostHog or Sentry is live, disclosures must reflect that
- if a toggle claims to disable analytics but SDK behavior ignores it, the product is ahead of the truth

## 7. Drape Needs A Better Distinction Between Stored Preference And Enforced Control

This is the most important local finding in this layer.

Right now:

- privacy preferences are stored in `user_metadata`
- analytics initialization appears environment-driven
- Sentry initialization appears environment-driven

Important Drape inference:

- a preference can exist without being enforced
- disclosure honesty requires Drape to say which controls are:
  - active runtime controls
  - communication preferences
  - future or partial preferences not yet fully enforced

## 8. The Strongest Drape Shape

The cleanest V1 shape is:

- self-serve correction for factual profile and fit data
- request-based access/export for broader data rights
- limited rectification for history-sensitive records
- disclosure text that follows actual SDK behavior
- app-store and Play disclosures that reflect all real collection paths, including third-party SDKs

## 9. What This Means For V1

The strongest V1 direction is:

- keep self-serve correction for profile and measurements
- clearly distinguish “edit my data” from “request a copy of my data”
- use a one-month target for access and rectification requests
- avoid direct rewriting of evidence-critical history
- make privacy toggles honest about whether they are fully enforced yet
- align App Store and Play privacy disclosures with actual SDK/runtime behavior

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
