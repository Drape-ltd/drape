# Tailor UI Parity — Implementation Prompt

## Context

File: `apps/web/components/account-app-surface.tsx` (~11,988 lines)

The web tailor UI doesn't match the mobile app's tailor experience in three critical ways:

1. **Explore appears in the tailor nav** — Explore is a customer feature for finding tailors. Tailors should never see it in their own nav.
2. **The nav is customer-first** — "Buying" group (Explore, Saved, Orders, Messages, Measurements) always appears before the tailor's "Your work" group, even when the user is a tailor.
3. **RenderWork (line ~9765) is a kanban** — Mobile's dashboard is a "Tailor cockpit" with a metrics row, availability tile, payout tile, and a dynamic "Today" focus card. The web shows a 4-column kanban with no personality.
4. **RenderProfile (line ~10514) is a static info dump** — Mobile has an avatar hero with live status dot, availability + live status pills, stats pills (Rating/Reviews/Orders), a Trust & access row, and a flat action list (share profile, invite client, invite colleague, switch to customer mode). The web just shows info cards.

Mobile reference files for these:
- Mobile tabs: `apps/mobile/app/(tailor)/_layout.tsx` — tabs are Dashboard, Clients, Orders, Shop, Profile
- Mobile dashboard: `apps/mobile/app/(tailor)/index.tsx`
- Mobile profile: `apps/mobile/app/(tailor)/profile/index.tsx`

---

## Change 1 — Nav restructure (lines ~3030–3064)

### Current nav (broken for tailors)
```tsx
const groups = [
  {
    title: 'Buying',
    items: [
      { label: 'Explore', ... },     // ← WRONG: shown to tailors
      ...(hasTailorWorkspace ? [] : [{ label: 'Marketplace', ... }]),
      { label: 'Saved', ... },
      { label: 'Orders', ... },
      { label: 'Messages', ... },
      { label: 'Measurements', ... },
    ],
  },
  ...(hasTailorWorkspace ? [{ title: 'Your work', items: [...] }] : []),
  { title: 'Account', items: [...] },
]
```

### New nav — tailor-first when `hasTailorWorkspace`
When the user has a tailor workspace, show a completely different nav group arrangement:

```tsx
const groups: Array<...> = hasTailorWorkspace
  ? [
      {
        title: 'Workspace',
        items: [
          { label: 'Dashboard', href: '/account/work' as Route, icon: 'briefcase' as const, badge: tailorActiveOrderCount > 0 ? String(tailorActiveOrderCount) : null },
          { label: 'Orders', href: '/account/orders' as Route, icon: 'orders' as const, badge: tailorActiveOrderCount > 0 ? String(tailorActiveOrderCount) : null },
          { label: 'Messages', href: '/account/messages' as Route, icon: 'message' as const, badge: unreadCount > 0 ? String(unreadCount) : null },
          { label: 'Shop', href: '/account/shop' as Route, icon: 'card' as const },
          { label: 'Earnings', href: '/account/earnings' as Route, icon: 'wallet' as const },
          { label: 'Payout', href: '/account/payout' as Route, icon: 'wallet' as const, badge: payoutNeedsSetup ? '!' : null },
          { label: 'Profile', href: '/account/profile' as Route, icon: 'profile' as const },
        ],
      },
      {
        title: 'Account',
        items: [
          { label: 'Settings', href: '/account/settings', icon: 'settings' },
          { label: 'Support', href: '/account/support', icon: 'help' },
        ],
      },
    ]
  : [
      {
        title: 'Buying',
        items: [
          { label: 'Explore', href: '/account/explore', icon: 'search' },
          { label: 'Marketplace', href: '/account/shop' as Route, icon: 'card' as const },
          { label: 'Saved', href: '/account/saved', icon: 'heart' },
          { label: 'Orders', href: '/account/orders', icon: 'orders', badge: customerActiveOrderCount > 0 ? String(customerActiveOrderCount) : null },
          { label: 'Messages', href: '/account/messages', icon: 'message', badge: unreadCount > 0 ? String(unreadCount) : null },
          { label: 'Measurements', href: '/account/measurements', icon: 'ruler' },
        ],
      },
      {
        title: 'Account',
        items: [
          { label: 'Settings', href: '/account/settings', icon: 'settings' },
          { label: 'Support', href: '/account/support', icon: 'help' },
        ],
      },
    ]
```

**Key points:**
- Tailors see `Workspace` group (their work) + `Account` group only. No Explore. No Saved. No Measurements.
- "Dashboard" is the label for `/account/work` (matches mobile "Dashboard" tab). The existing route stays `/account/work`.
- Remove the duplicate badge on the "Work queue"/"Dashboard" item and "Orders" item for tailors — use `tailorActiveOrderCount` on Dashboard and `tailorActiveOrderCount` on Orders (same count, different entry point).
- Customer-only users see the current "Buying" group unchanged.
- The `isActive` function at line ~3066 already handles `/account/work` correctly — no change needed there.

Also update `surfaceCopy.work` (line ~791) to match the cockpit tone:
```tsx
work: {
  eyebrow: 'Tailor cockpit',
  title: 'Your business at a glance.',
  body: 'Active orders, availability, payout readiness, and the next action that needs your attention — all from one surface.',
},
```

---

## Change 2 — RenderWork cockpit redesign (line ~9765)

Replace the body of `RenderWork` (everything from the `return (` down to the closing `}`) with the cockpit layout below. The function signature and the guard clause for `!data.tailorProfile` stay the same. The `WorkOrderCard` inner component and the `columns` derivation can be kept for the desktop kanban section.

### Data to derive before the return
```tsx
const tailorOrders = data.orders.filter(/* existing filter */)
const activeOrders = tailorOrders.filter((order) => !isTerminalOrder(order))
const pendingReplyOrders = activeOrders.filter((order) =>
  ['PENDING_QUOTE', 'CONSULTATION'].includes(order.stage ?? '')
)
const availability = data.tailorProfile.availability ?? 'OPEN'
const availLabel = availability === 'OPEN' ? 'Open for orders' : availability === 'LIMITED' ? 'Limited availability' : 'Fully booked'
const availHint = availability === 'OPEN' ? 'Customers can find and book you.' : availability === 'LIMITED' ? 'Visible with a slower-reply notice.' : 'New bookings paused; active orders unaffected.'
const availColor = availability === 'OPEN' ? 'bg-emerald-500' : availability === 'LIMITED' ? 'bg-amber-400' : 'bg-rust'
const payoutVerified = data.tailorProfile.payout_account_verified && !data.tailorProfile.payout_reverification_required
const payoutLabel = payoutVerified ? 'Payout ready' : data.tailorProfile.payout_reverification_required ? 'Reverification needed' : 'Not set up'
const payoutHint = payoutVerified
  ? (data.tailorProfile.payout_bank_name ?? data.tailorProfile.payout_provider ?? 'Account verified')
  : data.tailorProfile.payout_reverification_required
    ? 'Open Payout to re-verify your account.'
    : 'Set up payouts before earnings can release.'
const payoutBadgeStyle = payoutVerified
  ? 'bg-needle/10 text-needle'
  : data.tailorProfile.payout_reverification_required
    ? 'bg-rust/10 text-rust'
    : 'bg-amber-400/15 text-amber-600'

// "Today focus" — show most urgent thing
const todayFocus = (() => {
  if (pendingReplyOrders.length > 0) {
    return {
      tone: 'warning' as const,
      eyebrow: 'Today',
      title: `${pendingReplyOrders.length} quote${pendingReplyOrders.length === 1 ? '' : 's'} waiting`,
      body: 'Send clear pricing or request a consultation before the customer cools off.',
      action: 'Review orders',
      actionHref: '/account/orders' as Route,
    }
  }
  if (activeOrders.length > 0) {
    const next = activeOrders[0]
    return {
      tone: 'default' as const,
      eyebrow: 'Today',
      title: orderTitle(next),
      body: orderActionCopy(next, data) ?? 'Check the order for the next step.',
      action: 'Open active orders',
      actionHref: '/account/orders' as Route,
    }
  }
  if (!payoutVerified) {
    return {
      tone: 'default' as const,
      eyebrow: 'Today',
      title: payoutLabel,
      body: payoutHint,
      action: 'Set up payout',
      actionHref: '/account/payout' as Route,
    }
  }
  return {
    tone: 'success' as const,
    eyebrow: 'Today',
    title: 'No urgent actions',
    body: 'Your queue is clear. Update your availability or review your shop while it stays quiet.',
    action: 'Manage availability',
    actionHref: '/account/profile' as Route,
  }
})()
```

### JSX cockpit layout

```tsx
return (
  <div className="grid gap-6">

    {/* ── Cockpit card ── */}
    <section className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-5 shadow-sm">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Tailor cockpit</p>
          <h2 className="mt-2 text-3xl text-ink">{safeEntityName(data.tailorProfile.business_name || data.tailorProfile.display_name, 'Dashboard')}</h2>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${data.tailorProfile.is_live ? 'bg-needle/10 text-needle' : 'bg-ink/8 text-ink/52'}`}>
          {data.tailorProfile.is_live ? '● Live' : 'Hidden'}
        </span>
      </div>

      {/* Metrics row */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-[1.1rem] bg-bone/70 px-4 py-3">
          <p className="text-2xl font-semibold text-ink">{activeOrders.length}</p>
          <p className="mt-0.5 text-xs text-ink/52">Active</p>
        </div>
        <div className="rounded-[1.1rem] bg-bone/70 px-4 py-3">
          <p className={`text-2xl font-semibold ${pendingReplyOrders.length > 0 ? 'text-amber-600' : 'text-ink'}`}>{pendingReplyOrders.length}</p>
          <p className="mt-0.5 text-xs text-ink/52">Needs reply</p>
        </div>
        <div className="rounded-[1.1rem] bg-bone/70 px-4 py-3">
          <p className="text-2xl font-semibold text-ink">{data.tailorProfile.total_orders ?? 0}</p>
          <p className="mt-0.5 text-xs text-ink/52">Completed</p>
        </div>
      </div>

      {/* Status tiles */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        {/* Availability tile */}
        <Link href="/account/profile" className="rounded-[1.1rem] bg-needle/8 p-3 transition hover:bg-needle/12">
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${availColor}`} />
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-needle/70">Availability</span>
          </div>
          <p className="mt-1.5 text-sm font-semibold text-ink">{availLabel}</p>
          <p className="mt-0.5 text-xs leading-4 text-ink/52">{availHint}</p>
        </Link>

        {/* Payout tile */}
        <Link href="/account/payout" className="rounded-[1.1rem] bg-needle/8 p-3 transition hover:bg-needle/12">
          <div className="flex items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${payoutBadgeStyle}`}>{payoutLabel}</span>
          </div>
          <p className="mt-1.5 text-sm font-semibold text-ink">Payout</p>
          <p className="mt-0.5 text-xs leading-4 text-ink/52">{payoutHint}</p>
        </Link>
      </div>

      {/* Today focus card */}
      <div className={`mt-3 rounded-[1.1rem] border p-4 ${
        todayFocus.tone === 'warning'
          ? 'border-amber-300/40 bg-amber-400/8'
          : todayFocus.tone === 'success'
            ? 'border-needle/16 bg-needle/6'
            : 'border-ink/8 bg-bone/60'
      }`}>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-needle/70">{todayFocus.eyebrow}</p>
        <p className="mt-1.5 text-base font-semibold text-ink">{todayFocus.title}</p>
        <p className="mt-1 text-xs leading-5 text-ink/56">{todayFocus.body}</p>
        <Link
          href={todayFocus.actionHref}
          className="mt-3 inline-flex rounded-full bg-needle px-4 py-2 text-xs font-semibold text-white"
        >
          {todayFocus.action}
        </Link>
      </div>
    </section>

    {/* ── Active order queue (mobile-first list) ── */}
    <section className="lg:hidden grid gap-3">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Order queue</p>
      {activeOrders.length === 0 ? (
        <EmptyState
          title="No active work right now."
          body="New custom briefs and ready-made orders will appear here when customers place them."
          action={<Link href="/account/shop" className="font-semibold text-needle">Review shop</Link>}
        />
      ) : (
        activeOrders.map((order) => <WorkOrderCard key={order.id} order={order} />)
      )}
    </section>

    {/* ── Desktop kanban (existing 4-column layout) ── */}
    <section className="hidden gap-4 lg:grid lg:grid-cols-4">
      {columns.map((column) => (
        <div key={column.key} className="rounded-[1.4rem] border border-ink/8 bg-white/64 p-4">
          <div className="min-h-20">
            <h2 className="text-2xl text-ink">{column.title}</h2>
            <p className="mt-2 text-xs leading-5 text-ink/54">{column.body}</p>
          </div>
          <div className="mt-4 grid gap-3">
            {column.orders.length === 0 ? (
              <p className="rounded-[1rem] bg-white/72 p-4 text-sm leading-6 text-ink/48">Nothing here.</p>
            ) : (
              column.orders.map((order) => (
                <WorkOrderCard key={`${column.key}-${order.id}`} order={order} compact={column.key === 'done'} />
              ))
            )}
          </div>
        </div>
      ))}
    </section>

  </div>
)
```

**Notes:**
- `safeEntityName`, `orderTitle`, `orderActionCopy`, `EmptyState`, `WorkOrderCard`, `columns`, `StagePill`, `StageProgressBar` are all defined inside or near `RenderWork` — keep all of them.
- `todayFocus.actionHref` is typed as `Route` — import or cast as needed (same pattern as other uses in the file).
- The availability update on mobile goes through a bottom-sheet modal. On web, link the availability tile to `/account/profile` where the tailor can update it. This is acceptable for parity.

---

## Change 3 — RenderProfile redesign (line ~10514)

Keep the function signature and the `!profile` guard. Replace the return body.

The new profile has 4 sections:

### A. Hero card — avatar + name + location + status pills

```tsx
{/* Hero */}
<section className="rounded-[1.6rem] border border-ink/8 bg-white/84 shadow-sm overflow-hidden">
  {/* Avatar + identity */}
  <div className="flex items-start gap-5 p-6 pb-4">
    {/* Avatar with live dot */}
    <div className="relative shrink-0">
      <div className="h-[76px] w-[76px] overflow-hidden rounded-full border border-ink/10 bg-needle/10">
        {profile.avatar_url ? (
          <Image
            src={safeMediaUrl(profile.avatar_url) ?? ''}
            alt=""
            width={76}
            height={76}
            className="h-full w-full object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xl font-bold text-needle">
            {(profile.business_name || profile.display_name || '?')[0].toUpperCase()}
          </div>
        )}
      </div>
      {/* Live status dot */}
      <span
        className={`absolute left-1 top-1 h-3 w-3 rounded-full border-2 border-white ${profile.is_live ? 'bg-emerald-500' : 'bg-ink/30'}`}
      />
    </div>

    {/* Name + location */}
    <div className="min-w-0 flex-1 pt-1">
      <h2 className="truncate text-2xl text-ink">
        {safeEntityName(profile.business_name || profile.display_name, 'Tailor profile')}
      </h2>
      {profile.location ? (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-ink/52">
          {/* pin icon */}
          <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7Z" />
            <circle cx="12" cy="9" r="2.5" />
          </svg>
          {profile.location}
        </p>
      ) : null}

      {/* Availability + live status pills */}
      <div className="mt-3 flex flex-wrap gap-2">
        {/* Availability */}
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
          profile.availability === 'OPEN'
            ? 'bg-bone text-ink'
            : profile.availability === 'LIMITED'
              ? 'bg-amber-400/15 text-amber-700'
              : 'bg-rust/10 text-rust'
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${
            profile.availability === 'OPEN' ? 'bg-emerald-500' : profile.availability === 'LIMITED' ? 'bg-amber-400' : 'bg-rust'
          }`} />
          {profile.availability === 'OPEN' ? 'Available' : profile.availability === 'LIMITED' ? 'Limited' : 'Fully booked'}
        </span>
        {/* Live status */}
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
          profile.is_live
            ? 'bg-needle/10 text-needle'
            : profile.id_verification_status === 'PENDING'  // Note: check actual column name in TailorProfile type
              ? 'bg-amber-400/15 text-amber-700'
              : 'bg-ink/8 text-ink/50'
        }`}>
          {profile.is_live ? '● Live' : 'Not live'}
        </span>
      </div>
    </div>
  </div>

  {/* Stats row */}
  <div className="grid grid-cols-3 gap-px border-t border-ink/6 bg-ink/6">
    {/* Rating */}
    <button
      type="button"
      className="bg-white/84 px-4 py-3 text-center transition hover:bg-bone/60"
    >
      <p className="text-xl font-semibold text-ink">
        {(profile.avg_rating ?? 0) > 0 ? (profile.avg_rating ?? 0).toFixed(1) : '—'}
      </p>
      <p className="mt-0.5 text-xs text-ink/48">★ Rating</p>
    </button>
    {/* Reviews */}
    <button type="button" className="bg-white/84 px-4 py-3 text-center transition hover:bg-bone/60">
      <p className="text-xl font-semibold text-ink">{profile.total_reviews ?? 0}</p>
      <p className="mt-0.5 text-xs text-ink/48">Reviews</p>
    </button>
    {/* Orders */}
    <button type="button" className="bg-white/84 px-4 py-3 text-center transition hover:bg-bone/60">
      <p className="text-xl font-semibold text-ink">{profile.total_orders ?? 0}</p>
      <p className="mt-0.5 text-xs text-ink/48">Orders</p>
    </button>
  </div>
</section>
```

**Note:** The `TailorProfile` type at line ~202 uses `avg_rating`, `total_reviews`, `total_orders`, `availability`, `is_live`, `avatar_url` — all available. There is no `id_verification_status` directly on the profile type in the web. For the "Not live" badge, just check `profile.is_live` — if not live, show the "Hidden" variant. Keep it simple.

### B. Selling setup card

Keep the existing "Craft basics" + "Operational readiness" cards but rewrite them to match the mobile "Selling setup" card style (labeled rows with a needle-colored icon bubble, not just `SummaryLine`):

```tsx
{/* Selling setup */}
<section className="rounded-[1.6rem] border border-ink/8 bg-white/84 p-5 shadow-sm">
  <div className="flex items-center justify-between">
    <h3 className="text-xl text-ink">Selling setup</h3>
    <Link href="/account/settings" className="text-xs font-semibold text-needle">Edit →</Link>
  </div>
  <div className="mt-4 grid gap-0 divide-y divide-ink/6">
    {/* Each row: needle icon bubble + label + value */}
    {[
      {
        label: 'Offers',
        value: [profile.supports_custom_orders && 'Custom orders', profile.supports_ready_made && 'Ready-made'].filter(Boolean).join(' + ') || 'No offers enabled',
      },
      {
        label: 'Fulfillment',
        value: [profile.pickup_available && 'Pickup', profile.delivery_available && 'Delivery', profile.shipping_available && 'Shipping'].filter(Boolean).join(' · ') || 'Not configured',
      },
      {
        label: 'Specialties',
        value: safeList(profile.specialty_tags, 'Not set'),
      },
      {
        label: 'Languages',
        value: safeList(profile.languages, 'Not set'),
      },
      {
        label: 'Payout',
        value: payoutStatusLabel(profile),
      },
    ].map((row, i, arr) => (
      <div key={row.label} className={`flex items-start gap-3 py-3 ${i === arr.length - 1 ? '' : ''}`}>
        <span className="mt-0.5 text-xs font-semibold text-ink/42 w-24 shrink-0">{row.label}</span>
        <span className="flex-1 text-right text-xs font-semibold text-ink">{row.value}</span>
      </div>
    ))}
  </div>
</section>
```

### C. Portfolio manager

Keep the existing `<PortfolioManager data={data} onRefresh={onRefresh} />` — it's fine as-is.

### D. Action list — share, invite, switch to customer, account settings

Replace the current "Profile editing is limited on web" section with a full flat action list matching the mobile profile screen structure:

```tsx
{/* Action list */}
<section className="overflow-hidden rounded-[1.6rem] border border-ink/8 bg-white/84 shadow-sm">
  {[
    profile.is_live && {
      label: 'Share my live profile',
      href: null as null,
      onClick: () => { /* Copy profile URL to clipboard */ navigator.clipboard?.writeText(`https://drapeon.co/tailors/${profile.id}`) },
    },
    {
      label: 'Edit profile in app',
      href: null as null,
      onClick: () => { /* OpenAppButton equivalent — no-op with hint */ },
    },
    {
      label: 'Review payout setup',
      href: '/account/payout' as Route,
      onClick: null,
    },
  ].filter(Boolean).map((action, i, arr) => (
    action.href ? (
      <Link
        key={action.label}
        href={action.href}
        className={`flex min-h-[52px] items-center justify-between gap-3 px-5 py-3.5 text-sm font-semibold text-ink transition hover:bg-bone/60 ${i < arr.length - 1 ? 'border-b border-ink/6' : ''}`}
      >
        {action.label}
        <span className="text-ink/30">→</span>
      </Link>
    ) : (
      <button
        key={action.label}
        type="button"
        onClick={action.onClick ?? undefined}
        className={`flex min-h-[52px] w-full items-center justify-between gap-3 px-5 py-3.5 text-left text-sm font-semibold text-ink transition hover:bg-bone/60 ${i < arr.length - 1 ? 'border-b border-ink/6' : ''}`}
      >
        {action.label}
        <span className="text-ink/30">→</span>
      </button>
    )
  ))}
</section>

{/* "Edit in app" notice — for features gated to mobile */}
<section className="rounded-[1.6rem] border border-needle/12 bg-needle/6 p-5">
  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/70">Mobile only</p>
  <p className="mt-2 text-sm leading-6 text-ink/66">
    Bio editing, portfolio uploads, ID verification, and sensitive payout changes need the app's camera and reauth controls.
  </p>
  <OpenAppButton label="Edit profile in app" className="mt-4" />
</section>
```

**Simplification note:** For "Share my live profile", copy the URL to clipboard using `navigator.clipboard.writeText`. Add a brief `useState` for a "Copied!" confirmation label on the button (revert after 2 seconds). Keep it simple.

---

## Change 4 — surfaceCopy for `profile` surface (line ~804)

Update so the header copy matches the mobile profile screen tone:

```tsx
profile: {
  eyebrow: 'Your profile',
  title: 'Storefront, setup, and trust.',
  body: 'Manage your live profile, payout readiness, portfolio, and how customers see your business on Drapeon.',
},
```

---

## Change 5 — `accountHomeHref` stays `/account/work` for tailors (line ~3022)

No change needed — this already goes to `/account/work` for tailors, which now renders the cockpit.

---

## TypeScript checks

After all edits, run:
```
cd apps/web && npx tsc --noEmit
```

Fix any type errors before declaring done. The most likely issue is the `Route` type cast on `todayFocus.actionHref` — use `as Route` where needed, matching the existing pattern in the file.

---

## What to NOT change

- `RenderShop` tailor view — already shows a sensible seller item manager + grid. Acceptable parity.
- `RenderEarnings` — functional and data-complete. The range selector + CSV export is actually better than mobile. Keep it.
- `RenderPayout` — functional Stripe/Paystack form. Keep it.
- `RenderTailorDetail` / `RenderItemDetail` — already redesigned in this session with immersive heroes.
- The mobile has a "Clients" tab (CRM with platform customers + in-person diary). This does not exist on web and is out of scope for this change — it would need new surface data, a new `AccountSurface` type entry, and new DB queries. Mark it as future work.

---

## Checklist

- [ ] Nav: tailors see Workspace group (no Explore), customers see Buying group unchanged
- [ ] `surfaceCopy.work` updated to cockpit tone
- [ ] `surfaceCopy.profile` updated to storefront tone
- [ ] `RenderWork`: cockpit card with metrics row + availability tile + payout tile + today-focus card, plus mobile-view list and desktop kanban below
- [ ] `RenderProfile`: avatar hero with live dot + availability/live pills + stats row + selling setup card + portfolio manager + action list + "edit in app" notice
- [ ] `npx tsc --noEmit` passes with no new errors
