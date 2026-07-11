# Account Layer — Design Plan
**Date:** July 5, 2026
**Mode:** Design + planning only — no code changes
**Scope:** Customer order tracking, tailor work pipeline, navigation, messaging, architecture

---

## 1. What Is Actually Built (Honest Assessment)

Before planning additions, understand what already exists in `account-app-surface.tsx` (4,093 lines) and `account-dashboard.tsx` (1,140 lines):

**Already functional on web:**
- Customer order list + order detail (stage timeline, payments, stage updates, production evidence)
- Tailor order list + order detail (same data set)
- Quote sending from web (`tailor-order-action: send-quote`)
- Stage advancing from web with photo upload (`tailor-order-action: advance-stage`, up to 6 photos)
- Stripe card payment from web (full `StripeCardAuthorization` component, `payment-action: prepare-payment + confirm-payment`)
- Paystack redirect from web (`authorizationUrl` redirect)
- Message sending from web (`message-action: send-message`, contact info filtered)
- Audio + video call initiation from web (`create-order-call-room`)
- Ready-made call scheduling from web
- Manual measurement entry and editing (`customer_measurement_profiles` table, 7 fields)
- Shop item creation from web (`seller-item-action: create-item`, with photo upload)
- Tailor explore + search
- Ready-made item browsing
- Wishlist collections (read)
- Account dashboard with role switching + next action logic
- `drape://` deep link to open app

**The architecture:**
- One monolithic client component: all surfaces share a single `fetchAccountSurfaceData` call that fetches 40 orders, 100 messages, 100 stage updates, 100 production evidence, 60 material advances, 30 shop items, 18 explore items, 120 wishlist items — all at once, on every page load
- Navigation: horizontal scrolling pill chips in a top card (`AccountRouteShell`)
- Dashboard: separate component at `/account/dashboard`, not sharing the shell
- Route structure is flat: `/account/[surface]` — no role separation in URLs

---

## 2. Current UX Problems (Specific)

### 2.1 Navigation

The current `AccountRouteShell` nav:

```
┌─────────────────────────────────────────────────────────────────┐
│ Drapeon    [Dashboard][Explore][Saved][Orders][Messages][Measurements][Settings][Support][Shop][Work] │
└─────────────────────────────────────────────────────────────────┘
```

**Problems:**
- 10 pill links in a horizontal scroll container — on a 375px phone all but 3 are hidden off-screen
- On desktop (1280px+) the pills float in a wide empty header card — wastes horizontal space
- Active link is needle-filled pill, inactive is white border pill — good pattern, just too many items
- No visual separation between customer surfaces (Orders, Messages, Saved) and tailor surfaces (Shop, Work) — a CUSTOMER with no tailor profile sees all links anyway

**What it should be on desktop (1024px+):** Left sidebar. On mobile: bottom bar or hamburger drawer.

```
Desktop layout:

┌──────────────────────────────────────────────────────┐
│ Drapeon                            [Open app] [Email] │
├──────────────┬───────────────────────────────────────┤
│              │                                       │
│  CUSTOMER    │                                       │
│  ─────────   │         Main surface content          │
│  Dashboard   │                                       │
│  Explore     │                                       │
│  Orders   ●  │                                       │
│  Messages  3 │                                       │
│  Saved       │                                       │
│  Fit         │                                       │
│              │                                       │
│  ACCOUNT     │                                       │
│  ─────────   │                                       │
│  Settings    │                                       │
│  Support     │                                       │
│  Sign out    │                                       │
│              │                                       │
│  [Open app]  │                                       │
└──────────────┴───────────────────────────────────────┘
```

For tailors, the sidebar shows:

```
│  TAILOR      │
│  ─────────   │
│  Dashboard   │
│  Work queue  │
│  Shop        │
│  Earnings    │
│  Clients     │
│              │
│  ACCOUNT     │
│  ─────────   │
│  Profile     │
│  Payout      │
│  Settings    │
```

Mobile (375px): Sidebar collapses to a hamburger that opens a full-screen drawer. Bottom tab bar is NOT appropriate here (conflicts with mobile app's bottom bar design language — web account is a desktop-first product).

### 2.2 Single Massive Data Fetch

`fetchAccountSurfaceData` fetches everything regardless of which surface is being shown. Loading `/account/messages` triggers fetching of explore tailors, wishlist items, shop items, etc. that messages doesn't need.

**Impact:** Slow initial load. Gets much worse as a user accumulates orders. A user with 50 orders will fetch 50 × (messages + stage updates + payments + evidence + material advances) on every page.

**What it should be:** Surface-specific data fetching. Each surface component owns its own query. Shared data (userId, customerProfile, tailorProfile) fetched once at the shell level via React Context, not re-fetched per surface.

### 2.3 Messages Have No Real-Time

The message composer sends messages. But reading messages is a static snapshot — no Supabase realtime subscription. A user sends a message, the tailor replies, and the customer only sees the reply if they manually refresh.

**This is the single most important UX gap** on the account layer. Order messaging is a core workflow — if it doesn't update in real-time, it feels broken.

**What it needs:** A `useEffect` that subscribes to a Supabase realtime channel on `messages` filtered by `order_id`. On INSERT, append the new message to local state. No full re-fetch needed.

```typescript
// Pattern (not a code change, just illustrating the design):
const channel = supabase
  .channel(`messages:${orderId}`)
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'messages',
    filter: `order_id=eq.${orderId}`,
  }, (payload) => appendMessage(payload.new))
  .subscribe()
```

### 2.4 Order Detail Has No Visual Stage Timeline

The current order detail shows stage updates as a list of text cards. The mobile app renders a visual stage progression — you can see where in the production lifecycle the garment is.

**What it needs:** A horizontal or vertical stage progress bar showing the full lifecycle:

```
Customer view:
Brief → Quote → [Payment] → Designing → Sourcing → Cutting → Sewing → Finishing → Delivery → ✓ Complete
         ↑ Current stage (needle highlight, all before are ticked, all after are grey)
```

Tailor view (same data, different framing):
```
Received → Quoted → [Confirmed] → Designing ● → Sourcing → Cutting → Sewing → Finishing → Dispatched → Done
                                      ↑ You are here — advance from this panel below
```

### 2.5 Tailor Work Queue Is a List, Not a Pipeline

The `work` surface shows tailor orders as a flat list. Mobile's tailor orders screen is also a prioritized list. But on desktop, there is enough room for a pipeline/kanban view by production stage.

A web tailor managing 8 active orders at once wants to see:
- What needs action NOW (pending quotes, payment issues, items ready to dispatch)
- What is in production (and at which stage)
- What is near completion

A 4-column layout works:

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ NEEDS ACTION │ IN PRODUCTION│  DISPATCHED  │  COMPLETED   │
│              │              │              │              │
│ [Agbada      │ [Kaftan —    │ [Suit —      │ [Dress —     │
│  Quote due]  │  Cutting]    │  Shipped]    │  Collected]  │
│              │              │              │              │
│ [Suit —      │ [Dress —     │              │              │
│  Payment     │  Sewing]     │              │              │
│  failed]     │              │              │              │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

"Needs action" = PENDING_QUOTE, QUOTE_SENT, PAYMENT_FAILED, IN_DISPUTE
"In production" = CONFIRMED, DESIGNING, SOURCING, CUTTING, SEWING, FINISHING
"Dispatched" = SHIPPED, OUT_FOR_DELIVERY, READY_FOR_COLLECTION, READY_FOR_DRAPE_DISPATCH
"Completed" = DELIVERED, COLLECTED, COMPLETE

Mobile fallback: single prioritized list (existing pattern).

### 2.6 `drape://` Deep Link Has No Fallback

`AccountRouteShell` and `AccountDashboard` both have `<a href="drape://">Open app</a>`. If the app is not installed, `drape://` silently fails — no redirect to the App Store, no error, just nothing.

**Fix (design-level):** The "Open app" button should:
1. On iOS Safari → try `drape://`, set a 500ms timeout, if no response → redirect to App Store URL
2. On other mobile → App Store / Play Store
3. On desktop → show a QR code modal or "Download from the App Store" text

This is a single shared `<OpenAppButton />` component. Use the same "smart link" approach documented in the parity audit (`/app` universal link page).

---

## 3. Customer Order Tracking — Ideal Design

### 3.1 Orders List (`/account/orders`)

**Current:** A flat list of order cards, latest first, no filtering.

**Ideal:**

```
┌─────────────────────────────────────────────────────────┐
│ Orders                                          [+ New]  │
│                                                          │
│  [Active ●4]  [Completed 12]  [All]                     │
├─────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────┐  │
│  │ Agbada · Drape Tailor                    £280.00   │  │
│  │ SEWING  ████████░░░░░░░░░░░░              Est Jun 28│  │
│  │ Last update: 2 days ago                   Order #4F │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Suit · James Adewale                    ₦450,000   │  │
│  │ QUOTE SENT — action needed              Exp in 3d  │  │
│  │ Review and accept or decline the quote   Order #2A │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

Key additions:
- Active / Completed tabs (exist in mobile, should exist on web)
- Stage pill with a visual progress bar inline on each card
- "Action needed" surface for orders requiring customer response (quote to review, payment due, delivery to confirm)
- Estimated completion date shown
- Order reference shown
- Click → order detail

### 3.2 Order Detail (`/account/orders/[id]`)

**Current:** The `order-detail` surface shows payments, messages, stage updates, production evidence, material advances. All exist. The layout is a single-column list of sections.

**Ideal layout (2-column on desktop):**

```
┌───────────────────────────────┬──────────────────────────┐
│                               │                          │
│  AGBADA                       │  MESSAGES                │
│  Drape Tailor · £280          │  ──────────────────────  │
│  Reference: #4F2X             │  Tailor: "Cutting done,  │
│                               │   photos attached."      │
│  ████████████░░░░░░░ Sewing   │                          │
│  Brief > Quote > Payment >    │  You: "Looks great,      │
│  Designing > Sourcing >       │   thank you!"            │
│  Cutting > [SEWING] > ...     │                          │
│                               │  [Reply...]              │
│  ──────────────────────────   │  [Audio call][Video call]│
│  TIMELINE                     │                          │
│  ↳ Jul 3 — Sewing started     │  ──────────────────────  │
│    "Fabric cut, stitching      │  PAYMENT                 │
│     begins today."            │  £280.00 · CONFIRMED     │
│  ↳ Jul 1 — Sourcing done       │  Paid Jul 1 via Stripe  │
│  ↳ Jun 28 — Payment confirmed  │                         │
│  ↳ Jun 26 — Quote accepted    │  HANDOFF                 │
│  ↳ Jun 24 — Brief received    │  Shipping · Est Jun 28   │
│                               │  Track: [Royal Mail]     │
│  PRODUCTION PHOTOS            │                          │
│  [3 photos — click to view]   │  Auto-release: Jul 12    │
│                               │  [Confirm delivery]      │
└───────────────────────────────┴──────────────────────────┘
```

Critical interaction states:
- `QUOTE_SENT` → Show quote review panel prominently: amount, completion date, note. Two buttons: "Accept quote" / "Decline". Payment follows immediately if accepted.
- `PAYMENT_PENDING` / `PAYMENT_FAILED` → Show checkout panel front and center, above timeline
- `SHIPPED` / `OUT_FOR_DELIVERY` → Show tracking link, collection code (if applicable), "Confirm receipt" button
- `IN_DISPUTE` → Show dispute context, disable payment, show support link
- Terminal stages → Read-only. Show review prompt if within 14-day window.

### 3.3 What Customer Cannot Do on Web (App-Only)

State these clearly in the UI — don't hide these actions, just label them:
- Drape Vision body scan → "Available in the Drapeon app" with Open App button
- Camera-based proof photos → "Take production proof photos in the app"
- Push notification preferences → "Notification settings are in the app"

---

## 4. Tailor Work Pipeline — Ideal Design

### 4.1 Work Queue (`/account/work`)

**Current:** Flat list of orders with stage labels and basic info cards.

**Ideal (desktop):** 4-column kanban. **Ideal (mobile):** Stage-prioritized list (keep existing pattern).

Stage grouping logic:

| Column | Stages |
|---|---|
| Needs action | PENDING_QUOTE, QUOTE_SENT (if not replied), PAYMENT_FAILED, IN_DISPUTE |
| In production | CONFIRMED, DESIGNING, SOURCING, CUTTING, SEWING, FINISHING |
| Dispatched | READY_FOR_COLLECTION, READY_FOR_DRAPE_DISPATCH, SHIPPED, OUT_FOR_DELIVERY |
| Done | DELIVERED, COLLECTED, COMPLETE, CANCELLED, REFUNDED |

Each order card shows:
- Garment type + customer name
- Current stage pill
- Amount
- Estimated completion date or "overdue" warning
- Last message preview (1 line)
- Click → order detail

**Quick actions from pipeline card** (without navigating to detail):
- "Send quote" if in PENDING_QUOTE
- "Advance to next stage" if in production with a single next-stage option
- "Upload photo" (opens file picker inline)

### 4.2 Tailor Order Detail

The current `TailorOrderActions` component exists and handles quote sending and stage advancing. The design gap is layout and discoverability, not functionality.

**Ideal layout (2-column):**

```
┌──────────────────────────────────┬──────────────────────────┐
│                                  │                          │
│  KAFTAN                          │  CUSTOMER                │
│  Customer Name · ₦85,000         │  ──────────────────────  │
│  Reference: #7G3Y                │  [Customer name]         │
│                                  │  Last order: 1st time    │
│  Stage: SEWING                   │  Measurement profile: ✓  │
│  ████████████░░░░░░              │                          │
│                                  │  BRIEF                   │
│  ──────────────────────────      │  Style: Slim fit kaftan  │
│  STAGE ACTIONS                   │  Fabric: Customer supply │
│  Next: [FINISHING ▾]             │  Deadline: Jul 28        │
│  Note: ____________________      │  Delivery: Pickup        │
│  Photos: [+ Add up to 6]         │                          │
│  [Advance stage]                 │  MEASUREMENT SNAPSHOT    │
│                                  │  Chest: 42in · Waist: 36 │
│  ──────────────────────────      │  Hips: 40 · Shoulder: 18│
│  QUOTE (if applicable)           │                          │
│  Amount: ____  Currency: ___     │  MESSAGES                │
│  Completion: ___  Note: ___      │  ──────────────────────  │
│  [Send quote]                    │  [Recent messages + reply│
│                                  │   panel]                 │
│  ──────────────────────────      │                          │
│  TIMELINE                        │  PAYMENT                 │
│  ↳ Jul 3 — Sewing started        │  ₦85,000 · CONFIRMED    │
│  ↳ Jul 1 — Cutting done          │  Paid Jun 29 via Paystack│
│  ↳ Jun 29 — Payment confirmed    │                          │
│                                  │  HANDOFF                 │
│  PRODUCTION PHOTOS               │  Pickup · Collection code│
│  [Grid of uploaded photos]       │  Generate: [□ Generate]  │
└──────────────────────────────────┴──────────────────────────┘
```

### 4.3 Missing Surfaces for Tailors

These surfaces appear in the navigation but are not yet built as functional screens:

**Earnings (`/account/earnings`)** — Does not exist as a surface in `AccountAppSurface`. The mobile app has a full earnings dashboard (`/(tailor)/earnings.tsx`) with breakdown by status, date filter, transaction history, CSV export.

**Web design for earnings:**
```
┌──────────────────────────────────────────────────────────────┐
│ Earnings                                                     │
│                                                              │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│ │ PENDING  │ │AVAILABLE │ │ RELEASED │ │  PAID    │        │
│ │ £350     │ │ £1,200   │ │ £800     │ │ £4,500   │        │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
│                                                              │
│  Period: [30D] [90D] [365D] [All]     [Export CSV]          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Order #4F · Agbada · £280.00 · PAID · Jun 29         │   │
│  │ Order #3B · Kaftan · ₦85,000 · PENDING · Jul 1       │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

Data source: `tailor_transactions` or `payouts` table + `order_payments` joined to orders.

**Payout setup (`/account/payout`)** — Does not exist on web. The mobile app has a full multi-step wizard (`/(tailor)/profile/payout-setup.tsx`): choose currency → Stripe Connect (OAuth) or Paystack recipient code entry.

The web version must handle:
1. Currency + account type selection
2. Stripe Connect → `payout-account-action: start-stripe-connect` → get `accountLinkUrl` → redirect → return to `/account/payout?setup=complete` → call `refresh-stripe-connect-status`
3. Paystack → `payout-account-action: submit-paystack-recipient` with recipient code
4. Current status display (verified / unverified / change cooldown remaining)

**Tailor profile edit (`/account/profile`)** — Not a surface in the current architecture. The mobile app has a full profile editor. Web should at minimum show profile completeness and link to app for full edits — with bio, location, availability, and specialty tags editable on web.

---

## 5. Messaging Surface Design

### 5.1 Current State

`/account/messages` uses `AccountAppSurface` with surface `messages`. The surface shows all messages across all orders, grouped and with a composer per order. No realtime.

### 5.2 Ideal Design

**Inbox list + thread panel** (Airbnb/Linear inbox pattern):

```
┌────────────────┬─────────────────────────────────────────┐
│ MESSAGES       │  Kaftan — Customer Name                  │
│                │  Order #7G3Y · Sewing · ₦85,000         │
│ ● Kaftan       │  ─────────────────────────────────────  │
│   "Cut done,   │                                          │
│   photos..."   │  [Jul 3, 2:14pm]                        │
│   2h ago       │  ╔═══════════════════════════════════╗   │
│                │  ║ Customer:                         ║   │
│   Agbada       │  ║ "Looking good! When will sewing   ║   │
│   "Thank you   │  ║  be done?"                        ║   │
│    for the..." │  ╚═══════════════════════════════════╝   │
│   1d ago       │                                          │
│                │  [Jul 3, 2:18pm]                        │
│   Suit         │  ╔═══════════════════════════════════╗   │
│   "Brief       │  ║ You:                              ║   │
│   received"    │  ║ "By end of week, I'll send photos ║   │
│   3d ago       │  ║  when done."                      ║   │
│                │  ╚═══════════════════════════════════╝   │
│                │                                          │
│                │  ─── LIVE ●                              │
│                │  ┌─────────────────────────────────┐     │
│                │  │ Reply...                         │     │
│                │  └─────────────────────────────────┘     │
│                │  [Send]  [Audio call]  [Video call]      │
└────────────────┴─────────────────────────────────────────┘
```

**Realtime:** "LIVE ●" indicator when the Supabase realtime channel is connected. Messages appear instantly. Typing indicator (optional enhancement).

**Mobile:** Full-screen inbox list → tap to open thread (full-screen). Same as mobile app pattern.

---

## 6. Architecture Recommendations (No Code, Just Design)

### 6.1 Break the God Component

`account-app-surface.tsx` at 4,093 lines is doing too much. The design for splitting it:

```
components/
  account/
    shell.tsx              ← AccountRouteShell (nav, header, auth check)
    data-context.tsx       ← Shared data: userId, customerProfile, tailorProfile
    surfaces/
      orders.tsx           ← Customer order list
      order-detail.tsx     ← Order detail (shared customer/tailor)
      work.tsx             ← Tailor work pipeline
      messages.tsx         ← Message inbox + thread
      shop.tsx             ← Shop list
      shop-item.tsx        ← Shop item create/edit
      explore.tsx          ← Tailor discovery
      measurements.tsx     ← Measurement profiles
      saved.tsx            ← Wishlists
      earnings.tsx         ← Tailor earnings (NEW)
      payout.tsx           ← Tailor payout setup (NEW)
      settings.tsx         ← Account settings
      support.tsx          ← Support
    components/
      stage-timeline.tsx   ← Visual stage progress bar
      message-thread.tsx   ← Thread with realtime
      tailor-actions.tsx   ← Quote + stage advance (extracted from existing)
      checkout-action.tsx  ← Stripe/Paystack payment (extracted)
      open-app-button.tsx  ← Smart deep link with fallback
```

Each surface fetches only its own data. The `data-context.tsx` fetches the shared profile data once at the shell level.

### 6.2 Per-Surface Data Pattern

```
Shell loads:
  - userId (from session)
  - customerProfile (if CUSTOMER or dual-role)
  - tailorProfile (if TAILOR or dual-role)
  - active order count (for badge)
  - unread message count (for badge)

/account/orders loads:
  - orders (all, paginated)
  - latest payment per order
  - latest stage update per order

/account/orders/[id] loads:
  - single order (full)
  - all payments for order
  - all messages for order (+ realtime subscription)
  - all stage updates for order
  - all production evidence for order
  - material advances for order

/account/work loads:
  - tailor orders (active + recent completed)
  - stage updates (latest per order)

etc.
```

This reduces the initial data load from ~10 parallel Supabase queries to ~2-3.

### 6.3 Navigation State

The current navigation uses `surface` prop to derive the active link. This means the nav only works when rendered inside `AccountRouteShell`. The sidebar design requires the nav to know the current pathname globally.

Use `usePathname()` from `next/navigation` to derive the active link — no need to pass `surface` as a prop for nav highlighting.

---

## 7. Visual Design Improvements (Account Layer)

The existing design language is consistent and correct. These are incremental refinements:

### 7.1 Stage Pills

Current stage labels are `cleanLabel(order.stage)` — plain text with capital formatting. They should be colored pills:

| Stage group | Color |
|---|---|
| Needs action (QUOTE_SENT, PAYMENT_PENDING) | `rust/12` background + `rust` text |
| In production (DESIGNING...FINISHING) | `needle/10` background + `needle` text |
| Dispatched (SHIPPED, OUT_FOR_DELIVERY) | `blue/10` background + blue text |
| Complete | `ink/8` background + `ink/50` text |
| Problem (PAYMENT_FAILED, IN_DISPUTE) | `rust` background + white text |

No left-border indicators. Background tint + text color is the correct differentiation pattern.

### 7.2 Empty States

Current empty states are `bg-bone/60` text cards. These should have more visual weight and be action-oriented:

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│   No active orders                                  │
│   Explore tailors and start your first brief,       │
│   or continue ready-made checkout.                  │
│                                                     │
│   [Explore tailors →]                               │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 7.3 Loading States

Current loading states are `"Loading your orders..."` text in a bone card. These should be skeleton shimmer cards:

```
┌─────────────────────────────────────────────────────┐
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓         ▓▓▓▓▓▓     (shimmer)       │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓                                 │
│  ▓▓▓▓▓▓▓▓                                           │
└─────────────────────────────────────────────────────┘
```

CSS `animate-pulse` on `bg-ink/6` divs. One-liner Tailwind implementation.

### 7.4 Warning/Error Notice Placement

`ActionNotice` uses background tint for error/success — correct. But it appears above the action button, which means the user sees the error before they see the form. Move it below the form inputs, above the submit button.

### 7.5 Form Input Style Consistency

Current form inputs use `rounded-full` with `border border-ink/10`. This works for single-line inputs but looks awkward on `textarea` elements (which use `rounded-[1rem]`). Standardize: `textarea` should use `rounded-2xl` (slightly rounded corner, not pill). Select elements look good as rounded-full.

---

## 8. Missing Surfaces — Priority Order

| Surface | Route | What it needs | Priority |
|---|---|---|---|
| Tailor earnings | `/account/earnings` | Transaction list, status breakdown, date filter, CSV download | P0 — tailors can't see their money on web |
| Tailor payout setup | `/account/payout` | Stripe Connect OAuth flow, Paystack recipient entry, status + change cooldown | P0 — required for payout readiness |
| Tailor profile edit | `/account/profile` | Bio, location, availability, specialty tags (partial) | P1 |
| Order create (brief) | `/account/brief/[tailorId]` | Multi-step brief form — large undertaking | P1 |
| Realtime messages | Existing `/account/messages` | Add Supabase realtime channel subscription | P1 |
| Tailor kanban pipeline | Existing `/account/work` | Add kanban view on desktop, keep list on mobile | P1 |
| Stage timeline visual | Existing `order-detail` | Visual stage bar above timeline section | P2 |
| Navigation sidebar | All account routes | Left sidebar on desktop, drawer on mobile | P2 |
| Per-surface data fetching | Architecture | Split `fetchAccountSurfaceData` by surface | P2 |
| Skeleton loading states | All surfaces | CSS shimmer on data cards | P3 |
| Smart "Open app" button | All account pages | iOS deep link with App Store fallback | P2 |

---

## 9. Route Structure Recommendation

The current flat structure (`/account/[surface]`) is fine. Do not add role-prefixed routes (`/account/customer/orders`) — the role is determined by session data, not the URL. Adding role-prefixed routes creates duplicate URL structures that require redirect management.

One addition: redirect `/account` → `/account/dashboard` (currently `/account` is the marketing page, not the signed-in dashboard — this is confusing once signed in).

The `account/customer/page.tsx` and `account/tailor/page.tsx` marketing pages should redirect to `/account/dashboard` if the user is already signed in.

---

## 10. Build Order

Given what already exists and what needs to be added:

**Sprint 1 (most impactful, least new infrastructure):**
1. Add realtime subscription to messages surface — single useEffect, no architecture change
2. Add stage pills with color tinting on order cards — styling change only
3. Add visual stage timeline bar to order detail — new component, pure UI
4. Fix `drape://` deep link with App Store fallback — single new component

**Sprint 2 (new surfaces):**
5. Build tailor earnings surface — new data query + display
6. Build tailor payout setup surface — new form flow with edge function calls
7. Add kanban view to work surface (desktop only) — layout logic on existing data

**Sprint 3 (architecture):**
8. Split `account-app-surface.tsx` into per-surface files — no behavior change, just code organization
9. Extract shared profile data into React Context — performance improvement
10. Add sidebar nav on desktop — layout redesign of `AccountRouteShell`

**Sprint 4 (brief + onboarding):**
11. Build order brief form on web — large scope, requires its own design doc
12. Build tailor profile editor on web

---

## 11. Things That Should Stay Mobile-Only

Explicitly do not build these on web — document the decision:

| Feature | Reason to keep mobile-only |
|---|---|
| Drape Vision body scan | ARKit native, no viable web equivalent |
| Production proof photo capture | Camera capture UX is native-optimized |
| Biometric lock | Not appropriate for web session model |
| Native push notification opt-in | Web push is a separate implementation (add later) |
| Tailor video call room creation | Already works on web via `window.open()` — done |
| Payment sheet (Stripe native SDK) | Already replaced with Stripe Elements on web — done |
| Paystack in-app browser | Already replaced with `window.location.assign(authorizationUrl)` on web — done |
