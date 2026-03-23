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

## Highest-Value Next Step

Run a fresh manual end-to-end pass from zeroed accounts.

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
