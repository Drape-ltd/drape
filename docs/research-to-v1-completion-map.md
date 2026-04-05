# Research To V1 Completion Map

Date: April 2, 2026

## Why This Exists

The research work is only useful if it reduces ambiguity and helps Drape ship.

This document connects the recent research and decision docs to:

- what is already decided
- what still needs implementation
- what should stay deferred
- what must be validated in QA or with real secrets later

## Core Goal

Use research to make the remaining build work:

- safer
- faster
- less reversible
- less dependent on guesswork during implementation

In short:

- yes, the goal is to use this research to drive Drape to completion

## What Is Already Decided

## Measurements

Locked direction:

- keep guided self-measurement
- support nearby professional measurement conceptually
- do not build a verified partner network in V1
- use `measurement source` as the core concept
- allow tailors to request measurement confirmation before cutting

Primary docs:

- `docs/v1-decisions-measurements-payouts-material-risk.md`
- `docs/v1-decisions-nearby-measurements-and-source-strategy.md`

## Payments, payouts, and FX

Locked direction:

- `READY_MADE` payout after `DELIVERED` or `COLLECTED` plus the `72-hour` dispute window
- no default partial payout for ready-made materials
- keep payout conservative
- do not treat Stripe or Paystack as escrow
- tailor-sourced fabric should be funded by quote acceptance, not tailor credit

Primary docs:

- `docs/payments-fx-policy.md`
- `docs/v1-decisions-measurements-payouts-material-risk.md`
- `docs/research-refunds-disputes-and-payout-liability-2026-04-02.md`

## Sourcing and material risk

Locked direction:

- customer-supplied fabric is supported
- local handoff is conceptually valid
- tailor-sourced fabric stays inside one quote/payment moment in V1
- no separate material-deposit flow yet
- material issues should be a structured subflow before cutting

Primary docs:

- `docs/research-fabric-sourcing-and-handoff-2026-04-02.md`
- `docs/v1-decisions-fabric-sourcing-handoff-billing.md`
- `docs/v1-decisions-measurements-payouts-material-risk.md`

## Remedies and disputes

Locked direction:

- use a remedy ladder, not a blanket refund rule
- stronger customer-favoring refund rights before sourcing/cutting
- after cutting, shift toward alter/remake/partial refund
- keep payout blocked while remedy or dispute is open

Primary docs:

- `docs/research-refunds-disputes-and-payout-liability-2026-04-02.md`
- `docs/v1-decisions-remedy-ladder-and-refund-matrix.md`

## Tailor trust and capability gating

Locked direction:

- identity verification is not the same as payout readiness
- paid order acceptance requires payout readiness
- higher-risk custom sourcing and international shipping should be gated more tightly
- Drape should show clear reasons for holds or restrictions

Primary docs:

- `docs/research-tailor-trust-onboarding-and-payout-readiness-2026-04-02.md`
- `docs/v1-decisions-tailor-trust-and-capability-gating.md`

## Infrastructure resilience and degraded mode

Locked direction:

- Drape should be async-first, not live-first
- the order record should stay canonical under weak connectivity
- critical non-destructive actions should be retry-safe
- payment should be resumable and reconciliation-friendly
- local collection, local handoff, and manual ops recovery are valid product paths

Primary docs:

- `docs/research-infrastructure-resilience-and-degraded-mode-policy-2026-04-02.md`
- `docs/v1-decisions-infrastructure-resilience-and-fallback-policy.md`

## Evidence retention and timeline integrity

Locked direction:

- the order timeline should count as part of the evidence model
- core order facts should be preserved conservatively in V1
- append-over-erase behavior is safer for disputes, payouts, and weak-connectivity recovery
- ops should trust platform facts before rhetoric

Primary docs:

- `docs/research-evidence-retention-and-order-timeline-integrity-2026-04-02.md`
- `docs/v1-decisions-evidence-retention-and-order-timeline-integrity.md`

## Ops ownership and escalation authority

Locked direction:

- triage authority and final decision authority should be separated
- money and trust-sensitive decisions need a narrower lane than general support
- event-critical, cross-border, and processor-timed issues should escalate automatically
- shared-token ops access should bias V1 toward conservative irreversible authority

Primary docs:

- `docs/research-ops-ownership-and-escalation-authority-2026-04-02.md`
- `docs/v1-decisions-ops-ownership-and-escalation-authority.md`

## Seller ranking and discovery fairness

Locked direction:

- discovery should separate eligibility from ranking
- visibility should reflect both relevance and reliability
- restrictions should affect discovery by scope
- new sellers need a bounded cold-start path

Primary docs:

- `docs/research-seller-ranking-and-discovery-fairness-2026-04-02.md`
- `docs/v1-decisions-seller-ranking-and-discovery-fairness.md`

## Seller appeals and reinstatement fairness

Locked direction:

- self-fixable holds should be separated from true appeals
- appeals should be evidence-based, time-bounded, and scope-aware
- open orders and payouts should be handled by actual risk, not just one generic “restricted” state
- reinstatement can be probationary or partial
- low-bandwidth appeal intake matters in Drape’s target markets

Primary docs:

- `docs/research-seller-appeals-reinstatement-and-restriction-fairness-2026-04-02.md`
- `docs/v1-decisions-seller-appeals-reinstatement-and-restriction-fairness.md`

## Referrals, credits, and promo abuse

Locked direction:

- sharing links is fine, but reward economics should stay deferred until governance exists
- narrow promo rules are safer than open referral rewards
- incentives should be reversible and milestone-based
- Drape should not promise discount economics before the control layer exists

Primary docs:

- `docs/research-referrals-credits-and-promo-abuse-2026-04-02.md`
- `docs/v1-decisions-referrals-credits-and-promo-abuse.md`

## Post-completion defects and aftercare

Locked direction:

- Drape should offer limited aftercare, not an open-ended warranty
- obvious fit and finish issues should be raised quickly
- credible latent workmanship defects can have a narrower extra review window
- `CUSTOM` should stay remedy-first while `READY_MADE` can stay more retail-like
- ordinary wear, misuse, and body-change issues should sit outside remedy coverage

Primary docs:

- `docs/research-post-completion-defects-aftercare-and-limited-warranty-2026-04-02.md`
- `docs/v1-decisions-post-completion-defects-aftercare-and-limited-warranty.md`

## Reviews, moderation, and retaliation boundaries

Locked direction:

- honest negative reviews should stay visible
- customer reviews of tailors can be public, but tailor reviews of customers should stay non-public in V1
- open concerns should delay public publication
- one factual tailor response is enough
- review manipulation and retaliation should be treated as trust issues, not ordinary support noise

Primary docs:

- `docs/research-review-publication-moderation-and-retaliation-policy-2026-04-02.md`
- `docs/v1-decisions-review-publication-moderation-and-retaliation-policy.md`

## Contact integrity, anti-circumvention, and language safety

Locked direction:

- phone numbers should be normalized before save and treated as canonical identity data, not raw display strings
- stored phone should not automatically mean shareable phone
- anti-off-platform controls should be evasion-aware, not only literal-regex based
- abusive language should be handled by severity, with threats, hate, coercion, and doxxing treated as trust incidents
- this layer should explicitly account for African-market mobile and formatting realities

Primary docs:

- `docs/research-contact-integrity-phone-normalization-circumvention-and-abuse-language-2026-04-02.md`
- `docs/v1-decisions-contact-integrity-phone-normalization-circumvention-and-abuse-language.md`

## Privacy, deletion, and retention boundaries

Locked direction:

- Drape should use staged deletion, not promise an instant total wipe
- in-app deletion initiation stays real, and the web deletion route should become clearer
- active orders, disputes, payouts, abuse reviews, or legal holds can delay final erasure while still restricting the account
- public visibility should disappear faster than internal evidence
- retention should be specific, justified, and time-bounded rather than indefinite by default

Primary docs:

- `docs/research-privacy-account-deletion-and-retention-boundaries-2026-04-02.md`
- `docs/v1-decisions-privacy-account-deletion-and-retention-boundaries.md`

## Data access, rectification, and disclosure honesty

Locked direction:

- factual profile and fit data should stay self-servable
- access and export rights can remain request-based in V1
- evidence-critical history should not be directly rewritten
- privacy preferences should not overclaim beyond what runtime SDK behavior actually enforces
- App Store and Play disclosures must reflect real first-party and third-party collection behavior

Primary docs:

- `docs/research-data-access-export-rectification-and-disclosure-honesty-2026-04-02.md`
- `docs/v1-decisions-data-access-export-rectification-and-disclosure-honesty.md`

## Runtime consent, diagnostics, analytics, and SDK disclosure alignment

Locked direction:

- required diagnostics and optional analytics should be treated as different categories
- optional analytics should not initialize before Drape knows the user's preference
- the cleanest V1 posture is to keep PostHog-style product analytics default-off until explicit consent exists
- session replay should stay off by default in V1
- mobile release discipline should include privacy-manifest and store-disclosure review for the actual shipped SDK behavior

Primary docs:

- `docs/research-runtime-consent-analytics-diagnostics-and-sdk-disclosure-2026-04-02.md`
- `docs/v1-decisions-runtime-consent-analytics-diagnostics-and-sdk-disclosure.md`

## Account recovery, reauthentication, and sensitive-request verification

Locked direction:

- email-link recovery should remain the primary self-serve recovery path in V1
- Drape should not rush into phone-only recovery before phone identity is verified and governed properly
- recovery-channel changes and other sensitive account changes should require stronger checks than a bare active session
- support recovery should stay conservative for unproofed accounts and more evidence-based for stronger verified accounts
- shared-device and shared-phone reality should be tolerated without ignoring large-scale fraud risk

Primary docs:

- `docs/research-account-recovery-reauthentication-and-sensitive-request-verification-2026-04-02.md`
- `docs/v1-decisions-account-recovery-reauthentication-and-sensitive-request-verification.md`

## What This Means For Implementation

## Workstream 1: Measurement metadata

Implementation target:

- add measurement-source support to customer profile and/or order snapshot
- allow `TAILOR_CAPTURED` / `EXTERNAL_PRO_CAPTURED` / `SELF_GUIDED`
- add a tailor-side `measurements_need_confirmation` or equivalent pre-cutting gate

Why it matters:

- reduces fit ambiguity
- improves dispute handling
- makes nearby professional measurement useful without overbuilding

## Workstream 2: Fabric handoff clarity

Implementation target:

- support local handoff conceptually in customer/tailor flow copy
- later add `fabric_handoff_mode`
- add simple fabric receipt confirmation

Why it matters:

- closes a real operational gap
- reduces “I gave it to them / I never got it” disputes

## Workstream 3: Material issue flow

Implementation target:

- structured pre-cutting issue flow for unsuitable customer fabric
- customer actions:
  - replace fabric
  - ask tailor to source
  - revise design
  - cancel

Why it matters:

- this is one of the clearest negative-path gaps in custom work

## Workstream 4: Remedy and refund decision support

Implementation target:

- encode the stage-based remedy ladder into ops and order support flows
- make it easier for ops to choose:
  - alter
  - remake
  - partial refund
  - full refund

Why it matters:

- gives support a consistent playbook
- reduces emotional dispute handling

## Workstream 5: Tailor payout readiness and capability gating

Implementation target:

- add explicit payout readiness / restriction state
- distinguish identity approval from payout readiness
- gate higher-risk seller capabilities more deliberately

Why it matters:

- prevents confusing seller states
- aligns trust copy with real account readiness

## Workstream 6: Seller-facing trust copy

Implementation target:

- update payout/help/verification copy to avoid overpromising
- explain restrictions and readiness more clearly

Why it matters:

- avoids misleading stage or payout messaging
- supports launch trust

## Workstream 7: Infrastructure resilience and degraded states

Implementation target:

- make degraded states explicit in product copy
- ensure critical actions can recover cleanly from retry / timeout conditions
- preserve async fallbacks for call, payment, and fulfillment paths
- keep local collection and manual handoff support available where logistics are weak

Why it matters:

- this is part of Drape’s market fit, not just technical polish
- it prevents the product from silently assuming world-class infrastructure

## Workstream 8: Evidence integrity and ops-readable timeline

Implementation target:

- make the ops surface easier to read as one coherent timeline
- preserve core order evidence conservatively
- avoid destructive mutation of evidence-critical records
- make concern resolution basis easier to capture explicitly

Why it matters:

- stronger dispute handling
- safer payout decisions
- cleaner recovery when infrastructure or communication is messy

## Workstream 9: Ops authority and accountability

Implementation target:

- separate triage-friendly actions from irreversible money/trust actions
- record clearer human ownership for final decisions
- make escalation triggers easier to see in `/ops`
- avoid shared-token ambiguity around high-risk actions over time

Why it matters:

- more consistent outcomes
- safer financial and trust decisions
- less operational drift as Drape moves from build mode into real business mode

## Workstream 10: Discovery quality and fairness

Implementation target:

- align discovery/ranking inputs with trust and reliability policy
- make restriction scope affect visibility more intentionally
- avoid overexposing sellers to workflows they are not cleared for
- support fair cold-start exposure for newly approved sellers

Why it matters:

- better customer trust at the moment of seller choice
- healthier marketplace quality over time
- more honest growth for new and existing sellers

## Workstream 11: Incentive governance and referral honesty

Implementation target:

- remove or soften reward-promising copy until incentives are real
- define promo restrictions before launch if discounts are introduced
- avoid open-ended wallet or referral-credit behavior
- make future qualification and reversal rules explicit before economic sharing launches

Why it matters:

- prevents support debt and abuse leakage
- keeps growth systems aligned with trust and accounting reality
- avoids promising economics the product cannot yet enforce

## Workstream 12: Seller appeals and reinstatement controls

Implementation target:

- add explicit seller restriction and appeal fields
- make seller-visible reason, scope, and next-step messaging clearer
- support low-bandwidth appeal intake and durable appeal history
- define how open orders and payouts behave while a seller is under review

Why it matters:

- makes trust enforcement more legible and fair
- reduces damage from false positives or operational holds
- fits Drape’s market reality better than opaque, desktop-only enforcement assumptions

## Workstream 13: Aftercare and latent-defect handling

Implementation target:

- add an explicit post-completion aftercare path distinct from generic disputes
- support structured evidence for fit, finish, and workmanship claims
- distinguish pre-payout concern blocking from post-payout aftercare review
- make local alteration and repair support easier to record

Why it matters:

- closes one of the last major trust gaps after “order complete”
- keeps custom-work promises honest without becoming a blanket warranty
- fits local infrastructure reality better than return-only recovery

## Workstream 14: Review publication and moderation controls

Implementation target:

- make public review queries respect publication and moderation state
- add report, hold, and moderation handling for review content
- gate public publication while concerns are unresolved
- keep tailor-to-customer review visibility private in V1

Why it matters:

- closes a launch blocker around review publish flow and moderation
- protects trust without sanitizing honest bad outcomes
- reduces retaliation and manipulation risk in a sensitive two-sided marketplace

## Workstream 15: Contact integrity and message-safety hardening

Implementation target:

- normalize stored phone numbers on write paths and define a canonical phone field strategy
- strengthen contact-bypass detection across client and server with better normalization and evasion handling
- separate lower-severity abuse friction from high-severity safety blocking
- make repeated circumvention or abusive behavior easier to route into trust review

Why it matters:

- prevents avoidable phone and OTP-style reliability failures later
- strengthens “stay on Drape” protections without depending on one brittle regex
- closes a real trust gap around harassment, threats, and coercive off-platform pressure

## Workstream 16: Deletion workflow and retention honesty

Implementation target:

- tighten deletion copy to match the real staged process
- make the web deletion route more explicit
- add clearer deletion state and hold handling
- separate removable profile data from retained evidence and transaction records

Why it matters:

- closes store-compliance and privacy-trust gaps at the same time
- avoids overpromising “full deletion” when legal or evidence retention still applies
- gives Drape a more defensible privacy posture as it moves from build mode into real operations

## Workstream 17: Access/export workflow and disclosure alignment

Implementation target:

- distinguish self-serve edits from formal access/export requests
- make export handling more concrete than a generic support mailto
- ensure privacy toggles and copy match actual analytics/diagnostics behavior
- align App Store and Play privacy declarations with real SDK use and app behavior

Why it matters:

- reduces privacy-trust debt before launch
- prevents store-disclosure mismatches
- gives users cleaner, more believable control over their data

## Workstream 18: Telemetry consent enforcement and mobile disclosure audit

Implementation target:

- separate required diagnostics from optional product analytics in code and copy
- stop initializing optional analytics before user preference is known
- keep session replay dormant unless it passes a separate review
- add explicit mobile privacy-manifest and store-disclosure audit steps to the release path

Why it matters:

- closes the gap between stored privacy settings and real runtime behavior
- reduces App Store and Play compliance risk
- keeps Drape's privacy posture believable as the business becomes more real

## Workstream 19: Recovery governance and step-up verification boundaries

Implementation target:

- define which account actions require recent reauthentication
- keep self-serve recovery centered on the bound email flow for now
- tighten phone-change and other recovery-adjacent identity changes
- add a documented support-review path for lost-access cases without creating a casual takeover route
- make notifications and review state around recovery-sensitive actions more explicit

Why it matters:

- closes one of the last auth and trust ambiguities before launch
- reduces support-led takeover risk
- keeps Drape usable in weak-infrastructure environments without letting “fallback” become “fraud path”

## What Can Stay Deferred

- verified nearby measurement partner network
- BNPL-heavy custom-order financing
- separate material-deposit flow
- computer-vision or body-scan measurement
- full seller reserve system
- fully automated payout execution controls in-product

These are real opportunities, but not V1 completion blockers.

## What Needs Real-World Validation Later

- final secrets and deploy setup
- provider-specific payout onboarding realities
- actual dispute response timings with Paystack and Stripe
- real tailoring feedback on sourcing, material issues, and fit remedies
- QA around order state transitions and ops decisions

## Completion Logic

The practical sequence should be:

1. finish the remaining product-state and policy-driven implementation
2. align UI copy with the actual rules
3. run migrations / deploy functions / wire secrets
4. run manual QA against the real states
5. tighten anything that still feels ambiguous in real use

## Best Mental Model

Research is not a side quest.

For Drape, it is being used to:

- shrink policy ambiguity
- decide what not to build yet
- define failure handling before users force us to
- make the implementation path cleaner

That is exactly how it should drive Drape to completion.
