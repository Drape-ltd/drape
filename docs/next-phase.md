# Drape Next Phase

## What Is Done

- Mobile core customer and tailor flows are substantially more stable.
- Quote, confirmation, production-stage progression, and completion behavior are much tighter than they were at the start of stabilization.
- Error states, stale-route handling, and recovery paths are far more honest across the app.
- Shared types and workspace typecheck are clean.
- Seeded E2E setup is safer and more portable than before.

## What Is Not Signed Off Yet

- Full manual scratch E2E from a reset database.
- Final product signoff against the original Drape vision docs.
- Final security and architecture review pass for release readiness.
- Final website flow coverage beyond the landing/discovery direction.

## This Week's Focus: March 30, 2026 To April 3, 2026

This week should be about high-risk product plumbing, not scattered polish.

## Status Check: Evening Of March 30, 2026

### Already landed

- Stripe sandbox path is now wired for both `Custom order` and `Shop now`
- native mobile PaymentSheet has been integrated
- payment intents are created server-side and confirmed back into order state
- `stripe-webhook` is deployed for:
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `payment_intent.canceled`
- abandoned `PAYMENT_PENDING` orders now have background timeout handling via
  `expire-pending-payments`
- quote acceptance no longer skips payment:
  - `QUOTE_SENT -> PAYMENT_PENDING -> CONFIRMED`
- ready-made duplicate checkout and quantity guardrails are already in place

### Still open after payment work

- fresh iPhone build and manual end-to-end pass on the new native Stripe build
- shipping fee / provider abstraction is still not represented in totals
- voice / video provider still needs to be selected and integrated
- branding assets still need a dedicated assembly pass
- scheduler setup in Supabase still needs to be added for recurring background runs:
  - `expire-pending-payments`
  - existing quote-expiry / auto-release jobs that should be moved into active runtime

### Must-win outcomes

- Stripe sandbox works for both `Custom order` and `Shop now`
- shipping dependency is wired enough to test real order handoff behavior
- voice and video dependency is selected and integrated behind a stable path
- iPhone end-to-end pass is completed on the current mobile build
- branding asset gaps are identified and the first ship-ready pack is assembled
- critical business logic and preflight rules are written down, reviewed, and started
- release environment parity is checked:
  - Cloudflare deploy path
  - web env vars
  - Supabase secrets
  - Stripe sandbox config
  - shipping provider config
  - call provider config

### Burnout-safe rule for the week

- one heavy track per day
- one light support track per day
- no more than one new platform dependency introduced in the same half-day block
- if a blocker survives half a day, document it and switch to the next highest-value task

## Recommended Week Plan

### Monday, March 30, 2026

- lock payment, shipping, and call-provider decisions
- wire or confirm sandbox credentials and local/dev environment setup
- update business logic and preflight rules docs so implementation has a clear target
- light track:
  - audit branding asset gaps
  - note missing app icon, splash, notification, and store screenshot work

### Tuesday, March 31, 2026

- heavy track:
  - rebuild the iPhone dev client with the native Stripe SDK included
  - run a fresh manual E2E pass for:
    - custom quote payment
    - ready-made checkout payment
    - cancel / retry / resume-from-`PAYMENT_PENDING`
  - verify webhook-driven order confirmation lands cleanly
- light track:
  - add or verify recurring scheduler setup for:
    - `expire-pending-payments`
    - quote expiry
    - auto-release
  - note any missing payment logs or support breadcrumbs during QA

### Wednesday, April 1, 2026

- implement Stripe sandbox for `Shop now`
- add ready-made quantity rules and duplicate-checkout protection
- start shipping integration or manual shipping abstraction:
  - address
  - rate/fee model
  - tracking lifecycle
- light track:
  - notification smoke checks for payment and order updates

### Thursday, April 2, 2026

- integrate voice/video dependency with graceful failure states
- add preflight checks before:
  - payment start
  - checkout submit
  - shipping handoff
  - call join
- light track:
  - brand the main in-app assets and high-visibility states

### Friday, April 3, 2026

- run full iPhone end-to-end pass on the latest build
- fix blockers found in:
  - auth/setup
  - custom order payments
  - ready-made payments
  - shipping
  - calls
- finish the first review-ready branding pack
- cut a short weekly status summary:
  - what shipped
  - what slipped
  - what needs partner/opinion input

### Stretch only if energy remains

- push notification completion for the new flows
- stronger ops logging around failed payments and shipping issues
- release checklist draft for TestFlight / store readiness

## Tomorrow Game Plan: Tuesday, March 31, 2026

If the goal is to avoid burnout and convert today’s plumbing into confidence,
tomorrow should be mostly verification plus one new infrastructure choice.

### Heavy track

1. build and install a fresh iPhone dev client
2. run the full payment QA loop:
   - custom quote accepted and paid
   - ready-made order checked out and paid
   - payment canceled from PaymentSheet
   - stale `PAYMENT_PENDING` resume flow
   - webhook-confirmed order transition to `CONFIRMED`
3. write down every broken or confusing step while testing instead of fixing
   them mid-run

### Light track

- lock the shipping approach for V1:
  - provider now vs manual abstraction now
  - how shipping fee should enter totals
  - how timeout / tracking / delivery states should be represented
- lock the consultation provider:
  - preferred direction remains `Daily`
- keep branding work bounded to an audit list, not a full design sprint

### Definition of a good tomorrow

- payment rails feel trustworthy on iPhone
- no hidden retry dead-ends remain
- shipping and calls each have one clear implementation decision
- the week can shift from architecture to QA and polish

## Highest-Value Next Step

Finish the infrastructure-dependent work first, then run a fresh manual end-to-end
pass from zeroed accounts on iPhone against the updated payment, shipping, and
call flows.

### Customer path

1. Sign up
2. Role select
3. Complete setup
4. Explore tailors
5. Open tailor profile
6. Submit brief
7. Receive quote
8. Accept quote
9. Track stages
10. Confirm delivery or collection
11. Complete order
12. Leave or skip review

### Tailor path

1. Sign up
2. Role select
3. Complete setup
4. Confirm profile is live and coherent
5. Receive brief
6. Review measurements and references
7. Send quote
8. Advance through production
9. Ship or mark ready for collection
10. Confirm handoff

### Passport path

1. Open passport invite from signed-out state
2. Create account or sign in
3. Claim passport
4. Confirm measurements land in customer profile
5. Start a brief using the imported fit data

## What To Watch For In Manual E2E

- Wrong user data appearing after account switches
- Old search or booking state leaking between sessions
- Setup loops or incorrect route guards
- Buttons that appear tappable but do nothing
- Silent failures after uploads, saves, or stage changes
- Inconsistent stage labels between list and detail screens
- Messages and orders falling out of sync
- Measurements not appearing where tailors actually need them
- Consultation flows feeling incomplete on either side
- Shipping or collection states feeling unclear

## Security / Architecture Follow-Up

- Confirm no hardcoded secrets remain in repo history or active code paths.
- Verify all runtime secrets used by functions are current and scoped correctly.
- Review rate-limited functions and confirm all privileged actions still use the intended server-side auth path.
- Do a focused pass on account-deletion, data-export, and support flows to ensure they match actual operations policy.
- Review production logging for any remaining noisy or misleading warnings during normal order flow use.
- Add preflight checks before critical workflow transitions so users fail early and clearly.

## Website Track

The website is still early. The right short-term goal is not “full parity with mobile immediately,” but a clean trust-first marketing, waitlist, and routing flow:

1. Landing page that explains Drape clearly for both customers and tailors
2. Startup-style waitlist entry that lets each side raise a hand before every live web flow exists
2. Customer journey section
3. Tailor journey section
4. Trust / verification / handoff explanation
5. Clear CTA paths for:
   - join as customer
   - join as tailor
   - discover how the order flow works
6. Later:
   - real auth entry
   - real tailor discovery
   - real tailor application funnel
   - eventual high-value parity with the mobile journeys

## Release Gate Before Calling V1 Ready

- Manual scratch E2E passes cleanly
- No critical auth/setup/order regressions
- No misleading stage or payout messaging
- No session bleed between users
- No dead primary CTAs
- Mobile app feels trustworthy on first use for both roles
- Website clearly explains the product and routes people into the correct side of Drape
