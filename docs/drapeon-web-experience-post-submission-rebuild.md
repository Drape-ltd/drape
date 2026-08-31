# Drapeon Web Experience — Post-Submission Rebuild

Status: Design and architecture proposal
Scope: Public website, authentication, customer web, tailor web
Related: `docs/drapeon-ops-control-plane-post-submission-rebuild.md`

## 1. Objective

Rebuild Drapeon web as a premium global fashion marketplace and dependable working product. The public site must sell the service. Signed-in customer and tailor surfaces must complete real workflows without inheriting the visual or architectural constraints of Ops.

This is not a homepage reskin. It is a controlled replacement of the current public and account presentation layers while preserving authoritative database, Edge, shared-domain, payment, messaging, notification, and role contracts.

## 2. Product Surfaces

```text
drapeon.co
├── Public marketplace
│   ├── Home
│   ├── Explore
│   ├── Tailor profile
│   ├── Ready-made item
│   ├── How Drapeon works
│   ├── Drapeon Vision
│   ├── Trust, security, pricing, help, and legal
│   └── Authentication entry
├── Customer workspace
│   ├── Home
│   ├── Explore and saved
│   ├── Briefs and orders
│   ├── Messages
│   ├── Measurements
│   ├── Notifications
│   └── Account, privacy, and support
├── Tailor workspace
│   ├── Home and My Work
│   ├── Briefs, quotes, and orders
│   ├── Messages
│   ├── Shop and portfolio
│   ├── Earnings and payout readiness
│   ├── Trust and profile
│   └── Account, privacy, and support
└── Ops control plane
    └── Separate architecture, navigation, authorization, and deployment concerns
```

Public, customer, tailor, and Ops may share domain contracts and primitives. They must not share one giant rendering component or one universal navigation tree.

## 3. Current-State Findings

- `account-app-surface.tsx` is approximately 22,160 lines and owns unrelated customer and tailor responsibilities.
- Public pages repeat local section, card, and CTA treatments instead of composing a page system.
- Account routes are thin aliases into a monolith, preventing route-level loading, caching, error isolation, ownership, and testing.
- The website describes the product but does not yet present the emotional quality of global fashion or the proof of a functioning marketplace.
- Authentication has improved, but public discovery, provider entry, new-role selection, setup, and contextual returns still need to feel like one journey.
- Ops code remains architecturally separate in intent but is physically colocated with the customer/tailor web application.
- Explicit caching and query ownership are inconsistent. Large client surfaces fetch too much and recover too broadly.

## 4. Experience Principles

1. Fashion first, software second. Lead with people, garments, craft, movement, and outcome.
2. Real marketplace proof. Use authentic approved profiles, portfolios, order states, and conversations.
3. One job per screen. Avoid dashboard walls and mixed-role navigation.
4. Quiet confidence. Editorial typography, warm materials, precise spacing, and restrained motion.
5. Global by default. Casting, garments, locations, names, currencies, and copy must not imply one-region service.
6. Browse before commitment. Public discovery must work without authentication; private actions create a contextual sign-in checkpoint.
7. Durable workflow state. Reload, back, deep links, and another device must show authoritative state.
8. Fast by design. Server-render useful content, stream slower regions, cache public reads, and isolate live account data.

## 5. Visual Direction

### Brand system

- Background: warm bone and paper, not cold SaaS grey.
- Text: deep ink with accessible muted tones.
- Primary: Drapeon green.
- Accent: garment-derived seasonal colors used sparingly in editorial media, never as competing UI colors.
- Display typography: Fraunces or the established Drapeon editorial serif.
- Interface typography: Inter.
- Corners: restrained 8–18px radii; pills only for compact controls, filters, and deliberate primary actions.
- Icons: one consistent line-icon family with accessible labels and tooltips.
- Depth: borders, tonal layering, and selective shadows rather than glass everywhere.

### Rejected directions

- Generic purple SaaS palettes.
- Persistent glassmorphism over body content.
- Decorative charts in customer or tailor workspaces.
- Autoplay video without controls, a poster, reduced-motion handling, and bandwidth restraint.
- Fake testimonials, fabricated metrics, AI-generated app UI, or unsupported claims.
- Africa-only casting or garment selection. Drapeon is a global marketplace.

## 6. Homepage Narrative

### Hero

A full-bleed, rounded cinematic panel shows a short, quiet tailoring sequence:

```text
fabric selection → pattern work → hand finishing → fitting → finished garment in motion
```

Overlay:

- Drapeon wordmark and minimal public navigation.
- Headline: `Made for you. Wherever you are.`
- Supporting line: `Discover independent tailors and follow every detail.`
- Primary action: `Explore Drapeon`.
- Secondary action: `Join as a tailor`.
- Compact sign-in action.
- Mute/unmute and pause/play controls with accessible names.

Video rules:

- Muted and `playsInline`; never depend on audio.
- High-quality poster image is the first paint and reduced-motion experience.
- Responsive AV1/WebM and H.264/MP4 sources.
- Mobile source is separately cropped and materially smaller.
- Do not download full video when Save-Data is enabled.
- Pause when off-screen or when the tab becomes hidden.
- No text baked into the video.
- Maintain minimum contrast through a controlled scrim, not an opaque black wash.
- Instrument start, meaningful play, pause, completion, and hero CTA—not every frame.

### Remaining home sequence

1. Featured work: editorial garment grid with real approved marketplace content.
2. Global makers: curated tailor profiles across regions and specialties.
3. One connected order: brief → quote → conversation → production → handoff.
4. Ready-made and custom paths shown as equal, understandable choices.
5. Drapeon Vision explained honestly as optional measurement assistance.
6. Trust and payment protection with direct policy links.
7. Tailor proposition with a dedicated application path.
8. Final Explore CTA and complete footer.

### Marketplace truth gate

- Never present seeded, generated, staged, or showcase-only identities as live marketplace supply.
- Named makers, locations, ratings, availability, portfolio claims, and inventory may render publicly only from approved authoritative marketplace records.
- When real supply is not yet available, lead with craft, product capability, process, and honest access language instead of simulated social proof.
- Editorial imagery may illustrate materials and craft, but must not imply that an identifiable person or business is available through Drapeon unless that relationship is real and approved.

## 7. Authentication Journey

```text
Public page or private action
        │
        ├── Continue browsing ──────────────→ public route
        │
        └── Authentication checkpoint
             ├── Continue with Apple
             ├── Continue with Google
             └── Continue with email
                    │
                    ├── Established account → preserved role and contextual return
                    └── New account → choose customer or tailor → setup → contextual return
```

Requirements:

- Provider buttons use approved brand treatment and equivalent prominence.
- “Continue” covers new and returning users.
- Never ask provider-authenticated users for a Drapeon password.
- Store only sanitized contextual return data.
- Existing role wins over entry-page intent.
- Setup is resumable and draft-safe.
- Sign-in, sign-up, recovery, verification, account switching, and deletion share one auth shell but remain distinct flows.

## 8. Authenticated Information Architecture

### Customer

```text
Home        current orders, next actions, recent messages
Explore     public discovery with authenticated save/order actions
Orders      active, awaiting action, completed
Messages    conversations grouped by project
Saved       tailors, ready-made pieces, collections
Fit         measurements, profiles, Drapeon Vision
Account     identity, privacy, notifications, support, deletion
```

### Tailor

```text
Home        My Work, deadlines, briefs, unread conversations
Work        briefs, quotes, active orders, handoff
Messages    project conversations
Shop        ready-made inventory, portfolio, availability
Earnings    balances, payout readiness, payout history
Profile     public presence, trust review, services
Account     identity, privacy, notifications, support, deletion
```

Role switching, if supported, must be explicit. Never mix customer and tailor actions in one default navigation.

## 9. Frontend Architecture

Target structure:

```text
apps/web/
├── app/
│   ├── (marketing)/
│   ├── (auth)/
│   ├── (marketplace)/
│   ├── account/customer/
│   ├── account/tailor/
│   └── ops/                    # temporary until extraction decision
├── features/
│   ├── auth/
│   ├── discovery/
│   ├── briefs/
│   ├── orders/
│   ├── messaging/
│   ├── measurements/
│   ├── shop/
│   ├── earnings/
│   └── account/
├── components/
│   ├── marketing/
│   ├── workspace/
│   └── ui/
└── lib/
    ├── server/
    ├── client/
    ├── cache/
    └── observability/
```

Rules:

- Server Components are the default for page composition and initial reads.
- Client Components begin at the smallest interactive boundary.
- One feature owns its queries, mutations, optimistic behavior, empty/error states, and tests.
- Shared domain types and action derivation remain in `@drape/shared`.
- Mobile and web call the same authoritative Edge/database transition.
- Replace the account monolith incrementally; do not rewrite all workflows at once.
- Route-level loading and error boundaries must preserve navigation and recovery.

## 10. Data, Caching, and Realtime

| Data class | Strategy |
| --- | --- |
| Marketing copy and legal navigation | build/static cache with explicit revalidation |
| Approved public tailors and items | cached read gateway, tagged invalidation, 30–120 second freshness |
| Tailor profile detail | cached public record with targeted invalidation after approved changes |
| Authenticated dashboard summary | server read scoped to user; short-lived request cache only |
| Orders, briefs, money, privacy, trust | authoritative uncached read unless a bounded domain cache is proven safe |
| Messages and workflow events | paginated initial read plus realtime deltas and reconnect reconciliation |
| Media | CDN transformation, responsive sizes, immutable asset URLs where possible |

No homepage request may fan out across every domain table. Public collections need bounded read models. Authenticated dashboards need purpose-built summaries, not dozens of independent client queries.

## 11. Security and Privacy

- Public routes may access approved public read models only.
- Every authenticated server action verifies the session, role, resource ownership, current workflow state, and idempotency key.
- Never trust role or resource IDs from client state alone.
- Keep Ops authentication and authorization separate from customer/tailor account access.
- Sanitize `returnTo`, deep-link identifiers, image URLs, and user-generated rich content.
- Apply CSP, frame restrictions, secure cookies, origin checks, rate limits, and upload validation.
- Do not leak addresses, phone numbers, private media, trust videos, payout details, or provider errors into public responses or client logs.
- Sentry events use normalized errors, safe identifiers, release, environment, route, and correlation IDs.
- Account deletion and provider-token revocation remain authoritative server workflows.

## 12. Performance Budgets

- LCP: under 2.5s at the 75th percentile on representative mobile connections.
- INP: under 200ms at the 75th percentile.
- CLS: under 0.1.
- Homepage initial JavaScript: target under 170KB gzip, excluding consented analytics.
- Authenticated route initial JavaScript: budget per route, not one account-wide bundle.
- Hero poster under 250KB; initial mobile video source target under 1.5MB with later quality escalation.
- No blocking third-party script before meaningful content.
- Every image declares size/aspect ratio; every long list paginates or virtualizes.

## 13. Observability

Track journeys, not vanity events:

- Public Explore opened and meaningful profile viewed.
- Auth checkpoint source and successful contextual return.
- Brief started, resumed, submitted, failed, or abandoned.
- Quote viewed and actioned.
- Message send persisted and delivered.
- Payment/handoff action reached a terminal outcome.
- Web Vitals by route, device class, release, and authenticated role.
- Cache hit/miss, read-gateway latency, action latency, realtime reconnects, and route errors.

Analytics remains consent-aware. Operational evidence belongs in structured events and Ops, not only analytics.

## 14. Delivery Sequence

### Phase 0 — Inventory and contracts

- Map all public and authenticated routes, queries, mutations, flags, and role gates.
- Record parity requirements with iOS, Android, database, Edge, communications, and Ops.
- Establish visual tokens, responsive grid, motion rules, and performance budgets.

### Phase 1 — Foundations

- Build new public/workspace shells and navigation.
- Extract design primitives and route-state utilities.
- Add route-level error/loading boundaries and observability.
- Introduce explicit public read caching.

### Phase 2 — Public conversion experience

- Ship video/poster hero, homepage narrative, public Explore, profile, and item pages.
- Complete SEO, metadata, structured data, sitemap, and accessible media behavior.

### Phase 3 — Authentication

- Finish provider-first entry, role checkpoint, resumable setup, recovery, switching, and contextual return across web and mobile.

### Phase 4 — Customer workspace

- Replace Explore, Saved, Orders, Order Detail, Messages, Fit, and Account one vertical slice at a time.

### Phase 5 — Tailor workspace

- Replace My Work, Briefs, Quotes, Orders, Messages, Shop, Earnings, Profile, and Account one vertical slice at a time.

### Phase 6 — Monolith retirement

- Delete migrated branches from `account-app-surface.tsx` only after route-level proof.
- Split server/data modules by domain.
- Add bundle and import-boundary enforcement.

### Phase 7 — Hardening and rollout

- Accessibility, responsive, keyboard, cross-browser, security, cache, load, and failure testing.
- Progressive rollout with route flags and rollback paths.
- Remove legacy routes only after telemetry and support review.

## 15. Vertical-Slice Completion Gate

A migrated feature is complete only when:

1. Its public or authenticated route renders from authoritative state.
2. Mobile and web use the same business transition.
3. Loading, empty, pending, success, duplicate, failure, and recovery states exist.
4. Back, browser history, deep links, reload, and contextual return work.
5. Realtime/revalidation updates without a full-page reset where applicable.
6. Communications reach recorded terminal outcomes.
7. Accessibility, responsive, performance, security, and observability gates pass.
8. The matching legacy branch can be removed without fallback.

## 16. Reference Use

- Refero Styles supplies evidence-based design-system and real-flow references; it does not replace Drapeon’s own tokens or product judgment.
- 60fps supplies motion references and timing breakdowns; Drapeon motion remains sparse, accessible, and performance-budgeted.
- SceneAI supplies landing-page and animated-background inspiration under its applicable license; it must not introduce extractable licensed assets, fabricated UI, or unreviewed production dependencies.
- The supplied Archistry reference informs the contained cinematic hero, nav-over-media composition, readable scrim, and restrained controls. Drapeon’s subject, palette, typography, content, and interaction remain original.

## 17. Launch Decisions Recorded

- The public message is live-account language, not waitlist or invite-only language.
- Signed-out navigation uses `Sign in` and `Create account`. Tailor onboarding remains a separate reviewed application.
- `/explore` is the canonical public marketplace and may only show approved, live, media-complete profiles from authoritative data.
- `/discover` redirects to `/explore`; `/join` redirects to `/sign-up`; `/login` remains a compatibility redirect to `/sign-in`.
- Homepage and retained product pages use original craft/process imagery. Generated people are never presented as real Drapeon supply.
- Press and Careers are not advertised until each has substantive, current content.
- The first protected migration remains `Customer Explore → Public Profile → Contextual Sign-in → Brief`.
- Ops remains a separate post-submission rebuild and must not dictate the public-site information architecture.

## 18. Public Route Disposition

| Route group | Launch disposition |
| --- | --- |
| `/`, `/explore`, `/tailors/[profileId]` | Keep and redesign around truthful public discovery. |
| `/sign-in`, `/sign-up`, `/auth/*` | Keep; concise provider/email entry with sanitized contextual return. |
| `/how-it-works`, `/tailors`, `/vision` | Keep; craft-led visual explanation with direct account/application actions. |
| `/privacy`, `/terms`, `/security`, `/trust`, `/payouts`, `/account-deletion` | Keep as launch policy surfaces; privacy and deletion must remain store-compliant and directly reachable. |
| `/about`, `/contact`, `/partnerships`, `/status`, `/help` | Keep as compact company/support utilities. |
| `/discover`, `/join`, `/login` | Compatibility redirects only. |
| `/press`, `/careers` | Remove from navigation until real programs or materials exist. |
| `/faq`, `/legal`, `/customers`, `/pricing` | Do not advertise as primary routes; consolidate their durable content into Help, Terms, How it works, and checkout disclosures over the next migration slices. |
