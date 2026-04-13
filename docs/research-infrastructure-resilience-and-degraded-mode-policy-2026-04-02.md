# Research Notes: Infrastructure Resilience, African Operations, And Degraded-Mode Policy

Date: April 2, 2026

## Why This Exists

One of the easiest ways to build the wrong version of Drape is to assume:

- stable power
- stable data
- high-end devices
- reliable courier networks
- precise street addressing
- instant provider callbacks

That assumption breaks a lot of otherwise good products in African markets.

This note is the research layer for the opposite stance:

- Drape should be trustworthy even when infrastructure is uneven

## High-Signal Takeaways

- Coverage is not the same as reliable usage.
- Drape should be async-first, not live-first.
- Electricity and device constraints are product constraints, not background context.
- Digital payments are growing fast, but cash, agent networks, and interrupted payment journeys are still normal.
- Last-mile logistics are still messy enough that local collection, local handoff, and manual support bridges should be treated as legitimate product paths.
- In this environment, recoverability matters more than elegance.

## 1. Connectivity Reality: Usage Gap Matters More Than Coverage Alone

GSMA’s 2025 mobile internet connectivity reporting continues to make the same core point:

- the usage gap is much bigger than the coverage gap
- Sub-Saharan Africa remains the least connected region
- barriers are not only network coverage
- barriers also include affordability, skills, safety concerns, low-end devices, and access to enablers like consistent electricity

Important Drape takeaway:

- “the customer has coverage” does not mean “the customer can reliably complete a call, upload photos, stay in a checkout flow, or get every push notification in time”

This pushes Drape toward:

- lighter flows
- retry-safe flows
- refreshable state
- fewer assumptions about both parties being online together

## 2. Power Reliability Is A Real Business Constraint

World Bank material on Africa’s power gap is a reminder that unreliable electricity is still not an edge case.

Important current signal:

- nearly 600 million people in Sub-Saharan Africa still live without electricity
- unreliable electricity and frequent interruptions still hurt firms and productivity
- off-grid and backup approaches remain part of the practical operating reality

Important Drape takeaway:

- missed calls, delayed uploads, dropped sessions, and delayed responses should be treated as expected conditions
- a call failure should not collapse an order
- a delayed confirmation should not automatically look like user irresponsibility

## 3. Payment Reality: Digital Growth And Cash Reality Coexist

The World Bank’s recent Sub-Saharan Africa Findex overview and GSMA’s mobile money reporting tell a useful combined story.

The current pattern is:

- digital payments are increasingly common
- mobile money is deeply important in Sub-Saharan Africa
- millions of adults still receive or make common payments in cash
- lack of documentation, lack of phones, distance, and cost still block access
- local agents remain important because they support low-denomination, high-frequency, and cash-in / cash-out behavior

GSMA’s 2025 mobile money report is especially relevant here:

- Sub-Saharan Africa remains the epicenter of mobile money
- agent growth is still heavily concentrated there
- agents remain essential for deposits, transactions, and troubleshooting

Important Drape takeaway:

- Drape should not behave like every customer has frictionless, uninterrupted, card-native checkout behavior
- payment needs pending states, resume states, verification, and manual reconciliation paths
- support for Africa should mean resilience around payment interruption, not only adding another provider

## 4. Logistics Reality: Last-Mile Reliability Is Still Uneven

The logistics signal is also clear.

IMF analysis drawing on the World Bank Logistics Performance Index notes that:

- Africa’s average logistics performance is still weak
- the region trails other major regions on categories including timeliness and tracking
- last-mile delivery problems are not abstract; they show up in real service delivery outcomes

Important Drape takeaway:

- local collection is not a fallback to be embarrassed by
- support-mediated handoff is not a product failure
- perfect door-to-door logistics should not be a hidden requirement for Drape success

This is especially important for:

- customer-supplied fabric
- local pickup
- delivered ready-made orders
- event-sensitive orders where courier slippage matters

## 5. What Drape Already Does Well

The repo already points in the right direction.

### Consultation fallback

In `apps/mobile/lib/consultation.ts`, consultation failures already degrade into retry or message-based recovery instead of treating live calling as the only path.

### Payment resume and pending logic

In `supabase/functions/payment-action/index.ts`, the payment flow already supports:

- pending states
- existing checkout reuse
- provider verification
- confirmation after return

That is the right architecture for interruption-prone environments.

### Retry-safe order actions

In `supabase/functions/tailor-order-action/index.ts`, some non-destructive order actions are already idempotent.

That matters because weak connectivity often produces duplicate taps, timeouts, and ambiguous client state.

### Offline-to-online relationship bridge

The tailor diary and passport flow already preserves offline relationship context:

- offline measurement memory
- later passport claim
- later merge into a live customer profile

That is one of the strongest signals in the product that Drape does not need to force every relationship to begin online.

### Launch blocker language already acknowledges this

`docs/v1-launch-blockers.md` already says:

- critical flows must stay usable on weak networks
- non-destructive actions should be retry-safe
- messaging and refresh should degrade gracefully
- manual fallback is valid in V1

So the product instinct is already right.
This note simply makes the business rule explicit.

## 6. What This Means For Drape’s Product Shape

### Async-first beats live-first

The canonical customer-tailor relationship should work through:

- the order thread
- staged updates
- resumable payment
- clear timestamps

Not through:

- perfect real-time presence
- video-first coordination
- push-notification dependency

### Recovery beats one-shot completion

The right question is often not:

- did the action succeed instantly

It is:

- can the user safely recover if it did not look like it succeeded

### Local operational modes should stay first-class

Drape should continue to treat these as valid:

- local collection
- local fabric handoff
- support-assisted bridging
- manual ops intervention

These are not merely stopgaps for bad systems.
They are legitimate resilience tools in the market Drape wants to serve.

### Structured proof matters more under weak infrastructure

When delivery, coordination, or messaging is fragile, Drape benefits from having:

- order stages
- timestamps
- collection codes
- tracking numbers when available
- audit logs
- support-visible context

That becomes the trust layer when infrastructure is inconsistent.

## 7. What Drape Should Avoid Assuming

For V1, Drape should avoid building core flows that assume:

- stable electricity during a consultation window
- every customer can stay inside a hosted checkout uninterrupted
- high-confidence street addressing
- perfect courier pickup and tracking coverage
- guaranteed push delivery
- simultaneous availability across customer, tailor, and ops

## 8. Strong V1 Working Direction

The cleanest resilience posture for Drape is:

- async-first
- retry-safe
- resumable
- manual-fallback-friendly
- local-fulfillment-friendly
- explicit about degraded states

That is the better fit for African operating reality than a more polished but brittle “everything happens live and instantly” product.

## Sources

- [GSMA: Closing the usage gap remains the central challenge](https://www.gsma.com/newsroom/press-release/gsma-calls-for-renewed-focus-on-closing-the-usage-gap-as-more-than-3-billion-people-remain-offline-despite-available-mobile-internet-services/)
- [GSMA: The State of Mobile Internet Connectivity 2025 overview](https://www.gsmaintelligence.com/research/the-state-of-mobile-internet-connectivity-2025-overview-report)
- [GSMA: The State of the Industry Report on Mobile Money 2025](https://www.gsma.com/solutions-and-impact/connectivity-for-good/mobile-for-development/wp-content/uploads/2025/04/The-State-of-the-Industry-Report-2025_English.pdf)
- [World Bank: Financial Inclusion in Sub-Saharan Africa overview](https://www.worldbank.org/en/publication/globalfindex/brief/financial-inclusion-in-sub-saharan-africa-overview.print)
- [World Bank: Mission 300 and electricity resilience in Africa](https://blogs.worldbank.org/en/climatechange/connecting-300-million-people-to-electricity-and-building-a-resilient-future-in-africa)
- [IMF Finance & Development: Going the Last Mile](https://www.imf.org/Publications/fandd/issues/2021/12/Last-Mile-Improving-Sub-Saharan-Africa-Vaccine-Access-Bempong-Munemo)
