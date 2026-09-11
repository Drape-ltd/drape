# Ops Workflow Proof — Phase 0 and Canonical Shell

Status: Development engineering and browser pass complete; production promotion and live-device certification remain pending
Environment observed: local application plus Drape-DEV database and Edge functions
Last updated: September 11, 2026

## Proven in code and build

- Production Ops authentication fails closed without a valid Cloudflare Access identity and active named workforce principal.
- Unknown roles have no fallback authority.
- Sensitive actions require the dedicated Access audience, recognized MFA context, and a recent authentication time.
- Mutations validate canonical origin and same-origin fetch metadata.
- Action-adjacent Ops and public marketplace reads do not use cross-request process caches.
- Trust evidence is proxied with private no-store delivery and case-linked access logging.
- Ops push subscriptions bind to a workforce principal and one explicit environment, expire, revoke, and record provider outcomes.
- Production monitoring has one scheduled Worker/state owner; the GitHub workflow is dispatch-only.
- The separate `apps/ops` application owns a compact route-based shell, authoritative no-fixture reads, and a dedicated Cloudflare build artifact.
- The Ops deployment contract owns only `ops.drapeon.co/*` and rejects bootstrap variables.
- The global command palette derives every destination from the same role policy as navigation, limits phone results to permitted mobile-safe routes, and supports Command/Control-K, arrows, Enter, Escape, and visible focus.
- My Work rows expose next action and last meaningful activity, use roving Arrow/Home/End keyboard focus, and become labelled ordered cards before tablet widths can compress the desktop table.
- Generic case collaboration now derives visible actions from the same active queue policy that authorizes the database mutation. Retired/future policies, non-owning workforce roles, and queue-forbidden acknowledgement, assignment, or escalation all fail closed; escalation records its reason, policy version, backup team, event, audit, and durable receipt together.
- Route-owned operational views now cover My Work, queues, cases, trust, support/privacy, incidents, providers/jobs, orders, Money Desk, customers, tailors, Vision, delivery, communications, leadership overview, audit reports, knowledge, and access governance.
- Money decisions require named authority, fresh step-up, scoped elevation, optimistic concurrency, and maker/checker separation before an approval can persist.
- The installed-app shell has a manifest, 192/512 PNG icons, a no-operational-cache service worker, generic safe notifications, and a stable `/install` handoff. Its four-step guide explicitly covers scan, install, authentication, and urgent-alert permission.
- Ops Web Push payloads use the subscription's P-256 and authentication secrets with `aes128gcm` encryption. The notification body remains privacy-safe while the encrypted payload carries only a sanitized `/ops/cases/OPS-*` path and bounded correlation key, so notification taps can open the exact case without leaking case details onto a lock screen.
- The staff QR encodes only `https://ops.drapeon.co/install`; it never contains a token, session, operator identity, or bypass. Installation and authorization remain separate controls.
- Production case, domain, order, reliability, report, and workforce-principal reads are routed through an allowlisted Edge authorization broker. The broker independently verifies the original Cloudflare Access assertion, active named principal, environment, revocation cutoff, access-review date, and operation role before running a typed projection.
- Unknown read operations fail closed. Money, trust, support, access-governance, and audit projections have explicit role allowlists; broad case visibility does not imply sensitive-domain authority.
- The direct service-role read adapters remain available only to the named local development dry-run. They are not selected by the production runtime.
- Cloudflare-authenticated notification registration and removal route through a separate Edge action that re-verifies the assertion, active principal, review date, revocation cutoff, role, endpoint host, per-principal device cap, and environment. The web route retains direct database access only for the named local development dry-run.
- Money elevation, independent approval, and provider execution route through a sensitive-audience Edge action that re-verifies fresh MFA, principal state, environment, and command role. Duplicate execution keys return the persisted attempt and never re-enter a provider adapter. The production Ops Worker contract rejects a Supabase service-role binding.
- Canonical server-side route policy now guards every operational domain before its projection runs. The shell consumes the same policy for navigation, so a hidden item and a denied direct URL cannot drift into separate authorization behavior.
- Customer and tailor operational projections now preserve their domain boundary: customer rosters/details require `CUSTOMER`, tailor rosters/details require a tailor profile, and deletion cases retain the exact tailor-profile target when one exists.
- Read-gateway projections have explicit query budgets and emit private query-count, query-budget, and `Server-Timing` evidence for runtime verification after the latest gateway bundle is deployed.
- The operational catalogue records route/role/phone/cache/query policy, data classification and retention, threat controls, case lifecycles, queue/SLA ownership, provider outcomes, metrics, alert/runbook ownership, release gates, and rollback evidence in one reviewable contract.
- `pnpm --filter @drape/ops prod:certify` now rereads the live production Edge secret/function inventories and combines them with a non-secret evidence record for migrations, Access, both phone platforms, maker/checker, parallel run, rollback window, and operator sign-off. It cannot report ready while any proof is absent.

Commands passed:

```text
pnpm --filter @drape/web typecheck
pnpm --filter @drape/health-monitor check
node apps/web/scripts/verify-environment.mjs
pnpm --filter @drape/ops typecheck
pnpm --filter @drape/ops lint
pnpm --filter @drape/ops build
pnpm --filter @drape/ops cf:build
pnpm --filter @drape/ops ui:verify
pnpm --filter @drape/ops pwa:verify
pnpm --filter @drape/ops producers:verify
pnpm --filter @drape/ops env:verify
pnpm --filter @drape/ops prod:certify:test
deno test supabase/functions/_shared/ops-read-policy_test.ts
deno test supabase/functions/_shared/ops-route-access-policy_test.ts
deno test supabase/functions/_shared/ops-client-surface-policy_test.ts
deno test supabase/functions/_shared/ops-read-query-budget_test.ts
deno test supabase/functions/_shared/ops-access_test.ts
deno check supabase/functions/ops-read-gateway/index.ts
deno check supabase/functions/ops-web-push-action/index.ts
deno check supabase/functions/ops-money-action/index.ts
deno test supabase/functions/_shared/ops-money-policy_test.ts
deno test supabase/functions/_shared/web-push_test.ts
deno test --allow-env supabase/functions/_shared/payment-refunds_test.ts
deno check supabase/functions/_shared/ops-issues.ts
deno check supabase/functions/account-support-action/index.ts
deno check supabase/functions/ops-case-action/index.ts
git diff --check
```

The read-only `pnpm --filter @drape/ops prod:certify` audit intentionally exits nonzero today. The dated evidence record now leaves 68 explicit production gates open: 38 producer-version proofs, the pending queue-authorization migration, the sensitive Access secret, five Access proofs, six proofs on each phone platform, four release proofs, and seven exact Cloudflare IdP/application/Worker/route/schedule identifiers. That failure is the required safe outcome before activation—not a failing application test.

## Browser proof

Browser: in-app Chromium, `http://localhost:3005`

1. Direct entry to `/ops/my-work` without a workforce session rendered the restricted lock screen.
2. The lock screen disclosed no customer, tailor, money, evidence, or incident data.
3. The only local recovery action linked to the existing named-workforce unlock; production copy has no token fallback.
4. Direct entry to `/protected/checkpoint?returnTo=%2Fops%2Fcases%2FOPS-TEST` returned `303` to `/ops/my-work?protected=identity-required` and remained locked.
5. No protected POST body was created or replayed during the checkpoint.
6. `/install` rendered the staff QR, Android/browser install action contract, iPhone Add-to-Home-Screen guidance, urgent-alert permission step, and Cloudflare/database authorization boundary on desktop and at 375 × 812.
7. The copy-install-link interaction changed to a confirmed `Copied` state.
8. The manifest, service worker, and 192/512 application icons returned HTTP 200 with the expected content types; the service worker contains no fetch/cache handler for operational pages.
9. The unlocked named-workforce session rendered all sixteen canonical navigation destinations without a fail-open fixture or blank error shell.
10. Opening a real development case exposed an invalid UUID sentinel; the sentinel was replaced with the nil UUID and the case reloaded with authoritative facts, queue policy, SLA, receipts, and timeline.
11. At 375 × 812 the installed-app dock contains only My Work, Queues, Incidents, and Knowledge; restricted financial, trust, evidence, report, access, and order-detail content is not loaded.
12. A mobile-user-agent probe proved `/ops/money` renders the desktop-continuation boundary, the Money action returns `403 desktop-only-action`, and case triage omits related records, provider detail, evidence, receipts, and full timeline.
13. `/ops/customers` rendered 47 customer-role accounts only; no tailor-role record appeared in the customer roster. The existing Anna tailor profile remained independently reachable at its exact `/ops/tailors/:id` route, with `NGN 120,000–NGN 300,000` rendered from minor units.
14. Invalid customer and tailor identifiers fail closed into the route-owned not-found boundary rather than reaching the database adapter with malformed UUIDs.
15. `/ops/knowledge#catalogue` rendered the six canonical references, including the new operational catalogue.
16. At 390 × 844, `/ops/my-work` rendered the compact four-destination installed-app navigation with no legacy side rail or restricted operational domains.
17. Reusing the same workforce session under the local `trust` role hid Money Desk from navigation and denied direct `/ops/money` entry before the financial projection loaded. Restoring the normal local role returned the session to the 113-case authoritative admin queue.

The post-audit command-palette, keyboard-row, phone-incident safety, queue-policy action, and exact metric source-set changes passed their deterministic 29-check interaction contract, TypeScript, ESLint, the PWA contract, and a clean Node 22 optimized build. Every summary cell across Customers, Tailors, Orders, Vision, Communications, Delivery, Money Desk, Reliability, Overview, My Work, and Reports now opens a bounded filtered source ledger; communications and job drill-throughs omit payloads and raw provider errors. The existing port-3005 development process was started before build-output isolation and cannot be terminated from the current sandbox, so hydrated click/shortcut and metric-drill-through proof for these newest controls is deferred until that stale local process is restarted. A cached or unhydrated browser render is not counted as live interaction evidence.

The standalone worker boundary also fails closed at runtime: only the configured Ops hostname and exact Supabase project are accepted in production, both Access audiences must exist, bootstrap/shared-token variables are rejected, and each dynamic response receives a nonce CSP. Cloudflare `workers.dev` and preview URLs are explicitly disabled. The environment verifier and a local Node 22 Wrangler dry-run cover this deploy contract without changing a remote environment.

## Development database and Edge proof

The development migration ledger was reread on September 11 and proves Drape-DEV alignment through `20260911011000`. The reviewed migrations were linted and applied in bounded batches. Local migrations `20260911012000`, `20260911013000`, `20260911014000`, and `20260911015000` are forward-only queue-authorization, export, retention/recovery, and case-lineage release units and have not been applied to any database; each must be linted, applied, and behaviorally exercised in development before production review. A same-day secret-name audit proves Drape-DEV has `DRAPE_OPS_ENV` and all three `WEB_PUSH_VAPID_*` values; `CF_ACCESS_SENSITIVE_AUD` is the remaining development secret gap. The applied migrations establish:

- launch-gated daily digests;
- named workforce principals, revocation, environment scope, and review dates;
- expiring, environment-bound workforce push subscriptions;
- public visibility tombstones;
- canonical cases, case events, receipts, collaboration, and deletion actions;
- trust decision receipts;
- durable reliability observations and incidents;
- monotonic monitor observations and incident command actions.
- Money Desk tip scope, asynchronous cancellation-refund finalization, queue/SLA policy, terminal RPC corrections, and first-response evidence.

Development Edge deployments include the scoped account-deletion, case, trust, reliability-ingest, incident, read-gateway, web-push-action, and money-action functions. `account-support-action` was redeployed after the encrypted push change, proving one real issue-producing bundle contains the exact-case sender. On September 11 the locally verified customer-domain/query-budget gateway correction was deployed to Drape-DEV as `ops-read-gateway` version 4, and exact tailor-deletion targeting was deployed as `request-account-deletion` version 66. The refreshed gateway returned `401 Workforce access is required` with `private, no-store` and correlation `795128b1-f350-4566-957c-30546e13bce5` when invoked without an Access assertion; the push gateway has the same deny contract and Money returned `401 Fresh MFA-backed Money Desk access is required`. Read, route, client-surface, query-budget, access, and Money policy tests prove unknown-operation/command denial, direct-route role denial, mobile restriction, wrong-role financial decisions/execution, wrong-role support, and non-admin access-governance denial. The Web Push cryptography test generates a phone-style P-256 subscription, decrypts the emitted RFC 8291 record, and recovers the exact case path and correlation key. Replay/idempotency, stale-version rejection, and environment isolation were exercised against development for the existing mutation functions. Production was not changed by this implementation pass.

## Remaining certification gates

- Production now has `DRAPE_OPS_ENV` and its environment-specific `WEB_PUSH_VAPID_*` trio. `CF_ACCESS_SENSITIVE_AUD` remains intentionally absent until the real dedicated MFA Access application provides its audience, so sensitive reads and actions still fail closed. Development likewise lacks a certified sensitive Access audience.
- All eight canonical `ops-*` Edge gateways are active in Drape-PROD with Supabase JWT verification and auth-before-validation denial evidence. The coordinated 38-producer redeployment/version manifest and both Cloudflare Workers remain outstanding; the legacy production surface therefore remains the route owner and rollback boundary.
- Customer/tailor counterpart notifications and deep links require terminal provider delivery evidence for each migrated workflow.
- Money Desk still needs a live two-person development exercise with real sensitive Access assertions: one maker request, one independent decision, one idempotent execution replay, and its provider terminal outcome. The code boundary and production secret contract are complete, but unauthenticated deny-path proof alone is not movement-of-money certification.
- A real iPhone and Android must install the PWA, grant alerts, receive a privacy-safe notification, open the exact case, renew the subscription, and prove revocation. The current in-app browser has notifications denied, so it cannot certify provider delivery.
- Cloudflare Access must be proven live on `ops.drapeon.co` for normal and sensitive audiences, IdP MFA, revocation before token expiry, access-review expiry, and cross-environment denial.
- Production migrations are aligned through `20260911011000`. Pending local migrations `20260911012000`, `20260911013000`, `20260911014000`, and `20260911015000` must complete development proof, exact production dry runs, explicit separately reviewed promotion, and post-promotion Advisor, scheduler, queue, callback, export-retention, lineage, and synthetic-path checks.
- The pending queue-authorization migration must first prove owning-role actions, wrong-role denial, retired/future-policy denial, queue-forbidden action denial, escalation persistence, duplicate replay, and stale-version rejection in Drape-DEV.
- The legacy monolith remains available until parallel-run counts, role permissions, latency, query budgets, rollback, and operator sign-off pass.
- Authenticated route query-count headers, p95 targets, an exact live tailor-deletion target, and one real cross-role/counterpart terminal notification remain unproven. The required development bundles are deployed; the remaining read-header proof needs a legitimate Cloudflare Access assertion and the deletion proof must use a disposable development account.

## Rollback boundary

The legacy `/ops` surface remains the read/action rollback path. The new Ops application has not been deployed or assigned the production route. The authenticated Edge gateways are deployed independently in development and production, but the production Ops Worker and Access route are still absent. Applied migrations are immutable and forward-only; any database correction must be a new migration after the current development state is proven.
