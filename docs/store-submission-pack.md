# Store Submission Pack

Date: May 26, 2026
Status: May 27 store-readiness / production build prep baseline

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
- Age rating: `4+`

## App Store Metadata

### Subtitle

Custom clothing, tracked safely.

### Promotional Text

Find vetted tailors, place custom or ready-made orders, and follow your garment from brief to handoff.

### Full Description

Drapeon helps customers find trusted tailors for custom clothing and ready-made pieces, with order tracking, protected payments, measurements, messages, and production updates in one place.

Whether you are ordering an Agbada, Ankara set, formalwear, or a special-event outfit, Drapeon keeps the brief, photos, measurements, payment status, and handoff details organized so both customer and tailor know what happens next.

Key features:

- Browse tailor profiles, portfolios, reviews, and ready-made shop items
- Submit custom briefs with measurements, references, notes, delivery preferences, and cancellation acknowledgement
- Pay securely through supported payment providers
- Track production stages with tailor photo/video updates
- Message your tailor inside Drapeon so order decisions stay protected
- Request or schedule calls when a conversation needs more detail
- Save tailors and ready-made pieces to wishlist
- Manage privacy, notifications, password, currency, and account deletion from settings
- Tailors can manage orders, shop listings, payout readiness, production updates, and customer communication

Drapeon is built for the real tailoring journey: cultural wardrobe, event deadlines, fabric choices, delivery handoff, and the trust needed when money and measurements are involved.

### Keywords

tailor,custom clothing,fashion,diaspora,african fashion,bespoke,measurements,agbada,ankara

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
- Payment confirmation / protected payment state
- Active order timeline with production media
- Message thread with in-app communication
- Tailor dashboard / order action cockpit
- Tailor order stage update

Device targets:

- iPhone 6.7 inch: `1290x2796`
- iPhone 6.5 inch: `1242x2688`
- Android phone: `1080x1920` minimum

Optional for first pass:

- App preview video

## Reviewer Access

Before submission, confirm one of these is ready:

- self-serve reviewer test sign-up path
- or dedicated customer and tailor test credentials

Also prepare:

- short note explaining the two-sided marketplace model
- short note explaining where deletion and privacy controls live
- short note explaining Android Drape Vision is guarded/manual-first while iOS Vision is the primary assisted scan path
- short note explaining Paystack live NGN payouts require business verification before production release

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
