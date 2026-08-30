# Store Submission Pack

Date: August 30, 2026
Status: Metadata and production reviewer-fixture baseline; device capture intentionally pending

## Purpose

This is the submission package for Drapeon's first App Store / TestFlight / Play submission cycle.

Use it with:

- `docs/release-checklist.md`
- `docs/testflight-review-notes.md`
- `docs/mobile-permissions-and-disclosure-audit.md`

## App Basics

- App name: `Drapeon`
- Bundle ID: `com.drape.app`
- Privacy URL: `https://drapeon.co/privacy`
- Terms URL: `https://drapeon.co/terms`
- Support URL: `https://drapeon.co/help`
- Support email: `support@drapeon.co`
- Privacy email: `privacy@drapeon.co`
- Primary category recommendation: `Shopping`
- Secondary category recommendation: `Lifestyle`
- Age rating recommendation: lowest questionnaire-derived rating available; do not hard-code `4+` before completing Apple's current age-rating questionnaire

## App Store Metadata

### Subtitle

Clothing made around you.

### Promotional Text

Discover independent tailors, share your vision, and follow each garment from brief to handoff.

### Full Description

Drapeon helps customers find trusted tailors for custom clothing and ready-made pieces, with order tracking, protected payments, measurements, messages, and production updates in one place.

Whether you need bridalwear, a made-to-measure suit, alterations, modest fashion, cultural clothing, adaptive design, or a one-of-one piece, Drapeon keeps the brief, photos, measurements, messages, and handoff details organized so both customer and tailor know what happens next.

Key features:

- Browse tailor profiles, portfolios, reviews, and ready-made shop items
- Submit custom briefs with measurements, references, notes, delivery preferences, and cancellation acknowledgement
- Review project and payment availability before committing to an order
- Track production stages with tailor photo/video updates
- Message your tailor inside Drapeon so order decisions stay protected
- Request or schedule calls when a conversation needs more detail
- Save tailors and ready-made pieces to wishlist
- Manage privacy, notifications, password, currency, and account deletion from settings
- Tailors can manage orders, shop listings, payout readiness, production updates, and customer communication

Drapeon is built for the real tailoring journey across styles and cultures: fit, fabric choices, alterations, event deadlines, delivery handoff, and the trust needed when clothing is made personally.

### Keywords

tailor,custom clothing,alterations,bespoke,fashion,measurements,bridal,suits,made to measure

### What's New

Drapeon is here. Find vetted tailors worldwide, order custom clothing, and track your garment being made in real time.

## Google Play Metadata

### Short Description

Find vetted tailors. Custom clothing, tracked and protected.

### Full Description

Use the App Store full description above unless Google Play copy needs a region-specific edit during final submission.

## Screenshot Set

Required capture list:

- Customer Explore with real tailor photos
- Tailor profile with portfolio media and custom order CTA
- Custom brief / order setup
- Ready-made item detail or checkout
- Project review / clearly unavailable payment state
- Active order timeline with production media
- Message thread with in-app communication
- Tailor dashboard / order action cockpit
- Tailor order stage update

Device targets (verify again in each console immediately before upload):

- iPhone 6.9 inch: one accepted portrait size, preferably the native capture size (`1260x2736`, `1290x2796`, or `1320x2868` depending on device)
- iPhone 6.5 inch fallback: `1284x2778` or `1242x2688`
- Android phone: portrait screenshots between `320px` and `3840px` per side, with the long side no more than twice the short side

Apple accepts one to ten screenshots. Google Play requires at least two screenshots to publish a store listing; use the complete narrative set rather than the minimum.

Optional for first pass:

- App preview video

## Reviewer Access

Production reviewer identities are seeded and isolated:

- Apple review customer: `review.apple@drapeon.co`
- Google review customer: `review.google@drapeon.co`
- deletion lifecycle fixture: `review.spare@drapeon.co` (not for store-console login)
- counterpart tailor: `showcase.alder-rue@drapeon.co`

The shared reviewer password is intentionally not committed. The local handoff is stored at `/private/tmp/drape-reviewer-credentials.txt` with owner-only permissions and must be copied into the two store consoles through the approved secret handoff.

Also prepare:

- short note explaining the two-sided marketplace model
- short note explaining where deletion and privacy controls live
- short note explaining Android Drape Vision is guarded/manual-first while iOS Vision is the primary assisted scan path
- short note explaining that payout setup and payment-dependent actions are unavailable until provider readiness is approved; reviewers do not need to enter payment details

Exact reviewer path:

1. Sign in with the platform-specific reviewer account.
2. Open Explore and select **Alder & Rue**.
3. Open the existing project with reference **DRPGBAT3D** to review the quote and contextual order state. Do not attempt payment.
4. Open Notifications and select **Your review project has a quote**; it must open that same project.
5. Open Profile → Settings → Privacy → Delete account to inspect the in-app deletion path. Do not delete the reusable Apple or Google account.

The app is a two-sided tailoring marketplace. The supplied customer account demonstrates discovery, a custom brief, quote state, contextual communication, and privacy controls. The supplied tailor is a synthetic showcase fixture, not an operating merchant and not a live payout destination.

## Permissions Review

Reviewer notes should be ready for:

- camera
- photo library
- microphone
- biometrics
- notifications

Each one should point to a visible in-app feature and avoid vague claims.

## Data Safety / Privacy Answers

Data collected:

- Name and profile details: account setup, marketplace identity, support
- Email address: sign-in, account notices, support, receipts
- Phone number: order coordination, critical SMS fallback, account support
- User ID and device identifiers: authentication, push notification delivery, fraud/abuse protection
- Payment information: processed by Stripe or Paystack; Drapeon stores payment references and status, not raw card details
- Purchase/order history: order tracking, payouts, support, disputes, receipts
- Photos/videos/files: tailor portfolio, reference images, stage updates, evidence, profile photos
- Messages and voice/media attachments: order communication and safety enforcement
- Approximate location or region/currency signals where provided by device/account settings: currency and fulfillment context
- Diagnostics/crash data: reliability and incident response

Data sharing:

- Stripe and Paystack for payments and payouts
- Supabase for database/auth/storage infrastructure
- Resend for transactional email
- Expo/Firebase for push notification delivery
- Sentry for crash/error diagnostics
- PostHog only where product analytics consent and configuration allow it
- Shipping or courier providers when shipment handoff/tracking is used

Security:

- Data is encrypted in transit.
- Sensitive server actions are handled through authenticated Edge Functions.
- Account deletion can be initiated in-app.
- External account-deletion URL for Google Play: `https://drapeon.co/account-deletion`
- Users can contact `privacy@drapeon.co` for access, correction, deletion, or privacy questions.

Retention:

- Account and order data is retained while needed for app functionality, legal/compliance obligations, payment records, disputes, fraud prevention, and support.
- Personal data is deleted or anonymized where permitted after account deletion review.

## In-App Routes Reviewers Should Be Able To Reach

### Customer

- sign in / sign up
- setup
- tailor profile
- order / messages
- privacy
- delete account

### Tailor

- setup
- trust & access
- earnings / payout readiness
- privacy
- delete account
- active order

## Submission Warnings To Avoid

- claiming features are live when they are still placeholders
- implying full legal escrow if the product only provides payout protection/holds
- overpromising instant total deletion
- hiding permission reasons behind generic copy

## Final Packaging Check

- icon and splash are final enough for the first submission
- notification icon is final enough for the first submission
- support inbox ownership is clear
- privacy answers match runtime behavior
- reviewer note doc is current
- QA runbook has been executed on the build being submitted
- Apple SSO has nonce protection
- Google SSO redirects through the Expo/Supabase callback path
- Android FCM V1 credentials are assigned in EAS
- production EAS env contains the Supabase URL and publishable key for the production project

## Production API Proof — August 30, 2026

- Apple reviewer password login: passed.
- Google reviewer password login: passed.
- Apple and Google provider configuration: enabled in production Auth settings. A real OAuth UI round trip remains a physical-device capture gate.
- Explore: all eight global showcase studios returned from the public production read gateway.
- Custom order: `DRPGBAT3D` (`bdbefdbf-4ee6-4343-b66e-3ada57d0ca2a`) created against Alder & Rue and advanced to `QUOTE_SENT` with a GBP 384.00 tax-inclusive quote. No payment was created.
- Notification contract: inbox record `74e838bb-d43a-4f8b-b643-1839fefd9852` persists `ORDER_DETAIL` with the exact order ID.
- Deletion initiation: synthetic spare reviewer request `4f8f937e-1edd-41cc-b637-4f4741ebc3fa` entered `PENDING` through reauthentication and typed confirmation. Terminal Ops finalization remains required before this fixture can count as end-to-end deletion proof.
- Screenshot capture, notification tap navigation, real Apple/Google OAuth, and release builds were intentionally not run in this phase.
