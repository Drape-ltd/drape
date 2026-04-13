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
