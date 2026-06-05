# Drape Exception OS Launch Plan

Last updated: 2026-05-22

Drape should not feel fragile when real life happens. The launch goal is not to build every possible exception as a full feature before App Store submission. The launch goal is to make every important exception understandable, owned, and recoverable.

The detailed product memory ledger lives in `docs/product-cycle-scope-ledger.md`. Any real-life cycle that is discussed but not fully built should be recorded there with a status and priority before the work moves on.

## Principle

Every exception must answer five questions:

1. Who owns the next move?
2. What proof or context is needed?
3. What happens to the money?
4. What happens to the deadline?
5. What should customer, tailor, and ops say now?

The shared source of truth now lives in `packages/shared/src/exception-os.ts` and feeds:

- Ops runbook search
- Public help and trust pages
- Customer Drape Guide topics
- Tailor Drape Guide topics

## Launch-Critical Buckets

### People and Roles

Support buyer, wearer, recipient, tailor, and ops owner as distinct concepts. Gift orders, family orders, group orders, and linked event orders should not rely on one generic customer identity forever.

Launch posture: guide and ops language now covers this. Full named measurement profiles and group member lookup remain product work.

### Scope and Approvals

Style reference, fit preference, fabric path, purchase costs, and scope additions must be approved before irreversible work.

Launch posture: ops runbook covers style mismatch, fabric approval, measurement amendments, rework, and scope changes. Existing product already blocks cutting around fabric approval in key paths. Scope changes are now first-class order records for custom orders: either customer or tailor can request one, it appears in the timeline, duplicate open requests are blocked, contact bypass text is rejected, and ops is flagged when the change is late-stage or affects price/deadline.

### Evidence and Handoff

Photos, videos, receipts, tracking, delivery confirmation, and collection proof are the trust layer. Courier status is not the same as Drape handoff.

Launch posture: app already supports stage media and order timelines. Runbooks now define delivery proof, wrong recipient, ready-made damage, and handoff checks. Future work should require customer receipt photo for high-risk delivery flows.

### Money and Settlement

Customers need reassurance during provider latency. Tailors need clarity on locked value, payout readiness, and blocked reasons.

Launch posture: payout runbook and payment-pending guidance are centralized. Payment and payout QA remains required before production launch, especially Paystack live requirements and 72-hour release behavior.

### Time and Capacity

Tailors get sick, deadlines hit holidays, calls fail, and peak seasons overload capacity.

Launch posture: runbooks now cover stale production, emergency pauses, consultations, holiday/capacity risk, and provider outages. Future work should add capacity warnings and cultural calendar intelligence.

### Safety and Ops

Communication, evidence, and financial decisions stay inside Drape. Off-platform contact, fake reviews, stolen photos, unsafe content, and unclear ops actions need reviewable records.

Launch posture: existing contact filtering and ops queues are strengthened by runbook coverage. Future work should add portfolio originality checks, review authenticity scoring, and structured data export for tailors.

## What Not To Build Before Launch

Do not delay launch to fully build all 60 scenarios as standalone features. That would create a larger surface area than the team can QA. Instead:

- Launch with clear guide and ops runbooks.
- Harden the flows already in product: payment, payout, messages, stage media, handoff, refunds, support, and disputes.
- Convert repeated post-launch incidents into first-class product cycles.

## Next Feature Candidates After Launch

1. Named measurement profiles for gifts, family orders, and group orders.
2. Style interpretation approval before cutting.
3. Scope-change acceptance/decline decisions with revised quote or revised deadline approval.
4. Customer receipt photo before delivery completion.
5. Fabric purchase acknowledgement with cancellation impact.
6. Ready-made listing freshness prompts.
7. Cultural calendar and deadline risk warnings.
8. Tailor emergency pause and transfer workflow.
9. Portfolio originality and report-photo workflow.
10. Tailor data export and pre-Drape reputation references.
