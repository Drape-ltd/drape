# Auth Architecture

## Goals

- Keep authentication decisions server-derived, not client-declared.
- Make account recovery and password changes predictable on mobile.
- Separate device convenience locks from real server-side auth guarantees.

## Current Stack

- Identity provider: Supabase Auth
- Client platforms:
  - Expo mobile app for customer and tailor flows
  - Next.js web app for public pages and internal ops
- Backend runtime: Supabase Edge Functions with service-role access for privileged reads and writes

## Core Principles

- The client may know the user role, but the server should never trust a client-sent role as proof of authorization.
- The order database remains the source of truth for payment, shipping, and dispute state.
- Public client keys are expected to be public; privileged secrets stay in server env only.
- Biometric unlock is a local device gate, not MFA.

## Session Model

- Mobile uses Supabase sessions and keeps the access token mirrored into a module-level cache for edge-function calls.
- App startup is guarded by `RouteGuard`, which waits for auth, role, and profile state before routing.
- If a session exists but `supabase.auth.getUser()` fails, the app signs the user out instead of trusting a stale cached session.

## Role And Profile Model

- Role selection is stored in auth metadata after sign-in.
- Customer and tailor setup completion is derived from profile rows, not just from client navigation state.
- Route decisions in mobile are based on:
  - authenticated session
  - auth metadata role
  - profile existence/completion checks

### Provider role intent and returning accounts

- A customer/tailor choice attached to an Apple, Google, or email auth entry is a bootstrap hint for an account that does not have a role yet.
- Signing in must not overwrite an established account role based on the auth button or landing page used. Returning users switch roles explicitly from account settings.
- Mobile and web callbacks prefer the authenticated account's established role over cached route or browser intent.
- Incomplete onboarding is resumable after sign-in and must always expose an exit. Customer and tailor setup provide a contextual back path, sign-out/switch-account, an explicit mode switch, and account deletion.
- Customer and tailor setup keep a versioned, user-scoped device draft after authoritative profile data hydrates. Async upload, verification, connectivity failure, process death, or a deliberate exit must not erase completed text fields or the tailor's current setup section. Drafts are cleared only after the authoritative setup transition succeeds; temporary local media URIs are not treated as durable uploads.
- Phone entry begins without an assumed country for a new number. A stored international number may restore its country, but users must otherwise choose a country code or enter a complete international number; Drapeon does not default a global account to Nigeria or the United States.
- Account deletion remains reachable before profile setup is complete; route guards may not redirect deletion back into onboarding.

## Server Authorization Model

- Edge functions authenticate callers by reading the bearer token and resolving the real user through Supabase Auth.
- Privileged actions then perform DB checks against the authenticated user id.
- This keeps authorization anchored to:
  - verified JWT identity
  - order ownership / tailor ownership in the database
  - server-side stage and business-rule checks

## Password Policy

Current app policy:

- 10-72 characters
- at least one letter
- at least one number or symbol
- no leading or trailing spaces
- should not include obvious personal fragments like the user's name or email
- should not be a common weak password

Where it is enforced:

- sign up
- password reset
- in-app password change
- mobile auth helper as a second-layer guard before calling Supabase

## Recovery And Account Protection

- Password reset uses Supabase recovery links and waits for recovery session exchange before showing the reset form.
- In-app password changes require re-authentication first:
  - biometric if already enabled
  - otherwise current password
- Optional biometric lock only protects local device reuse after backgrounding the app. It does not strengthen the server session itself.

## What This Does Not Yet Do

- True MFA for server-side sign-in
- step-up auth for high-risk actions beyond password change
- centralized admin auth beyond the shared `/ops` dashboard token gate
- explicit anomaly detection for repeated auth failures

## Release Expectations

Before launch, verify:

- Supabase auth redirect URLs are correct for mobile recovery and OAuth callbacks
- mobile and web environments point at the intended Supabase project
- service-role secrets never ship in client bundles
- edge functions derive auth from bearer tokens, not request payload claims
- password and recovery flows work on a fresh device and from signed-out state
- a returning Apple/Google account keeps its established role regardless of which auth entry CTA is used
- partial customer and tailor onboarding can exit, sign out, switch account, resume, and open deletion without a redirect loop
