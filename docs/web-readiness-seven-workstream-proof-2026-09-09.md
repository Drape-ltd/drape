# Web readiness: seven-workstream development proof

**Verified:** September 9, 2026
**Environment:** Supabase development `pqptfuqogvrajozfsqzi`, authenticated web at `localhost:3004`
**Cross-role fixture:** custom order `DRPT38DKB` (`29f2461d-013c-421e-816e-b55499c820e7`)

This record distinguishes live development proof from production readiness. No production database migration, Edge deployment, payment, payout, or provider configuration was changed by this pass.

## Outcome matrix

| Workstream | Development outcome | Evidence |
| --- | --- | --- |
| Fulfilment replacement | Passed | The audit trail contains pickup → local delivery, retirement of the pickup credential, recovery to pickup with a fresh credential, a second local-delivery request, and retirement of that credential. The final order is `COMPLETE`, uses `LOCAL_DELIVERY`, and has no active collection code. |
| Fulfilment payment | Passed | The NGN 1,000 `FULFILLMENT` payment is distinct from initial and consultation payments. The phase-specific checkout route shows a durable paid receipt and ledger entry and offers no duplicate payment action. Delivery charges do not appear as tailor earnings. |
| Notifications and email worker | Passed in development | The hardened worker was deployed and accepted a targeted completed job as an idempotent no-op. Settlement jobs have terminal outcomes with one attempt: push is delivered or explicitly skipped for no token; Resend records `ACCEPTED` with provider IDs. `ACCEPTED` is not claimed as inbox delivery. Customer and tailor release alerts persist in the in-app inbox and deep-link to the exact order. |
| Handoff support | Passed | The completed order is unavailable to the active-handoff form. The form offers only an eligible collected order, while general support can still retain the completed order as context. |
| Web voice notes | Passed | Tailor web recorded, sent, persisted, and played an `.m4a` `VOICE` message using the same path/type/duration contract as mobile. Browser errors distinguish permission denied, missing device, busy device, unsupported encoder, and unknown failure. Duration now comes from decoded samples, avoiding Chromium MP4 timeline offsets. |
| Production dependency graph | Passed for web/shared/database | `sharp` is `0.35.4`, web/Next `postcss` is `8.5.23`, and patched overrides cover `deepmerge-ts`, `effect`, and `defu` in Prisma tooling. The filtered production audit for `apps__web`, `packages__shared`, and `packages__db` returns no advisories. Workspace-wide Expo/tooling advisories remain a separate mobile dependency-upgrade concern. |
| Clients/Diary and Vision | Passed within launch scope | Clients opens the latest platform order. Diary create, persisted reload, edit, and delete passed; the disposable record was removed. Contact fields remain intentionally blocked. Vision capture remains native-mobile-only per the Vision runbook; web subscribes to shared profile/scan rows, renders status/confidence, and supports manual profiles. This account has zero real Vision scans, so a live scan-to-web sync was not claimed. |

## Adjacent repairs

- Completed orders no longer offer consultation rescheduling or make-up actions; attendance history remains visible.
- Settlement releases always create durable customer and tailor inbox records, even when a device has no push token.
- Tailor navigation contract includes Clients.
- The repository completion rules require an authenticated in-app browser pass for every web change.

## Verification gates

- Optimized Next.js production build: passed.
- Responsive Playwright suite: 33 passed across 375 px, 768 px, and 1440 px projects.
- Focused shared contracts: 98 passed.
- Focused Edge payment/recovery contracts: 17 passed.
- Voice-recording failure contracts: 4 passed.
- Vision measurement merge/conflict contracts: 13 passed.
- Web TypeScript and Prisma client generation: passed.
- Development migration dry run: remote database is up to date.
- Development database lint: no new migration blocker; existing warnings remain in `extensions.index_advisor`, `initialize_order_settlement_plan`, and `derive_order_residual_settlement`.

## Production promotion boundary

Before production, review the exact pending migration batch (maximum five), deploy the corresponding Edge versions, verify secrets/provider callbacks, rerun the production synthetic path, and record production queue/provider outcomes. Development evidence does not substitute for that promotion proof.

## September 10 acquisition and auth addendum

The final public-entry pass was verified against Supabase development and the live local web application. It did not promote any change to production.

- New-device sign-in verification sends a six-digit email code, records the challenge, and can remember a revocable server-issued device token. The remembered-device path and device listing were proved with a real development email.
- Password-reset completion revokes remembered devices and queues the custom audited security notification. Recovery and security mail now use branded Drapeon templates in development; the SMTP sender display name remains a provider-admin configuration item.
- All public tailor acquisition routes point to the real `/sign-up?role=TAILOR` onboarding. The public page explains the same four studio sections rendered by signup, including portfolio media, fulfilment, consultation rules, and the private randomized challenge video.
- Public Explore returns only approved production-safe marketplace profiles. Development QA profiles were excluded at the authoritative read boundary and the visible directory was checked live.
- The tailor recruitment page was visually inspected in the in-app browser and its primary action was followed into the real signup. Responsive automation covers the page and signup at 375 px, 768 px, and 1440 px.
- Final web regression: 54 Playwright checks passed across all three viewport projects. Web TypeScript and `git diff --check` passed.

Remaining proof boundaries: a real password mutation through the signed recovery link was intentionally not performed on the user account during this pass; production provider configuration, production Edge deployment, production migrations, and a physical mobile-device pass remain separate release gates.
