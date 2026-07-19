# Drapeon — Web/App Parity & Payments Audit
**Date:** July 5, 2026
**Scope:** Full web ↔ mobile parity gaps, web account architecture, complete payment lifecycle audit

---

## PART 1 — WEB / APP PARITY

### 1.1 Feature Matrix

| Feature | Mobile (Customer) | Mobile (Tailor) | Web Today | Should Web Have It? |
|---|---|---|---|---|
| Marketing pages | — | — | ✅ Full | — |
| Sign in / Sign up | ✅ | ✅ | ✅ Basic | ✅ Already exists |
| Forgot password | ✅ | ✅ | ❌ | ✅ Add |
| Tailor discovery / search | ✅ Full | — | ❌ | ✅ Priority |
| Tailor public profile | ✅ Full | — | ❌ | ✅ Priority |
| Tailor portfolio view | ✅ | — | ❌ | ✅ Priority |
| Custom order brief | ✅ Multi-step | — | ❌ | ✅ Priority |
| Ready-made item detail | ✅ | — | ❌ | ✅ |
| Ready-made checkout | ✅ Stripe/Paystack | — | ❌ | ✅ |
| Order list (customer) | ✅ Active/Completed | — | ❌ | ✅ Priority |
| Order detail (customer) | ✅ Full lifecycle | — | ❌ | ✅ Priority |
| Order messages | ✅ Realtime | ✅ Realtime | ❌ | ✅ Priority |
| Wishlists | ✅ Collections | — | ❌ | ✅ Medium |
| Customer measurements | ✅ Full form + Vision | — | ❌ | ✅ Form only (no camera) |
| Guided fit preferences | ✅ | — | ❌ | ✅ Medium |
| Payment history | ✅ | — | ❌ | ✅ |
| Post-order review | ✅ | — | ❌ | ✅ |
| Customer notifications feed | ✅ | — | ❌ | ✅ |
| Customer profile settings | ✅ Full | — | ❌ Thin shell | ✅ Priority |
| Referral claiming | ✅ Deep link | — | ❌ | ✅ Web landing page |
| Group order invite | ✅ Deep link | — | ❌ | ✅ Web landing page |
| Client Passport claim | ✅ Deep link | — | ❌ | ✅ Web landing page |
| Tailor order pipeline | — | ✅ Full | ❌ | ✅ Priority |
| Tailor quote sending | — | ✅ | ❌ | ✅ Priority |
| Production stage updates | — | ✅ + photos | ❌ | ✅ Priority |
| Tailor shop management | — | ✅ Full CRUD | ❌ | ✅ Priority |
| Tailor earnings dashboard | — | ✅ | ❌ | ✅ Priority |
| Tailor payout setup | — | ✅ Stripe/Paystack | ❌ | ✅ Priority |
| Tailor client CRM | — | ✅ Customers + Diary | ❌ | ✅ Medium |
| Tailor portfolio management | — | ✅ | ❌ | ✅ |
| Tailor profile setup/edit | — | ✅ | ❌ Thin | ✅ Priority |
| Tailor notifications feed | — | ✅ | ❌ | ✅ |
| Drape Vision (camera scan) | ✅ iOS native | ✅ iOS native | ❌ | ❌ Mobile-only |
| Measurement form (manual) | ✅ | ✅ | ❌ | ✅ Web can have form |
| Biometric lock | ✅ | ✅ | ❌ | ❌ N/A |
| Tailor diary / offline CRM | — | ✅ | ❌ | ✅ Medium |
| Ops dashboard | — | — | ✅ Exists | ✅ Harden + expand |
| CSV earnings export | — | ✅ | ❌ | ✅ Simple download |

---

### 1.2 Web Account Architecture — What to Build

The web app currently has `/account`, `/account/customer`, `/account/tailor`, `/account/ops` as route shells. These need to become real, functional screens. Here is the recommended architecture:

#### Customer Web Account (`/account/customer/`)

**Priority 1 — Ship with launch:**
- `/account/customer` — dashboard: active order cards, shortcuts to orders/messages/profile
- `/account/customer/orders` — order list with Active/Completed tabs
- `/account/customer/orders/[id]` — order detail: stage timeline, quote acceptance, payment trigger, confirm delivery, message thread
- `/account/customer/messages` — inbox: threads grouped by order, unread badges
- `/account/customer/messages/[orderId]` — order message thread (Supabase realtime)
- `/account/customer/profile` — profile hub: display name, phone, avatar, settings links

**Priority 2 — Ship within 30 days of launch:**
- `/account/customer/measurements` — full measurement form (no camera, manual entry only)
- `/account/customer/payments` — payment history with status and amounts
- `/account/customer/wishlists` — collections, saved tailors, saved items
- `/account/customer/notifications` — order update feed from `stage_update_notifications`
- `/account/customer/reviews` — reviews given
- `/account/customer/settings` — currency, notification prefs, data/privacy, delete account

#### Tailor Web Account (`/account/tailor/`)

**Priority 1 — Ship with launch:**
- `/account/tailor` — dashboard: stats, active orders, availability toggle, readiness warnings
- `/account/tailor/orders` — order pipeline with stage columns or list view
- `/account/tailor/orders/[id]` — full order management: send quote, advance stages, upload photos, handle fulfillment payment, shipping
- `/account/tailor/messages/[orderId]` — order message thread
- `/account/tailor/shop` — item list (LIVE/DRAFTS/SOLD tabs)
- `/account/tailor/shop/new` — create item form (multi-photo upload, sizes, price, size guide)
- `/account/tailor/shop/[id]` — edit/manage item
- `/account/tailor/earnings` — earnings dashboard, payout history
- `/account/tailor/payout-setup` — Stripe Connect or Paystack setup wizard

**Priority 2:**
- `/account/tailor/profile` — edit display, bio, specialties, availability, portfolio
- `/account/tailor/clients` — customer CRM + diary list
- `/account/tailor/clients/[id]` — client detail with measurement view and order history
- `/account/tailor/notifications` — update feed
- `/account/tailor/settings` — currency, notifications, security, delete

#### App Deep Link Landing Pages (no auth required)

These currently don't exist on web — they need to be thin public pages that detect app install and deep link, or fall back to a download prompt:

- `/passport/claim/[id]` — Client Passport claim (calls `claim-passport` edge function)
- `/group-invite/[code]` — Group order invite
- `/referral/[code]` — Referral claim
- `/app` — Universal "open or download the app" smart link page

---

### 1.3 Navigation Redesign

Based on the parity analysis, the web header should serve two distinct states:

**Logged-out (marketing):**
```
[Logo]   How it works · Tailors · FAQ        [Open app ↗]   [Sign in ▾]
                                                             └ Sign in
                                                             └ Create account
                                                             └ Ops login
```

**Logged-in (customer):**
```
[Logo]   Explore · Orders · Messages         [Open app ↗]   [Avatar ▾]
                                                             └ My profile
                                                             └ Measurements
                                                             └ Payments
                                                             └ Settings
                                                             └ Sign out
```

**Logged-in (tailor):**
```
[Logo]   Orders · Shop · Earnings            [Open app ↗]   [Avatar ▾]
                                                             └ My profile
                                                             └ Clients
                                                             └ Payout setup
                                                             └ Settings
                                                             └ Sign out
```

**Mobile hamburger (all states):** Full-screen drawer with all links + auth state at bottom.

---

### 1.4 Drape Vision — Web Strategy

**Do not build a web camera scan.** The iOS native implementation uses ARKit + AVFoundation. A MediaPipe/WASM equivalent would take months, have lower accuracy, and require HTTPS + camera permissions on web (already handled, but the UX is worse).

**Instead:**
1. The Vision page on marketing site → smart link to open app (or download)
2. `/account/customer/measurements` on web → manual entry form only, with a banner: *"For faster, more accurate measurements, use Drape Vision in the app."* + smart link
3. Garment QC remains a documented future workflow. Do not expose it on mobile or web until the real-device and product re-entry gates in the Vision runbook pass.

---

### 1.5 What Stays Mobile-Only

These features have no meaningful web equivalent and should not be built there:

| Feature | Why mobile-only |
|---|---|
| Drape Vision camera scan | ARKit/AVFoundation, no accurate web equivalent |
| Biometric lock (FaceID/fingerprint) | No Web Authentication API equivalent for this use |
| Native Stripe Payment Sheet | iOS SDK; web uses Stripe Elements or redirects |
| Paystack in-app browser | Replaced by standard web redirect |
| Push notifications | Web push is possible but separate implementation |
| Draggable FAB | Mobile-specific UX pattern |
| CSV export via expo-file-system | Web can use standard `<a download>` blob URL |

---

## PART 2 — PAYMENT SYSTEM AUDIT

### 2.1 Architecture Overview

Dual-provider system routing by currency:
- **Stripe** → GBP, USD, EUR, CAD (customer payments + Connect transfers for tailor payouts)
- **Paystack** → NGN, GHS, KES (customer payments + Transfer API for tailor payouts)

Routing is enforced by DB function `resolve_payment_provider_for_currency` and validated in every edge function before any API call.

Four payment phases exist per order: `INITIAL_ORDER` (quote amount), `CONSULTATION` (pre-call fee), `FULFILLMENT` (separate delivery fee), `MATERIAL_ADVANCE` (ops-gated material costs).

---

### 2.2 What Is Well-Built

Before the gaps — the foundation is solid:

- ✅ Idempotency keys on all Stripe PaymentIntent creates (`DRAPE-PAY-{orderId}`) and transfers (`DRAPE-PAYOUT-{orderId}`)
- ✅ Webhook deduplication on `(provider, provider_event_id)` unique index with `ignoreDuplicates: true`
- ✅ Webhook signature verification with timing tolerance (±5 min), constant-time comparison, multi-secret support
- ✅ Signature failure rate-limiting + ops alert at 3 failures/10 min window
- ✅ Full preflight check system (9 checks before payment prepare, 7 before payout release)
- ✅ Provider circuit-breaker (`provider_health` table) gates both payment and payout
- ✅ 7-day change cooldown + 72-hour destination hold after payout account changes
- ✅ Payout snapshot columns locked on order at payment time (immune to tailor changing bank after payment)
- ✅ Full partial-refund support with idempotency keys
- ✅ Auto-release cron at 14 days with 12-day customer warning
- ✅ Payout watchdog escalating to ops at 30 min / 60 min overdue

---

### 2.3 Critical Gaps (fix before launch)

#### GAP-1 — [CRITICAL] Auto-release does not set `customer_handoff_confirmed_at` → every auto-released payout is blocked

**File:** `supabase/functions/auto-release/index.ts`, function `markOrderDelivered`

**Problem:** `auto-release` sets `handoff_completed_at` and `handoff_confirmation_source = 'SYSTEM_AUTO_DELIVERED'` but does NOT set `customer_handoff_confirmed_at`. The payout release preflight in `release-order-payouts` requires `customer_handoff_confirmed_at` to be non-null when `CUSTOMER_CONFIRMATION_REQUIRED` is checked.

**Result:** Every order that reaches the 14-day auto-release mark gets delivered but its payout is silently blocked. The watchdog will escalate it to ops 30–60 min later. This means every auto-released order creates a manual ops task instead of flowing through automatically. If this is already running in production, you have backed-up payouts right now.

**Fix:** Add `customer_handoff_confirmed_at: new Date().toISOString()` to the update object in `markOrderDelivered`.

---

#### GAP-2 — [CRITICAL] No `account.updated` webhook from Stripe Connect → verified tailors stay blocked on payout indefinitely

**File:** `supabase/functions/stripe-webhook/index.ts`

**Problem:** When a tailor completes the Stripe Connect Express onboarding flow, Stripe fires `account.updated` with `charges_enabled: true`. The webhook handler does not listen for this event. The tailor's `payout_account_verified` field is never automatically set to `true`. The tailor must manually tap "Refresh Stripe status" in the payout setup screen, or their payout is blocked forever.

**Fix:** Add a handler in `stripe-webhook` for `account.updated` events. When `account.charges_enabled === true`, call `refresh-stripe-connect-status` (or inline the update: set `payout_account_verified = true`, `stripe_connect_account_id_confirmed_at = now()` on the matching `tailor_profiles` row). Send a push notification to the tailor: "Your Stripe Connect account is ready — you can now receive payouts."

---

#### GAP-3 — [CRITICAL] No `charge.reversed` webhook in Paystack handler → post-success reversals go undetected

**File:** `supabase/functions/paystack-webhook/index.ts`

**Problem:** Paystack fires `charge.reversed` when a transaction is reversed after a successful `charge.success`. The webhook handler does not listen for `charge.reversed`. If a customer's Paystack payment is reversed after the order has been confirmed (stage = CONFIRMED), the order stays confirmed, the tailor keeps working, and the payout eventually releases — but there is no customer money to release against.

**Fix:** Add a `charge.reversed` handler in the Paystack webhook. On receipt: find the `order_payments` row by `provider_payment_id`, set status to `REVERSED`, set `orders.stage` back to `PAYMENT_FAILED` (or a new `PAYMENT_REVERSED` stage), block payout by updating `order_payments.refunded_amount`, and create an ops issue + notify both parties.

---

#### GAP-4 — [HIGH] Paystack payout transfer has no idempotency key → network retry can double-pay tailor

**File:** `supabase/functions/_shared/payout-release.ts` (Paystack transfer path)

**Problem:** The Stripe transfer uses `DRAPE-PAYOUT-{orderId}` as an idempotency key. The Paystack transfer call does not pass a `reference` or `Idempotency-Key` header. If the Paystack API call succeeds but the response is lost (network timeout), a retry will initiate a second transfer.

**Fix:** Pass `reference: DRAPE-PAYOUT-{orderId}` to the Paystack transfer request. Paystack will return the original transfer on duplicate reference instead of creating a new one.

---

#### GAP-5 — [HIGH] Both `stripe-webhook` and `paystack-webhook` return HTTP 400 on unhandled exception → Stripe/Paystack stops retrying

**Files:** `supabase/functions/stripe-webhook/index.ts`, `supabase/functions/paystack-webhook/index.ts`

**Problem:** The outer `catch` block returns `new Response(..., { status: 400 })` on unexpected errors (DB timeout, etc.). Stripe interprets a 4xx response as a permanent failure and removes the event from its retry queue. A transient DB outage will cause webhook events to be permanently dropped.

**Fix:** Return HTTP 500 (not 400) on unexpected errors. Reserve 400 for known bad inputs (invalid signature, malformed body). Stripe and Paystack both retry on 5xx.

---

#### GAP-6 — [HIGH] Manual bank entry tailors have no automated payout path and no ops resolution UI

**File:** `supabase/functions/payout-account-action/index.ts`

**Problem:** A tailor who submits a manual bank entry is intentionally outside the automated payout rails. The schema already stores manual bank review state (`manual_bank_verification_status`, `manual_bank_verified_at`, `manual_bank_verified_by`) and column-level RLS already prevents anon/authenticated clients from reading or updating raw `manual_bank_*` fields. Submission also already creates a `PAYOUT_BLOCKED` ops issue with the manual bank metadata.

There are two independent automated payout blockers:

1. `payout_account_verified = false` / `payout_reverification_required = true`
2. `provider_destination_present` requires a real `paystack_recipient_code` or `stripe_connect_account_id`

Approving a manual bank entry may set `payout_account_verified = true` for UI/audit purposes, but it must **not** make `release-order-payouts` auto-pay. Manual bank entries still lack a provider destination, so automated payout remains blocked by design.

**Beta fix:** Manual bank entry is disabled unless `MANUAL_BANK_ENTRY_ENABLED=1` is explicitly set. The mobile/web payout setup UI should hide the manual path while this is false, and the edge function rejects old clients server-side.

**Permanent fix:** Add an ops-only manual payout workflow. This must not live in `payout-account-action` because that function authenticates the tailor. Use an ops route/function protected by ops auth and service-role access so it can read raw manual bank fields despite column-level RLS.

The ops workflow needs:

- Manual bank review queue from `ops_issues` where `issue_type = 'PAYOUT_BLOCKED'` and metadata contains manual bank context.
- Approve/reject actions with audit logs. Approval sets manual review fields and may set `payout_account_verified = true`, but does not enable automated payout.
- Manual payout recording action that writes both:
  - a `payouts` row with `status = 'PAID'` and `provider_payout_id = <external_bank_reference>`
  - `orders.escrow_released = true` and `orders.escrow_released_at = now()`
- A duplicate guard before inserting so one order cannot be manually paid twice.

The payout row and `orders.escrow_released` update must happen atomically. If only the audit log or payout row is written, the payout cron will continue selecting the order because `escrow_released = false`, causing repeated `PAYOUT_ACCOUNT_MISSING` failures and ops noise.

---

### 2.4 Medium Gaps

#### GAP-7 — Paystack payout reference collision on retry

**File:** `supabase/functions/_shared/payout-release.ts`

If a payout attempt fails after the `payouts` DB row was created (status=PROCESSING) but before the Paystack API returned success, a retry using the same `DRAPE-PAYOUT-{orderId}` reference will get a Paystack "duplicate reference" error and fail. Unlike Stripe (which returns the existing transfer), Paystack returns an error. The payout stays `FAILED` and the watchdog escalates to ops.

**Fix (same as GAP-4):** Using Paystack's `reference` field as an idempotency key fixes both issues simultaneously.

---

#### GAP-8 — Consultation payment metadata stored in `orders.special_note` JSONB, not a proper column

**File:** `supabase/functions/payment-action/index.ts`, `supabase/functions/_shared/payment-webhook.ts`

Consultation `paymentIntentId`, `paidAt`, `paymentCheckoutUrl` are serialized into `orders.special_note` as a nested JSON string rather than first-class columns. The webhook lookup parses this string on every event. This is fragile to serialization changes and makes querying/auditing consultation payments opaque.

**Fix:** Add `consultation_payment_intent_id`, `consultation_paid_at`, `consultation_payment_checkout_url` columns to `orders` in a migration. Migrate existing `special_note` data. Update read/write paths.

---

#### GAP-9 — No `payment_intent.processing` webhook handler

Stripe fires `payment_intent.processing` for bank transfer and certain BNPL methods. An order can sit at `PAYMENT_PENDING` with a `processing` intent for days (bank transfers) until the 10-min expiry cron runs and tries to cancel it — which fails because the intent is still processing. The customer is stuck with a pending order and no status update.

**Fix:** Add a `payment_intent.processing` handler: keep the order at `PAYMENT_PENDING` but send a push notification: "Your payment is processing — bank transfers can take 1–3 business days. We'll notify you when it clears."

---

#### GAP-10 — `release-order-payouts` processes up to 200 orders in one Edge Function invocation

If the function times out (150s wall-clock limit on Supabase Edge Functions) partway through, some orders are paid and some are not — with no rollback. The watchdog catches unpaid ones within 30–60 min, but there is a silent gap window.

**Fix:** Reduce the batch size from 200 to 20–30. Run the cron more frequently (every 5 min instead of less often). Or add a processing lock per order (set `payout_processing = true` before starting, release on completion) so partial runs don't create double-processing risk on the next invocation.

---

#### GAP-11 — No webhook subscribed for `payment_intent.requires_action` (3DS abandonment)

If a Stripe customer starts a 3DS challenge and abandons it, the intent stays in `requires_action` indefinitely. The 10-min expiry cron cancels it eventually, but the customer gets no real-time notification to complete the challenge.

**Fix:** Add `payment_intent.requires_action` webhook handler. Send a push notification: "Action needed — your payment requires a security confirmation. Open the Drapeon app to complete it."

---

#### GAP-12 — Double audit event race between `confirm-payment` and Stripe/Paystack webhook

Both `payment-action: confirm-payment` (called from the app) and the webhook handler can race to call `markOrderConfirmed`. The order update is guarded by `.eq('stage', current_stage)` (optimistic concurrency — safe), but the audit log call is not guarded, producing two `payment.confirmed` audit events for the same order.

**Fix:** In `markOrderConfirmed`, check whether `order_payments.status` is already `SUCCEEDED` before writing the audit event. If already succeeded, skip the duplicate audit write.

---

### 2.5 Payment UX Gaps (customer-facing)

These are product/UX issues in the payment flow, not just backend:

| # | Gap | Impact |
|---|---|---|
| P1 | No web payment flow exists — customer can only pay in the mobile app | Blocks web parity |
| P1 | No payment status page for Paystack redirect flow — customer lands on `/paystack-redirect` with no feedback while `confirm-payment` is called | Confusing |
| P1 | No retry UI for `PAYMENT_FAILED` orders — customer has to know to go back to the order and retry | Reduces conversion |
| P1 | No "payment processing" state UI for bank transfer methods — order sits in PAYMENT_PENDING with no explanation | High support ticket driver |
| P2 | Fulfillment payment (delivery fee) request has no email notification — tailor requests it but customer only knows via push notification (may not see it if notifications off) | Missed payments |
| P2 | No saved payment methods — customer must re-enter card on every order | Increases payment friction |
| P2 | Paystack checkout opens in a WebView, not the native Paystack SDK | Less trustworthy appearance for NGN payers |
| P2 | No receipt/invoice generation after payment success | Users expect a downloadable receipt |

---

### 2.6 Payout UX Gaps (tailor-facing)

| # | Gap | Impact |
|---|---|---|
| P0 | Stripe Connect completion does not auto-verify — tailor must manually tap "Refresh Stripe status" | Silent payout block after a tailor completes onboarding |
| P1 | No clear timeline shown to tailor for when payout will release — just "after delivery confirmed" | Support volume |
| P1 | No email confirmation when payout is initiated or arrives in tailor's bank | Tailors don't know when they've been paid |
| P1 | Manual bank entry tailors have no visibility into ops verification progress | Tailors don't know they're blocked |
| P1 | Payout failure notification is push-only — if notifications off, tailor never knows | Missed payout failures |
| P2 | No payout scheduling preference — payout always releases as soon as eligible; some tailors may prefer weekly batching | Nice-to-have but expected in mature platforms |
| P2 | Earnings dashboard on web doesn't exist — tailor must use mobile app to see earnings | Web parity gap |
| P2 | CSV export only available on mobile (expo-file-system) | Tailors doing accounting on desktop are blocked |

---

### 2.7 Suggested Fix Order

**This week (before any new payments go live):**

1. Fix GAP-1: Add `customer_handoff_confirmed_at` to `auto-release` markOrderDelivered
2. Fix GAP-2: Add `account.updated` Stripe Connect webhook handler
3. Fix GAP-3: Add `charge.reversed` Paystack webhook handler
4. Fix GAP-4 + GAP-7: Add `reference: DRAPE-PAYOUT-{orderId}` to Paystack transfer calls
5. Fix GAP-5: Change webhook outer catch to return 500, not 400

**This month:**

6. Fix GAP-6: Build ops-only manual bank review and manual payout recording. Keep beta manual entry disabled until this ships.
7. Fix GAP-9: Add `payment_intent.processing` webhook + customer notification
8. Fix GAP-11: Add `payment_intent.requires_action` webhook + customer notification
9. Add email notifications for: payout initiated, payout landed, payment receipt
10. Add web payment flow (Stripe Elements / Paystack standard redirect) for web order management

---

## PART 3 — BACKEND WORKFLOW IMPROVEMENTS

### 3.1 Order Lifecycle Workflow

| # | Issue | Priority |
|---|---|---|
| 1 | No order cancellation workflow for customer after payment is confirmed — only tailor can cancel | P1 |
| 2 | No automated SLA reminders to tailor if order sits in a production stage > N days without update | P1 |
| 3 | `order_stage_updates` table records stage changes but there is no customer-facing timeline page on web | P1 |
| 4 | Consultation scheduling is mobile-only — no web-based scheduling flow | P2 |
| 5 | Group order system exists in mobile (invite + claim) but has no management UI for the lead customer | P2 |
| 6 | No automated "quote about to expire" notification to customer (there is a warning to tailor side, check customer side) | P2 |
| 7 | `order_material_issues` and `order_scope_changes` have no ops visibility dashboard | P2 |
| 8 | No order archiving/search for tailors with many completed orders (search only on completed tab, no date filter) | P3 |

### 3.2 Tailor Onboarding Workflow

| # | Issue | Priority |
|---|---|---|
| 9 | ID verification is upload-only — there is no automated check, no third-party KYC integration, ops must manually review | P1 |
| 10 | No automated email when ID verification is approved or rejected | P1 |
| 11 | Tailor readiness warnings are surface-level — no step-by-step "complete your setup" checklist | P2 |
| 12 | New tailor approval (going `is_live`) is manual and has no defined SLA or ops queue | P2 |
| 13 | No "sandbox mode" for new tailors to test the quote/order/payout flow without real money | P3 |

### 3.3 Customer Onboarding Workflow

| # | Issue | Priority |
|---|---|---|
| 14 | Customer setup wizard is mobile-only — web sign-up has no measurement collection step | P1 |
| 15 | No email drip sequence after customer signs up on web (only app gets the onboarding flow) | P1 |
| 16 | Guided fit preferences (`guided-fit.tsx`) are only accessible deep in mobile profile — not surfaced during brief creation | P2 |
| 17 | Measurement completeness is shown on profile but never blocks brief submission — a customer can submit a brief with zero measurements | P2 |

### 3.4 Notification Workflow

| # | Issue | Priority |
|---|---|---|
| 18 | All notifications are push-only on mobile — no email fallback if push is disabled | P1 |
| 19 | No web push notifications (different from mobile push — browser push API) | P2 |
| 20 | `stage_update_notifications` table backs the in-app notification feed but there is no mark-all-as-read | P3 |
| 21 | Tailor messages tab has no unread count badge in the tab bar (customer side has it, tailor side is hidden from tab bar entirely) | P2 |

### 3.5 Media & Content Workflow

| # | Issue | Priority |
|---|---|---|
| 22 | Portfolio photos have no ordering control — no drag-to-reorder in the tailor portfolio manager | P2 |
| 23 | Production photos uploaded by tailor to an order are not visible to the customer in a gallery view — only in the timeline | P2 |
| 24 | Ready-made item photos require 4:5 ratio — no crop tool in the upload flow, user must pre-crop externally | P2 |
| 25 | Media safety review (`queueMediaSafetyReview`) is queued but there is no in-app ops interface to approve/block queued assets | P1 |

---

## SUMMARY — TOP FIXES BY CATEGORY

### Payment (fix immediately)
1. Add `customer_handoff_confirmed_at` to `auto-release` — every auto-released payout is currently blocked
2. Add `account.updated` Stripe Connect webhook — tailors who complete onboarding can't get paid without manual action
3. Add `charge.reversed` Paystack webhook — post-success reversals are invisible to the system
4. Add Paystack payout `reference` field — network retry can double-pay a tailor
5. Change webhook outer catch to return 500, not 400

### Parity (build for web launch)
1. Customer order tracking + messages on web
2. Tailor order pipeline + shop management on web
3. Tailor earnings dashboard + payout setup on web
4. Universal `/app` smart link page
5. Deep link landing pages for passport, group invite, referral

### Backend
1. Email fallback for all push notifications
2. Automated tailor SLA reminders
3. Ops media review interface
4. Tailor ID verification email notifications
