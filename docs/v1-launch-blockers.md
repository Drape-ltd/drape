# Drape V1 Launch Blockers

## Purpose

This document is the working checklist for getting Drape to a marketable V1.

Everything here should be treated as launch-critical unless explicitly moved out after deliberate review.

## Current Position

- The public website is live-capable and already collecting waitlist and tailor applications.
- The mobile app is much more stable than before, but the full V1 product is not signed off.
- The biggest remaining risks are now trust, payments, fulfillment, notifications, compliance, moderation, and store readiness.

## V1 Launch Blockers

### 1. App Store / TestFlight / Play Store Readiness

- Real in-app account deletion flow
- Privacy manifest and app privacy disclosure audit
- App permissions audit:
  - camera
  - photo library
  - microphone
  - location
  - biometrics
- Reviewer-ready demo path and review notes
- No misleading "coming soon" claims in critical flows
- Social sign-in launch signoff:
  - Google OAuth works on Android and iOS release builds
  - Sign in with Apple works on a real iPhone release/TestFlight build
  - Sign in with Apple remains available anywhere third-party sign-in is offered on iOS
  - Supabase Auth provider settings are configured for Google and Apple in the target project
  - Supabase redirect allow-list includes the native callback used by the app, including `drape://callback`
  - iOS build includes the Apple Sign In capability / entitlement before App Store submission
  - First-time Google/Apple users land in role selection, then the correct customer/tailor setup flow
  - Returning Google/Apple users land on the correct side of the app without stale state
- Final metadata pack:
  - screenshots
  - descriptions
  - support URL
  - privacy URL
  - review credentials / instructions

### 2. Core Order Loop Signoff

- Customer setup path works cleanly
- Tailor setup path works cleanly
- Explore -> tailor -> brief works cleanly
- Quote send / receive / accept works reliably
- Order status updates reflect backend truth
- Terminal stages are correct:
  - delivered
  - collected
  - completed
- Messaging behavior matches order status
- Reviews close the loop correctly
- Passport claim flow works end to end

### 3. Payments and Payouts

- Final V1 payment architecture decision is locked
- Stripe integration path defined for global users
- Paystack integration path defined for Africa users
- Quote acceptance and payment handoff are connected cleanly
- Duplicate payment prevention
- Payment status linked to order status
- Tailor payout/connect onboarding exists
- Tailor payout state is visible enough for ops and trust

### 4. Shipping and Fulfillment

- Shipping architecture decision is locked
- Region-aware provider routing is defined
- Manual fallback exists for V1 even before deep automation
- Delivery address capture is reliable
- Shipping cost is represented correctly in order totals
- Tracking number storage and display work
- Shipment state updates feed the order state cleanly
- Tailor handoff flow works for:
  - shipping
  - collection

### 5. Notifications

- Push notifications work end to end
- Android FCM credentials are present in the release/dev-client build:
  - Firebase Android app for `com.drape.app` exists in Firebase project `drape-mobile-4729`
  - `apps/mobile/google-services.json` exists locally and `GOOGLE_SERVICES_JSON` is configured as an EAS file env var for native Firebase initialization
  - EAS Android FCM V1 service account key is assigned for the same Firebase project
  - Rebuilt Android dev-client registered fresh Pixel and Samsung push tokens on 2026-05-21
  - `expo-notifications` can generate an Expo push token on Pixel and Samsung test devices
- Trigger coverage exists for:
  - new message
  - quote received
  - quote accepted
  - stage update
  - delivery / collection readiness
- Notification settings are real, not decorative
- Push token lifecycle is stable
- Critical SMS fallback is wired for high-trust events only:
  - payment confirmed
  - ready for pickup / collection code
  - delivery / shipping milestones
  - dispute or ops resolution
  - payout/security issues
- Launch blocker before SMS QA: configure `SMS_PROVIDER=termii`, `TERMII_API_KEY`, and `TERMII_SENDER_ID` or `TERMII_FROM` in the target Supabase environment. Twilio remains supported as a fallback only when `SMS_PROVIDER=twilio` and the Twilio credentials are present.

### 6. Calls and Rich Communication

- V1 consultation model is scheduled, order-bound consultation rooms:
  - customer can request a slot before quote
  - tailor approves, prices, reschedules, or declines
  - paid consultations must be paid before the room opens
  - room opens near the scheduled time
  - reminders run by scheduled function
  - messages remain the fallback if calling fails
- Provider selected: Daily for hosted audio/video rooms.
- Voice note flow remains stable
- Audio attachments are validated and safe

### 6a. Media Trust Surface

- Profile avatars should use square crop before upload and initials fallback on display.
- Ready-made item photos should display the whole garment in detail and checkout surfaces; thumbnails can crop only when tapping opens a larger view.
- Order evidence and production-stage media should use contain-fit previews so proof is never cropped out.
- Order-stage emails should include the latest proof image when the update has an image, with the app remaining the source of truth for the full timeline.

### 7. Security and Abuse Prevention

- Final RLS review in active development DB and production DB
- All privileged actions remain server-enforced
- Validation is enforced server-side across quote/order/payment paths
- Rate limiting exists where abuse matters
- Contact bypass logging is implemented
- Anti-offline text filtering is active
- Contact details stay hidden until the correct milestone
- OCR / image moderation plan is defined
- Message abuse controls exist:
  - report
  - block
  - moderation response path

### 8. Reviews, Trust, and Moderation

- Review publishing actually works
- Published reviews are visible where intended
- Verification/trust surfaces are coherent
- User-generated content safety requirements are covered
- Support / trust contact paths are visible and real

### 9. Ops / Internal Control Surface

- Basic internal ops path exists for:
  - dispute handling
  - bans / abuse response
  - review moderation
  - contact bypass review
  - tailor application review
- This can be lightweight, but it cannot be absent

### 10. Observability and Incident Readiness

- Error monitoring is live
- Product analytics are live and disclosed correctly
- Admin/support inbox ownership is clear
- Production logging is useful but does not leak sensitive data
- There is a clear path to investigate:
  - failed payments
  - missing notifications
  - broken consultations
  - shipping issues

### 11. Low-Connectivity Resilience

- Critical flows must stay usable on weak mobile networks
- Heavy list screens should reduce payload size aggressively
- Image uploads should stay compressed before transport
- Non-destructive user actions should be retry-safe
- Messaging and order refresh paths should degrade gracefully on slow networks
- Add a queue/retry plan for:
  - message send
  - stage actions
  - review submit
- Prefer delta refresh and lazy loading over pulling full histories everywhere

## Infrastructure Recommendations

### Payments

- Primary global payments: `Stripe`
- Primary Africa payments: `Paystack`
- Recommendation:
  - lock architecture first
  - launch with the narrowest reliable payment path
  - expand region routing after the core path is trustworthy

### Payouts

- Preferred global payout model: `Stripe Connect`
- Africa payout path can evolve after the initial payment rails are stable

### Shipping

- Global / US: `Shippo` or `EasyPost`
- Africa: `Shipbubble` or `Topship`
- Fallbacks can be added later if real operations require them
- For V1:
  - rate
  - label / pickup path
  - tracking
  - manual fallback

### Notifications

- Use `expo-notifications` end to end for V1

### Calls

- Preferred V1 hosted consultation path: `Daily`
- Daily should cover:
  - scheduled consultation rooms
  - voice and video calls
  - room URL generation
  - participant access control
  - failure / reconnect fallback
- Do not build raw telecom complexity first unless clearly required
- If direct phone calling becomes necessary later:
  - use `Twilio`
  - do not make PSTN a V1 dependency

### Email

- Recommended transactional email layer: `Resend`
- Use it for:
  - support acknowledgements
  - application receipts
  - ops alerts
  - payment / fulfillment notifications where push is not enough

### Analytics and Monitoring

- `Sentry` for crashes, runtime failures, and backend operational errors
- `PostHog` for product analytics, with privacy disclosures kept accurate
- Support inboxes should be active and owned:
  - `support@drapeon.co`
  - `security@drapeon.co`
  - `payouts@drapeon.co`
  - `ops@drapeon.co`

### Search, Location, and Geo

- `OpenStreetMap` / Nominatim is acceptable for lightweight location input and search early
- If scale or reliability requires it later:
  - `Mapbox`
  - or `Google Places`

### Moderation and OCR

- For V1:
  - text filtering
  - contact-bypass logging
  - manual ops review
- For automated OCR / image moderation later:
  - `Google Vision`
  - or `AWS Rekognition`

### Internal Ops

- Lightweight internal ops surface can live in the existing web app
- It should be enough to review:
  - disputes
  - application approvals
  - bypass logs
  - moderation actions
  - payout issues

## Tailor Onboarding Recommendation

Do not jump straight to 50 tailors before the order loop is trustworthy.

Recommended ramp:

1. Private alpha with `5-10` high-quality tailors
2. Observe real quoting, order updates, customer communication, and support load
3. Tighten weak spots
4. Expand to `25`
5. Expand to `50` once repeated real orders no longer need constant manual rescue

## Practical Definition of "Ready For 50 Tailors"

- Tailor onboarding is clean
- Tailor profile setup is coherent
- Customer brief flow is stable
- Quote flow is stable
- Messaging is dependable
- Anti-offline protections are live
- Support / ops response path exists
- Payment and fulfillment plan is real enough that live demand does not break trust

## Immediate Next Work

1. Implement true in-app account deletion
2. Add privacy manifest and finish privacy review
3. Finish launch-grade push notification flow
4. Lock payment architecture
5. Lock shipping architecture
6. Implement contact bypass logging
7. Fix review publish flow
8. Fix terminal-stage behavior
9. Run fresh manual end-to-end from a clean database
10. Prepare TestFlight submission package

## Notes

- This is a launch blocker document, not a perfection document.
- Some systems may launch in a lightweight form, but they still need to be real, trustworthy, and supportable.
- If a feature affects trust, money movement, fulfillment, moderation, privacy, or store approval, treat it as V1-critical.
