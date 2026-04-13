# V1 Decisions: Infrastructure Resilience And Fallback Policy

Date: April 2, 2026

## Why This Exists

Drape needs an explicit operating stance for:

- weak mobile networks
- power interruptions
- low-end devices
- last-mile logistics gaps
- interrupted payment journeys
- uneven courier and address quality

This document turns that reality into working V1 decisions.

## Core Principle

Build for recoverability, not perfect infrastructure.

## Decision 1: Drape Should Be Async-First, Not Live-First

### Chosen rule

No critical order path should depend on both parties being online at the same time.

### This means

- consultations help, but they are not the only coordination path
- quote review should survive delayed reads
- order progress should survive delayed notifications
- support should not depend on immediate live response

### Why

African operating conditions make simultaneous reliable presence too fragile to be the hidden product assumption.

## Decision 2: The Order Record Is The Canonical Truth

### Chosen rule

The source of truth should be:

- order stage
- order thread
- stage updates
- audit logs
- persisted payment status

Not:

- push delivery
- call attendance
- memory of a live conversation

### Why

When infrastructure is inconsistent, the trust layer has to be durable and refreshable.

## Decision 3: Critical Non-Destructive Actions Must Be Retry-Safe

### Chosen rule

For V1, non-destructive mutations should prefer idempotent or safely repeatable behavior.

Important examples:

- send quote
- request consultation
- start payment
- confirm payment
- confirm collection
- submit concern
- resend invitation or claim flow actions

### Why

Weak connectivity creates duplicate taps, timeouts, and uncertain client state.
The backend should help the user recover from that.

## Decision 4: Every Real-Time Feature Needs An Async Fallback

### Chosen rule

If a real-time feature fails, Drape should provide a lower-bandwidth fallback.

### V1 fallback pattern

- consultation call fails
  - retry
  - reschedule
  - continue in messages
- push is missed
  - user still sees the update on refresh
- live delivery tracking is incomplete
  - order thread and manual updates still carry the fulfillment state

### Why

Live coordination should be a convenience layer, not a trust dependency.

## Decision 5: Payment Must Tolerate Interrupted Journeys

### Chosen rule

Payment flows should support:

- `pending`
- `resume`
- `existing checkout reuse`
- late verification
- manual ops reconciliation when needed

### Why

Provider redirects, app backgrounding, weak signal, and device interruptions are normal enough that one-shot payment assumptions are unsafe.

## Decision 6: Local Fulfillment Fallbacks Are First-Class, Not Edge Cases

### Chosen rule

For V1, these are valid Drape fulfillment modes:

- local collection
- support-assisted local handoff
- customer-supplied fabric dropoff with support bridge if needed
- manual courier recovery when formal logistics break down

### Why

The product should respect how fulfillment actually happens, not only the cleanest digital version of it.

## Decision 7: Drape Should Not Require Perfect Addressing To Stay Useful

### Chosen rule

Shipping can use structured order data, but Drape should not silently assume:

- flawless address precision
- universal carrier quality
- perfect tracking coverage

Where shipping confidence is weak, the system should still support:

- manual clarification
- local collection
- support intervention

### Why

Logistics gaps are not rare enough to ignore.

## Decision 8: Push Notifications Are Reminders, Not Guarantees

### Chosen rule

Push should be treated as a convenience layer.

The app must still work if:

- a push never arrives
- a user comes back hours later
- the device was offline

### Why

Important work cannot depend on notification delivery quality.

## Decision 9: Degraded States Should Be Named Plainly In Product Copy

### Chosen rule

V1 should prefer explicit degraded-state language such as:

- still pending
- already completed
- refresh and try again
- continue in messages
- contact support if it does not update

Not:

- generic failure
- vague error states
- UI that implies total loss when the action may actually be in flight

### Why

Good degraded-state copy reduces panic, duplicate work, and unnecessary trust damage.

## Decision 10: Manual Ops Playbooks Are A Feature, Not An Embarrassment

### Chosen rule

For V1, ops should explicitly own manual recovery paths for:

- payment verification delays
- consultation failures
- local handoff disputes
- weak tracking visibility
- event-critical rescue cases

### Why

In brittle environments, manual recovery is part of resilience.
It should be designed, not improvised.

## Decision 11: What We Deliberately Defer

### Chosen rule

These are useful later, but not required to lock the V1 business logic:

- full offline outbox and background sync
- SMS relay or masked telephony
- multi-courier smart fallback orchestration
- automatic requeue for every mutation
- ultra-low-bandwidth media pipelines beyond current compression and light payload work

### Why

The more urgent goal is to make the core flows recoverable with the architecture Drape already has.

## Recommendation Summary

The cleanest V1 resilience posture is:

- async-first
- order-record-first
- retry-safe
- payment-resumable
- local-fulfillment-friendly
- manual-fallback-capable
- explicit about degraded states

That is a better business posture for Drape than quietly assuming world-class infrastructure everywhere.

## Sources

- [GSMA: Closing the usage gap remains the central challenge](https://www.gsma.com/newsroom/press-release/gsma-calls-for-renewed-focus-on-closing-the-usage-gap-as-more-than-3-billion-people-remain-offline-despite-available-mobile-internet-services/)
- [GSMA: The State of Mobile Internet Connectivity 2025 overview](https://www.gsmaintelligence.com/research/the-state-of-mobile-internet-connectivity-2025-overview-report)
- [GSMA: The State of the Industry Report on Mobile Money 2025](https://www.gsma.com/solutions-and-impact/connectivity-for-good/mobile-for-development/wp-content/uploads/2025/04/The-State-of-the-Industry-Report-2025_English.pdf)
- [World Bank: Financial Inclusion in Sub-Saharan Africa overview](https://www.worldbank.org/en/publication/globalfindex/brief/financial-inclusion-in-sub-saharan-africa-overview.print)
- [World Bank: Mission 300 and electricity resilience in Africa](https://blogs.worldbank.org/en/climatechange/connecting-300-million-people-to-electricity-and-building-a-resilient-future-in-africa)
- [IMF Finance & Development: Going the Last Mile](https://www.imf.org/Publications/fandd/issues/2021/12/Last-Mile-Improving-Sub-Saharan-Africa-Vaccine-Access-Bempong-Munemo)
