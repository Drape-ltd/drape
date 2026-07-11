# Web/Mobile Order Lifecycle Parity Investigation

Last updated: 2026-07-09

## Bottom Line

The web order lifecycle now matches the mobile app for the customer and tailor actions that are backed by the current Edge Function contracts, with one explicit remaining surface gap:

- Remaining gap: mobile exposes Drapeon Vision garment QC and saves `tailor-order-action` `save-garment-qc`; web does not yet expose an equivalent manual or vision QC panel.
- Edge-constrained mismatch, not a web gap: mobile still contains some fulfillment metadata UI paths for `SHIPPED` and `OUT_FOR_DELIVERY` inside its generic stage modal, but `tailor-order-action` only accepts tailor `advance-stage` targets through `READY_FOR_DRAPE_DISPATCH` or `READY_FOR_COLLECTION`. The shared state machine marks `SHIPPED` and `OUT_FOR_DELIVERY` as platform/system/customer transitions, so web correctly avoids tailor advancement to those stages.

The main bug found in this pass was paired scope-change parity:

- Customer web could respond to tailor scope changes, but could not request or cancel its own scope change.
- Tailor web could request scope changes, but could not accept, decline, or cancel open customer/tailor scope changes.

Those web gaps are now wired in `apps/web/components/account-app-surface.tsx`.

## Source Set

Primary web surface:

- `apps/web/components/account-app-surface.tsx`

Mobile comparison surfaces:

- `apps/mobile/app/(tailor)/orders/[id].tsx`
- `apps/mobile/app/(customer)/orders/[id].tsx`
- `apps/mobile/components/drapeVision/NativeDrapeVisionScreen.tsx`

Backend contract sources:

- `supabase/functions/tailor-order-action/index.ts`
- `supabase/functions/customer-order-action/index.ts`
- `supabase/functions/payment-action/index.ts`
- `supabase/functions/material-advance-action/index.ts`
- `packages/shared/src/order-machine.ts`

## Methodology

1. Treat Edge Function schemas and stage gates as the source of truth.
2. Compare every mobile order action dispatch against the web order detail/work surfaces.
3. Verify web gating against Edge `VALID_FROM`, `targetStage`, and support metadata ownership rules.
4. Keep mobile-only native capabilities separate from web lifecycle gaps.
5. Prefer existing web helpers and Edge Function actions; do not invent backend actions.
6. Record evidence anchors so this file can be updated during future confirmation passes.

## Contract Constraints

### Tailor Edge Contract

`tailor-order-action` currently accepts these lifecycle actions:

- `send-quote`
- `decline-order`
- `request-consultation`
- `approve-consultation`
- `decline-consultation-request`
- `request-fulfillment-payment`
- `advance-stage`
- `confirm-collection`
- `request-measurement-confirmation`
- `confirm-fit-readiness`
- `request-style-alignment`
- `confirm-fabric-received`
- `save-garment-qc`
- `request-scope-change`
- `respond-scope-change`
- `open-material-issue`
- `request-cancellation-review`
- `request-delivery-review`

Important contract notes:

- `advance-stage` only accepts `DESIGNING`, `SOURCING`, `CUTTING`, `SEWING`, `FINISHING`, `READY_FOR_COLLECTION`, and `READY_FOR_DRAPE_DISPATCH`.
- `advance-stage` accepts dispatch metadata: `trackingNumber`, `carrier`, `fulfillmentProvider`, `fulfillmentReference`, `fulfillmentContactName`, and `fulfillmentContactPhone`.
- `confirm-collection` requires a 4-digit pickup code.
- `request-fulfillment-payment` currently returns a 409 response saying standard delivery and shipping are Drape-managed and included at checkout. It should not be exposed as an active web action.
- `save-garment-qc` is real and accepted by the Edge Function, but is still only surfaced by mobile Drapeon Vision.

Evidence:

- `supabase/functions/tailor-order-action/index.ts:114` starts the tailor body schema.
- `supabase/functions/tailor-order-action/index.ts:181` defines valid `advance-stage` targets and dispatch metadata.
- `supabase/functions/tailor-order-action/index.ts:193` defines `confirm-collection`.
- `supabase/functions/tailor-order-action/index.ts:222` defines `save-garment-qc`.
- `supabase/functions/tailor-order-action/index.ts:238` defines `request-scope-change` and `respond-scope-change`.
- `supabase/functions/tailor-order-action/index.ts:2068` shows `request-fulfillment-payment` is deprecated/blocked.

### Customer Edge Contract

`customer-order-action` currently accepts these lifecycle actions:

- `confirm-receipt`
- `open-dispute`
- `accept-quote`
- `decline-quote`
- `complete-order`
- `save-fabric-tracking`
- `approve-sourced-fabric`
- `request-sourced-fabric-change`
- `approve-style-alignment`
- `request-style-alignment-change`
- `confirm-measurements`
- `respond-material-issue`
- `cancel-order`
- `request-cancellation-review`
- `request-delivery-review`
- `request-aftercare-support`
- `request-emergency-support`
- `request-consultation`
- `request-scope-change`
- `respond-scope-change`

Important contract notes:

- Scope change actions are valid from `PENDING_QUOTE`, `CONSULTATION`, `QUOTE_SENT`, `PAYMENT_PENDING`, `CONFIRMED`, `DESIGNING`, `SOURCING`, `CUTTING`, `SEWING`, `FINISHING`, `READY_FOR_COLLECTION`, and `READY_FOR_DRAPE_DISPATCH`.
- Style alignment, sourced fabric, measurement confirmation, and material issue responses are pre-cutting actions.
- Receipt confirmation is valid from `SHIPPED` and `OUT_FOR_DELIVERY`.
- Completion is valid from `DELIVERED` and `COLLECTED`.
- Cancellation and delivery reviews have their own stage-specific review windows.

Evidence:

- `supabase/functions/customer-order-action/index.ts:57` defines the customer body schema.
- `supabase/functions/customer-order-action/index.ts:190` defines pre-cutting and scope-change stage sets.
- `supabase/functions/customer-order-action/index.ts:211` defines the customer `VALID_FROM` matrix.

### Shared State Machine

The shared order machine confirms that:

- Tailors move production through `DESIGNING`, `SOURCING`, `CUTTING`, `SEWING`, `FINISHING`, `READY_FOR_COLLECTION`, and `READY_FOR_DRAPE_DISPATCH`.
- Platform/system moves Drape-managed dispatch from `READY_FOR_DRAPE_DISPATCH` to `OUT_FOR_DELIVERY` or `SHIPPED`.
- Customers confirm receipt from `OUT_FOR_DELIVERY` or `SHIPPED` into `DELIVERED`.
- Customers complete from `DELIVERED` or `COLLECTED`.

Evidence:

- `packages/shared/src/order-machine.ts:42` starts the transition matrix.
- `packages/shared/src/order-machine.ts:71` defines tailor production transitions.
- `packages/shared/src/order-machine.ts:83` defines Drape-managed dispatch transitions.
- `packages/shared/src/order-machine.ts:96` defines local collection transitions.

## Web Changes Made In This Pass

### Customer Scope-Change Parity

Web now supports:

- `request-scope-change`
- `respond-scope-change` with `ACCEPTED`
- `respond-scope-change` with `DECLINED`
- `respond-scope-change` with `CANCELLED` for customer-created open requests

Gating now matches mobile and Edge:

- Custom orders only for creating a scope change.
- `SCOPE_CHANGE_STAGES` only.
- No open scope change, cancellation review, or delivery review before creating a new scope change.
- Customer can respond only to tailor-created open scope changes.
- Customer can cancel only customer-created open scope changes.

Evidence:

- `apps/web/components/account-app-surface.tsx:3765` includes `request-scope-change` in `CustomerOrderActionName`.
- `apps/web/components/account-app-surface.tsx:3816` starts `CustomerOrderActions`.
- `apps/web/components/account-app-surface.tsx:3831` defines scope/review gating.
- `apps/web/components/account-app-surface.tsx:3991` sends customer `request-scope-change`.
- `apps/web/components/account-app-surface.tsx:4017` sends customer `respond-scope-change`.
- `apps/web/components/account-app-surface.tsx:4347` renders the customer request-change panel.
- `apps/web/components/account-app-surface.tsx:4392` renders response/cancel controls.

Mobile evidence:

- `apps/mobile/app/(customer)/orders/[id].tsx:2012` defines customer scope-change gates.
- `apps/mobile/app/(customer)/orders/[id].tsx:2140` sends customer `respond-scope-change`.
- `apps/mobile/app/(customer)/orders/[id].tsx:2981` renders customer scope-change UI.
- `apps/mobile/app/(customer)/orders/[id].tsx:4639` sends customer `request-scope-change`.

### Tailor Scope-Change Parity

Web now supports:

- `request-scope-change`
- `respond-scope-change` with `ACCEPTED` for customer-created open requests
- `respond-scope-change` with `DECLINED` for customer-created open requests
- `respond-scope-change` with `CANCELLED` for tailor-created open proposals

Gating now matches mobile and Edge:

- Custom orders only for creating a scope change.
- `SCOPE_CHANGE_STAGES` only.
- No open scope change, cancellation review, or delivery review before creating a new scope change.
- Tailor can respond only to customer-created open scope changes.
- Tailor can cancel only tailor-created open scope changes.

Evidence:

- `apps/web/components/account-app-surface.tsx:5686` starts `TailorOrderActions`.
- `apps/web/components/account-app-surface.tsx:5757` defines review and scope state.
- `apps/web/components/account-app-surface.tsx:5775` gates tailor scope-change creation/response/cancel.
- `apps/web/components/account-app-surface.tsx:6061` sends tailor `request-scope-change`.
- `apps/web/components/account-app-surface.tsx:6105` sends tailor `respond-scope-change`.
- `apps/web/components/account-app-surface.tsx:6458` renders tailor scope-change creation UI.
- `apps/web/components/account-app-surface.tsx:6516` renders tailor response/cancel UI.

Mobile evidence:

- `apps/mobile/app/(tailor)/orders/[id].tsx:1323` defines tailor scope-change gates.
- `apps/mobile/app/(tailor)/orders/[id].tsx:1443` sends tailor `respond-scope-change`.
- `apps/mobile/app/(tailor)/orders/[id].tsx:2405` renders open scope-change UI.

## Tailor Lifecycle Matrix

| Lifecycle area | Mobile action | Web action | Status |
| --- | --- | --- | --- |
| Quote | `send-quote` | `send-quote` | Matched |
| Consultation request | `request-consultation` | `request-consultation` | Matched |
| Customer consultation approval | `approve-consultation` | `approve-consultation` | Matched |
| Customer consultation rejection | `decline-consultation-request` | `decline-consultation-request` | Matched |
| Measurement gate | `request-measurement-confirmation` | `request-measurement-confirmation` | Matched |
| Fit gate | `confirm-fit-readiness` | `confirm-fit-readiness` | Matched |
| Style approval gate | `request-style-alignment` | `request-style-alignment` | Matched |
| Customer fabric receipt | `confirm-fabric-received` | `confirm-fabric-received` | Matched |
| Material issue | `open-material-issue` | `open-material-issue` | Matched |
| Tailor proposes scope change | `request-scope-change` | `request-scope-change` | Matched |
| Tailor responds to customer scope change | `respond-scope-change` | `respond-scope-change` | Matched after this pass |
| Tailor cancels own scope proposal | `respond-scope-change` with `CANCELLED` | `respond-scope-change` with `CANCELLED` | Matched after this pass |
| Decline pre-confirmed order | `decline-order` | `decline-order` | Matched |
| Production stage advance | `advance-stage` | `advance-stage` | Matched to Edge-valid targets |
| Dispatch readiness metadata | `advance-stage` body fields | `advance-stage` body fields | Matched for `READY_FOR_DRAPE_DISPATCH` |
| Local collection | `confirm-collection` with code | `confirm-collection` with code | Matched |
| Tailor cancellation review | `request-cancellation-review` | `request-cancellation-review` | Matched |
| Tailor delivery review | `request-delivery-review` | `request-delivery-review` | Matched |
| Garment QC | `save-garment-qc` through Drapeon Vision | Not exposed on web | Remaining gap |
| Fulfillment fee request | Deprecated Edge action | Not exposed on web | Correctly not exposed |

Additional web evidence:

- `apps/web/components/account-app-surface.tsx:5823` sends quote.
- `apps/web/components/account-app-surface.tsx:5839` handles consultation request/approval.
- `apps/web/components/account-app-surface.tsx:5903` centralizes tailor Edge calls.
- `apps/web/components/account-app-surface.tsx:6140` sends `decline-order`.
- `apps/web/components/account-app-surface.tsx:6151` sends `confirm-collection`.
- `apps/web/components/account-app-surface.tsx:6163` sends `request-cancellation-review`.
- `apps/web/components/account-app-surface.tsx:6179` sends `request-delivery-review`.
- `apps/web/components/account-app-surface.tsx:6215` sends dispatch metadata on stage advance.
- `apps/web/components/account-app-surface.tsx:6663` renders collection code entry.
- `apps/web/components/account-app-surface.tsx:6685` renders reviews and exceptions.

## Customer Lifecycle Matrix

| Lifecycle area | Mobile action | Web action | Status |
| --- | --- | --- | --- |
| Accept quote/payment | `payment-action` prepare/confirm path | `payment-action` prepare/confirm path | Matched |
| Decline quote | `decline-quote` | `decline-quote` | Matched |
| Request consultation | `request-consultation` | `request-consultation` | Matched |
| Confirm measurements | `confirm-measurements` | `confirm-measurements` | Matched |
| Approve style alignment | `approve-style-alignment` | `approve-style-alignment` | Matched |
| Request style change | `request-style-alignment-change` | `request-style-alignment-change` | Matched |
| Approve tailor-sourced fabric | `approve-sourced-fabric` | `approve-sourced-fabric` | Matched |
| Request sourced fabric change | `request-sourced-fabric-change` | `request-sourced-fabric-change` | Matched |
| Respond to material issue | `respond-material-issue` | `respond-material-issue` | Matched |
| Customer requests scope change | `request-scope-change` | `request-scope-change` | Matched after this pass |
| Customer responds to tailor scope change | `respond-scope-change` | `respond-scope-change` | Matched |
| Customer cancels own scope request | `respond-scope-change` with `CANCELLED` | `respond-scope-change` with `CANCELLED` | Matched after this pass |
| Self-cancel before commitment | `cancel-order` | `cancel-order` | Matched |
| Cancellation review | `request-cancellation-review` | `request-cancellation-review` | Matched |
| Delivery review | `request-delivery-review` | `request-delivery-review` | Matched |
| Receipt confirmation | `confirm-receipt` with proof photo | `confirm-receipt` with proof photo | Matched |
| Completion | `complete-order` | `complete-order` | Matched |
| Customer-supplied fabric tracking | `save-fabric-tracking` | `save-fabric-tracking` | Matched |
| Dispute/concern | `open-dispute` | `open-dispute` | Matched |
| Aftercare | `request-aftercare-support` | `request-aftercare-support` | Matched |
| Emergency support | `request-emergency-support` | `request-emergency-support` | Matched |
| Material advance approval/payment | `material-advance-action` | `material-advance-action` | Matched |
| Fulfillment fee payment | `payment-action` when order is payable | `payment-action` when order is payable | Matched |

Additional web evidence:

- `apps/web/components/account-app-surface.tsx:1729` includes payable fulfillment fee cases.
- `apps/web/components/account-app-surface.tsx:3639` starts order payment with `payment-action`.
- `apps/web/components/account-app-surface.tsx:3744` confirms Stripe order payment.
- `apps/web/components/account-app-surface.tsx:3921` sends `confirm-measurements`.
- `apps/web/components/account-app-surface.tsx:3924` sends style alignment decisions.
- `apps/web/components/account-app-surface.tsx:3945` sends sourced fabric decisions.
- `apps/web/components/account-app-surface.tsx:3976` sends material issue response.
- `apps/web/components/account-app-surface.tsx:4095` sends `open-dispute`.
- `apps/web/components/account-app-surface.tsx:4122` sends `confirm-receipt`.
- `apps/web/components/account-app-surface.tsx:4139` sends `complete-order`.
- `apps/web/components/account-app-surface.tsx:4156` sends aftercare support.
- `apps/web/components/account-app-surface.tsx:4177` sends emergency support.
- `apps/web/components/account-app-surface.tsx:4198` sends fabric tracking.
- `apps/web/components/account-app-surface.tsx:6879` starts material advance payment.
- `apps/web/components/account-app-surface.tsx:6991` confirms material advance payment.

## Realtime Sync Readiness

Before the Realtime sync pass:

- Mobile customer order detail subscribed to `orders`, `custom_order_details`, and `order_stage_updates`, then performed a silent refetch on changes.
- Mobile tailor order detail subscribed to `orders`, `custom_order_details`, and `order_stage_updates`, then performed a silent refetch on changes.
- Web messages subscribed to `messages` and `message_reactions`.
- Web order lifecycle surfaces refreshed after web-originated actions, but did not subscribe to app-originated order lifecycle changes.

Web now has order lifecycle Realtime triggers at the account surface level:

- Surfaces covered: `orders`, `order-detail`, `work`, and `checkout`.
- Parent order rows: watched by `id` on order detail, by `customer_id` on customer-facing lists/checkout, and by `tailor_id`/`tailor_profile_id` on tailor-facing lists/work.
- Order detail child tables watched for the open order id:
  - `custom_order_details`
  - `messages`
  - `order_material_advances`
  - `order_payments`
  - `order_production_evidence`
  - `order_stage_updates`
  - `reviews`
- Checkout watches `order_payments` for currently visible checkout order ids.
- Orders/work list surfaces intentionally rely on parent `orders` row changes to avoid registering heavy child-table subscriptions across the full list.
- Realtime events are trigger-only. Web still debounces and calls the existing surface fetchers, so normalization, RLS, and warning behavior stay in the existing data path.

Expected behavior for desk testing:

- If mobile performs a lifecycle action while the web order detail is open, web should refresh the order detail within roughly one second after the database event arrives.
- If web performs a lifecycle action while mobile order detail is open, mobile should refresh through its existing Realtime listener or its one-minute fallback poll.
- If mobile creates a new customer order while web is on the orders or checkout list, web should refresh from the parent `orders` insert/update listener.
- If mobile updates an order already visible in the web work queue, web should refresh from parent `orders` row changes.
- Messages already had web Realtime handling on the messages surface; order-detail pages now also use order-level refresh triggers when message rows change for that order.

Evidence:

- `apps/mobile/app/(customer)/orders/[id].tsx:1246` subscribes customer order detail to Realtime.
- `apps/mobile/app/(tailor)/orders/[id].tsx:1093` subscribes tailor order detail to Realtime.
- `apps/web/components/account-app-surface.tsx:79` defines the web order Realtime surfaces and watched child tables.
- `apps/web/components/account-app-surface.tsx:12133` derives the currently visible order ids.
- `apps/web/components/account-app-surface.tsx:12212` subscribes web order lifecycle surfaces to Realtime.
- `apps/web/components/account-app-surface.tsx:12232` registers Realtime table/filter handlers.
- `apps/web/components/account-app-surface.tsx:12260` starts the web Realtime channel.

Remaining Realtime caveats:

- Realtime depends on Supabase publication/RLS behavior for each table; if a table is not published, the fallback is still a manual refresh or mobile's one-minute polling on native order detail.
- The web implementation intentionally refetches instead of locally patching rows, so it is slightly less instant than optimistic local state but much safer for parity.
- Browser tab sleep/background throttling can delay web refresh timers; keep the web tab focused for the side-by-side test.

## Remaining Gap Detail: Garment QC

Mobile Drapeon Vision garment QC supports:

- A dedicated `garment_qc` flow.
- Garment measurements for fields including chest, waist, hips, shoulder width, sleeve length, back length, under bust, inseam, outseam, bicep, wrist, and headwear fields.
- Checklist flags: `seamsSecure`, `measurementsChecked`, `photoAttached`, and `readyForHandoff`.
- Optional proof photo upload to `order-photos`.
- `save-garment-qc` payload with `note`, `photoUrl`, `unit`, `measurements`, `checks`, `confidence`, and `captureVersion`.

Evidence:

- `apps/mobile/app/(tailor)/orders/[id].tsx:2225` renders the Drapeon Vision garment QC card.
- `apps/mobile/components/drapeVision/NativeDrapeVisionScreen.tsx:581` defines garment QC fields.
- `apps/mobile/components/drapeVision/NativeDrapeVisionScreen.tsx:649` defines garment QC checklist keys.
- `apps/mobile/components/drapeVision/NativeDrapeVisionScreen.tsx:4325` validates and saves garment QC.
- `apps/mobile/components/drapeVision/NativeDrapeVisionScreen.tsx:4347` sends `tailor-order-action` `save-garment-qc`.
- `supabase/functions/tailor-order-action/index.ts:1402` handles `save-garment-qc` on the backend.

Recommended web parity patch if product wants 100 percent web surface parity:

- Add a progressive-disclosure "Garment QC" panel to `TailorOrderActions`.
- Gate it to active tailor orders, ideally near finishing/handoff stages unless product wants the broader Edge-permitted active-order behavior.
- Reuse `uploadPublicFile('order-photos', ...)` for optional proof photo.
- Send existing `tailor-order-action` `save-garment-qc`.
- Keep contact-leak filtering on the note.
- Use a small manual measurement grid and four checkboxes rather than trying to recreate native Drapeon Vision in the browser.

## Edge-Constrained Dispatch Note

Mobile contains metadata inputs for `SHIPPED` and `OUT_FOR_DELIVERY` in the stage modal, but the current Edge contract does not accept those as tailor `advance-stage` targets. Web only offers targets that pass both:

- `packages/shared/src/order-machine.ts` `canTransition(currentStage, targetStage, 'TAILOR')`
- `tailor-order-action` `targetStage` enum

Evidence:

- `apps/mobile/app/(tailor)/orders/[id].tsx:5039` validates fulfillment details for `SHIPPED` and `OUT_FOR_DELIVERY` in mobile stage modal code.
- `apps/mobile/app/(tailor)/orders/[id].tsx:5078` sends `advance-stage`.
- `supabase/functions/tailor-order-action/index.ts:181` rejects those targets by schema because they are not in the target enum.
- `apps/web/components/account-app-surface.tsx:1791` lists web custom tailor targets.
- `apps/web/components/account-app-surface.tsx:1812` filters web stage options through shared transition rules.

Conclusion:

- Web should not add tailor `SHIPPED` or `OUT_FOR_DELIVERY` stage advancement unless the Edge Function and shared state machine are changed first.
- The mobile code should eventually be cleaned up or constrained so it cannot present off-contract target-stage fields.

## Authenticated Web QA Runner Evidence

2026-07-10 expanded happy/negative checkpoint:

- Runner: `scripts/web-authenticated-qa-runner.mjs`.
- Command: `WEB_QA_BASE_URL=http://localhost:3001 WEB_QA_FAST_AUTH=1 WEB_QA_ENABLE_MUTATIONS=1 node scripts/web-authenticated-qa-runner.mjs`.
- Report artifact: `/private/tmp/drape-web-qa/authenticated-report.json`.
- Disposable fixture cleanup: passed with zero cleanup errors.
- Flow status: zero failed flows; guarded skip only for password reset/magic-link email smoke because `WEB_QA_ENABLE_EMAILS` is off.
- Happy paths covered:
  - authenticated customer route coverage across account surfaces
  - true tailor-role route coverage using a disposable tailor fixture
  - explore search/filter
  - measurements editor save
  - settings notification mutation
  - custom brief preflight
  - tailor detail save/unsave
  - shop item detail
  - ready-made checkout preview/create
  - payment initiation through `payment-action`
  - message text/photo sends through `message-action`
  - consultation request through `customer-order-action`
  - quote send and stage advance through `tailor-order-action`
  - support request contact-leak rejection plus support submission
  - signed-in and two-tap signed-out header state
- Negative cases covered:
  - unauthenticated account route wall
  - invalid sign-in rejection
  - measurement profile contact-leak block
  - custom brief contact-leak rejection
  - custom brief unauthenticated rejection
  - ready-made invalid quantity rejection
  - ready-made checkout cancellation-policy rejection
  - payment invalid order rejection
  - empty text message rejection
  - photo message missing-photo-url rejection
  - consultation request from an invalid stage rejection
  - zero-amount quote rejection
  - stage advance missing proof rejection
  - customer attempting tailor stage advance rejection
- Fixes found by runner expansion:
  - The web sign-in runner must wait for hydration before filling controlled inputs.
  - Local QA should use `http://localhost:3001` while the stale IPv4 `127.0.0.1:3000` process exists.
  - `payment-action` now uses `.maybeSingle()` for order lookup so unknown order IDs reach the existing 404 branch instead of returning a 500. This was deployed to the development Supabase project.
  - Header sign-out automation now matches the two-tap confirmation UI.

2026-07-10 checkpoint:

- Runner: `scripts/web-authenticated-qa-runner.mjs`.
- Command: `WEB_QA_FAST_AUTH=1 WEB_QA_ENABLE_MUTATIONS=1 node scripts/web-authenticated-qa-runner.mjs`.
- Report artifact: `/private/tmp/drape-web-qa/authenticated-report.json`.
- Disposable fixture cleanup: passed with zero cleanup errors.
- Targeted flows passed:
  - route coverage for customer account surfaces
  - explore search/filter
  - measurements editor save
  - settings notification mutation
  - custom brief preflight
  - true tailor-role authenticated route coverage with a disposable tailor login
  - tailor detail save/unsave
  - shop item detail
  - public tailor application validation
  - ready-made checkout preview/create path
  - payment initiation through `payment-action`
  - message text send and photo send through `message-action`
  - consultation request through `customer-order-action`
  - quote send through `tailor-order-action`
  - stage advance through `tailor-order-action` with disposable proof media
- Guarded skip remaining:
  - password reset/magic-link smoke, because `WEB_QA_ENABLE_EMAILS` is intentionally off. Run with `WEB_QA_ENABLE_EMAILS=1` only against a non-production email sink.

Runner fixes made during this checkpoint:

- Disposable auth users no longer send phone metadata during admin creation. Dev Auth was masking a database trigger error as a generic 500; direct REST diagnosis showed the phone normalization trigger compares `text` and `uuid` in the dev schema.
- Disposable custom order inserts now match the live dev schema by avoiding the absent `orders.description` column.
- Ready-made fixture lookup now uses `seller_items`, not the non-existent `ready_made_items` table.
- Stage advance sends unique disposable `photoUrl`, `photoUrls`, and `mediaFingerprints`, preserving the Edge Function's fresh-proof preflight instead of bypassing it.
- Shop item detail now reports `httpStatus` so the flow status remains `passed`.

## Live Device QA Readiness

2026-07-10 checkpoint:

- Web dev server is listening on `http://127.0.0.1:3000`.
- Metro/mobile dev server is listening on `http://localhost:8081`.
- Pixel `38271FDJH0030C` is authorized and signed in as the customer test account.
- Pixel currently shows customer order detail/list data for existing active QA orders.
- Samsung `R5GL40FWHQR` is still `unauthorized`; accept the USB debugging prompt on that device before using it as the tailor phone.
- Until the Samsung is authorized, true two-phone app/web real-time lifecycle confirmation is blocked. Web/tailor browser and Pixel/customer app can still be used for one-sided live observation.

Realtime fix evidence:

- Browser CSP now allows `wss://*.supabase.co`, so Supabase Realtime sockets are no longer blocked by `connect-src`.

## Verification

Commands run after the scope-change parity and Realtime sync patches:

- `pnpm --filter @drape/web typecheck`: passed.
- `pnpm --filter @drape/web lint`: passed. The earlier six `@next/next/no-img-element` warnings in `account-app-surface.tsx` are no longer present in the latest lint run; only the Babel deoptimization note for the very large generated web component appeared.
- `git diff --check`: passed.

Run these again after future code or doc edits.

## Next Manual Confirmation Checklist

Use disposable dev fixtures and record each result here:

- Customer requests a scope change on web; tailor accepts on web; mobile shows closed/accepted scope metadata.
- Customer requests a scope change on web; tailor declines on web; mobile shows closed/declined scope metadata.
- Customer requests a scope change on web; customer cancels on web; mobile shows cancelled metadata.
- Tailor requests a scope change on web; customer accepts on web; mobile shows closed/accepted scope metadata.
- Tailor requests a scope change on web; customer declines on web; mobile shows closed/declined scope metadata.
- Tailor requests a scope change on web; tailor cancels on web; mobile shows cancelled metadata.
- Tailor advances a non-local order from `FINISHING` to `READY_FOR_DRAPE_DISPATCH` on web with dispatch metadata and proof media.
- Tailor advances a local pickup order from `FINISHING` to `READY_FOR_COLLECTION` on web, then confirms collection with the customer pickup code.
- Customer confirms receipt from `SHIPPED` or `OUT_FOR_DELIVERY` on web with proof photo.
- Customer completes from `DELIVERED` or `COLLECTED` on web.
- With web order detail open, perform one mobile customer lifecycle action and confirm web refreshes without manual reload.
- With mobile order detail open, perform one web tailor lifecycle action and confirm mobile refreshes without manual pull-to-refresh.
- With web work queue open, perform one mobile customer response and confirm the work queue updates without manual reload.
- With web checkout/orders list open, create or update a customer order from mobile and confirm the list refreshes.
- Decide whether to add web `save-garment-qc` or explicitly mark it native/mobile-only for launch.
