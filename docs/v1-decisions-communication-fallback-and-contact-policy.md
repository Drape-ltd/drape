# V1 Decisions: Communication Fallback And Contact Policy

Date: April 2, 2026

## Why This Exists

Drape needs a practical answer to:

- when customers and tailors must keep communication fully inside Drape
- when limited operational contact can open up
- how local collection, shipping, and local handoff should work without turning every order into a WhatsApp thread

This document turns the research into a working V1 stance.

## Core Principle

Keep commercial trust inside Drape.

Only release the minimum operational contact detail needed to fulfill a real order.

## Decision 1: Split Commercial Contact From Operational Contact

### Chosen rule

For V1, Drape should treat these as different categories.

### Commercial contact

- quote and pricing
- scope and design
- deadlines and changes
- payment
- disputes and remedies

### Operational contact

- pickup timing
- courier arrival
- fabric dropoff timing
- handoff instructions

### Why

The platform can be strict on commercial trust without being unrealistic about real-world fulfillment.

## Decision 2: No Peer-To-Peer Contact Exchange Before Commitment

### Chosen rule

Before a real order commitment exists, customer and tailor should not exchange direct contact details through Drape.

This includes:

- phone numbers
- email addresses
- WhatsApp / Telegram / Instagram handles
- external links
- home or studio addresses

### Applies to

- discovery
- pre-quote messaging
- consultation scheduling before commitment
- negotiation
- unpaid quote discussion

### Why

This is where scam, circumvention, and evidence loss are most likely.

## Decision 3: Commercial Communication Stays In Drape Even After Commitment

### Chosen rule

Even after payment or confirmation, these should still stay in Drape:

- pricing changes
- delay discussions
- change requests
- complaint handling
- refund or remedy negotiation
- payment instructions

### Why

Operational contact may need limited release later.
Commercial accountability should still remain on-platform.

## Decision 4: Shipping Uses Structured Order Data, Not Open-Ended Contact Sharing

### Chosen rule

For shipping orders, Drape should rely on:

- delivery address stored on the order
- carrier
- tracking number
- order thread for updates

The customer does not need the tailor’s raw personal number by default.
The tailor does not need a free-form off-platform conversation by default.

### Why

Shipping already has structured proof primitives.
That is safer than turning fulfillment into ad hoc private chat.

## Decision 5: Local Collection Should Use Time-Gated Operational Detail

### Chosen rule

For local collection, Drape should not treat direct contact as automatically open from day one.

Best V1 rule:

- keep normal communication in the order
- use collection code as the primary pickup proof
- expose exact pickup instructions or location only when the order is in or near `READY_FOR_COLLECTION`

### Why

Collection is a real handoff need, but the whole relationship still does not need to move off-platform.

## Decision 6: Customer-Supplied Fabric Local Handoff Needs Support-Mediated Fallback In V1

### Chosen rule

Until Drape has first-class local handoff tooling, customer-supplied fabric handoff should use:

- in-app order communication as the default
- support-assisted bridging if direct operational coordination becomes necessary

Not:

- casual peer-to-peer phone exchange in the main thread

### Why

This is one of the highest-risk fulfillment moments for “I handed it over” versus “I never got it” disputes.

## Decision 7: Consultation Failure Should Escalate, Not Drift Into Private Contact

### Chosen rule

If a consultation call fails, the fallback should be:

- retry
- reschedule
- support escalation

Not:

- “just move to WhatsApp and sort it out”

### Why

Consultation still affects scope, price, timing, and evidence.

## Decision 8: Drape Support Channels Are Allowed, But They Do Not Authorize Off-Platform Peer Coordination

### Chosen rule

Support email and support WhatsApp remain valid Drape-owned support channels.

They do not imply that:

- customer and tailor should move their order to WhatsApp
- payment discussions can move off-platform
- disputes should be handled privately outside Drape

### Why

Platform-to-user support is different from user-to-user circumvention.

## Decision 9: Off-Platform Payment Or Business Solicitation Is A Hard Trust Violation

### Chosen rule

These remain high-severity trust issues at any stage:

- asking to pay outside Drape
- asking for bank transfer instead of the platform checkout
- moving the commercial deal to Instagram, WhatsApp, Telegram, or similar
- using contact exchange to avoid platform fees or protections

### Why

Stage does not make circumvention safe.

## Decision 10: Repeated Contact Bypass Should Feed Restriction Review

### Chosen rule

Repeated blocked contact attempts should feed the seller trust ladder and review process.

### Why

One awkward message may be education-worthy.
Repeat behavior is usually a policy signal.

## Decision 11: V1 Should Favor Scoped Contact Release Over General Phone Visibility

### Chosen rule

If Drape later opens more operational contact, it should do so through scoped release, not broad “show both phone numbers after payment” logic.

Useful future primitives:

- `contact_release_scope`
- `contact_release_reason`
- `contact_released_at`
- `contact_released_by`
- `pickup_location`
- `pickup_instructions`
- `handoff_window`
- temporary or masked number relay later

### Why

Minimum necessary release is the better long-term marketplace pattern.

## Recommendation Summary

The cleanest V1 contact posture is:

- pre-commitment communication stays inside Drape
- commercial communication stays inside Drape at every stage
- operational detail opens only when needed for real fulfillment
- shipping relies on structured order data
- collection uses location timing plus collection code
- local fabric handoff uses support-mediated fallback until dedicated tooling exists
- off-platform payment or business diversion remains a hard violation
- future evolution should be scoped or masked contact release, not blanket phone sharing

## Sources

- [Upwork: Keeping your contact information safe](https://support.upwork.com/hc/en-us/articles/360051749534-Keeping-your-contact-information-safe)
- [Upwork: Get to know each other before a contract](https://support.upwork.com/hc/en-us/articles/360052511833-Get-to-know-each-other-before-a-contract)
- [Upwork: Circumvention, and why it's against the rules](https://support.upwork.com/hc/en-us/articles/360052511133-Circumvention-and-why-it-s-against-the-rules)
- [Airbnb: Contacting hosts](https://www.airbnb.com/help/article/147)
- [Airbnb: What info is shared with guests when their booking is confirmed](https://www.airbnb.com/help/article/4116)
- [Airbnb: How temporary phone numbers work](https://www.airbnb.com/help/article/3764)
- [Airbnb: Contacting your guests by phone](https://www.airbnb.com/help/article/4155)
- [Etsy: Off-Platform Transactions](https://www.etsy.com/legal/policy/off-platform-transactions/1254654515806)
- [Fiverr: Community Standards - Integrity and Authenticity](https://help.fiverr.com/hc/en-us/articles/37554436102289-Community-Standards-Integrity-and-Authenticity)
- [Fiverr: Account restrictions](https://help.fiverr.com/hc/en-us/articles/37333328644625-Account-restrictions)
