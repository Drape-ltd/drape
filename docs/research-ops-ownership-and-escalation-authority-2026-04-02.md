# Research Notes: Ops Ownership And Escalation Authority

Date: April 2, 2026

## Why This Exists

Drape now has a real internal `/ops` surface and a growing set of policy decisions.

What is still ambiguous is:

- who is allowed to decide what
- which issues belong to ordinary ops versus specialist review
- when a case should escalate
- which decisions can be made alone versus requiring senior review

This note is the research layer for that ambiguity.

## High-Signal Takeaways

- Mature marketplaces separate urgent safety, money disputes, and general support.
- The more money or trust risk a case carries, the less it should rely on a generic catch-all support queue.
- Documented evidence and consistent timelines matter more than conversational persuasion.
- Drape’s current `/ops` surface is useful, but it is still a shared-token tool rather than identity-graded admin auth.
- Because of that, Drape needs a narrow authority model for V1 even before it builds a perfect admin system.

## 1. What Drape Already Does Today

The current internal ops surface already supports real actions:

- dispute status update
- dispute resolution
- contact-bypass review
- application review
- verification approve/reject
- deletion request status updates
- payout visibility
- workflow issue visibility

This is already meaningful operational power.

Important current repo reality:

- `/ops` is unlocked by a shared token in `apps/web/lib/ops-auth.ts`
- current audit trails often store actor role as `OPS`
- some workflow helpers still write `resolved_by` or `reviewed_by` as `null`

Important Drape takeaway:

- the product already has operational decision power
- but accountability and authority boundaries are still looser than the business should want long term

## 2. Marketplace Pattern: Specialist Lanes Matter For High-Risk Cases

Upwork’s current dispute guidance is a strong signal.

Their published explanation says:

- disputes rely on documentation, not opinions
- dispute specialists are separate from sales or support
- some disputes get a specialist recommendation first
- arbitration is independent if the parties still disagree

Important Drape takeaway:

- money disputes and contractual judgment should not be treated like ordinary inbox support
- specialist or senior review is a sensible pattern even in V1

## 3. Marketplace Pattern: Safety Issues Get A Distinct Fast Lane

Airbnb’s current safety help structure shows another useful pattern:

- ordinary support and safety support are not the same queue
- safety issues get priority access to specially trained agents
- urgent issues can bypass normal support flow

Important Drape takeaway:

- trust-and-safety incidents should not wait behind general admin work
- “who handles this” should depend on the type of risk, not only the ticket timestamp

## 4. Marketplace Pattern: Platform Can Intervene And Decide On Its Own Record

Etsy’s current case system adds a third useful pattern:

- case communication stays in the case log
- Etsy reviews order and shipping information directly
- case agents can determine outcomes
- Etsy may resolve the case on the seller’s behalf and recoup funds if needed

Important Drape takeaway:

- once a case reaches formal review, the platform needs authority to decide from the record
- there should be a real “ops decision” moment, not endless back-and-forth

## 5. Processor Reality: Financial Escalation Has Hard External Consequences

Stripe and Paystack make this part sharper:

- Stripe disputes can immediately reverse money from the platform balance
- Paystack says disputes should be handled within `16 hours`, or they may auto-accept and trigger refunds from merchant balance

Important Drape takeaway:

- not every ops action is equal
- payment disputes and payout-impacting cases need a real money-risk owner, even if that is still a founder-led lane in V1

## 6. Drape Needs Role Separation Even Before It Has Perfect Tooling

This is the biggest Drape-specific conclusion.

Because the current tool is token-gated and not person-identity-graded, the safest V1 approach is organizational:

- define which actions are low-risk
- define which actions are specialist or senior-only
- require narrower handling for irreversible decisions

This is especially important for:

- refund vs release outcomes
- seller restriction decisions
- goodwill or platform-funded recovery
- cross-border or event-critical exceptions
- trust and safety actions

## 7. What The V1 Ownership Layers Probably Need To Be

The cleanest Drape shape appears to be:

### Frontline ops

Good for:

- intake
- triage
- queue classification
- evidence requests
- status movement into review
- basic administrative updates

### Specialist or senior ops

Good for:

- dispute outcome decisions
- payout release or hold decisions
- trust restriction calls
- verification overrides
- off-platform risk response
- event-critical rescue calls

### Founder or lead override

Best reserved for:

- platform-funded goodwill
- high-value edge cases
- public-policy exceptions
- cross-border loss ambiguity
- irreversible account restrictions in borderline cases

## 8. The Biggest V1 Governance Risk

The biggest operational risk is not only “wrong decision.”

It is:

- unclear authority
- inconsistent outcomes
- weak accountability
- no person-level ownership for irreversible actions

That risk grows if:

- the same shared token can both view and finalize
- sensitive actions do not record who made them
- financial and trust decisions are mixed into one generic ops lane

## 9. Strong Working Recommendation

The safest Drape answer is:

- broad visibility
- narrower decision authority
- specialist escalation for money and trust
- explicit senior review for exceptional cases
- stronger actor accountability over time

## Sources

- [Upwork: Dispute Process Demystified](https://www.upwork.com/resources/upwork-dispute-process)
- [Upwork Help: Payment dispute response timelines](https://support.upwork.com/hc/en-us/articles/211062068-How-to-respond-if-a-freelancer-files-a-payment-dispute)
- [Airbnb Help: Safety issue support](https://www.airbnb.com/help/article/248)
- [Airbnb Help: Pay and communicate on Airbnb](https://www.airbnb.com/help/article/231)
- [Etsy Help: How to Resolve a Case from a Buyer](https://help.etsy.com/hc/en-us/articles/360016126873-How-to-Resolve-a-Case-from-a-Buyer)
- [Etsy Help: How to Open a Case](https://help.etsy.com/hc/en-us/articles/5745586898199-How-to-Open-a-Case)
- [Stripe: Disputes](https://docs.stripe.com/disputes)
- [Paystack: Manage disputes](https://paystack.com/docs/payments/manage-disputes/)
