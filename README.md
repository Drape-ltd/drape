# Drapeon

Drapeon is a cross-platform marketplace for custom clothing and ready-made pieces. Customers discover verified tailors, share a brief and fit information, manage orders, and shop published pieces. Tailors onboard through a private trust review, manage their storefront and portfolio, quote work, fulfil orders, and connect a payout provider.

The repo currently contains:

- an Expo / React Native customer + tailor app
- a Next.js customer/tailor web app deployed through Cloudflare
- a separate Next.js Ops control plane protected by named Cloudflare Access identities
- a Cloudflare Worker that monitors production health every five minutes
- Supabase database migrations and Edge Functions
- shared order, money, auth, trust, notification, and validation contracts

## Stack

- `apps/mobile`: Expo Router, React Native, Supabase, React Query
- `apps/web`: Next.js, Supabase, Cloudflare / OpenNext
- `apps/ops`: standalone Ops portal, Cloudflare Access, sensitive step-up routes
- `apps/health-monitor`: scheduled Cloudflare Worker for production synthetic checks
- `supabase/`: SQL migrations and Edge Functions
- `packages/shared`: cross-platform domain contracts and validation
- `packages/db`: Prisma schema and DB tooling

## Repo Layout

```text
apps/
  mobile/      Expo app for customers and tailors
  web/         Marketing, marketplace, customer/tailor workspace, auth bridge
  ops/         Named-workforce operations control plane
  health-monitor/ Scheduled production health monitor
packages/
  db/          Prisma schema and DB scripts
  shared/      Shared TS utilities used across apps
supabase/
  functions/   Edge Functions for order actions, messaging, auth workflows
  migrations/  SQL schema + policy history
docs/          Product, QA, and rollout notes
```

## What Works Today

- customer and tailor signup with cross-browser confirmation and durable setup drafts
- tailor storefront, portfolio, private challenge-video trust review, approval/rejection, and resubmission
- verified-tailor Explore discovery, custom-order briefs, ready-made listings, quotes, messaging, and fulfilment
- guided fit intake with `measurement_scans` and pre-cutting tailor review
- Stripe Connect payout onboarding and currency-aware marketplace pricing
- local collection and shipping handoffs with persisted workflow outcomes
- transactional email, push, SMS fallback policy, Ops/Slack routing, and dead-letter ownership
- standalone Ops queues for Trust, Safety, Reliability, Money Desk, Communications, and delivery operations
- Cloudflare production monitoring with durable state, deduplicated Slack transitions, and exact Ops case links

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
git checkout main
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

Ops dashboard locally (ordinary named local workforce session):

```bash
pnpm --filter @drape/ops dev
```

Open `http://localhost:3005/ops/my-work`. Founder-authority testing is intentionally separate:

```bash
pnpm --filter @drape/ops dev:founder
```

Open `http://localhost:3006/ops/my-work`. Never add a shared Ops token or auth bypass to a URL.

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
- private trust-video evidence, resumable tailor setup, and cross-browser confirmation recovery
- Stripe payout destination review, Money Desk receipts, and provider webhook reconciliation
- dead-letter Reliability ownership with explicit no-replay resolution for stale notifications
- scheduled production health checks with durable Ops incidents and deduplicated Slack alerts

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

## Release And Data Environment Policy

Use production for real people, even during a private beta, TestFlight round, or soft launch. Use development only for disposable fixtures, QA accounts, destructive runner flows, and experiments that can be deleted.

Practical rules:

- `Drape-PROD` is the source of truth for waitlist leads, real auth users, real orders, real messages, payment state, Ops issues, and production support history.
- `Drape- DEV` is for fake customers/tailors, automated QA, negative cases, and payment/provider dry-runs.
- Do not invite waitlist people into dev for normal testing. Invite them into prod behind whatever access gate or limited rollout policy is active.
- If a real person accidentally tests in dev, treat that data as non-production. Recreate or invite the person in prod; do not bulk-copy dev auth rows, payment rows, order state, or messages into prod.
- Waitlist leads collected on production stay in production. When they start using the service, the normal prod account/order records become their live history.
- If a beta tester already has a prod waitlist row and later creates a prod account with the same email, preserve both records or link them with an explicit, audited migration. Do not delete the waitlist row just because an account now exists.

### Production release checklist

1. Commit and push the intended release to `main`.
2. Verify locally before release:

```bash
pnpm typecheck
pnpm lint
pnpm --filter @drape/web build
git diff --check
```

3. Link Supabase to production and inspect pending migrations:

```bash
pnpm supabase:link:prod
pnpm supabase:status
supabase migration list
pnpm supabase:db:push:prod -- --dry-run
```

4. Apply migrations and deploy Edge Functions:

```bash
pnpm supabase:db:push:prod
pnpm supabase:functions:deploy:prod -- tailor-order-action customer-order-action custom-order-action payment-action
```

If shared files under `supabase/functions/_shared` changed, deploy every function that imports those shared files. A full function sweep is safer before launch.

Before claiming production Tax/SMS readiness, confirm these Supabase Edge Function secrets are set in the target project:

```bash
pnpm supabase:secrets:manifest
supabase secrets list --project-ref <prod-ref>
```

Launch-critical provider secrets include `ZIPTAX_API_KEY` for US/Canada checkout tax lookups, `SMS_PROVIDER=termii`, `TERMII_API_KEY`, `TERMII_SENDER_ID` or `TERMII_FROM` for critical SMS fallback, and `AUTH_SMS_HOOK_SECRET` only if Supabase Auth phone OTP is enabled through `auth-sms-hook`.

Set the same SMS provider secrets on the Cloudflare `drape` Worker if Ops dashboard actions should send SMS directly:

```bash
wrangler secret put SMS_PROVIDER --name drape
wrangler secret put TERMII_API_KEY --name drape
wrangler secret put TERMII_SENDER_ID --name drape
```

5. Build and deploy web to Cloudflare with production public env values. Wrangler currently needs Node 22+:

```bash
PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" \
DRAPEON_PUBLIC_SUPABASE_URL=https://<prod-ref>.supabase.co \
NEXT_PUBLIC_SUPABASE_URL=https://<prod-ref>.supabase.co \
DRAPEON_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<prod-publishable-key> \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<prod-publishable-key> \
NEXT_PUBLIC_SITE_URL=https://drapeon.co \
ALLOW_LOCAL_WEB_ENV_DEPLOY=1 \
pnpm --filter @drape/web cf:build

PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" \
DRAPEON_PUBLIC_SUPABASE_URL=https://<prod-ref>.supabase.co \
NEXT_PUBLIC_SUPABASE_URL=https://<prod-ref>.supabase.co \
DRAPEON_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<prod-publishable-key> \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<prod-publishable-key> \
NEXT_PUBLIC_SITE_URL=https://drapeon.co \
ALLOW_LOCAL_WEB_ENV_DEPLOY=1 \
pnpm --filter @drape/web cf:deploy
```

Run `cf:build` before `cf:deploy`; deploying an old `.open-next` bundle can leave production on a stale build.
After pushing to `main`, wait for the GitHub `Workers Builds: drape` check to finish successfully before calling the deployment done. If that external check fails, inspect the Cloudflare build, rerun or retrigger it, and then run the production smoke checks below against `https://drapeon.co`.

6. Confirm production:

```bash
curl -I https://drapeon.co
curl -I https://drapeon.co/join
curl -I https://drapeon.co/pricing
curl https://drapeon.co/manifest.webmanifest
curl https://drapeon.co/api/web-push
```

### Web push secrets

Ops browser alerts need VAPID envs in both Cloudflare and Supabase if both web routes and Edge Functions should send closed-browser alerts.

Cloudflare Worker secrets:

```bash
wrangler secret put WEB_PUSH_VAPID_PUBLIC_KEY --name drape
wrangler secret put WEB_PUSH_VAPID_PRIVATE_KEY --name drape
wrangler secret put WEB_PUSH_VAPID_SUBJECT --name drape
```

Supabase Edge Function secrets:

```bash
SUPABASE_ACCESS_TOKEN=<personal-access-token> \
supabase secrets set --project-ref <prod-ref> \
  WEB_PUSH_VAPID_PUBLIC_KEY=<public-key> \
  WEB_PUSH_VAPID_PRIVATE_KEY=<private-key> \
  WEB_PUSH_VAPID_SUBJECT=mailto:ops@drapeon.co
```

The Supabase CLI can read and deploy using a logged-in profile, but `secrets set` may still require `SUPABASE_ACCESS_TOKEN`. Generate a short-lived personal access token from the Supabase dashboard when setting production secrets from a local machine.

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

Use the target guard for every deployment:

```bash
pnpm supabase:functions:deploy:dev -- tailor-order-action customer-order-action custom-order-action
pnpm supabase:functions:deploy:prod -- tailor-order-action customer-order-action custom-order-action
```

Apply any matching SQL migration before testing those changes in a live environment.

### Ops and production health

`apps/ops` is an independently deployed control plane at `https://ops.drapeon.co`. Production authentication requires Cloudflare Access plus an active named `ops_workforce_principals` record. Sensitive Trust, Money Desk, deletion, evidence, and administrative actions require the dedicated short-lived sensitive audience; a normal Ops session is not sufficient.

`apps/health-monitor` runs every five minutes and calls the authenticated production readiness endpoint. The durable database monitor state and Ops issue ledger are authoritative; Slack is only an alert surface. A transition to degraded or recovered is posted once, while unchanged failures are suppressed.

Dead jobs are never rewritten as successful. Each true dead-letter outcome owns a Reliability case. A reviewed stale notification can be resolved without replay, which stores a named reason, immutable case event, action receipt, and audit entry while retaining the original `DEAD` job. Until that explicit review exists, the production health check stays degraded.

Optimistic-concurrency conflicts are expected client outcomes: record them in bounded minute buckets and return one structured HTTP `409` without raising a database error. A burst of 20 conflicts within five minutes fails readiness and produces one deduplicated Slack transition alert; isolated stale screens remain normal UI feedback. Reserve SQLSTATE `40001` for genuine serialization failures because provider or database retry layers can amplify an incorrectly classified stale-version click into a request storm. The Ops interaction contract checks this boundary.

Useful checks:

```bash
pnpm --filter @drape/ops typecheck
pnpm --filter @drape/ops ui:verify
pnpm --filter @drape/ops runtime:verify
pnpm --filter @drape/health-monitor check
curl -i https://drapeon-health-monitor.dimowoope.workers.dev/health
```

## Testing Focus

Highest-signal manual passes right now:

- customer signup to custom order placement
- tailor signup, confirmation, restored draft, trust submission, rejection/resubmission, and approval
- role switching from customer to tailor, including required profile photo and trust/payout gates
- Stripe Connect start, hosted provider setup, return, cancel, retry, webhook, and readiness state
- currency changes across Explore, quotes, payment records, earnings, and payout presentation
- tailor quote to production-stage movement
- shipping and local collection handoff
- waitlist and tailor-application submission notifications
- password reset email to hosted recovery bridge to in-app reset
- guided fit intake to pre-cutting tailor review
- dead job to exact Reliability case, named resolution receipt, recovered health transition, and Slack deep link

## Notes

- The database and durable domain/case ledgers are authoritative. UI banners, email, push, SMS, and Slack are delivery surfaces—not proof of a business transition.
- Migrations, Edge Functions, customer web, Ops, mobile binaries, provider configuration, and Cloudflare Workers are separate release units. Verify each target explicitly.
- Development proof never substitutes for production verification. Preserve production correlation IDs and terminal provider outcomes.
- Never commit credentials or place them in URLs. Use secret stores and verify secret names without printing values.
