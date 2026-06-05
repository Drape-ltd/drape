# Drape Product Cycle Scope Ledger

Last updated: 2026-05-25

This is the product memory ledger for the real-life cycles discussed during launch hardening. If a cycle is not fully built, it must still live here with a status, owner surface, and launch decision so it does not get lost.

## Status Key

- `BUILT`: implemented in app/server and ready for QA.
- `PARTIAL`: some model, copy, runbook, or UI support exists, but the full cycle is not complete.
- `RUNBOOK`: covered in help, trust, ops, or guide language only.
- `BACKLOG`: not built yet.
- `DEFER`: intentionally post-launch unless repeated incidents prove otherwise.

## Launch Critical

| Cycle | Status | Launch Decision | Notes |
| --- | --- | --- | --- |
| Scope change, rework, and amendments | BUILT | Launch with it | Customer/tailor can request or propose a formal custom-order change, accept/decline/cancel, write timeline, notify other party, and flag ops when price/deadline or late-stage risk exists. |
| Payment worked but app still says pending | PARTIAL | Launch blocker QA | Stripe app/API confirmation works in dev for fresh ready-made delivery and shipping orders. Final Stripe webhook signature verification is a prod/test preflight gate: align the active Workbench endpoint `whsec_...` with Supabase Edge secrets and confirm `signature_valid = true`. |
| Payout 72-hour release | PARTIAL | Launch blocker QA | Release guard exists; verify eligible completed test order and Paystack live-readiness separately. |
| Android push/FCM | PARTIAL | Launch blocker QA | FCM key was added; verify real push on Pixel/A17 after payment, stage update, message, consultation reminder. |
| Contact bypass and off-platform movement | PARTIAL | Launch with strict monitoring | Message/order notes filter phone/email/social attempts in key paths; media/off-platform screenshots remain ops-reviewed, not automated. |
| Consultation call cycle | PARTIAL | Launch if QA passes | Scheduling, paid/free terms, reminders, calls, fallback to messages, and no-show policy exist in pieces; verify end-to-end on both phones. |
| Delivery/shipping checkout totals | PARTIAL | Launch blocker QA | Pickup was tested. Delivery/shipping custom and ready-made payments still need full amount/payout/earnings verification. |
| Ready-made order clarity | PARTIAL | Launch blocker polish | We reduced some unrelated custom-order noise; ready-made order detail still needs final QA for only relevant handoff, payment, delivery, and aftercare info. |
| Order screens information load | PARTIAL | Launch polish | Customer side has been quieted; tailor side still needs a final pass to keep cards actionable and stage-specific. |
| Ops workflow issue actions | PARTIAL | Launch blocker QA | Refund action worked once; email-customer action did not appear to deliver and needs verification. |
| Customer delivery confirmation separate from courier scan | PARTIAL | Launch with current confirmation, improve next | Confirmation copy now warns not to confirm until the customer/recipient has physically inspected the garment. Receipt photo requirement for high-risk delivery is not fully built. |
| Aftercare and fit/finish issue reporting | BUILT/PARTIAL | Launch with it | Aftercare flow exists; strengthen photo evidence and remedy ladder as QA exposes gaps. |
| Fabric approval before cutting | BUILT/PARTIAL | Launch with it | Cutting is blocked for tailor-sourced fabric until customer approval in key path; keep QAing edge states. |
| Tailor production stage evidence | PARTIAL | Launch blocker QA | Photos and videos are supported in stage media, but capture quality guidance and display/cropping need final QA. |

## Next Product Cycles To Build

| Cycle | Status | Priority | Scope |
| --- | --- | --- | --- |
| Named measurement profiles | BUILT/PARTIAL | P0 next | Added durable `customer_measurement_profiles`; current measurement saves and claimed tailor passports now create reusable named profiles. Full profile picker UI across every order path is still next. |
| Gift orders | PARTIAL | P0 next | Custom order brief can now separate buyer from wearer; ready-made checkout already separates recipient. Full buyer/wearer/recipient order model still needed for saved family profiles. |
| Group orders / Aso-Ebi | BUILT/PARTIAL | P0 next | Group custom orders capture recipient count, optional member names, single-payer policy, measurement privacy, persist `order_group_members`, show order-owner invite controls, and let invitees accept with a named measurement profile. Full multi-order event dashboard remains later. |
| Linked event orders | BACKLOG | P1 | Group multiple orders under one event/deadline, potentially across multiple tailors. Ops sees dependency risk. |
| Order version compatibility | PARTIAL | P1 | New custom and ready-made orders now stamp an order contract version in support metadata so future app releases can render old orders intentionally. Future migrations should branch on this version instead of guessing. |
| Style interpretation confirmation | BUILT | Launch with it | Tailor can request style approval, customer can approve or request correction, and cutting is blocked server-side until the style interpretation is approved or marked not required. |
| Fabric/material advance | BUILT/PARTIAL | P1 | Tailor can request a customer-approved material advance for fabric, embroidery, or other order-specific costs. Customer pays that exact advance, ops releases only the approved material amount, and the tailor must upload receipt proof. Main escrow is never released early. Customer order now surfaces active requests near the top; final approval/payment device QA is blocked until dev Supabase REST/Auth recovers from Disk I/O pressure. |
| Measurement amendment workflow | PARTIAL | P1 | Covered by scope-change rail. Later build direct update of order measurement snapshot before cutting, with tailor approval. |
| Pause/hold order | PARTIAL | P1 | Covered by scope-change rail now. Later add formal hold dates and deadline recalculation. |
| Tailor emergency pause | RUNBOOK | P1 | Tailor/ops can pause active orders due to sickness/emergency; customer chooses wait, transfer, or cancel. |
| Tailor offboarding / relocation | RUNBOOK | P1 | Graceful exit, active orders completed/transferred/cancelled, customer recommendations, escrow protected. |
| Rework/restart order | PARTIAL | P1 | Covered by scope-change/aftercare. Later add formal rework stage, proof, cost decision, and deadline. |
| Wrong recipient / delivered but not received | BUILT/PARTIAL | P1 | Customer receipt confirmation now requires an item-in-hand proof photo before the app closes delivery. Courier scan remains separate from customer confirmation. |
| Collection deadline for pickup | BUILT/PARTIAL | P1 | Customer/tailor copy sets 7-day pickup expectation and scheduled automation now opens reminders at 7/14/30 days. Final storage/legal policy remains ops-runbook. |
| Customs and duties education | PARTIAL | P1 | Custom and ready-made checkout/order copy now says standard delivery/shipping is collected, while carrier surcharges, customs, and import duties need customer approval before dispatch. |
| Public holiday deadline warnings | BUILT/PARTIAL | P1 | Server-side deadline context now flags Christmas/New Year, Nigerian Independence, cultural rush periods, and international customs risk into order support metadata. Expand country holiday calendar over time. |
| Cultural calendar capacity warnings | BACKLOG | P1 | Tailors see deadline density warnings and prompt to pause new orders before Eid/Christmas/owambe peaks. |
| Rush/emergency orders | BUILT/PARTIAL | P1 | Customer order detail now has an event-sensitive emergency support path that creates a CRITICAL ops issue. Premium rush ordering remains later. |
| Repeat order / order again | BACKLOG | P1 | Returning customer-tailor pair gets prefilled preferences, measurements, and "order like last time." |
| Measurement age warning | PARTIAL | P1 | Manual measurement saves now store last-updated time; stale profiles warn in custom-order brief and carry into customer/tailor order readiness. Full reusable profile manager still needs quick rescan/manual update per wearer. |
| Fit preference / ease capture | PARTIAL | P1 | Some fit-intent metadata exists; make it explicit in order brief and visible to tailor. |
| Handmade variability education | PARTIAL | P2 | Custom and ready-made checkout now explain small handmade variation while keeping fit, finish, wrong item, and quality issues protected through concerns/aftercare. |
| Fabric colour reference | PARTIAL | P1 | Custom fabric approval and tailor sourcing/stage-proof copy now ask for natural light and a white paper reference when color accuracy matters. |
| Fabric quantity shortfall | RUNBOOK | P1 | Tailor flags insufficient yardage with photo; customer chooses send more, tailor sources, or revise design. |
| Fabric authentication / quality mismatch | RUNBOOK | P1 | Tailor confirms fabric type/quality on receipt before cutting; protects tailor and customer. |
| Photo quality coaching | PARTIAL | P1 | Tailor stage update capture now asks for fresh, well-lit proof with garment fully in frame; full camera-time quality detection still needs native work. |
| Portfolio originality/photo theft | RUNBOOK | P1 | Ops review and report-photo flow; later reverse-image check against Drape portfolio. |
| Pre-Drape reputation references | BACKLOG | P1 | Tailors submit references; ops verifies and shows pre-Drape verified work badge. |
| Notable tailor badge | BACKLOG | P2 | Earned external credibility badge, not paid placement. |
| Review authenticity enforcement | PARTIAL | P1 | Reviews tied to completed orders. Later add account age, device/IP flags, minimum payment threshold. |
| Complaint-in-review triage | RUNBOOK | P1 | 1-star complaint language routes to ops before publication when it is actually dispute/support. |
| Customer reputation / reviews before work | PARTIAL | P1 | Tailors can see internal customer review summary. Verify it displays correctly and does not invite repeat reviews on same order. |
| Trust transfer referrals | BUILT/PARTIAL | P2 | Referral links now create/claim durable `referrals`; claimed referral context attaches to future custom orders and shows as tailor-visible trust context. Referral analytics/reward rules remain later. |
| Inspiration-first order flow | BACKLOG | P2 | Start brief from photo, infer garment category/specialty, then build order. |
| Visual style glossary | BACKLOG | P1 | Ambiguous words like fitted, knee length, deep V map to visual choices attached to brief. |
| Language/literacy support | PARTIAL | P1 | Voice notes exist/are planned in messages; longer-term language support for Yoruba, Igbo, Hausa, Twi, Swahili. |
| Voice/video calls inside orders | PARTIAL | P1 | Drape calls and scheduling exist; formalize footer entry, no-show, SMS fallback, and call summaries. |
| Timezone intelligence | PARTIAL | P1 | Consultations store timezone; UI should show both local/tailor times for cross-border calls. |
| SMS fallback for critical events | PARTIAL | P1 | Queue support exists; needs provider secrets and event coverage QA. |
| Platform outage/status page | RUNBOOK | P1 | Need status.drapeon.co and outage notification policy before public scale. |
| Data export for tailors | BUILT/PARTIAL | P2 | In-app data access requests now create `tailor_data_exports` rows with a launch-safe export package: profile, portfolio, shop items, order history, reviews, payouts, and audit trail, with sensitive customer data excluded. Human release/identity verification remains ops-mediated. |
| Community tailor onboarding | RUNBOOK | P2 | Assisted onboarding path for skilled low-digital-fluency tailors. |
| Story capture / viral moment | BACKLOG | P2 | Post-delivery share-story/refer/review flow at peak satisfaction. |
| Price context in Explore | BACKLOG | P2 | Budget/mid-range/premium labels to anchor customer expectations. |
| Currency and FX transparency | PARTIAL | P1 | Customer currency routing improved; tailor should see locked payout equivalent and no surprise FX at acceptance. |
| Payment plans / deposits | RUNBOOK | P2 | Deposit plus final payment for high-value orders; not launch unless escrow/accounting is ready. |

## Architecture And Ops Cycles

| Cycle | Status | Priority | Scope |
| --- | --- | --- | --- |
| Read gateway/caching for Explore/profile | PARTIAL | P0/P1 | Explore/shop/item reads now have app-side dedupe/cache and Edge in-memory cache. Tailor profile now caches public profile/reviews/media separately from viewer-specific saved state. Continue trimming direct REST reads on active order widgets and profile/settings surfaces. |
| Queue-first side effects | PARTIAL | P0/P1 | Push/email/SMS jobs exist; continue moving slow side effects out of request path. |
| Provider circuit breakers | PARTIAL | P0/P1 | Health checks and provider readiness exist; verify ready check in prod once secrets are configured. |
| DB IO reduction | PARTIAL | P0 | Supabase disk IO warning affected QA: REST reads timed out at 60s while live Edge health stayed up, and `supabase inspect db` timed out before creating its login role. After upgrading Supabase dev, the grants migration applied successfully. Read-gateway cache/dedupe is deployed. Customer/tailor order-detail fallback polling is reduced from 15s to 60s while realtime remains active. Repeated `order_group_members` 403s were caused by missing table grants; the app now uses `group-member-action` for reads and DB grants are in place. The every-minute notification worker no longer runs payout watchdog scans. Next is index/query review now that DB accepts admin connections. |
| Ops portal parity | PARTIAL | P0/P1 | Backend actions exist for many issues. Frontend needs coherent Shopify-admin-style layout, runbook search, clear next action, and no maze. |
| Website parity | PARTIAL | P1 | Website should share auth/account foundation, help/trust, and later web order surfaces. Full mobile parity is not done. |
| Store assets and SSO | BACKLOG | P0 | Apple/Google SSO verification, screenshots, privacy/terms deployment, data safety, metadata before submission. |

## Decisions Made

- Scope changes are launch-critical because they prevent informal message-thread agreements.
- Group/gift/named measurement profiles are the next major product cycle after scope change; the first wearer-context lane now exists on new custom orders.
- Not every real-life scenario becomes a launch feature. Launch features must be QA-able; the rest must be in guide, ops, or backlog with owner.
- Price-impact scope changes must not become "pay me extra." They flag ops until revised quote/payment collection is first-class.
- Drape does not lend money or release main escrow early at launch. If a tailor needs cash for fabric, embroidery, or order-specific supplies, it must go through the formal material-advance lane: customer approval, separate payment, ops release, receipt proof.
- Ready-made orders should not use custom-order scope changes. They use delivery, cancellation, aftercare, and item-specific support cycles.

## Next Recommended Build Order

1. Named measurement profile picker in ready-made gifts and full family profile manager.
2. Material advance app UI and ops QA.
3. Consultation cycle final QA: scheduling, no-show, SMS fallback, call entry.
4. Continue Explore/profile read-gateway hardening and remove direct REST reads from hot navigation paths.
5. Ops portal runbook search and workflow parity.
