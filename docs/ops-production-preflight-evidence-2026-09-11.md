# Ops Production Preflight Evidence

Status: Production schema, Edge gateways, Access boundaries, and standalone Worker activated; physical-device PWA receipt remains deferred
Recorded: September 11, 2026
Target: Drape-PROD (`wkfsrunetmgjdtcurmoj`)

## Release identity and boundary

- Local release branch: `main`
- Observed local HEAD before promotion: `06fe2e8`
- Production project status: `ACTIVE_HEALTHY`
- Production database region: `us-east-2`
- Production migration watermark before promotion: `20260910090000`
- The exact pre-promotion pending ledger contained only the 25 reviewed Ops migrations from `20260910182000` through `20260911010000`.
- No older or unrelated migration appeared in the remote ledger.
- Promotion remains constrained to five ordered batches of five migrations as defined in `docs/ops-production-migration-batch-plan-2026-09-11.md`.

## Database preflight

The following checks were run against the linked production project before any schema mutation:

| Check | Result |
| --- | --- |
| Schema lint | Completed with no errors. Three pre-existing PL/pgSQL warnings remain in settlement helpers. |
| Blocking queries | None observed. |
| Queries running longer than five minutes | None observed. |
| Database size | 66 MB. |
| Index/table cache hit rate | 1.00 / 1.00. |
| Table or index bloat | No material bloat; largest observed waste was 280 kB. |
| Autovacuum pressure | No table was waiting for autovacuum. `job_queue` was eligible for autoanalyze. |

The warnings were:

- `derive_order_residual_settlement`: existing variable `v_existing_release` is never read.
- `initialize_order_settlement_plan`: existing loop variable shadowing warning and unused variable `i`.

These warnings predate the Ops batch and do not change the reviewed migration set. They are not treated as migration approval for unrelated settlement changes.

## Production configuration state

Routine automated Ops case generation is fail-closed before public launch. `DRAPE_ROUTINE_OPS_CASES_ENABLED` must remain unset or false in development and production until explicit launch approval, then be set to `true` as a recorded launch change. Manual cases, customer-initiated privacy/trust cases, and the authoritative service-incident ingestion path are not suppressed by this switch.

The preflight secret-name inventory confirmed that Drape-PROD already had the normal Cloudflare Access audience and team-domain values. The following release-specific values were initially absent:

- `CF_ACCESS_SENSITIVE_AUD`
- `DRAPE_OPS_ENV`
- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`
- `WEB_PUSH_VAPID_SUBJECT`

None of the eight canonical `ops-*` Edge functions was present in the production function inventory at preflight. The existing production `request-account-deletion` function remained on version 37 while development had the reviewed version 66.

A production-specific Web Push keypair was installed without exposing the private key. Its public-key SHA-256 fingerprint is `fa3922f75631e3c6`. `DRAPE_OPS_ENV`, the VAPID public key, private key, and subject were verified present by secret name after the authenticated write. The temporary file containing the private key was removed immediately afterward. The verified normal and sensitive Cloudflare Access audiences are now installed in both the standalone Worker and Drape-PROD Edge secret inventory.

## Access and authentication evidence

- The Supabase CLI authorization was completed and its credential was proven against Drape-PROD.
- The in-app browser completed the Supabase/GitHub authorization flow used to issue that CLI credential.
- Wrangler authenticated to Cloudflare account `d2c21d3b898b789689684f815f222ae6`, which owns the active `drapeon.co` zone.
- The dashboard-authoritative inventory verified the existing `ops` self-hosted application for `ops.drapeon.co`, its `Drape Staff Allow` policy, and the One-time PIN identity provider.
- A separate `Drapeon Ops Sensitive` application now protects `ops.drapeon.co/ops/sensitive` with an allowlisted workforce email and a 15-minute policy session. Its audience is distinct from the normal Ops audience.
- The standalone `drape-ops` Worker was replaced by sanitized version `b790939b-967e-4686-a335-2ce1bee7a090` and owns only `ops.drapeon.co/*`. The conflicting route was removed from the legacy `drape` Worker before activation.
- An unauthenticated production browser request was redirected to the expected Cloudflare Access sign-in page for the verified normal audience; no Ops application data rendered before authentication.

The first standalone artifact had been packaged while the local Ops `.env.local` link and repository `.env` were visible to OpenNext. The production runtime boundary detected the resulting development target and bootstrap configuration after Access and returned the intentional generic `503`; no Ops data rendered. Production packaging now temporarily isolates and restores both local environment files, passes only an allowlisted host environment plus reviewed Wrangler variables to the build, and rejects an artifact containing bootstrap values, privileged database credentials, payment secrets, private push material, or any non-production Supabase reference before deployment. The guarded rebuild, TypeScript, ESLint, runtime tests, environment verification, and artifact scan passed before version `b790939b-967e-4686-a335-2ce1bee7a090` was deployed.

## Production schema promotion evidence

The 25 reviewed migrations were applied as five batches of five. Each batch was preceded by an exact dry run and followed by a remote-ledger check. Batch E initially stopped on the intentional `ops_runtime_configuration` fail-closed guard. The release then used the reviewed environment-binding script with a transient production service-role credential; no credential was printed or persisted.

The binding response proved:

- environment: `PRODUCTION`
- project reference: `wkfsrunetmgjdtcurmoj`
- cases updated: 14
- audit events inserted: 1
- deletion requests projected: 1

Batch E was then dry-run again and applied successfully. The remote migration ledger showed all 25 versions aligned, and a final production dry run reported zero pending migrations.

Post-batch database evidence remained healthy:

| Check | Result |
| --- | --- |
| Database size | 67 MB. |
| Index/table cache hit rate | 1.00 / 1.00. |
| Queries running longer than five minutes | None observed. |
| Table or index bloat | No material bloat; largest observed waste remained 280 kB. |

## Forward lint repair

The post-promotion lint identified one error in the newly installed cancellation-refund finalizer: a named operator email was being assigned to the legacy UUID `disputes.resolved_by` field. The canonical Money Desk request and Ops audit already retain the named workforce identity.

Migration `20260911011000_fix_cancellation_refund_resolved_by_uuid.sql` corrects the finalizer by leaving the legacy user UUID field null while preserving the operator in immutable Money Desk and Ops audit evidence. The already-applied migration was not edited.

The repair was:

1. dry-run and applied to Drape-DEV;
2. linted to confirm the finalizer error was removed;
3. promoted as a one-migration production batch after an exact dry run;
4. linted again in production, where only the three pre-existing settlement warnings remained; and
5. followed by restoring the repository link to Drape-DEV.

Development additionally reports a pre-existing `extensions.index_advisor`/HypoPG lint defect that is not present in production. It is recorded as a development-infrastructure repair and was not mixed into this production batch.

The final local release gate used Node 22 and passed Ops typecheck, ESLint, the optimized Next.js build, all six production-readiness policy tests, all 29 selected Edge/security/refund/web-push tests, and `git diff --check`. The first Deno invocation omitted its required environment-read permission and therefore exercised Sentry's fail-closed import guard; the canonical rerun with `--allow-env` passed. The standalone OpenNext/Cloudflare package build also completed locally under Node 22.

## Edge gateway deployment

The initial deployment attempt was stopped before any function changed because the reviewed design had Cloudflare Access as the external authentication boundary while Supabase JWT verification was disabled. The boundary was hardened instead of waived:

- all eight canonical `ops-*` functions now require a valid Supabase JWT at the Edge gateway;
- interactive callers send the project anon JWT and must then pass the existing Cloudflare Access, workforce-principal, environment, role, revocation, and sensitive-assurance checks;
- the health monitor sends the same outer JWT and must still pass its separate constant-time ingest-secret check; and
- `edge:auth:verify` statically fails if an Ops function disables JWT verification, a broker omits either JWT header, or selected gateways parse the operation before workforce authentication.

All eight functions were deployed to Drape-PROD and the authoritative inventory reported `ACTIVE` and `verify_jwt: true`. A first deny-path probe found that four functions returned bounded validation errors before Cloudflare identity verification. Those four were changed to authenticate before reading or validating their operation and redeployed as version 2. Final versions are 2 for account deletion, Money Desk, read gateway, and web push; the case, health ingest, incident, and trust gateways remain version 1.

The repeated production probe proved, for every function:

- missing Supabase JWT returns `401` at the outer gateway;
- a valid anon JWT without the required workforce or monitor identity returns `401`;
- the response is `Cache-Control: private, no-store, max-age=0`; and
- no operation-specific validation detail is returned before identity.

The subsequent local response-boundary audit also removed raw database error text from case, incident, account-deletion, and Money Desk browser responses. Expected conflict, authorization, terminal-state, invalid-request, and not-found outcomes now map to bounded public statuses; unexpected failures retain only a correlation ID and stable public code while their internal code and message remain in server logs. `edge:auth:verify` now fails if these protected response patterns regress or if a Money Desk adapter reintroduces a raw database message into its result.

Sensitive reads and mutations remain fail-closed unless the distinct sensitive Access assertion is present and fresh. Both verified audiences are now bound, and the standalone production route is active.

The live production certifier now also rejects any active canonical Ops function whose inventory reports `verify_jwt: false`. It additionally requires an exact post-deployment version manifest for all 38 Edge functions that embed the shared Ops-issue or Web Push sender. The executable source manifest currently reconciles all 38 functions. Their production redeployment and reviewed version evidence remain intentionally incomplete. The dated pre-export certification record contained 68 open gates. The current source adds six explicit fail-closed gates: migrations `20260911013000`, `20260911014000`, `20260911015000`, and `20260911016000`, plus the ninth `ops-export-action` and tenth `ops-workforce-action` gateways. An attended production evidence refresh is therefore expected to report 74 open gates until those release units are actually promoted; this expectation is not live production proof. Each phone matrix still requires explicit evidence that a restricted irreversible action is absent from the UI and receives a server-side denial.

## Local Ops browser proof

The in-app browser reused the existing local workforce session at `http://localhost:3004/ops?notice=ops-unlocked`. The redesigned legacy overview rendered its named local-workforce badge, queue navigation, priority decision list, full workload, and system pulse. The removed protruding side-panel treatment did not reappear. Development showed 113 active issues and 102 incidents; those values were treated as development evidence only and were not copied into production readiness.

The standalone app at `http://localhost:3005/ops/my-work` reused the same local workforce identity and returned the canonical route-owned work table, environment badge, install entry point, and runtime contract. Visual inspection then exposed a stale development-process artifact: a previous Cloudflare build had reused and replaced the running dev server's `.next` output, leaving its referenced stylesheet at `404`. The Ops development command now writes to `.next-dev`, the ordinary optimized build stays in `.next-build`, and the Cloudflare adapter retains `.next`; generated directories are ignored separately. A fresh optimized build compiled successfully and emitted its CSS asset. The already-running sandboxed process could not be terminated without elevated host permission, so a styled browser screenshot must be repeated after the local server is restarted; this does not affect source or the legacy local surface.

The shell audit then added the role-derived command palette and completed the queue interaction contract with explicit next-action/activity cells, roving Arrow/Home/End row focus, and labelled tablet cards. It also removed incident resolution from the phone UI and added an independent server-side phone denial for that terminal action. The following least-privilege review added queue-policy-derived case controls plus the pending forward database repair: non-owning roles become read-only, retired/future policies cannot authorize, assignment and acknowledgement obey permitted actions, escalation is offered only where policy permits it, and the Edge gateway returns a real forbidden response for a queue-policy denial. The source-set pass made every summary cell across My Work, Overview, Customers, Tailors, Orders, Vision, Communications, Delivery, Money Desk, incidents, providers/jobs, and Reports open an exact bounded filtered ledger; split overdue from due-soon; added payload-free reliability and communications job ledgers within existing query budgets; and removed raw provider failure text from the projections. `ui:verify` passed all 29 deterministic shell/surface/policy/source-set checks; TypeScript, ESLint, the PWA contract, `git diff --check`, and both the clean Node 22 optimized build and the Cloudflare OpenNext packaging build also passed. Browser clicks against the stale pre-isolation process did not hydrate and are intentionally not counted as proof. The next attended local pass must restart port 3005, then prove command search, Escape, metric drill-through, keyboard row traversal, role/queue action visibility, restricted incident controls, and the 768/1024 layouts before deployment.

The subsequent source-only case-lineage pass raised the deterministic interaction contract to 40 checks. It adds protected target reread, admin-only merge/split controls, deterministic two-case locking, source/target optimistic versions, cycle rejection, immutable lineage and paired events, durable receipts, explicit allowlisted split context, idempotent retry recovery, local-workforce development resolution, and independent phone denials in the application and Edge gateway. TypeScript, ESLint, runtime isolation, the PWA contract, nine Edge authentication boundaries, six production-readiness policy tests, 38 notification-producer manifests, 14 shared Deno policy tests, both touched Edge checks, `git diff --check`, a clean Node 22 optimized build, OpenNext packaging, and a 126-asset Wrangler dry run all passed locally. Migration `20260911015000` was not applied anywhere, no Edge/Worker was deployed, and no browser mutation was attempted; those remain attended development gates.

The typed-metric source-contract pass now raises `ui:verify` to 46 deterministic checks. Every catalogue entry declares its eligibility, source grain, watermark, owner, sensitivity, cache rule, rollup grains, late-correction window, and exact rendered drill-down. Queue drill-downs now distinguish first-response from active-resolution breaches, paused SLA clocks are excluded from breached and due-soon source sets in the queue and both top-level summaries, critical incidents resolve to the non-resolved `CRITICAL` ledger, and catalogue anchors for communications and tailor readiness resolve to ledgers rendered by their default route. TypeScript, ESLint, `git diff --check`, the six-test runtime boundary, ten-check PWA contract, six-test production policy, all nine Edge authentication boundaries and eight callers, the 38-function notification-producer manifest, and a clean Node 22 optimized build pass locally. This is source proof only; hydrated browser traversal and authoritative development records remain attended gates.

The following command-recovery and route-safety pass raises `ui:verify` to 50 checks and the PWA contract to 14 checks. Every current mutable Ops command now derives its idempotency key from the exact submitted inputs, retains that key when an unchanged request has an ambiguous response, creates a fresh key when an operator changes the command, and retires the key only after confirmed success. Incident snooze recovery also retains the originally computed deadline. Unknown routes now offer Back, My Work, and Knowledge without loading a broad fallback dashboard. PWA notification paths are parsed and normalized against the service worker origin; executable sandbox tests prove exact case/query/hash preservation plus fail-closed behavior for external, malformed, protocol-relative, and path-traversal destinations. The service worker has no fetch interception or cache-write path, so operational pages and API responses cannot enter PWA storage. The production certifier now forwards its Cloudflare evidence correctly and refuses bare boolean assertions: every positive Access, device, rollback, maker/checker, reconciliation, and operator-signoff claim must include a recent evidence reference bound to the exact clean git release. It also rejects placeholder Cloudflare identifiers and any health schedule other than the reviewed five-minute cadence. The 33 relevant Deno policy/refund tests, TypeScript, ESLint, `git diff --check`, the nine-test runtime boundary, Edge authentication boundary, all 13 production-readiness policy and runner tests, 38-function producer manifest, and clean Node 22 optimized and OpenNext builds pass locally. The live production Edge-denial script was intentionally not counted because its production endpoint could not be reached from the restricted local sandbox; it remains an attended pre-deployment proof rather than a source failure.

The production-certification runner now has a separate local evidence phase. `OPS_PRODUCTION_EVIDENCE_PATH` is mandatory, and the artifact is parsed and checked for the current clean release, complete producer and migration ledgers, fresh release-bound Access/device/release receipts, real Cloudflare identifiers, the exact Worker route, and the reviewed monitor cadence before any Supabase inventory command can run. The remote inventory loader is lazy, and executable tests prove malformed or incomplete evidence cannot invoke it. Operators can run `pnpm --filter @drape/ops prod:evidence:verify` to inspect those local gates without contacting production; only a successful local result permits `prod:certify` to advance to authoritative secret and function inventory. The current dated artifact correctly fails this local gate because it remains incomplete, references no release, and the active worktree is dirty; that failure is expected and is not production evidence.

The source-data audit found one remaining legacy migration bridge that previously activated for every canonical case-query error. That behavior could hide an authorization, outage, or schema-cache failure behind a partial legacy result, and the pre-migration query cannot carry the canonical environment predicate. The bridge is now permitted only in `DEVELOPMENT` and only for recognized missing-column codes (`42703` and `PGRST204`). Production, permission failures, connectivity failures, and unknown failures stop at the canonical read boundary. The runtime surface now labels a successful canonical read directly instead of describing it as a legacy bridge, and the interaction verifier covers the environment predicate and fail-closed call site.

Cloudflare Access certificate degradation is also explicit rather than log-only. A matching previously trusted key set may preserve read access for less than 24 hours during issuer-endpoint degradation, but an unknown issuer, missing key set, invalid age, or expired cache fails closed. The verified session carries whether fresh or stale keys were used; stale sessions receive a visible all-route alert and cannot satisfy `hasFreshOpsMfa`, so deletion, trust, Money Desk, export, lineage, and other protected actions stay locked until a fresh key set is fetched. `ui:verify` passes 52 checks and the runtime suite passes 12 tests after these isolation repairs.

The web session verifier and every protected Ops Edge gateway now enforce the same signed Access identity and lifetime contract. `iat` and `exp` are mandatory, finite, ordered, and bounded by the same 30-second clock skew; `sub` and `email` must be non-empty signed JWT claims; and the optional `nbf` cannot be in the future. The web boundary no longer substitutes the unsigned authenticated-user request header when the signed email claim is absent. This makes workforce revocation checks enforceable from an unambiguous token issue time and prevents a partially accepted identity at one layer from reaching a stricter downstream layer. The shared Deno verifier passes five cryptographic claim tests, the full selected Deno policy/refund suite passes 35 tests, the runtime suite passes 14 isolation tests, and `ui:verify` passes 53 deterministic checks after this alignment.

The Knowledge workspace now exposes the operational catalogue instead of assuming staff can read repository files. All seven versioned queues have stable deep-link anchors, named primary and backup ownership, first-response and active-resolution targets, first action, escalation trigger, and source-policy provenance. Fourteen launch workflows are searchable and filterable by queue; every result states its authoritative records, terminal definition of done, owning roles, and exact Ops workspace. Repository filenames remain provenance and no longer masquerade as clickable production runbooks. The UI follows the existing compact row system, uses a native dropdown, visible focus, progressive disclosure, and responsive single-column behavior instead of adding another card wall. `ui:verify` passes 57 checks, Ops TypeScript and ESLint pass, and the optimized build includes the interactive Knowledge route.

The in-app browser reached the live local standalone at `http://localhost:3005/ops/knowledge` after this pass. Its previous local workforce session had expired, so the route rendered the intentional fail-closed screen and confirmed that no customer, tailor, payment, evidence, or incident data was requested. Re-entering the local token would transmit a secret and was not attempted while the operator was unavailable. Authenticated search/filter/runbook visual proof remains in the attended browser matrix; the unauthenticated denial is counted only as boundary evidence.

The standalone deployable now has a per-request nonce CSP and a production runtime guard that validates the only permitted hostname, the exact Supabase project reference, production environment mode, both normal and sensitive Access configuration, and the continued absence of every bootstrap/shared-token bypass. `workers_dev` and `preview_urls` are explicitly disabled, preventing an accidental second public origin outside `ops.drapeon.co`. The environment verifier covers those runtime controls, and a Node 22 `wrangler deploy --dry-run` successfully bundled the existing OpenNext artifact without contacting or changing Cloudflare. This is source and packaging proof only; the real Access policy and routed deployment remain attended gates.

The browser also opened the standalone `/install` route and confirmed the stable `ops.drapeon.co/install` QR, platform install guidance, explicit no-credential/no-bypass explanation, and alert-enablement step. The live local manifest returns standalone display mode with `/ops/my-work` as its start URL, and the service worker is served successfully. `pwa:verify` now enforces the generic privacy-safe notification copy, Ops-only deep-link allowlist, cache deletion, authenticated subscription route, device unsubscribe path, and installer boundary. The installed-app badge also has a private authenticated foreground reconciler over the deduplicated urgent-or-breached canonical case set: focus and visibility events share one in-flight read with a ten-second aggregate throttle, authorization loss and unsubscribe clear the badge, and unavailable server truth never fabricates a count. The PWA contract now passes 17 checks. Physical receipt and exact-case opening remain required on both iPhone and Android before production activation.

The metric reconciliation pass removes separate handwritten eligibility rules from My Work, Leadership Overview, the queue ledger, and Incident Command. A single pure contract now defines open and terminal cases, P0/P1 urgency, named assignment, running SLA clocks, first-response and active-resolution breaches, due-soon boundaries, and non-terminal critical incidents. Cancelled cases are terminal everywhere, malformed or paused clocks cannot enter SLA counts, the exact deadline belongs to due-soon rather than breached, and every headline set is the same predicate used by its drill-down. The service registry now also makes the operating envelope executable: all fourteen services expose their existing case types, explicit action authority, policy-backed queue/runbook anchors, authoritative records, terminal proof, and exact workspace. Governance remains an information-architecture area under admin authority instead of masquerading as an eighth unversioned queue. Under Node 22, eight deterministic metric boundary tests, 14 runtime-boundary tests, 17 PWA checks, 60 interaction checks, 13 production-certification policy tests, the nine-function/eight-caller Edge authentication audit, and the 38-function notification-producer source manifest all pass. Ops TypeScript, ESLint, `git diff --check`, the optimized Next.js build, and OpenNext packaging also pass locally. No database, Edge, Cloudflare, git, or device state changed during this unattended source pass.

The observability privacy pass closes a boundary the design explicitly required but the prior source evidence did not prove. Sentry messages, tag values, and extras plus structured Edge stdout now share one depth-, array-, and length-bounded scrubber. Sensitive keys, email addresses, phone-like values, URLs, bearer/JWT material, and common payment-provider credentials are removed before serialization; audit-write failures retain only a database error code instead of raw database text. Four executable tests prove both redaction and preservation of safe case/correlation identifiers. This source change requires the same reviewed 38-function producer redeployment/version evidence as the other shared Edge changes; no function was deployed during the unattended pass.

The workforce offboarding source pass closes the final known insider-risk workflow gap without pretending an internal database update can revoke external tools. The Access workspace now offers an inline protected action rather than a read-only roster. A first admin action locks both principals in deterministic order, rejects self-action and stale state, atomically revokes the Drapeon workforce principal/session cutoff and every Ops push subscription, and leaves the case in scheduled follow-up with four explicit blockers. A different admin must then provide bounded retained references for Access/IdP, collaboration tools, provider dashboards, and scoped credentials before a second durable receipt resolves the case. Application and Edge gateways independently require admin role, fresh sensitive Access, desktop surface, active access review, exact environment, and no-store responses. Idempotent replay is bound to the same action, evidence must contain exactly four non-null bounded identifiers, and case events retain the actual prior status rather than assuming a newly created case. Under Node 22, the final unattended source gate passes 64 interaction checks, 18 PWA checks, 14 runtime-isolation tests, eight metric-boundary tests, 13 production-certification policy tests, the ten-function/nine-caller Edge authentication audit, the 38-function producer manifest, eight telemetry source checks plus four scrubber tests, and 39 selected Deno policy/security/refund tests. Ops TypeScript, ESLint, `git diff --check`, the optimized Next.js build, and OpenNext packaging also pass locally. Migration `20260911016000` and `ops-workforce-action` are source-only and have not been applied or deployed; authenticated maker/checker browser proof remains an attended development gate.

The bounded-command follow-up makes that workflow's request contract executable before either gateway reaches the RPC. Both the standalone application and the Edge broker now accept only the exact action-specific fields; validate the principal identifier, reason, idempotency key, case version, and target timestamp; require four named non-URL evidence references only for external verification; and reject malformed JSON without exposing internal detail. Cloudflare Access authentication still precedes Edge request parsing and validation, while the durable receipt's server-issued correlation ID remains authoritative on replay. The queue also announces selected filters and result-count changes without altering its compact visual design. The current local source gate passes 66 interaction checks, 18 PWA checks, 14 runtime-isolation tests, eight metric-boundary tests, all 13 production-certification policy tests, the ten-function/nine-caller Edge authentication audit, the 38-function producer manifest, eight telemetry source checks plus four scrubber tests, and 38 selected Deno security/refund tests including all three new workforce-policy tests. Ops TypeScript, ESLint, `git diff --check`, the clean Node 22 optimized build, and OpenNext packaging pass. No database, Edge, Cloudflare, git, or device state changed during this unattended pass.

## Rollback and deferred proof

- The legacy embedded `/ops` bundle is retired. The customer web `/ops` entry redirects to the standalone hostname after its next production web deployment; Worker rollback uses the prior `drape-ops` version rather than restoring the embedded bundle.
- Schema rollback is forward-only; a failed batch stops promotion and requires a reviewed corrective migration.
- Migrations `20260911012000` through `20260911016000` were promoted as the final reviewed five-migration production batch after development proof and an exact dry run.
- The `ops.drapeon.co/*` Worker route is enabled behind Cloudflare Access; the application and Edge layers continue to reject absent, wrong-audience, stale, or revoked assertions.
- Physical iPhone and Android PWA/notification certification is deferred because no devices are currently available. This does not authorize weakening or removing those final certification gates.
