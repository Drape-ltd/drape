# Drape TestFlight Readiness

## Goal

Get Drape onto TestFlight with the least avoidable review friction.

This is the short operational checklist to run before cutting a beta build.

## Product / Compliance

- In-app account deletion initiation exists for both customer and tailor accounts
- Sign in with Apple remains available on iOS anywhere third-party sign-in is offered
- Privacy policy URL is live and correct
- Support URL is live and correct
- Permission prompts only exist for functionality the app actually uses
- No critical primary flows dead-end behind "coming soon"

## Current Permission Set To Recheck

- Camera
- Photo library
- Microphone
- Face ID / biometrics

## Removed Because It Was Not Truly Used

- Device location permission

## Backend Readiness

- Run the account deletion migration:
  - [20260323000006_account_deletion_requests.sql](/Users/onaopemipodimowo/drape/supabase/migrations/20260323000006_account_deletion_requests.sql)
- Deploy the new edge function:
  - [request-account-deletion](/Users/onaopemipodimowo/drape/supabase/functions/request-account-deletion/index.ts)
- Confirm deletion requests write successfully in the active development DB

## App Store Connect / TestFlight Prep

- App description is current
- Screenshots are current
- Review notes explain:
  - customer login path
  - tailor login path
  - any feature intentionally limited in beta
- Demo/test accounts are ready for App Review if needed
- Contact email for App Review is monitored

## Manual Beta QA Before Upload

### Customer

1. Sign up
2. Complete setup
3. Explore tailors
4. Open tailor profile
5. Submit brief
6. Receive quote
7. Accept quote
8. Track order status
9. Open privacy
10. Submit account deletion request

### Tailor

1. Sign up
2. Complete setup
3. Confirm profile is coherent
4. Receive brief
5. Send quote
6. Advance order stages
7. Open login & security
8. Submit account deletion request

## Still Worth Fixing Soon After

- Privacy manifest / App Privacy label final audit against all SDKs
- Push notification end-to-end verification
- Review publishing flow
- Contact bypass logging
- Terminal-stage messaging closure

## Notes

- Internal TestFlight can happen before every V1 business system is complete.
- Public confidence should still wait for the major launch blockers in:
  - [v1-launch-blockers.md](/Users/onaopemipodimowo/drape/docs/v1-launch-blockers.md)
