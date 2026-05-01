# Drape

Drape is a tailoring marketplace for custom orders and ready-made pieces.

The repo currently contains:

- an Expo / React Native customer + tailor app
- a Next.js web app deployed through Cloudflare
- Supabase database migrations and Edge Functions
- shared order, auth, and validation logic for both surfaces

## Stack

- `apps/mobile`: Expo Router, React Native, Supabase, React Query
- `apps/web`: Next.js, Supabase, Cloudflare / OpenNext
- `supabase/`: SQL migrations and Edge Functions
- `packages/shared`: shared order state, contact filtering, and auth helpers
- `packages/db`: Prisma schema and DB tooling

## Repo Layout

```text
apps/
  mobile/      Expo app for customers and tailors
  web/         Marketing + auth bridge + web APIs
packages/
  db/          Prisma schema and DB scripts
  shared/      Shared TS utilities used across apps
supabase/
  functions/   Edge Functions for order actions, messaging, auth workflows
  migrations/  SQL schema + policy history
docs/          Product, QA, and rollout notes
```

## What Works Today

- customer sign up, onboarding, measurement profile, and order brief flow
- tailor setup, quoting, consultation, messaging, and production-stage updates
- local collection and shipping handoff workflows
- hosted password recovery bridge for mobile auth recovery
- waitlist and tailor-application submissions saved to DB and mirrored into inbox notifications
- guided fit intake with `measurement_scans` and pre-cutting tailor review support

## Local Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Copy env files

Use the example files inside each app as your starting point:

- `apps/mobile/.env.local.example`
- `apps/web/.env.local.example`

You will also need working Supabase project credentials for local development.

### 3. Start the app you need

Web:

```bash
pnpm --filter @drape/web dev
```

Mobile:

```bash
pnpm --filter @drape/mobile dev -- --clear
```

Root workspace dev:

```bash
pnpm dev
```

## New Laptop Bootstrap

This is the shortest safe path to get the project running on a fresh machine without carrying over hidden local state.

### 1. Clone and install

```bash
git clone <your-remote-url>
cd drape
git checkout develop
pnpm install
```

### 2. Restore app env files

Copy the app examples and fill them with the same values you were using before:

```bash
cp apps/mobile/.env.local.example apps/mobile/.env.local
cp apps/web/.env.local.example apps/web/.env.local
cp .env.supabase-targets.example .env.supabase-targets.local
```

You will need:

- mobile Supabase URL + publishable key
- web Supabase URL + publishable key
- any payment, email, and auth provider env vars used by your current branch
- the real production Supabase project ref in `.env.supabase-targets.local`

### 3. Re-auth the Supabase CLI

```bash
supabase login
pnpm supabase:status
```

### 4. Link the correct development project

```bash
pnpm supabase:link:dev
pnpm supabase:status
```

The repo guard will stop you if the linked project does not match the expected target.

### 5. Bring the development database forward

```bash
pnpm supabase:db:push:dev
```

If a migration fails:

- check `supabase/verification`
- check `supabase/rollback`
- rerun only after the dev database is in a known good state

### 6. Deploy the current development functions

Safest full deploy:

```bash
pnpm supabase:functions:deploy:all:dev
```

If you only need the critical payment/profile surfaces while resuming QA, these are the highest-signal ones to confirm first:

```bash
pnpm supabase:functions:deploy:dev -- \
  tailor-profile-action \
  payout-account-action \
  payment-action \
  refund-order-payments \
  release-order-payouts \
  stripe-webhook \
  paystack-webhook \
  ready-made-order-action \
  tailor-order-action \
  customer-order-action
```

### 7. Start the surfaces you need

Web:

```bash
pnpm --filter @drape/web dev
```

Mobile:

```bash
pnpm --filter @drape/mobile dev -- --clear
```

Ops dashboard locally:

```text
http://localhost:3000/ops?token=drape-ops-local-2026
```

### 8. Resume manual testing from the latest trackers

The highest-signal docs to reopen first are:

- [docs/manual-qa-runbook.md](docs/manual-qa-runbook.md)
- [docs/ready-made-qa-tracking-checklist.md](docs/ready-made-qa-tracking-checklist.md)
- [docs/payment-payout-ops-bug-audit-2026-04-30.md](docs/payment-payout-ops-bug-audit-2026-04-30.md)
- [docs/order-flow-execution-checklist.md](docs/order-flow-execution-checklist.md)

### 9. Before touching production from the new laptop

Always confirm these first:

```bash
pnpm supabase:status
pnpm supabase:link:prod
pnpm supabase:status
```

Then use only the guarded production commands:

```bash
pnpm supabase:db:push:prod
pnpm supabase:functions:deploy:all:prod
```

Do not run raw `supabase db push` or raw `supabase functions deploy` against a new machine unless you have explicitly verified the target.

## Useful Commands

```bash
pnpm typecheck
pnpm build
pnpm --filter @drape/mobile typecheck
pnpm --filter @drape/web typecheck
pnpm --filter @drape/shared test
pnpm db:generate
pnpm db:migrate
```

## Database And Functions

Supabase is the operational backbone for:

- auth
- orders
- messaging
- notifications
- storage
- server-side workflow enforcement

Important folders:

- `supabase/migrations`
- `supabase/functions`

### Supabase target guard

This repo now includes explicit Supabase target commands so local CLI work does not silently drift into the wrong project.

1. Copy:

```bash
cp .env.supabase-targets.example .env.supabase-targets.local
```

2. Fill in your production project ref in `.env.supabase-targets.local`.

3. Check where the repo is linked:

```bash
pnpm supabase:status
```

4. Use the guarded commands instead of raw `supabase db push` and `supabase functions deploy`:

```bash
pnpm supabase:link:dev
pnpm supabase:db:push:dev

pnpm supabase:link:prod
pnpm supabase:db:push:prod

pnpm supabase:secrets:manifest
pnpm supabase:secrets:set:prod -- RESEND_API_KEY=re_xxx RESEND_FROM="Drape <noreply@drapeon.co>"

pnpm supabase:functions:deploy:dev -- tailor-order-action customer-order-action
pnpm supabase:functions:deploy:prod -- tailor-order-action customer-order-action
pnpm supabase:functions:deploy:all:dev
pnpm supabase:functions:deploy:all:prod
```

If the linked project ref does not match the requested target, the command will stop before touching the wrong database.

Recent workflow additions include:

- collection-code lock reset window
- guided fit session storage via `measurement_scans`
- cutting preflight rules that can block progression until fit review, fabric receipt, or measurement confirmation is complete
- payment currency locking, tax and payout hardening, append-only payment ledgers, and ops issue routing

## Current Guided Fit Flow

The current implementation starts with the most honest useful slice instead of pretending full camera automation already exists.

It includes:

- manual measurement baseline on the customer profile
- guided fit intake for stretch, support, posture, symmetry, coverage, and fit direction
- `measurement_scans` history table for reusable capture sessions
- order-level fit profile attached at brief submission
- tailor-side pre-cutting review and override before cutting can start

Relevant files:

- `apps/mobile/app/(customer)/profile/guided-fit.tsx`
- `apps/mobile/lib/order-support.ts`
- `supabase/functions/tailor-order-action/index.ts`
- `supabase/migrations/20260414000002_measurement_scans.sql`

## Deploy Notes

### Web

The web app is built for Cloudflare via OpenNext.

Useful commands:

```bash
pnpm --filter @drape/web build
pnpm --filter @drape/web cf:build
pnpm --filter @drape/web cf:deploy
```

### Mobile

The mobile app uses EAS profiles defined in `apps/mobile/eas.json`.

Useful commands:

```bash
pnpm --filter @drape/mobile build:ios
pnpm --filter @drape/mobile build:android
pnpm --filter @drape/mobile build:ios:prod
pnpm --filter @drape/mobile build:android:prod
```

### Edge Functions

Deploy Supabase functions after workflow changes that touch `supabase/functions/**`.

Typical examples:

```bash
supabase functions deploy tailor-order-action
supabase functions deploy customer-order-action
supabase functions deploy custom-order-action
```

Apply any matching SQL migration before testing those changes in a live environment.

## Testing Focus

Highest-signal manual passes right now:

- customer signup to custom order placement
- tailor quote to production-stage movement
- shipping and local collection handoff
- waitlist and tailor-application submission notifications
- password reset email to hosted recovery bridge to in-app reset
- guided fit intake to pre-cutting tailor review

## Notes

- This repo is actively evolving, so some docs may describe in-flight work before it is fully deployed.
- The DB remains the source of truth for leads and orders; inbox notifications are secondary visibility, not the primary record.
- If you are testing a workflow that touches Supabase Edge Functions, always make sure the matching migration and function deploy happened together.
