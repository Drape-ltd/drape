# Drapeon Release-Day Feature Gate Audit

Date: 2026-08-31

## Launch rule

A customer-visible feature may ship only when its initiating UI, authoritative
transition, counterpart state, Ops path, communications, recovery behavior, and
real-device path have been proven together. Otherwise it must fail closed and
remain absent from launch UI. Existing records must remain readable.

## Decisions

| Surface | Launch decision | Evidence and required action |
| --- | --- | --- |
| Group orders | **Hidden and server-blocked** | The V1 order checklist and V1.1 backlog explicitly defer the full group-order engine. Mobile and web creation are now controlled by default-off flags; `custom-order-action` independently rejects new group preflight/create requests unless its server flag is explicitly enabled. Existing orders and invites remain readable. |
| Android health/activity tracking | **Must not ship in the next artifact** | Drapeon has no health feature. `expo-sensors` contributed `ACTIVITY_RECOGNITION`; Expo config now blocks it. Confirm the merged manifest in the next AAB before completing Play's Health declaration. |
| Drapeon Vision Fit 360 | **Keep only after release-device proof** | This is the only specialist mode presented as available cross-platform. The Vision regression runbook requires fresh native artifacts and physical-device passes. |
| Unavailable Vision specialist modes | **Hidden in code; device pass pending** | The hub, result follow-ups, and “scan another” surfaces now use one platform-availability filter. Android exposes Fit 360 only when its independent live-scan gate passes and hides unavailable specialist modes. Stale unavailable mode state returns to the hub. Preserve the dormant implementations until individually proven. |
| Multi-tailor checkout | **Do not expose** | The data, fee grouping, stock failure, dispute, refund, and Ops settlement model is explicitly deferred to V1.1. No customer launch entry point was found in this audit. |
| Rewards, sweepstakes, purchased credits, transferable balances, gift cards, affiliate payouts | **Keep disabled** | Shared commercial feature flags are false and tests assert the high-risk programs remain disabled. Controlled order-level benefits may remain internal/ops-owned. |
| Premium/same-day dispatch | **Ops-only exception** | V1.1 documents customer-facing premium dispatch as deferred. Do not advertise an automated guarantee. Existing service-level values may remain for Ops/manual fulfillment records. |
| Live carrier integrations | **Manual tracking only** | Deep carrier automation is deferred. A saved carrier and tracking number may be shown, but the product must not promise live map tracking or automatic carrier recovery. |
| Paystack-dependent payments and payouts | **Unavailable until provider readiness** | Do not advertise the rail as live. UI must continue showing an explicit unavailable state and must not create a payable order on an unready provider. |
| ZIP tax calculation | **Unavailable until configured** | Do not advertise automatic tax coverage for unsupported corridors. It may remain outside the reviewer path while payments are unavailable, but production checkout must fail closed rather than estimate silently. |
| SMS fallback | **Do not claim as delivered** | Push has device proof. SMS remains an operational dependency until provider credentials and a real terminal delivery outcome are verified. |

## Group-order gate contract

- Mobile build flag: `EXPO_PUBLIC_GROUP_ORDERS_V1`; explicitly `false` in every
  EAS profile.
- Web build flag: `NEXT_PUBLIC_GROUP_ORDERS_V1`; absent/false means hidden.
- Edge flag: `GROUP_ORDERS_V1`; absent/false means preflight and creation return
  `GROUP_ORDERS_NOT_AVAILABLE`.
- Enabling the UI flags without the Edge flag cannot create a group order.
- Enabling the Edge flag without the UI flags does not expose a customer entry
  point.
- Re-enablement requires cross-role workflow proof, not only setting flags.

## Verification completed in this change

- Mobile TypeScript check passed.
- Web TypeScript check passed.
- Mobile build-profile parity check passed and asserts group orders are false in
  development, device development, preview, TestFlight, and production.
- `git diff --check` passed.

## Still required

- No new build or deployment was made.
- Exercise mobile and web custom brief creation and confirm only one-person and
  named-other wearers remain available.
- Invoke development `custom-order-action` with a synthetic group payload and
  preserve the `409 GROUP_ORDERS_NOT_AVAILABLE` response.
- Inspect the next release AAB merged manifest and confirm
  `ACTIVITY_RECOGNITION` is absent.
- Read the Vision regression runbook before hiding unavailable specialist modes,
  then run the required physical-device checks.
