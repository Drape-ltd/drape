# Research Notes: Evidence Retention And Order Timeline Integrity

Date: April 2, 2026

## Why This Exists

Drape already collects a meaningful amount of order truth:

- messages
- stage updates
- tracking
- audit events
- dispute records

But the product still lacks one explicit rule for:

- what must count as evidence
- what must never disappear casually
- what ops should trust most when stories conflict
- how long the platform should preserve core order facts

This note is the research layer for that ambiguity.

## High-Signal Takeaways

- The order timeline is not just UX; it is part of dispute defense.
- In fragile infrastructure environments, durable server-side records matter more than memory or screenshots.
- Processor dispute systems reward complete, organized evidence and punish late or fragmented submissions.
- Platforms usually rely heavily on their own logs, shipping state, and case threads when resolving disputes.
- For Drape, evidence should be append-first and platform-native wherever possible.

## 1. What Drape Already Does Today

The repo already has a stronger foundation than a lot of early marketplaces.

Important current evidence surfaces include:

- `orders`
- `order_stage_updates`
- `messages`
- `disputes`
- `audit_logs`
- `tracking_number` and `carrier`
- collection-code state
- payout records

This is especially useful because:

- stage updates are append-like, not free-form timeline memory
- messages are created with timestamps
- dispute rows already have `evidence_urls`
- audit logs capture backend events that users do not always see

Important Drape strength:

- the platform already has the bones of an evidence packet even when users do not upload anything

Important Drape gaps:

- no explicit “evidence packet” concept
- no written rule for what core order evidence must be preserved
- no explicit rule against mutating or replacing core facts after the fact
- customer evidence upload is still thin in some flows
- ops still has to mentally assemble timeline truth across multiple tables

## 2. Stripe’s Dispute Flow Rewards Complete, Final Evidence

Stripe’s current dispute guidance is a strong signal for Drape.

The important current points are:

- dispute response windows are short, usually `7-21 days`
- there is usually only one submission opportunity
- you should keep records of customer communication
- Stripe asks for organized background evidence such as:
  - shipping details
  - refund policy details
  - customer details
  - product details

Important Drape takeaway:

- if Drape waits until the dispute is already emotionally messy, it is late
- the timeline and evidence structure need to exist before a processor dispute ever appears

## 3. Paystack’s Flow Also Pushes Early Evidence Discipline

Paystack’s dispute documentation reinforces the same lesson:

- you may need to provide evidence about the product or service rendered
- receipts and documents matter
- webhook reminders continue until a dispute is resolved

Important Drape takeaway:

- Africa-first payments do not reduce the need for evidence rigor
- they arguably make it more urgent because time windows and operational pressure can be tight

## 4. Marketplace Pattern: The Platform’s Own Case Log Matters A Lot

Etsy’s current case guidance is especially relevant.

The key current ideas are:

- the majority of cases can be resolved from order shipping status and platform eligibility logic
- if more information is needed, Etsy asks for it inside the case flow
- sellers are told to keep all information about a case in the case log

Important Drape takeaway:

- platform-native timeline beats scattered side conversations
- evidence should accumulate in one system of record, not across memory, WhatsApp, and screenshots

## 5. Timeline Integrity Matters Even More Under Weak Infrastructure

This matters even more for Drape because:

- calls may fail
- pushes may be missed
- users may go offline for long stretches
- local handoffs may happen without formal carrier data
- emotional retellings may differ sharply from the actual sequence

Important Drape takeaway:

- server-stamped order truth becomes more valuable in African operating conditions, not less
- this is not only a trust-and-safety issue
- it is part of the product architecture for the markets Drape wants to serve

## 6. What Should Count As Strong Evidence For Drape

The strongest evidence is usually what the platform can verify directly.

For Drape, that includes:

- order stage history
- quote terms
- payment state
- in-platform messages
- tracking / carrier state
- collection confirmation
- dispute timing
- audit events

Useful supplementary evidence includes:

- customer photos
- tailoring progress photos
- receipts
- alteration receipts
- packaging photos
- off-platform screenshots when they explain a trust issue

Important Drape takeaway:

- uploads are important
- but uploads should supplement platform facts, not replace them

## 7. The Biggest V1 Risk Is Silent Mutation Of Evidence-Critical Facts

An early marketplace gets into trouble when:

- notes overwrite old reality
- message history can be rewritten
- shipping claims can be changed without trace
- ops decisions are made from memory instead of timeline facts

Important Drape takeaway:

- if something matters for payout, dispute, or trust review, V1 should prefer append-only behavior or clearly traceable correction behavior

## 8. What This Means For Retention

The safest V1 direction is conservative:

- do not build casual deletion or editing of core order evidence
- preserve order timeline facts through the dispute, payout, and support window
- treat retention minimization for these artifacts as a later governance/privacy design step, not an early product convenience

This is especially reasonable because:

- Drape is still learning failure modes
- processor dispute and reversal windows can outlast the happy-path order flow
- custom work disputes often depend on sequence, not just the final snapshot

## 9. Strong Working Recommendation

The cleanest Drape answer is:

- the order timeline is part of the evidence model
- core order facts should be preserved conservatively in V1
- corrections should usually append context, not erase history
- ops should resolve cases from platform truth first, uploads second, rhetoric third

## Sources

- [Stripe: Respond to disputes](https://docs.stripe.com/disputes/responding)
- [Stripe: How disputes work](https://docs.stripe.com/disputes/how-disputes-work)
- [Paystack: Manage disputes](https://paystack.com/docs/payments/manage-disputes/)
- [Etsy: How to Resolve a Case from a Buyer](https://help.etsy.com/hc/en-us/articles/360016126873-How-to-Resolve-a-Case-from-a-Buyer)
- [Etsy Seller Policy](https://www.etsy.com/legal/sellers/)
