# Drapeon Commercial, Payments, Tax, Settlement, And Resolution Architecture

Status: canonical product and engineering direction
Policy version: `commercial-2026-07-31-v1`
Tax and fulfillment target version: `tax-fulfillment-2026-08-15-v1`
Last updated: August 15, 2026

## Purpose

This document is the source of truth for consultations, order payments, material funding, fulfillment charges, taxes, incentives, tailor settlement, returns, refunds, disputes, and Ops-controlled money movement across iOS, Android, web, email, payment providers, and Supabase.

It defines the target architecture. Existing orders keep the policy and financial promise accepted when they checked out. A target rule does not change live settlement behavior until its implementation section has passed its dry run and been deliberately activated.

## Invariants

- A user action is a claim, not proof.
- A provider event is evidence, but may still require corroboration.
- No single-party assertion directly moves contested money.
- Eligibility may be calculated automatically; external money movement remains Ops-controlled.
- Customer payment, tax, shipping, Drapeon revenue, tailor entitlement, subsidy, credit, refund, and tip values remain separate.
- Every payment, release, refund, provider call, notification, and case reaches a recorded terminal outcome.
- Mobile and web use the same authoritative server transition.
- Currency never determines tax jurisdiction, phone country, payout route, or shipping eligibility.
- Use `protected payment`, not `escrow`, unless the legal arrangement supports the regulated term.
- Policies are versioned and immutable for an accepted order.

## Supersession Register

This register resolves conflicting guidance without deleting historical decision context.

| Earlier source | Earlier rule | Canonical treatment |
| --- | --- | --- |
| `research-to-v1-completion-map.md` | No separate material-deposit flow | Superseded. Typed, customer-approved, Ops-released `MATERIAL_ADVANCE` is supported. |
| `v1-decisions-fabric-sourcing-handoff-billing.md` | Tailor-sourced fabric remains inside the quote only | Superseded where an authenticated material-advance case is used; ordinary quoted fabric may remain bundled. |
| `v1-decisions-measurements-payouts-material-risk.md` | Conservative single payout and no default partial release | Superseded for newly activated policy versions by evidence-gated payout tranches. Existing orders remain on their accepted release rule. |
| `v1-decisions-post-acceptance-change-policy.md` | No formal change-order billing | Superseded by typed amendments that preserve the original agreement and require authenticated customer approval. |
| `v1-decisions-consultation-no-show-reschedule-and-expiry-policy.md` | Consultation cannot be a paid standalone service | Superseded. Tailors may publish free or paid pre-quote consultation policies. |
| `payments-fx-policy.md` | One charged order currency and no silent repricing | Preserved. Additional phases and amendments do not silently reprice an accepted charge. |
| Trust verification documents | Drapeon does not collect identity documents or biometrics | Preserved. Payout KYC remains provider-owned and independent of marketplace trust review. |
| Pre-Implementation-11 tax resolution | A country-level rate control and checkout-time location fallbacks are sufficient | Superseded for newly activated corridors by `tax-fulfillment-2026-08-15-v1`. Responsible party, registration obligation, product classification, and collection method must be resolved from reviewed configuration. Existing accepted pricing and receipt snapshots remain immutable. |

## Contract Vocabulary

Persisted order payment phases are `INITIAL_ORDER`, `CONSULTATION`, `FULFILLMENT`, and `MATERIAL_ADVANCE`.

The broader commercial-purpose vocabulary additionally includes `ORDER_ADJUSTMENT`, `TAX`, `TIP`, `PROMOTIONAL_COVERAGE`, and `OTHER_REVIEWED`. `OTHER_REVIEWED` requires a financial case, explanation, and dual approval. It is never presented as an ordinary miscellaneous charge.

Commercial work separates claim, evidence, eligibility, approval, execution, provider outcome, and reconciliation. Shared packages own these types, labels, validation rules, policy versions, permissions, and destination derivation.

## Evidence And Decision Standard

Every money-sensitive workflow follows this sequence:

1. A party submits a claim or request.
2. Drapeon records the claim without treating it as fact.
3. System and provider evidence is attached.
4. The affected counterpart receives notice.
5. A contest window opens where appropriate.
6. The system derives an eligibility recommendation.
7. Ops reviews exceptions or contested evidence.
8. An authorized operator executes the financial action.
9. Provider and ledger outcomes reconcile.
10. Both parties receive the terminal outcome and reason.

Evidence strength:

- **Tier A:** signed payment webhooks, token-identified Daily participation, authenticated Drapeon handoff, Drapeon custody, and trusted carrier events.
- **Tier B:** matching authenticated decisions from the customer and tailor.
- **Tier C:** receipts, estimates, photographs, videos, shipping documents, and delivery evidence.
- **Tier D:** free text, email replies, support notes, and consented WhatsApp summaries.

Tier C or D evidence alone cannot trigger an irreversible contested release. Missing provider evidence does not automatically punish either party.

## Ledger And Pricing Target

Every commercial transaction records original and settlement currencies, original value, customer payment, Drapeon subsidy, tax, shipping, provider fees, Drapeon revenue, tailor entitlement, refunded amount, eligible amount, released amount, provider references, policy version, pricing version, actor, and correlation ID.

An immutable double-entry ledger becomes authoritative in implementation 2. Cached order totals remain projections. Corrections use reversing entries rather than rewriting history.

A versioned pricing service will produce the same breakdown and reservation token for iOS, Android, and web. Checkout, webhooks, ledger posting, releases, refunds, and notifications must be idempotent.

### Durable provider webhook inbox and outbox

Stripe and Paystack public webhook endpoints perform only the synchronous intake boundary: read the exact raw body, verify the provider signature, validate the provider event identifier and type, and atomically persist the verified JSON body, SHA-256 digest, provider deduplication key, domain event, and `PROCESS_PAYMENT_WEBHOOK` outbox job. The endpoint returns `200` only after that transaction commits. Invalid signatures are rejected and retain only safe extracted metadata, byte count, and digest—not the attacker-controlled raw body. A persistence or enqueue failure returns a retryable provider error and reports identifier-only context to Sentry.

The trusted queue worker replays the stored event into the existing provider handler through service-role authentication. Existing payment, refund, dispute, settlement, ledger, Ops, and communication transitions therefore remain authoritative and idempotent. Queue attempts use bounded backoff and terminal `RETRYABLE`, `PROCESSED`, or `DEAD` state on the webhook ledger; a fresh signed provider retry can safely revive an unprocessed dead event without creating a second event or job. Dead processing creates both a Sentry incident and an Ops issue.

Every processed event schedules `RECONCILE_PAYMENT_WEBHOOK`. Stripe reconciliation retrieves the provider Event and compares its identifier and type. Paystack retrieves the applicable transaction, transfer, or refund where Paystack exposes that lookup; event families without a general retrieval endpoint retain an explicit signed-event-only reconciliation mode rather than pretending a provider fetch occurred. A mismatch is terminally recorded, opens a critical Ops issue, and blocks silent follow-on assumptions. Transient provider lookup failures retry and dead-letter independently from the already completed business transition.

The payment-webhook worker runs in its own one-minute high-priority partition so notification volume cannot delay money state. Service health requires that schedule and the shared queue health check fails when any webhook processing or reconciliation job dead-letters. Production promotion requires replay of one signed event per provider, duplicate delivery, a forced retry, a forced dead letter, provider reconciliation, exact database and ledger outcomes, and an Ops/Sentry correlation review.

## Consultations

Before a customer begins a custom brief, the tailor profile states whether consultation is unavailable, free, or paid; whether it is optional or required; its fee, currency, duration, call type, creditability, cancellation terms, and no-show terms.

Paid pre-quote consultation remains separate from free in-order Drapeon coordination calls. A creditable fee reduces the later order charge without creating duplicate tailor entitlement.

Cancellation defaults:

- More than 24 hours before: full refund.
- Inside 24 hours: 50% refund.
- Tailor cancellation: full refund.
- Verified Drapeon or Daily failure: full refund or mutually accepted reschedule.
- Customer no-show: forfeiture only after the evidence process below.

### Attendance And No-Show

Room availability and appointment attendance use separate clocks. A room may remain technically accessible for rejoining or support without extending the booked appointment.

Daily meeting-token `user_id`, participant session, join time, leave time, duration, and actual overlap form the provider evidence. Loading the room, joining anonymously, a brief connection, or visiting after the appointment does not prove attendance.

- Grace period: 10 minutes.
- A no-show claimant must join by scheduled start plus 10 minutes.
- The claimant must remain available for at least 15 continuous minutes.
- Attendance requires at least five continuous minutes of verified overlap during the scheduled appointment.
- A later visit is recorded as late and does not erase the earlier absence.
- If both parties joined but did not overlap meaningfully, classify the event as a scheduling or connection issue.
- If neither party satisfied the waiting requirement, neither receives an automatic no-show ruling.

`Report no-show` creates a pending review and never moves money immediately. The counterpart has 24 hours to contest. Missing webhooks, identity mismatches, conflicting timelines, or provider incidents require Ops review. Confirmed customer no-show releases the applicable consultation entitlement; confirmed tailor no-show fully refunds the customer and records a reliability event.

The report is not a terminal screen. After submission, the reporter sees a read-only receipt, the original reason, the response deadline, and the protected-money state; the report control is removed. The counterpart must choose one structured account: the call did not happen, they attended, they had a connection issue, or something else happened. If the counterpart agrees the call did not happen, the attendance case resolves immediately to `RESCHEDULE_REQUIRED`, no money moves, and both parties are returned to the order's rescheduling path. Any conflicting attendance account or connection issue moves the case to `OPS_REVIEW`; the fee remains frozen until Ops records one of the supported terminal outcomes: reschedule, customer refund, or verified tailor earning. Both parties receive the recorded outcome through the same order context.

## Order Charges, Materials, And Amendments

Initial checkout shows base work, consultation credit, included material, fulfillment, tax, incentives, and total. Receipts identify the intended merchant, customer charge, tax treatment, discount funding, and protected tailor amount. An unresolved tax, customs, provider, payout, or fulfillment corridor cannot silently fall back to zero tax or another currency.

A material advance requires a supplier estimate and proof, a three-party case, authenticated customer approval of the exact amount, successful customer payment, JIT-authorized Ops release, final receipt, and unused-value reconciliation. Receipt upload is evidence, not automatic proof. Missing or inconsistent proof blocks later advances. The main order balance remains untouched.

Post-payment changes use typed amendments for scope, quantity, material, rush work, fit or revision work, delivery, customs, correction, or reviewed exception. Each amendment preserves the original terms and records the proposed change, amount, deadline impact, responsibility, and authenticated decision.

Carrier-label creation is not dispatch proof. Fulfillment release evidence requires Drapeon custody, trusted carrier acceptance, authenticated local handoff, or another approved event.

## Settlement Target

Percentages apply to tailor entitlement only.

For shipped orders under the new policy, 70% becomes eligible after verified carrier or Drapeon custody, 20% becomes eligible 72 hours after verified delivery, and 10% becomes eligible after the 14-day protection window. For authenticated local handoff, 80% becomes eligible at handoff and 20% becomes eligible after 72 hours.

Marking an order ready is only a claim. A complaint freezes unreleased tranches. Released money is not silently reversed; recovery becomes an explicit reserve, negative balance, provider recovery, or Drapeon-funded resolution.

Existing orders remain on `legacy-single-release-72h` until a migration and activation review explicitly proves a safe alternative. New staged settlement is not active merely because this document exists.

## Cases, Returns, And Refunds

The target case system supports consultation attendance, material request, fulfillment reconciliation, timeline amendment, quality complaint, return, refund, payment failure, payout failure, safety/fraud, and reviewed exception. Multiple typed cases may relate to one order.

The authenticated in-app case is canonical. Email mirrors the case and may ingest evidence, but cannot authorize money. WhatsApp escalation requires consent and a confirmed case summary.

Return eligibility depends on product type, destination, fault, evidence, applicable law, and whether the item is custom or ready-made. Refund restoration separately treats original payment, tax, shipping, promotion, grant, consultation credit, and released or unreleased tailor entitlement.

## Tax And Global Checkout

Drapeon targets merchant-of-record responsibility only in activated corridors. Delivery destination drives consumption tax, ship-from drives customs, tailor location drives payout reporting, billing/payment data supports provider risk, and currency only controls presentation and routing.

ZipTax is a US calculation adapter, not a global tax engine. Nigeria VAT and other jurisdictions require reviewed, versioned configuration or qualified providers. Collected tax posts to jurisdiction-specific liabilities and is never Drapeon revenue or tailor entitlement.

### Fulfillment, Jurisdiction, And Tax Decision Contract

`tax-fulfillment-2026-08-15-v1` is an additive target policy. It does not alter an accepted order, consumed pricing reservation, receipt, tax liability, or fulfillment promise. A draft receives this policy only after Implementation 11 has been activated for its exact corridor and tax transaction type.

`TaxTransactionType` is a reviewed commercial taxonomy, not an ordinary implementation enum and not a legal conclusion about whether a supply is goods or services. Launch values are:

| Tax transaction type | Commercial event |
| --- | --- |
| `CUSTOM_ORDER` | Initial consideration for made-to-order work and its included materials. |
| `READY_MADE_ORDER` | Initial consideration for an existing product or inventory item. |
| `CONSULTATION` | Free or paid pre-quote professional consultation. |
| `MATERIAL_ADVANCE` | Separately approved funding for identified material costs. |
| `ORDER_AMENDMENT` | Post-acceptance addition, reduction, correction, or other agreed change. |
| `FULFILLMENT_CHARGE` | Separately priced delivery, shipping, or collection-related consideration. |
| `TIP_OR_GRATUITY` | Optional post-service customer payment to the tailor. |

`PROMOTIONAL_COVERAGE` is intentionally not a `TaxTransactionType`: it changes who funds an underlying supply without changing that supply's type or tax treatment. `OTHER_REVIEWED` is also intentionally excluded from static tax mapping and cannot enter automatic pricing merely because a financial case and dual approval exist. A reviewed exception must be decomposed into an existing `TaxTransactionType` or remain `BLOCKED` until Tax/Legal, Finance, and Engineering approve a new type and jurisdiction control.

Each jurisdiction control maps a `TaxTransactionType` to its reviewed tax-supply characterization and treatment. For example, a jurisdiction may characterize all or part of `CUSTOM_ORDER` as goods, services, a composite supply, or another statutory category; the enum itself does not decide that question. `ORDER_AMENDMENT` inherits an earlier treatment only when the jurisdiction control explicitly permits inheritance, and mixed-purpose amendments must split or block. A new enum value or a changed mapping requires Tax/Legal, Finance, and Engineering sign-off, a new immutable policy version, fixtures, and receipt/ledger review. Unknown values fail closed.

Tax responsibility is configuration, not a checkout inference. A server resolver must select one effective-dated, sourced, reviewed control for the exact jurisdiction and `TaxTransactionType` before it calculates or collects tax. The liable or remitting party is one of `TAILOR`, `DRAPEON_MARKETPLACE_FACILITATOR`, or `CUSTOMER_IMPORTER`. An unresolved, conflicting, expired, or unsupported result is `BLOCKED`; the client cannot substitute the seller, Drapeon, the customer, currency, payment provider, or a zero rate.

The responsibility control is governed with the same discipline as `TAX_POLICY_CONTROLS` and records at least:

| Field | Required meaning |
| --- | --- |
| Policy identity | Immutable policy version, control ID, status, effective-from date, optional effective-to date, and superseded control ID. |
| Scope | Jurisdiction, `TaxTransactionType`, fulfillment method, seller/business facts used by the rule, marketplace-facilitator applicability, and liability granularity. |
| Responsible party | `TAILOR`, `DRAPEON_MARKETPLACE_FACILITATOR`, or `CUSTOMER_IMPORTER`, plus the statutory role and the party whose registration is evaluated. |
| Registration rule | Threshold or mandatory-registration rule, measurement period, currency, evidence source, and effective-dated registration decision. |
| Collection treatment | Calculation strategy, provider or static rule reference, invoice treatment, filing liability account, and whether tax is collected at checkout, payable on import, or blocked. |
| Review evidence | Primary source URLs, legal or tax reviewer, reviewed-at date, next-review date, change reason, and approval record. |

The application must never derive responsible party merely because a tailor is registered or unregistered. Marketplace-facilitator rules may make Drapeon the taxpayer or remitter even when the tailor is not registered. Import rules may instead make the customer or importer responsible. A material rule change creates a new control version; it never mutates an accepted order's decision snapshot.

Launch responsibility is resolved once per priced commercial transaction within an order; line-item classification may vary only for rate and exemption treatment under that same responsibility decision. Responsibility controls therefore declare `liability_granularity` as `ORDER` or `LINE_GROUP`, but `tax-fulfillment-2026-08-15-v1` activates only `ORDER`. Tax/Legal review must affirm that each launch jurisdiction and `TaxTransactionType` does not require responsibility or registration to vary by product-category revenue mix. A rule that requires `LINE_GROUP`, mixed responsible parties, or category-specific registration remains `BLOCKED` until a later policy version implements per-line-group liability, receipts, ledger posting, filing evidence, and refunds. Drapeon must not approximate it with the order-level model.

The authoritative server decision chain is:

`fulfillment classification -> verified origin and destination -> corridor -> jurisdiction and TaxTransactionType -> tax-supply characterization -> liability granularity -> responsible party -> registration obligation -> line-item classification -> rate or provider -> collection method -> pricing and receipt snapshot`

Product treatment is a line-item or listing property, not an assumption that every custom garment has the same tax class. Each line resolves to reviewed `STANDARD`, `ZERO_RATED`, `EXEMPT`, or jurisdiction-specific treatment. A missing classification may use `STANDARD` only after the responsibility and registration gates have established that tax may lawfully be collected; otherwise the result is `BLOCKED`.

Registration decisions are effective-dated and periodically rechecked against the applicable rule. A changed threshold, registration status, or facilitator rule applies to future pricing only. Accepted orders continue under the decision and sources captured by their pricing reservation.

#### Fulfillment Selection Guard

Fulfillment eligibility is validated while the customer selects a method and whenever a relevant address changes. Final pricing revalidates the same contract, but it is not the first place a mismatch may surface.

- **Local collection** requires a verified, structured pickup address. Free-text profile location is never a fulfillment or tax fallback.
- **Local delivery** requires a verified destination in the same country as the verified dispatch origin. As soon as an entered address resolves to another country, the current selection becomes invalid and the customer sees an explicit prompt: `This address is outside {origin country}. Switch to international shipping?` Accepting the prompt changes the fulfillment method and its terms; declining it returns the customer to the address or method choice. Drapeon never silently relabels the order.
- **International shipping** requires an activated origin-destination corridor. The corridor records export treatment and evidence, shipping taxability, destination import VAT or duty treatment, carrier constraints where relevant, responsible remitter or importer, and one collection mode: `COLLECTED_AT_CHECKOUT`, `PAYABLE_ON_IMPORT`, or `BLOCKED`. An unreviewed corridor defaults to `BLOCKED`.

The selected fulfillment method, verified origin, verified destination, corridor policy, and user confirmation are persisted with the draft. Changing the fulfillment method, dispatch origin, destination country, or material address fields invalidates any existing 15-minute pricing reservation and forces the complete decision chain to run again.

Customer-facing copy distinguishes amounts collected by Drapeon from amounts potentially payable to customs or a carrier. `PAYABLE_ON_IMPORT` must disclose that import charges are not included in checkout and identify the responsible party. `BLOCKED` must explain the unsupported corridor without presenting a false zero-tax or local-delivery option.

The immutable pricing and receipt snapshot records the complete decision: origin, destination, fulfillment method, corridor, jurisdiction, `TaxTransactionType`, tax-supply characterization, liability granularity, responsible party, registration decision, every line classification, rates, sources and review dates, collection mode, tax amount, shipping amount, provider, policy versions, and correlation ID. Ledger posting keeps domestic tax, import tax, duty, shipping liability, tailor entitlement, and Drapeon revenue separate.

## Benefits

The architecture enables promo codes, Ops account grants, free shipping, and complimentary orders. Tips, referrals, milestones, commission waivers, and affiliate rewards remain behind flags. Drapeon-funded benefits never reduce tailor entitlement.

Sweepstakes, purchased credits, cash wallets, transferable balances, gift cards, raffles, and arbitrary stacking remain deferred.

## Ops, Security, And Observability

The target Money Desk contains eligibility, material releases, payout tranches, refunds, tax liabilities, provider failures, reconciliation exceptions, approvals, and a ledger/audit explorer.

All actions require named workforce identity, MFA, JIT elevation, reason, policy version, idempotency protection, and immutable audit. A separate approver is required at or above USD 500 equivalent and for payout-destination changes, manual FX, post-release recovery, policy override, or `OTHER_REVIEWED`. A preparer cannot approve their own action.

Sentry covers React Native, Next.js client/server/Edge, and Supabase functions. One correlation ID links UI action, server request, database transition, future ledger entries, provider request/webhook, jobs, notifications, and Ops approval. Logs exclude message bodies, evidence contents, addresses, card data, credentials, and secrets.

## Cross-Platform Contract

Customer and tailor capabilities must reach iOS, Android, and responsive web for consultation policy, pricing, checkout, material and amendment cases, payment history, fulfillment charges, deadline changes, evidence, returns, refunds, case status, receipts, and notifications. Ops may remain web-first, but no customer or tailor financial decision may be web-only.

All surfaces require accessible labels, keyboard support, text scaling, narrow-layout support, safe-area behavior, exact-context navigation, secure media, and timezone-explicit dates.

## Implementation And Dry-Run Sequence

1. Canonical contracts and supersession.
2. Ledger, pricing, tax, and idempotency.
3. Evidence and financial-case foundation.
4. Money Desk security and approvals.
5. Paid/free consultations and attendance.
6. Initial-order checkout and receipts.
7. Materials, adjustments, fulfillment, and extensions.
8. Staged tailor settlement.
9. Returns, refunds, and resolutions.
10. Benefits, notifications, Sentry, and reporting.
11. Fulfillment-jurisdiction and tax-responsibility hardening.

Each section ends with a dry run proving initiating confirmation, authoritative persistence, counterpart update, terminal side effects, real-device notification delivery, and reverse-role or adjacent-stage replay. Implementation 11 is additive and does not invalidate the completed evidence for Implementations 1–10; its own gates must pass before any new tax or fulfillment corridor is activated. After all active boundaries pass, the major rehearsal covers both roles, physical iOS and Android, responsive web, Ops, Stripe, Paystack, local and international fulfillment, failures, Sentry correlation, and ledger/provider/bank reconciliation.

## Implementation 1 Activation Boundary

Implementation 1 publishes vocabulary, policy intent, compatibility rules, and parity checks. It does not activate staged payouts, new tax behavior, automated forfeiture, a new ledger, or new charge types. Those behaviors require their numbered implementation and dry run.

## Implementation 2 Activation Boundary

Implementation 2 establishes the financial recording foundation without activating later case, consultation, amendment, staged-settlement, or incentive workflows.

- Existing orders are pinned to `legacy-single-release-72h`; new orders receive `commercial-2026-07-31-v1` only after the database migration is promoted in that environment.
- A 15-minute, versioned pricing reservation locks the exact subtotal, platform fee, tax, fulfillment amount, currency, jurisdiction, source, policy, and correlation ID used to prepare a payment.
- A fallback or unresolved tax result cannot produce a pricing reservation. Currency never substitutes for delivery jurisdiction.
- Successful provider captures post an idempotent, balanced journal that separates tailor entitlement, Drapeon revenue, tax liability, and fulfillment liability. Consultation and material payments use their own liabilities.
- Refund journals reverse the original capture allocation proportionally and retain the original commercial purpose. A completed provider refund whose journal fails creates a critical Ops reconciliation issue and must not be sent to the provider again.
- Ledger headers and entries are immutable. Corrections require linked reversing transactions. Original and settlement values, FX rate, provider fees, actor, policy, pricing version, and correlation ID remain explicit fields.
- Mobile, web, Stripe, and Paystack reach these controls through the same Edge payment handlers; no client calculates or writes ledger entries.

The development dry run must prove balanced posting, per-currency balance enforcement, immutable entries, idempotent retry, pricing consumption, expired-token rejection, and fail-closed tax behavior inside a rollback-only database block. Production remains inactive until its own reviewed migration, Edge deployment, provider replay, reconciliation, and cross-role dry run.

## Implementation 3 Activation Boundary

Implementation 3 establishes the canonical financial-case and evidence packet without activating automatic eligibility, refunds, releases, returns, consultation forfeiture, or Ops money execution.

- Multiple typed cases may relate to one order. The compatibility `disputes` record remains one-per-order only for the existing customer concern and current Ops screens.
- Customer concern creation is one database transaction: validate the claim, lock the order, create the compatibility dispute and canonical case, snapshot source references, pause the order, clear auto-release, append the timeline event, and write the audit record. A partial concern cannot remain after failure.
- The claimant must select both a canonical reason and requested outcome. Mobile and responsive web share the same labels, normalization, validation, evidence prompts, and server transition.
- Claims are immutable. Corrections, counterpart responses, eligibility decisions, evidence, status changes, and resolutions are appended as events rather than rewriting the original account.
- Evidence records store private object coordinates, provider references, or internal source references. Permanent public media URLs are not copied into the case packet. User uploads begin as Tier D claims; generic order snapshots are corroborating context, not Tier A proof.
- Email may notify or ingest evidence and consented WhatsApp summaries may be recorded, but neither authorizes a money movement. Existing Ops dispute resolution synchronizes the canonical case and appends its terminal event.
- Order parties may read party-visible cases, events, and evidence. They cannot write the tables directly; authenticated actions go through the shared Edge and database contracts. Ops-only evidence is excluded by RLS.
- The order remains payout-blocked while its concern is unresolved. Later implementations own eligibility calculation, JIT approvals, provider execution, ledger postings, and reconciliation.

The development dry run must prove multi-case support, append-only events and evidence, immutable claims, rejection of evidence without a secure source, atomic customer concern creation, idempotent retry, counterpart notification jobs, and legacy Ops resolution synchronization. Production remains inactive until its migration and cross-role evidence pass are reviewed.

## Implementation 4 Activation Boundary

Implementation 4 establishes the protected manual-money control plane without activating consultation charging, new checkout purposes, staged settlement, returns automation, benefits, or production promotion.

- Money Desk lives inside the existing responsive Ops dashboard. Bootstrap shared-token sessions are read-only for money; preparation, approval, and execution require a named Cloudflare Access identity whose verified JWT records an MFA authentication method.
- Elevation is scoped to explicit action types and expires after 15 minutes. Every request records the named actor, role, policy version, reason, target, correlation ID, risk result, and idempotency claim.
- Every action requires an approver other than its preparer. USD 500 equivalent or more, unresolved FX, payout-destination changes, manual FX, post-release recovery, policy overrides, and `OTHER_REVIEWED` require two independent approvals.
- Decisions and lifecycle events are append-only. Request financial claims are immutable. Provider execution attempts are idempotent and must become `SUCCEEDED`, `FAILED`, or `BLOCKED`; stuck `PROCESSING` work stays visible for later reconciliation.
- Existing direct payout, material release, refund, payout-destination approval, and dispute money-decision routes fail closed into Money Desk. Approved payout-destination recovery is executable only when it replaces a failed order snapshot with the tailor's different, currently verified destination on the same provider and currency. The failed attempt remains immutable, the replacement is fingerprinted, two independent approvals are required for a risk-triggered replacement, and the retry receives a distinct provider idempotency reference. Manual FX, post-release recovery, and policy overrides remain visibly blocked until their dedicated reviewed execution adapters are implemented in their numbered slices.

### Payout Account Communication And Change Lifecycle

- Initial payout setup reaches a recorded terminal notification outcome through in-app state, push, and transactional email. The confirmation names the active destination, provider, currency, normal order-release gate, and where a tailor can resolve a blocked payout.
- A replacement payout destination never silently replaces the active one. The tailor must confirm the request within 48 hours; otherwise it expires and the current destination remains active.
- A confirmed, provider-verified replacement with the same provider, currency, and normalized account holder activates immediately without routine Ops work. The immutable change record remains visible to Ops.
- Provider, currency, account-holder, or manual-entry differences enter risk review. After the required independent approvals, the verified replacement activates immediately. The seven-day change-again cooldown limits repeated destination churn but never delays release of otherwise eligible earnings.
- Provider, currency, account-holder, manual-bank, or verification differences enter Ops only after tailor confirmation. Ops sees the active and requested destinations side by side, the provider-verification result, the exact risk signals, and the confirmation timestamp before it may prepare independent approval.
- A blocked payout notifies the tailor and exposes the specific reason and next safe action in Earnings. Normal remediation stays self-service; Ops owns only exceptions or exhausted recovery paths.
- Mobile, responsive web, email, push, Ops, database state, and provider outcomes use the same lifecycle names and destinations. No client can activate or reject a payout change before the authoritative confirmation and review gates pass.
- The Ops UI never displays raw action payloads or secrets. Operational error logs include request, attempt, action, and correlation identifiers only; Sentry correlation across web, Edge, mobile, and jobs remains part of Implementation 10.

The development dry run must prove named MFA elevation, expiry, action scoping, self-approval rejection, one- and two-approver paths, immutable decisions, idempotent execution, and recorded terminal outcomes. Production remains inactive until Cloudflare Access policy, Entra role groups, two real named approvers, provider sandbox execution, and the responsive Ops pass are reviewed.

## Implementation 5 Activation Boundary

Implementation 5 activates published free/paid pre-quote consultation terms and provider-backed attendance review without activating an automatic forfeiture, refund, or tailor release.

- A tailor publishes `UNAVAILABLE`, `FREE`, or `PAID`, optional or required, fee and currency, duration, audio/video preference, and whether a paid fee credits an accepted order. Mobile and responsive web write the same server-owned profile contract. Customers see it on the profile before opening the custom brief.
- Scheduling uses the published policy rather than an order-local price chosen after the customer has submitted a brief. Confirmation snapshots the exact commercial, cancellation, and attendance policy on the normalized booking; later profile edits do not rewrite it.
- Consultation checkout remains a separate `CONSULTATION` payment purpose. Stripe and Paystack webhooks update both compatibility order metadata and the normalized booking payment state. A paid booking cannot open until the provider-confirmed state is `PAID`.
- The Daily room is linked to the booking. Token identity, join and leave intervals, meeting end, continuous wait, actual overlap, and late visits produce a Tier A evidence summary without recording audio, video, or transcripts.
- Five verified minutes of overlap is attendance. A no-show recommendation requires the claimant to join by the ten-minute grace deadline and remain continuously for fifteen minutes. A brief room open, anonymous visit, later visit, missing webhook, or disjoint joins does not create an automatic win.
- Reporting opens a canonical `CONSULTATION_ATTENDANCE` financial case, freezes money movement, attaches the provider evidence, notifies the counterpart, and gives them 24 hours to respond. Customer and tailor have symmetrical mobile and responsive-web report/response surfaces.
- Neither the derived recommendation nor a report directly changes booking status, forfeits a fee, refunds a customer, or releases tailor entitlement. Ops resolution and its Money Desk execution adapter remain later reviewed work.

The development dry run must prove published-policy validation, immutable booking snapshot, normalized provider payment state, five-minute overlap, continuous fifteen-minute wait, late-visit preservation, incomplete-evidence review, report idempotency, counterpart response, and money hold. Physical iOS/Android scheduling, checkout, Daily attendance, email/push receipt, and reverse-role reporting remain the half-pass device checkpoint before this implementation can be promoted to production.

### Consultation settlement finishing pass

The later commercial finishing pass activates the money outcomes that Implementation 5 intentionally held back:

- A paid booking is recorded as `HELD` after the original charge provider confirms payment. Merely submitting or accepting a quote never releases the fee.
- Five continuous verified minutes of Daily overlap marks the entire consultation fee earned. Drapeon automatically releases that earning through the tailor's verified payout provider; the customer charge provider and tailor payout provider may differ.
- A creditable consultation still becomes an exact checkout credit if the order proceeds. This changes the customer's later amount due, not whether the verified consultation was earned.
- Customer cancellation at least 24 hours before the start refunds the full fee. Customer cancellation inside 24 hours but before the start refunds 50% and marks 50% earned. Tailor cancellation and verified provider failure refund the full fee. Cancellation keeps the order and chat open and returns the order to quote preparation.
- Refunds always return through the original charge provider. Any earned remainder is released only after the provider refund reaches a terminal outcome.
- The request clock and appointment clock are separate. An unanswered consultation request expires after 48 hours. Accepting a time ends that request clock; the booked appointment and attendance clocks take over. Quote expiry starts only when a quote is actually sent.
- The booked window ending reopens quote preparation immediately. Attendance evidence, consultation-fee settlement, refunds, and earnings continue on the consultation booking without keeping the order in `CONSULTATION`. No attendance or reschedule outcome may hold the commercial order in consultation after that window. Any later ordinary discussion or make-up conversation is optional, free, and uses protected order chat or the regular call unlocked by quoting.
- Twenty-four hours after a booked window ends, deterministic provider evidence reaches a terminal outcome automatically. Verified attendance or a verified customer no-show earns the fee; a verified tailor no-show refunds the customer. If neither party recorded any participation, a paid consultation refunds automatically and a free consultation closes as `EXPIRED_NO_ACTIVITY`. Every clean terminal path returns the order to quote preparation.
- A created room or room URL is never attendance evidence. Contested reports, partial or conflicting activity, missing booking/payment state, provider failure, payout failure, and ledger/state mismatch fail closed into attendance review, an Ops issue, or Money Desk recovery. These paths never guess or create a duplicate money movement.
- Customer, tailor, mobile, and responsive web read the same booking settlement state. Push and email jobs point back to the exact order and must record terminal delivery outcomes.

The finishing-pass dry run must prove both cancellation windows, tailor cancellation, mixed charge/payout providers, verified-attendance release, credit-at-checkout without double entitlement, Paystack asynchronous refund completion, Stripe refund completion, payout failure recovery through Money Desk, counterpart realtime refresh, and exact notification destinations. Production activation remains gated on two physical mobile roles, responsive web, signed provider webhook replay, balanced ledger entries, and Ops terminal-outcome review.

## Implementation 6 Activation Boundary

Implementation 6 activates locked initial-order checkout and immutable capture receipts without activating material adjustments, fulfillment reconciliation, staged settlement, returns, refunds, incentives, or production promotion.

- The accepted custom quote or ready-made order is priced by the server before a provider payment object is created. Its 15-minute commercial reservation locks subtotal, any credited consultation amount, any Drapeon-funded promotion, platform fee, tax, fulfillment amount, currency, jurisdiction, policy version, pricing version, and correlation ID.
- A consultation credit reduces the later order subtotal exactly once. Tax remains fail-closed, one checkout uses one currency, and the client may display but cannot calculate or overwrite the authoritative allocation.
- Stripe checkout stays inside the native apps through Stripe Payment Sheet. Paystack checkout uses a constrained in-app hosted checkout on iOS and Android, with external bank applications allowed only when the provider requires them. Responsive web continues to use the provider-hosted flow. Page navigation, a callback URL, or a client success state is never capture proof; the server confirmation and signed provider webhook remain authoritative.
- A provider-confirmed initial-order capture consumes the exact pricing reservation, posts the balanced commercial ledger transaction, and issues one immutable receipt linked to the order, payment, reservation, journal, policy version, pricing version, provider reference, and correlation ID. A retry repairs a missing receipt rather than duplicating money or receipt records.
- The customer receipt shows the exact subtotal, consultation credit, promotion, service fee, fulfillment, tax jurisdiction and amount, and total paid. The tailor sees the same captured total and protected tailor amount without exposing customer-only payment details. Mobile, responsive web, payment history, order detail, and transactional email read the same receipt record.
- Receipt rows cannot be edited or deleted. A later refund, correction, chargeback, or reconciliation outcome must append its own linked financial record and cannot rewrite the capture-time receipt.
- RevenueCat is outside this architecture because Drapeon checkout pays for physical garments and tailoring services rather than App Store or Play Store digital content or subscriptions.

The development dry run must prove pricing is reserved before provider initialization, credited consultation math, balanced capture posting, receipt idempotency and immutability, customer/tailor visibility, exact web/mobile/email allocation, expired-reservation rejection, and provider retry behavior. Because the Paystack containment adds a native WebView module, Metro alone is not proof: fresh iOS and Android development clients and physical-device passes are required before promotion. Production remains untouched until those cross-role provider passes, signed webhook replay, real receipt delivery, and ledger/provider reconciliation are reviewed.

## Implementation 7 Activation Boundary

Implementation 7 activates normalized post-acceptance amendments and material-value reconciliation for new-policy orders without activating staged settlement, automated returns/refunds, incentives, or production promotion.

- The accepted quote, initial receipt, and original order promise remain immutable. Scope, price, responsibility, fulfillment, customs, correction, and exact-deadline changes are separate versioned claims with append-only decisions and events.
- Customer and tailor may each propose a change from mobile or responsive web. The counterpart accepts or declines it; the proposer may cancel only while it is still open. Only one money- or timeline-affecting amendment may be open per order.
- A customer-responsible positive amount becomes payable only after acceptance. Stripe remains inside the native Payment Sheet and Paystack inside the constrained in-app checkout. Responsive web uses its provider flow. Provider confirmation, not client navigation, marks the amendment paid.
- The agreed adjustment amount is the exact customer total. For added tailor work, its tax share is derived from the order's locked non-fallback jurisdiction and posted separately to tax liability; fulfillment/customs amounts post to fulfillment liability rather than tailor entitlement. A missing or fallback tax lock fails closed.
- Accepted deadline changes update the authoritative deadline only as part of the recorded counterpart decision. UI dates always show date, time, and timezone.
- Material requests require supplier estimate/photo proof before customer approval. Main order escrow remains untouched. Drapeon releases only the separately paid material liability through the existing named, JIT-gated Money Desk path.
- After provider-confirmed release, the tailor records actual spend plus final receipt coordinates. An exact match closes reconciliation; unused value or overage opens a canonical financial case and Ops issue. Ops then records the refund, recovery, or reviewed exception through Money Desk rather than editing the original advance.
- Money, deadline, fulfillment/customs, correction, and late-stage amendments create or refresh an Ops review issue with correlation identifiers. Push and email carry the authoritative proposal or decision into the exact order context.
- RLS gives both order parties read parity while Edge/database contracts remain the only write path. Claims and events cannot be mutated; idempotent provider retry reuses the prepared payment attempt.

The development dry run must prove proposal idempotency, immutable claims and events, counterpart-only decisions, exact deadline mutation, payment gating, tax/fulfillment ledger allocation, native/web provider retry, supplier-proof requirement, release-before-receipt enforcement, exact/unused/overage reconciliation, Ops issue creation, terminal notification jobs, and reverse-role replay. Production remains untouched until physical iOS and Android plus responsive-web customer/tailor passes, named Ops material release, provider capture/release evidence, email/push receipt, and ledger/provider reconciliation are reviewed.

## Implementation 8 Activation Boundary

Implementation 8 activates evidence-backed staged tailor settlement for new-policy orders without changing the accepted release contract of legacy orders.

- The settlement base is only the protected tailor entitlement. Tax, fulfillment, and Drapeon revenue never enter a tranche. Shipped orders use 70% after verified carrier or Drapeon custody, 20% seventy-two hours after verified delivery, and 10% after the fourteen-day protection window. Authenticated local collection uses 80% at handoff and 20% after seventy-two hours.
- `READY_FOR_*`, tracking-number creation, and label creation are claims, not financial evidence. Append-only evidence is limited to Drapeon custody, trusted-carrier acceptance, customer-verified delivery, or collection-code-authenticated handoff.
- Open disputes and financial cases freeze every unreleased tranche. Previously released money is never silently reversed; recovery requires a separate Money Desk action.
- Eligibility posts a balanced `TAILOR_ENTITLEMENT` to `TAILOR_ELIGIBLE` journal. Release posts `TAILOR_ELIGIBLE` to `TAILOR_RELEASED`. Exact-cent allocation puts any rounding remainder in the first tranche so the plan always equals the protected entitlement.
- Every eligible tranche remains a manual Money Desk move with named MFA/JIT elevation, preparer/approver separation, idempotent provider execution, and a recorded terminal outcome. The fifteen-minute monitor opens an Ops alert immediately, escalates after four and twenty-four hours, and sends the tailor a push and transactional email.
- Provider release and bank settlement are separate lifecycle facts. A successful Stripe Connect transfer means the entitlement reached the connected account's Stripe balance; it is not evidence that the tailor's bank received funds. A payout is called paid only after an exactly linked `payout.paid` event. Paystack transfer success may remain terminal bank-payment evidence where the provider contract confirms that meaning.
- Stripe automatic payouts can aggregate several Drapeon releases. An event without an exact Drapeon payout ID is retained as account-level bank activity and must never be guessed onto an individual order or tranche. Exact matching requires the Drapeon payout ID in provider metadata or a previously recorded provider bank-payout ID.
- Stripe Connect endpoints must receive connected-account `account.updated`, `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled`, `transfer.created`, and `transfer.reversed` events. The platform endpoint must also receive `refund.created`, `refund.updated`, and `refund.failed`. Missing subscriptions fail the settlement-readiness dry run.
- Signed Stripe dispute events create an immutable provider-dispute observation and freeze only unreleased settlement while the dispute needs response or remains under review. A won or warning-closed dispute can release the freeze after the authoritative refresh; a lost dispute remains a reviewed recovery case. Mobile, responsive web, and Ops read this same state and refresh through Realtime rather than inventing local status.
- Reversing an already released Stripe transfer is a separate post-release recovery action. It requires an exact provider transfer, a reviewed Money Desk request, two independent approvals, an idempotent provider reversal, and a balanced reconciliation journal. It does not itself refund the customer; customer refunds continue through the original customer payment provider.
- Paystack refund, transfer, and charge-reversal events use the same terminal-outcome, recovery-message, Ops-issue, and Sentry-correlation contract. Provider-specific limitations may change the recovery adapter, but never the audit, communication, or fail-closed boundary.
- Push, transactional email, and critical SMS use the same party-safe states: available in provider balance, bank payout pending, in transit, paid to bank, failed, or reversed. Mobile, responsive web, Ops, and receipts derive copy from the shared settlement contract rather than rendering provider or database enums.
- Customer and tailor order detail show the same authoritative compact progress card on mobile and responsive web with role-appropriate copy. Raw ledger and database enums are never exposed.
- Orders carrying `legacy-single-release-72h` never receive a staged plan. Activation requires a provider-confirmed `commercial-2026-07-31-v1` initial payment whose commercial ledger capture has been recorded.

The development dry run must prove shipped and local plans independently, exact-cent allocation, rejection of label-only evidence, each eligibility time gate, dispute freeze and unfreeze, independent Money Desk approval, provider-failure terminality, counterpart refresh, notification terminal outcomes, and final full settlement. Include a one-cent remainder and an open concern before a later tranche becomes due. Production remains untouched until those results and provider reconciliation are reviewed.

## Implementation 9 Activation Boundary

Implementation 9 activates the canonical return, remedy negotiation, reverse-logistics evidence, and reviewed customer-refund path for customer and tailor on mobile and responsive web without activating benefits or production promotion.

- A return begins as one immutable financial-case claim with reason, requested remedy, optional exact amount, eligibility snapshot, protection hold, policy version, idempotency hash, correlation ID, and secure evidence coordinates. Email and chat may mirror the record but cannot authorize a proposal, decision, return receipt, or refund.
- Custom change-of-mind requests fail into reviewed ineligibility unless applicable law overrides policy. Missing delivery, fit responsibility, expired protection windows, and cross-border uncertainty stay in Ops review instead of receiving an automatic outcome.
- Customer and tailor propose versioned remedies. Only the counterpart may accept or decline; a later proposal supersedes but never rewrites the earlier claim. Explanation, alteration, remake, partial refund, full refund, return plus refund, and rejection remain explicit outcomes.
- A return-required agreement cannot reach refund preparation until an append-only provider or Ops shipment event records receipt. Label creation and tracking text alone are not receipt evidence.
- Refund restoration separates provider cash lines—tailor work, platform fee, tax, fulfillment, and consultation—from restored promotions and from the party funding an already-released tailor amount. Cash lines must equal the provider refund exactly. Released tailor money is never silently debited; Drapeon funds the customer result and any recovery becomes a separate high-risk Money Desk action.
- Refund preparation creates an immutable reviewed resolution. Execution is enabled only for `CUSTOMER_REFUND` through named MFA/JIT Money Desk preparation, independent approval, and its idempotent Stripe or Paystack adapter. The provider refund is restricted to the original initial-order payment and posts an exact restoration journal against unreleased balances; a provider-success/ledger-failure mismatch opens a critical reconciliation issue and must not be retried at the provider.
- Both parties see the same case, proposal, decision, return requirement, and terminal refund status on iOS, Android, and responsive web. Push and transactional email open the exact order context. Ops has a compact return queue, exact-restoration form, and protected Money Desk handoff.
- Sentry captures authenticated action and execution failures with identifiers only. Message bodies, evidence contents, private paths, addresses, payment credentials, and provider secrets are excluded.

The DEV dry run proved schema/RLS deployment, idempotent claim creation with hash-mismatch rejection, immutable claims and decisions, counterpart-only acceptance, exact restoration balance, Money Desk gating, Edge auth rejection, shared tests, Deno checks, mobile/web typechecks, and rollback of synthetic records. A real provider refund, two physical-device counterpart notification receipts, return-carrier webhook replay, and final ledger/provider reconciliation remain mandatory promotion evidence. Production remains untouched until that reviewed pass.

### Ops-reviewed partial-refund evidence

An Ops partial refund never begins with a provider button. Ops first opens or selects the order's active issue, records a canonical reason and decision basis, writes a party-safe summary, identifies the evidence source and received time, allocates every refund unit across the exact restoration lines, and explicitly chooses whether provider success will continue the order, close it as partially refunded, or keep it under review. The database creates an immutable `REFUND` financial case, append-only evidence rows, and a `MONEY_DESK_REQUIRED` refund resolution while preserving the order's `IN_DISPUTE` production stage.

Email, WhatsApp, Drapeon chat, Drapeon call records, and Ops notes may support the decision. The source reference records the thread subject/date, consented WhatsApp contact/date, message identifier, call identifier, or Ops issue. Optional screenshots are stored only in the private `commercial-evidence` bucket under the order's `ops-refunds` folder; the database stores the private object coordinate and metadata rather than a public URL. Raw external evidence defaults to `OPS_ONLY`. The independent approver receives a ten-minute signed preview in Money Desk, while the separate party-safe summary is suitable for the case history and terminal notification. Credentials, payment details, unrelated conversations, and unnecessary personal data must never be uploaded.

External evidence can corroborate facts but cannot authorize money. Preparation requires a named MFA-backed JIT grant, then a different named reviewer approves the exact case, restoration, and post-refund order outcome. Only the approved Money Desk request may call the idempotent provider adapter. Pending and failed provider refunds never move the order. A successful refund appends the restoration journal, applies the protected outcome once, recalculates remaining settlement, and sends customer and tailor push/email jobs to terminal outcomes.

Customer refund routing and tailor payout routing are independent. A Stripe-funded customer order may refund through Stripe while an eligible tailor settlement later pays through Paystack, and vice versa. The refund always returns through the original customer payment attempt; the tailor's payout provider is never used to route a customer refund. Party-facing status names the refund provider and communicates the normal window: Stripe usually takes 5–10 business days to the original payment method; Paystack generally takes 3–10 working days, with any provider `expected_at` date taking precedence and the bank controlling final display time.

## Implementation 10 Activation Boundary

Implementation 10 activates only the controlled benefit core and post-completion customer tips for new-policy orders. It does not activate purchased wallets, transferable balances, gift cards, rewarded referrals, milestones, commission waivers, affiliates, sweepstakes, or production promotion.

- A named MFA-backed Finance or Admin operator prepares a campaign in Ops. It remains `PENDING_APPROVAL` until a different named operator activates it. The database rejects activation of non-core feature keys.
- Promo codes, free or capped shipping, account grants, goodwill grants, and complimentary orders reserve a versioned benefit against the exact locked order price. One order may have one active reservation. Reservation, campaign budget, and account-grant state change atomically.
- A benefit reduces customer due without reducing protected tailor entitlement, tax liability, fulfillment liability, or Drapeon revenue allocation. The covered amount posts to `DRAPEON_SUBSIDY_EXPENSE`. A fully covered order uses the internal `COVERAGE` provider and still produces a balanced ledger transaction and immutable receipt without creating a fake external charge.
- A fifteen-minute reservation is extended to twenty-four hours only after a real provider payment object is prepared. Abandoned reservations expire through the five-minute monitor, release campaign liability, and restore an eligible account grant. Capture retry repairs a missing benefit redemption rather than duplicating the journal or receipt.
- Tips become available only after delivered, collected, or complete. One order has one tip; a failed attempt may retry the same exact amount. The full displayed amount posts to `TIP_LIABILITY`, remains separate from order total, discounts, reviews, ranking, and commission, and cannot enter staged order settlement.
- A captured tip becomes `PAYOUT_PENDING`. Tip release is a separate `TIP_PAYOUT` Money Desk action with named JIT elevation, independent approval, idempotent Stripe Connect or Paystack transfer, `TIP_LIABILITY` to `TAILOR_RELEASED` journal, immutable event, and terminal payout status.
- Customer and tailor see role-appropriate benefit, receipt, and tip state on iOS, Android, and responsive web. Ops sees campaign budget/reservation/consumption, captured tip liability, payout queue, correlation IDs, and push/email terminal outcomes.
- Tip capture and payout enqueue in-app push and transactional email jobs with stable idempotency keys. Every job remains visible as pending, retryable, succeeded, failed, or dead. Edge action, webhook, provider payout, and enqueue failures report identifier-only context to Sentry.
- Service-only RPCs own reservation, expiry, campaign preparation/activation, grants, redemption, and tip preparation. Authenticated clients have party-scoped reads and cannot invoke financial RPCs directly.

The DEV dry run proved both schema verification migrations, feature-gate rejection, append-only history, service-only controls, payment-lock and expiry functions, scheduled expiry, independent campaign activation contract, Money Desk tip action, terminal reporting views, six deployed DEV Edge functions, three unauthenticated rejection paths, 415 shared tests, mobile and responsive-web typechecks, Deno checks, auth-manifest parity, commercial-contract parity, and clean diffs. Real Stripe and Paystack tip captures/transfers, a zero-dollar complimentary order, two named Ops approvers, physical iOS/Android counterpart refresh, real push/email terminal delivery, and Sentry correlation replay remain required major-rehearsal evidence. Production remains untouched.

## Implementation 11 Activation Boundary

Implementation 11 replaces checkout-time fulfillment and tax inference with a versioned, configuration-driven decision for newly activated drafts. It does not reprice accepted orders, rewrite receipts, change historical liabilities, enable an unreviewed corridor, or promote any behavior to production merely because the contracts exist.

### 11A. Shared contracts and reviewed controls

- Shared packages define fulfillment classifications, verified-location requirements, the reviewed `TaxTransactionType` taxonomy and tax-supply mappings, liability granularity, responsible-party outcomes, registration decisions, line-item tax classes, corridor collection modes, blocked reasons, party-safe copy, and receipt fields.
- The database stores immutable, effective-dated responsibility and corridor controls with source, review, approval, and supersession evidence. Editing an active rule creates a new version.
- `TAX_POLICY_CONTROLS`, responsibility controls, registration controls, and corridor controls are validated as one dependency graph. Missing, expired, conflicting, or unsourced nodes fail closed.
- The server owns the resolver. iOS, Android, responsive web, Ops, checkout, receipts, emails, and Edge functions consume its decision and never recreate it locally.

The 11A dry run must prove schema constraints, immutable versioning, effective-date selection, controlled enum evolution, reviewed tax-supply mappings for every launch `TaxTransactionType`, rejection of unknown `TaxTransactionType` values, rejection of `LINE_GROUP` controls under the launch policy, conflict rejection, expired-review blocking, source and reviewer presence, RLS or service-role boundaries, shared serialization, and parity fixtures across server, mobile, web, and Ops. No customer-facing behavior activates at this stage.

The Drape-DEV 11A dry run on 16 August 2026 applied the dormant control schema and its rollback-only verification migrations. It proved all seven launch transaction-type fixtures, order-only launch liability, duplicate-scope rejection, expired-review blocking, immutable controls, HTTPS source evidence, service-role-only access, shared and Edge serialization, Prisma validity, commercial-contract parity, 494 shared tests, and mobile/web typechecks. No reviewed jurisdiction row, synthetic fixture, checkout integration, corridor activation, receipt change, or ledger change was left active; production remains untouched.

### 11B. Early fulfillment validation

- Address entry and fulfillment-method selection call the authoritative eligibility resolver before the draft is built around local terms.
- Local collection rejects missing or free-text pickup locations. Local delivery rejects a cross-country destination and offers the explicit international-shipping switch. International shipping requires an activated corridor and presents its collection mode before commitment.
- Back, cancel, edit, saved-draft resume, deep-link return, and counterpart review preserve the same method and verified location state without bypassing the guard.
- A material location change invalidates pricing and records why a new reservation is required.

The 11B dry run must cover local collection, same-country local delivery, a local-delivery country mismatch accepted and declined, an unsupported international corridor, an activated corridor, incomplete and edited addresses, saved-draft resume, notification or deep-link entry, and cold start. Prove the paths on physical iOS and Android plus narrow responsive web, with the counterpart seeing the selected method without a forced full-screen reload.

Implementation status (development, 2026-08-16): the shared resolver, structured pickup contract, persisted draft/order snapshots, append-only eligibility events, mobile/web early checks, and the strict authoritative create-order verification-source recheck are deployed to development. Existing accepted orders remain readable. Legacy free-text pickup locations deliberately fail closed until the tailor confirms structured city/country data. Production is unchanged. Physical iOS/Android, narrow-web, deep-link/cold-start, active-corridor, and counterpart-realtime proof remain completion gates rather than assumed outcomes.

### 11C. Domestic responsibility and calculation

- The resolver selects tax-supply characterization and order-level responsible party from the reviewed jurisdiction-and-`TaxTransactionType` control, then applies the effective registration decision and line-item classifications before calling a rate adapter.
- A marketplace-facilitator control can select Drapeon independently of tailor registration. A customer or importer outcome cannot be converted into Drapeon-collected tax without a reviewed rule.
- Mixed standard, zero-rated, and exempt lines remain separate. Shipping taxability is resolved explicitly. Currency formatting and payment provider selection do not influence liability.
- Pricing, checkout, receipt, ledger, and Ops show the same party-safe result and retain the internal filing evidence.

The 11C dry run must include every launch `TaxTransactionType`, registered and unregistered tailor facts, Drapeon marketplace-facilitator responsibility, customer/importer responsibility, threshold crossing, a changed effective date, mixed tax classes under one responsibility decision, an amendment that may inherit treatment, a mixed-purpose amendment that must split or block, a simulated jurisdiction requiring category-revenue or line-group liability that must remain blocked, taxable and non-taxable shipping, incomplete controls, adapter failure, reservation expiry, and an address change after pricing. Every successful case must reconcile pricing, provider amount, receipt, tax liability journal, email, and Ops; every unresolved case must block before provider initialization.

Implementation status (development, 2026-08-16): exact-scope activation, dependency resolution, mixed-line calculation, immutable pricing snapshots, reservation verification, aggregate customer tax, separate liability posting, party-safe mobile/web/email display, Ops visibility, and fail-closed pre-provider blocking are deployed to development. No jurisdiction is activated by code or migration, so ordinary development orders retain legacy pricing until a named reviewed activation is added. Physical cross-role, real provider, notification, and reconciliation proof remain promotion gates.

### 11D. International corridor resolution

- Each activated corridor resolves export treatment, import VAT and duty, shipping taxability, evidence requirements, responsible party, and `COLLECTED_AT_CHECKOUT`, `PAYABLE_ON_IMPORT`, or `BLOCKED` treatment.
- Carrier-specific rules are configuration where legally or operationally material. No generic worldwide fallback exists.
- Customer and tailor see the same inclusion or payable-on-import promise before quote acceptance. Receipts and order detail preserve it after checkout.

The 11D dry run must exercise both directions of every proposed launch corridor, all three collection modes, a carrier-specific rule, missing export evidence, unsupported destination, address change across borders, refund restoration of collected tax and shipping, and counterpart notification delivery. At least one real international sandbox checkout must reconcile provider capture, jurisdiction liabilities, receipt, ledger, and Ops reporting before that corridor can be proposed for production.

Implementation status (development, 2026-08-16): reviewed static corridor calculations now preserve domestic tax, import tax, duty, collection mode, importer responsibility, export/customs evidence, calculation source, and separate ledger liabilities through pricing, order detail, receipts, email, refund restoration, and Ops. The two schema/verification migrations and affected quote, payment, webhook, receipt-email, Ops-health, and monitor functions are deployed to development. `PAYABLE_ON_IMPORT` never invents a checkout charge; unsupported, blocked, incomplete, and provider-strategy corridors fail before payment initialization. No international corridor is seeded or activated. A named corridor review and real sandbox checkout remain mandatory before production proposal.

### 11E. Activation, monitoring, and rollback

- Activation is allowlisted by policy version, environment, jurisdiction, `TaxTransactionType`, and corridor. Development approval does not enable production.
- Ops shows the decision chain, sources, review age, upcoming review deadlines, blocked reason, affected reservations, liabilities, and correlation ID without exposing private addresses beyond role need.
- Sentry and health reporting distinguish configuration miss, expired review, responsibility conflict, adapter failure, reservation invalidation, provider mismatch, receipt mismatch, and ledger mismatch. Alerts link to the exact Ops context and exclude full addresses and payment credentials.
- A scheduled monitor warns before a control review expires and blocks new pricing when it expires. Existing accepted orders and their filing snapshots remain readable and unchanged.

The final Implementation 11 dry run must replay the full customer-to-tailor journey for local collection, local delivery, and one activated international corridor on physical iOS and Android and responsive web. It must prove initiating confirmation, authoritative draft and audit persistence, counterpart realtime state, successful or blocked checkout, balanced ledger and receipt, terminal push and email outcomes, exact-context deep links, Ops visibility, Sentry correlation, configuration expiry, safe rollback, and reverse-role or adjacent-stage replay. Production activation requires named tax/legal review of every responsibility and corridor row, Finance review of liability accounts and receipts, Engineering review of provider and ledger reconciliation, and an explicit allowlist change.

Implementation status (development, 2026-08-16): environment-specific allowlisting, append-only disable rollback, immutable accepted snapshots, exact Ops decision-chain visibility, scheduled activation and dependency review monitoring, identifier-only Sentry/Ops incidents, and launch-tier health failure are deployed to development. The monitor covers policy, registration, responsibility, line classification, corridor, registration-fact, and activation deadlines; expiry blocks only new pricing and leaves accepted filing snapshots readable. Its authenticated post-deploy probe completed successfully with zero dormant reviewed controls or alerts. The three quote journeys below are the next gate. Production remains untouched.
