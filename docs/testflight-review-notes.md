# TestFlight Review Notes

Date: August 30, 2026

## Purpose

This is the lightweight reviewer-facing note pack for Drapeon's first external mobile review cycles.

Use it alongside:

- `docs/release-checklist.md`
- `docs/mobile-permissions-and-disclosure-audit.md`

## Product Summary

Drapeon is a two-sided tailoring marketplace:

- customers browse tailors, submit briefs, accept quotes, pay, and track orders
- tailors review briefs, send quotes, update stages, and manage delivery or collection handoff

## Reviewer Notes

- Sign in with Apple should stay available anywhere third-party sign-in is offered.
- Account deletion is available in-app:
  - customer: `Profile -> Privacy -> Delete account`
  - tailor: `Profile -> Account settings -> Privacy -> Delete account`
- Privacy controls are available in-app:
  - customer: `Profile -> Privacy`
  - tailor: `Profile -> Account settings -> Privacy`
- Optional product analytics should stay off until consent is granted.
- Crash diagnostics may still run as a required operational layer.

## Permissions In Use

- Camera:
  - reference photos
  - order progress photos
  - portfolio photos
- Photo library:
  - upload reference images
  - upload portfolio/work images
- Microphone:
  - voice note messaging
- Biometrics:
  - local step-up verification for sensitive actions

## Demo Paths To Verify

### Customer

1. Sign in with the platform-specific reviewer identity.
2. Open Explore and select **Alder & Rue**.
3. Open the existing project with reference **DRPGBAT3D** to inspect the quote and contextual order state. Payment is intentionally unavailable and is not required for review.
4. Open Notifications and select **Your review project has a quote**; it should open the same project.
5. Open the project message thread.
6. Open `Profile -> Settings -> Privacy`.
7. Open `Profile -> Settings -> Privacy -> Delete account` to inspect the in-app path. Do not delete the reusable Apple or Google reviewer identity.

### Tailor

1. Sign out of the Customer account, then sign in with the separate Tailor credentials provided in App Review Information.
2. The account opens directly into a completed, approved Tailor workspace; do not create a new account or repeat onboarding.
3. Open Orders to inspect the three seeded projects, then open the project matching reference `DRPGBAT3D`.
4. Open Messages and Shop to inspect the existing conversation, portfolio, and live showcase item.
5. Open `Profile -> Account settings -> Trust & access`.
6. Open `Profile -> Account settings -> Privacy`.
7. Open `Profile -> Account settings -> Payments & payouts`. The reviewer does not need to enter external payout-provider information.

## Weak-Network Behavior

- Drapeon is designed to degrade gracefully on weak mobile networks.
- Order and message flows should prefer retry-safe behavior over silent data loss.
- External carrier/help/privacy links may fail open; when they do, the in-app order or privacy path remains the source of truth.

## Support Routes

- Support: `support@drapeon.co`
- Privacy: `privacy@drapeon.co`
- Security: `security@drapeon.co`

## Reviewer Identities

- Apple review customer: `review.apple@drapeon.co`
- Apple review tailor: `showcase.alder-rue@drapeon.co`
- Google review customer: `review.google@drapeon.co`

Passwords are intentionally excluded from the repository and differ between the two Apple accounts. Copy them from the owner-only handoff at `/private/tmp/drape-app-review-credentials.txt` directly into App Store Connect.

The reviewer accounts have no Ops role and no live payment capability. The synthetic deletion account is not a store-console credential. Do not ask reviewers to sign up, complete SMS verification, submit a trust video, wait for staff approval, or configure a payout provider.
