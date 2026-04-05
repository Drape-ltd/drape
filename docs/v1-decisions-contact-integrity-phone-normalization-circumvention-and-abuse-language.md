# V1 Decisions: Contact Integrity, Phone Normalization, Circumvention, And Abuse Language

Date: April 2, 2026

## Why This Exists

Drape needs a practical answer to:

- how phone numbers should be stored
- how contact-bypass prevention should work
- how abusive and offensive language should be handled
- how all of that should work without pushing real business off-platform

This document turns the research into a working V1 stance.

## Core Principle

Treat contact integrity as one system.

Phone normalization, anti-circumvention, and message safety should reinforce each other.

## Decision 1: Store Canonical Phone Numbers, Preferably In E.164

### Chosen rule

For V1, Drape should prefer canonical phone storage in E.164 form for any phone number that may be used for:

- account recovery
- support
- notifications
- future OTP
- safe contact handling

### Why

Canonical storage reduces lookup failures, duplicate identity drift, and future messaging bugs.

## Decision 2: Normalize At Input, Not At Query Time

### Chosen rule

Phone normalization should happen before save on every write path.

### Applies to

- customer profile phone
- tailor profile or auth phone
- offline tailor-client phone
- future support/admin entry points

### Why

Query-time normalization is too late and too easy to miss.

## Decision 3: Require Country Context For Reliable Parsing

### Chosen rule

For V1, Drape should not guess blindly when a number lacks country code.

Best inputs are:

- explicit country selection
- user profile country or market
- trusted locale context where appropriate

### Why

The same digits can mean different things in different countries.

## Decision 4: Nigerian Local Variants Should Collapse To One Canonical Number

### Chosen rule

When the country context is Nigeria, local variants of the same number should resolve to one canonical stored value.

### Best V1 canonical target

- E.164 with `+234...`

### Example inputs that should become one canonical number

- `08012345678`
- `8012345678`
- `2348012345678`
- `+2348012345678`
- `080 1234 5678`

### Important note

This exact mapping is a Drape implementation inference grounded in E.164, Nigeria’s `+234` dialing code, and country-aware parsing behavior.

### Why

This is the failure mode that breaks OTP, matching, and support lookup when ignored.

## Decision 5: Keep Human Display Separate From Canonical Lookup

### Chosen rule

If Drape wants a human-friendly display form later, it should derive or store it separately from the canonical value.

### Why

The canonical field is for uniqueness and routing, not for pretty presentation.

## Decision 6: Stored Phone Numbers Are Not Auto-Shareable Contact Details

### Chosen rule

Even if Drape stores a user’s phone number, that does not mean it should be shown to the other party by default.

### Why

Internal contact data and peer-to-peer contact release are different decisions.

## Decision 7: Contact-Bypass Detection Should Be Canonical And Evasion-Aware

### Chosen rule

For V1, Drape should improve from “literal regex only” toward:

- normalized digit matching
- spaced and punctuated number handling
- simple obfuscation handling
- payment-circumvention phrases
- social-handle and external-platform intent

### Why

Users trying to move off-platform rarely always type contact info in one obvious format.

## Decision 8: Contact Leakage And Off-Platform Payment Requests Stay Hard-Blocked

### Chosen rule

These should remain hard-blocked:

- phone numbers
- email addresses
- WhatsApp / Telegram / Instagram handles
- external links for contact diversion
- bank-transfer or off-platform payment requests

### Why

This is core marketplace protection, not optional moderation polish.

## Decision 9: General Offensive Language And Severe Safety Language Should Not Be Treated The Same

### Chosen rule

For V1, Drape should distinguish:

- rude or heated language
- targeted harassment or sexual humiliation
- credible threats, hate, coercion, doxxing, or extortion

### Why

A single moderation hammer will either overfire or miss serious harm.

## Decision 10: High-Severity Abuse Should Be A Trust Incident

### Chosen rule

Credible threats, hate speech, coercion, doxxing, blackmail, or severe sexual harassment should trigger:

- immediate block or hide
- incident logging
- urgent ops review
- restriction review where warranted

### Why

These are not ordinary moderation issues.

## Decision 11: Lower-Severity Abuse Can Use Friction Before Full Restriction

### Chosen rule

For V1, direct insults, degrading language, and repeated hostile tone can use:

- user warning or rewrite prompt
- report path
- moderation review
- escalation on repetition

### Why

Drape should protect people without pretending every angry sentence is a suspension-level event.

## Decision 12: Repeated Circumvention Or Harassment Should Feed The Seller Trust Ladder

### Chosen rule

Repeated blocked contact attempts, repeated abusive messages, or mixed circumvention-plus-harassment behavior should feed seller trust and restriction review.

### Why

This is behavior pattern risk, not just one bad message.

## Decision 13: Future Product Should Model Contact Integrity Explicitly

### Chosen rule

When implemented, useful fields likely include:

- `phone_e164`
- `phone_country`
- `phone_national_display`
- `contact_integrity_state`
- `contact_hold_reason`
- `abuse_severity`
- `abuse_reported_at`
- `abuse_reviewed_at`

### Why

Right now too much of this system depends on ad hoc string checks and raw text state.

## Recommendation Summary

The cleanest V1 posture is:

- normalize phones before save
- prefer E.164 for canonical storage
- use country-aware parsing
- treat Nigerian formatting variants as one number once country is known
- never equate stored phone with shareable phone
- keep contact leakage and off-platform payment requests hard-blocked
- classify abuse by severity
- escalate threats, hate, coercion, and doxxing as trust incidents

## Sources

- [ITU-T Recommendation E.164](https://www.itu.int/rec/t-rec-e.164/en)
- [Twilio: Normalize telephone numbers](https://www.twilio.com/docs/serverless/functions-assets/quickstart/normalize-telephone-numbers)
- [Twilio Proxy API: phone number in E.164 format](https://www.twilio.com/docs/proxy/api/phone-number)
- [Twilio Nigeria SMS Guidelines](https://www.twilio.com/en-us/guidelines/ng/sms)
- [Google libphonenumber](https://github.com/google/libphonenumber)
- [Zendesk: accepted phone number formats for Talk](https://support.zendesk.com/hc/en-us/articles/4408823756570-What-are-the-accepted-phone-number-formats-for-Talk)
- [Zendesk: format a phone number in Sell](https://support.zendesk.com/hc/en-us/articles/4408835497370-How-do-I-format-a-phone-number-in-Sell)
- [Upwork: Keeping your contact information safe](https://support.upwork.com/hc/en-us/articles/360051749534-Keeping-your-contact-information-safe)
- [Upwork: Why you shouldn’t get paid outside Upwork](https://support.upwork.com/hc/en-us/articles/360048105134-Why-you-shouldn-t-get-paid-outside-Upwork)
- [Upwork: How to use Upwork Messages for chats, updates, and meetings](https://support.upwork.com/hc/en-us/articles/43357128336147-How-to-use-Upwork-Messages-for-chats-updates-and-meetings)
- [Airbnb: Avoiding fraud, scams, and abuse](https://www.airbnb.com/help/article/3059)
- [Airbnb: Report suspicious messages](https://www.airbnb.com/help/article/3017)
- [Airbnb: Combating hate, harassment, and discrimination](https://www.airbnb.com/help/article/3058)
- [Fiverr: Objectionable content and user safety](https://help.fiverr.com/hc/en-us/articles/37554483360529-Community-Standards-Objectionable-content-and-user-safety)
- [Fiverr: Violence and unlawful behavior](https://help.fiverr.com/hc/en-us/articles/37554501373073-Community-Standards-Violence-and-Unlawful-Behavior)
- [Fiverr: How to report content or behavior on Fiverr](https://help.fiverr.com/hc/en-us/articles/37333217346833-How-to-report-content-or-behavior-on-Fiverr)
