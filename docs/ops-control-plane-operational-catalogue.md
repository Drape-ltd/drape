# Drapeon Ops Operational Catalogue

Status: Canonical implementation companion
Owner: Founder, Operations, Engineering, Security
Last reviewed: September 11, 2026

This catalogue turns the Ops architecture into enforceable operating policy. The architecture and delivery sequence remain owned by `docs/drapeon-ops-control-plane-post-submission-rebuild.md`; this file owns the concrete route, role, queue, data, cache, metric, alert, and proof registries required by section 24 of that design.

Code and database constraints win when prose and a deployed runtime disagree. A disagreement is a stop-line defect: do not improvise authority, retry money, expose evidence, or silently repair production data.

## 1. Runtime and environment contract

| Concern | Development | Production | Enforcement and evidence |
| --- | --- | --- | --- |
| Ops hostname | Local `localhost:3005` or a dedicated development hostname | `ops.drapeon.co` | `apps/ops/scripts/verify-environment.mjs`, Worker configuration, host validation |
| Data target | Drape-DEV only | Drape-PROD only | `DRAPE_OPS_ENV`, Supabase URL/project reference, `ops_runtime_configuration` |
| Workforce identity | Named local dry-run identity or development Access principal | Named Cloudflare Access principal only | `apps/web/lib/ops-auth.ts`, `ops_workforce_principals` |
| Normal Access audience | Development audience | Production audience | `CF_ACCESS_AUD`; wrong or missing audience denies before reads |
| Sensitive audience | Dedicated development MFA audience | Dedicated production MFA audience | `CF_ACCESS_SENSITIVE_AUD`; maximum 15-minute freshness |
| Interactive database authority | Typed Edge read/action gateways | Typed Edge read/action gateways | Access assertion is independently verified and mapped to a principal; no service role in the browser or Ops Worker |
| Fixtures and provenance | `QA`, `CANARY`, `REVIEWER`, `SHOWCASE`, or `STAFF` explicitly marked | `REAL` unless an approved production canary is explicitly marked | `ops_issues.environment`, `ops_issues.provenance`; no inferred production fixture |
| Push subscriptions | `environment=development` | `environment=production` | `20260911010000_bind_ops_push_subscriptions_to_environment.sql`; sender lookup is environment-bound |
| Monitoring state | Development fingerprint, channel, incident, and sink | Production fingerprint, channel, incident, and sink | `ops_monitor_state.environment`, environment-scoped dedupe keys |
| Cache namespace | Development release/environment namespace | Production release/environment namespace | Ops authenticated reads are no-store; public cache keys include environment and entity version |
| Provider credentials | Test/sandbox credentials and safe sinks | Live credentials and production callbacks | Environment verifier, secret-name audit, provider callback signature validation |

Fail closed if the runtime environment, project identity, Access audience, principal environment, or provider mode cannot be identified. Never copy a development record, push subscription, incident fingerprint, fixture, or communication destination into production to make a screen look populated.

## 2. Data classification and retention schedule

Retention dates are policy data, not guesses in UI code. Where a legal or finance period has not been approved, the system preserves the minimum operational record with `retention_until` unset and opens a governance review; it does not invent a purge date or keep unrestricted evidence forever.

| Class | Examples | Default access | Storage and display | Retention trigger |
| --- | --- | --- | --- | --- |
| Public | Published tailor name, public portfolio, live inventory, public availability | Public product surfaces | One public cache owner; safety and stock tombstones override cache | Remove immediately when hidden, sold out, suspended, deleted, or legally restricted; retain only internal audit references where justified |
| Internal | Case number, queue, owner, SLA, provider lane, safe order reference, correlation ID | Named workforce roles with route permission | Ops list/detail; safe Slack/Jira identifier only | Case closure plus approved operational retention policy |
| Sensitive | Account email, support context, communication outcomes, non-public profile facts, delivery state | Purpose-limited role and assigned work | No shared cache; no phone full-record route; audited use | Workflow completion, deletion eligibility, dispute/chargeback/financial exception review |
| Highly restricted | Private challenge video, addresses, body measurements or source frames, payment detail, deletion execution context, bulk export | Dedicated capability, case purpose, and fresh step-up where applicable | Never list-view, Slack, Jira, service-worker cache, analytics payload, or generic logs | Shortest approved purpose window; deletion propagates unless a documented legal-hold, fraud, chargeback, or financial-record exception applies |
| Secret | Access assertions, service credentials, VAPID private key, provider/API secrets, reset and OTP material | Runtime secret store or isolated Edge job only | Never database case payload, browser storage, logs, Slack, Jira, exports, or screenshots | Rotate on exposure, personnel change, provider requirement, or scheduled key policy |

Every `ops_case_events` event declares visibility and sensitivity. Every export requires a reason, filters, row limit, expiry, requester watermark, audit record, and fresh step-up. The first approved export is restricted to action-receipt CSVs for admin and engineering: 1,000 rows maximum, requester-only download, three downloads maximum, and fifteen-minute payload retention. Its local implementation is not production authority until migrations `20260911013000` and `20260911014000`, `ops-export-action`, both Access paths, and attended browser proof are promoted and certified together.

## 3. Threat and abuse catalogue

| Threat or abuse | Preventive control | Detective evidence | Required response |
| --- | --- | --- | --- |
| Shared or anonymous Ops login | Named Cloudflare Access identity mapped to active workforce principal | Principal/session audit, subject and email mismatch denial | Revoke group and principal; rotate exposed credentials; review access logs |
| Forged, stale, or wrong-environment assertion | Independent signature, issuer, audience, expiry, auth-time, revocation-cutoff, and environment verification in Edge | Deny result with correlation ID; no operational query | Keep route locked; investigate key/config drift |
| Hidden-nav authorization bypass | Server route-role guard before projection plus Edge action/read policy | Route-policy tests and 403/locked browser proof | Treat rendered unauthorized data as a security incident |
| Phone use of destructive or sensitive workflow | Server mobile-client guard, restricted PWA routes, desktop-only sensitive endpoint | Mobile-header tests and physical-device route proof | Deny before loading data; direct operator to trusted desktop |
| Cross-site mutation or forged form | Canonical Origin/CSRF validation, typed schema, assertion forwarding only server-side | Rejected request correlation and audit intent | Do not replay automatically; preserve safe draft only |
| Maker self-approval or duplicate money execution | Request/decision/elevation/execution separation, independent actor check, scoped JIT grant, expected version, idempotency | Money Desk decisions, attempts, receipts, provider reference | Stop execution; reconcile provider before any retry |
| Trust reviewer sees or leaks identity evidence outside purpose | Redacted queues, private evidence route, role + step-up, no direct storage URL | Evidence-access event and operator volume anomaly | Revoke access, preserve audit, investigate disclosure |
| Deleted/suspended/sold-out content resurrected by cache | Durable public tombstone checked before any cached or last-known-good value | Tombstone/invalidation/purge outcomes | Keep content hidden; repair cache owner; open incident on purge failure |
| Development data or notification reaches production | Environment-bound records, audiences, push subscriptions, provider sinks, fingerprints, cache keys | Runtime environment and provenance in every case/receipt | Disable affected path; revoke subscription/credential; audit affected recipients |
| Alert storm or green-message spam | Transition dedupe, cooldown, alert budget, recovery message, launch-gated digest | Durable incident state and Slack terminal outcome | Collapse repetition into one incident/digest; repair monitor |
| Monitor silently stops | Freshness threshold and monitor-silence incident | Last checked timestamp in durable monitor ledger | Page reliability owner; do not report healthy |
| Search or export used for browsing people | Purpose/reason, role scope, row limits, audit, sensitivity threshold | Per-principal query/export volume | Suspend capability and review access when anomalous |
| Offboarded worker retains browser push or session | Principal cutoff, group removal, session revocation, push disable/delete | Revocation receipt across Access, app, provider tools, and push | Verify every target; failed revocation is an incident |

## 4. Role and action authority

`ops` means operational triage, not universal administration. Authority is checked as an action capability and again inside the authoritative transaction.

| Capability | ops | customer_success | trust | finance | engineering | admin | Fresh step-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Read My Work/assigned case summary | allow | allow | allow | allow | allow | allow | no |
| Assign/claim, internal note, schedule, escalate | allow in permitted queue | allow in permitted queue | allow in permitted queue | allow in permitted queue | allow in permitted queue | allow | no |
| Customer support and evidence request | allow | allow | deny | deny | deny | allow | evidence class may require it |
| Trust decision or seller restriction | deny | deny | allow | deny | deny | allow | yes |
| Prepare a scoped money case/elevation request | allow | allow | deny | allow | deny | allow | yes; preparation never opens the full Money Desk or moves money |
| Money decision and execution | deny | deny | deny | allow | deny | allow | yes; maker/checker and scoped grant required |
| Incident acknowledge/snooze/recover | allow | deny | deny | deny | allow | allow | no; still versioned and audited |
| Provider/job diagnostics | allow | deny | deny | deny | allow | allow | no |
| Deletion review | deny except triage | allow | deny | deny | deny | allow | execution yes |
| Access grant/revoke | deny | deny | deny | deny | deny | allow | yes; self-approval forbidden where separation applies |
| Reports/audit read | deny | deny | deny | deny | allow | allow | export separately gated |

Single-operator launch override is an exceptional, one-action, 15-minute sensitive grant with reason, impact, immediate production alert, and retrospective due within 24 hours. It cannot alter workforce access or erase audit history.

## 5. Route, role, phone, cache, and query-budget map

The route policy source is `apps/ops/lib/route-access-policy.ts`. Read-action roles and budgets are enforced by `supabase/functions/_shared/ops-read-policy.ts`. Budget counts include the principal lookup. Authenticated operational responses are `private, no-store`.

| Route | Authorized roles | Phone/PWA | Edge read action | Max queries |
| --- | --- | --- | --- | --- |
| `/ops/my-work`, `/ops/queues/[queueKey]`, `/ops/cases/[caseNumber]` | all named Ops roles; case actions remain queue-scoped | allow; case is scoped/redacted | `canonical-cases` | 9 |
| `/ops/customers`, `/ops/customers/[customerId]` | admin, customer_success, ops | deny | `customers`, `customer-detail` | 4, 6 |
| `/ops/tailors`, `/ops/tailors/[tailorId]` | admin, trust, customer_success, ops | deny | `tailors`, `tailor-detail` | 4, 6 |
| `/ops/orders`, `/ops/orders/[orderId]` | admin, finance, customer_success, ops | deny | `orders`, `order-detail` | 7, 11 |
| `/ops/vision` | admin, trust, engineering, ops | deny | `vision` | 4 |
| `/ops/communications` | admin, engineering, customer_success, ops | deny | `communications` | 5 |
| `/ops/trust` | admin, trust | deny | `canonical-cases`; private evidence is separate | 9 |
| `/ops/delivery` | admin, customer_success, ops | deny | `delivery` | 4 |
| `/ops/money` | admin, finance | deny | `money`, `money-grant` | 7, 2 |
| `/ops/incidents` | admin, engineering, ops | allow | `reliability`, `canonical-cases` | 5, 9 |
| `/ops/providers` | admin, engineering, ops | deny | `reliability` | 5 |
| `/ops/overview` | admin, engineering, ops | deny | `reliability`, `canonical-cases` | 5, 9 |
| `/ops/reports` | admin, engineering | deny | `audit-report` | 5 |
| `/ops/knowledge` | all named Ops roles | allow | release-owned metadata only | no database read |
| `/ops/admin/access` | admin | deny | `access-governance` | 2 |
| `/ops/sensitive/[action]` | action-specific role plus named session | deny | checkpoint only; action route rereads truth | no business read at checkpoint |

Canonical sensitive actions are `account-deletion`, `case`, `export`, `money`, and `trust-decision`. An unknown action, mobile request, missing named session, normal-only audience, stale MFA, unsafe return path, or wrong role denies before mutation.

`ops` and `customer_success` can prepare a narrowly scoped money-related case or elevation request from an otherwise permitted workflow. They cannot open `/ops/money`, read the Money Desk projection, decide a request, or execute a provider action. Only `finance` and `admin` cross that route boundary after fresh step-up.

## 6. Case lifecycle catalogue

Canonical status order is not a simple linear funnel; every transition is typed and versioned.

| Status | Meaning | SLA behavior | Exit requirement |
| --- | --- | --- | --- |
| `NEW` | Durable intake exists, first response not yet recorded | First-response clock runs | Triage/claim or an explicit terminal correction |
| `TRIAGED` | Scope, queue, priority, and next action reviewed | Active-resolution clock runs | Assign, act, schedule, wait, block, escalate, or resolve |
| `IN_PROGRESS` | Named operator is performing the next action | Active-resolution clock runs | Persist outcome and next state |
| `SCHEDULED_FOLLOW_UP` | A real follow-up time exists | Policy-defined; not synonymous with blocked | Due time and owner required |
| `WAITING_CUSTOMER` | Customer response required | Pauses only if queue policy lists it | Customer response or timed escalation |
| `WAITING_COUNTERPARTY` | Tailor/other participant response required | Pauses only if queue policy lists it | Counterparty response or timed escalation |
| `WAITING_PROVIDER` | Terminal provider outcome is unknown | Pauses only if queue policy lists it | Reconcile provider before retry |
| `BLOCKED` | Internal requirement prevents safe progress | Clock runs unless an explicit policy says otherwise | Blocker code, owner, and recovery action required |
| `ESCALATED` | Impact/authority exceeds current queue | Clock runs | Named escalation owner and target required |
| `RESOLVED` | Required operational outcome is recorded | Clock stops; seven-day reopen window begins | Durable receipt and side-effect outcomes |
| `CLOSED` | Resolution and retention handling are complete | Closed | Immutable lineage retained |

Matching dedupe keys refresh one case. A matching event within seven days of resolution reopens and records lineage; after seven days it creates a linked case. Merge must designate one survivor and preserve every source event/reference. Split must create linked child cases and copy only explicitly selected context. No merge or split may rewrite a domain record or erase an event. The source-owned controls and typed RPC now exist, but must remain unpromoted until migration lint/apply, live concurrency/idempotency exercises, fresh-MFA and phone denial, and browser proof all pass in development.

## 7. Queue, ownership, SLA, and runbook registry

Versioned database policy in `20260910211000_ops_queue_policy_and_sla_clocks.sql` is authoritative. V1 uses continuous elapsed time to preserve public response promises; changing to staffed windows is prospective and requires a new policy version.

| UI queue | Stored policy key/version | Primary / backup | First response P0–P4 | Active resolution P0–P4 | Runbook |
| --- | --- | --- | --- | --- | --- |
| support | `support` / `support-v1` | customer_success / ops | 4h, 24h, 48h, 72h, 7d | 24h, 72h, 72h, 7d, 14d | `/ops/knowledge#support` |
| privacy | `privacy-deletion` / `privacy-deletion-v1` | customer_success / admin | 4h, 24h, 48h, 72h, 7d | 30d all priorities | `/ops/knowledge#privacy` |
| trust | `trust-safety` / `trust-safety-v1` | trust / admin | 4h, 24h, 48h, 72h, 7d | 24h, 72h, 5d, 7d, 14d | `/ops/knowledge#trust` |
| money | `money-desk` / `money-desk-v1` | finance / admin | 4h, 24h, 48h, 72h, 7d | 24h, 72h, 5d, 7d, 14d | `/ops/knowledge#money` |
| delivery | `delivery-supply` / `delivery-supply-v1` | ops / customer_success | 4h, 24h, 48h, 72h, 7d | 24h, 72h, 5d, 7d, 14d | `/ops/knowledge#delivery` |
| reliability | `reliability` / `reliability-v1` | engineering / admin | 15m, 1h, 24h, 72h, 7d | 1h, 4h, 24h, 72h, 7d | `/ops/knowledge#reliability` |
| operations | `operations` / `operations-v1` | ops / admin | 4h, 24h, 48h, 72h, 7d | 24h, 72h, 5d, 7d, 14d | `/ops/knowledge#operations` |

UI aliases never change the stored policy key. Waiting statuses pause active-resolution time only when included in that stored policy.

## 8. Service coverage and outcome registry

| Service/workflow | Queue / owner | Authoritative records | Terminal proof and escalation |
| --- | --- | --- | --- |
| Authentication, onboarding, role switch, recovery | support / customer_success | Auth identity, `users`, role profiles, security events | Confirmed account state and communication terminal outcome; security anomaly escalates to engineering |
| Customer privacy/deletion/data request | privacy / customer_success | `account_deletion_requests`, case/event/receipt ledger | Completed anonymization/deletion or documented blocker/legal exception; execution requires step-up |
| Tailor acquisition and setup | trust or operations / trust | `tailor_applications`, `tailor_profiles`, portfolio proof | Application/profile outcome with next requirement; no public listing before readiness |
| Tailor challenge-video trust review | trust / trust | Tailor trust state, private challenge reference, case/receipt | Approve/reject/restrict receipt plus public visibility result; payout readiness remains independent |
| Public catalogue and showcase quality | operations / ops | `tailor_profiles`, `seller_items`, tombstones | Visible/hidden/stock state and invalidation outcome |
| Customer-tailor conversation and safety | support or trust / customer_success or trust | Conversation access, safety reports, cases, communication outcomes | Access/moderation/remedy outcome; private messages never copied to generic logs |
| Consultation and live call | operations or support / ops | Order consultation state, attendance/reschedule records, call provider outcomes | Attendance/reschedule terminal state, notification deep link, and correct order context |
| Custom and ready-made orders | operations / ops | `orders`, stages, events, payments, approvals, fulfilment | Domain transition plus case receipt, counterpart refresh, and queued side effects reaching terminal outcomes |
| Measurements and Drapeon Vision | operations / ops; engineering on runtime failure | Measurement profile/scans, capture logs, cases | Saved/review-required/failure outcome; no body values or frames in lists |
| Fulfilment switching and delivery/supply | delivery / ops | Fulfilment runs, parcels, events, change requests | Accepted/paid/rejected/cancelled/recovered outcome with stale path removed |
| Payments, fulfilment charges, tips, refunds, payouts, settlement | money / finance | Payments, Money Desk request/decision/grant/attempt, provider callbacks, settlement ledger | Provider-reconciled terminal outcome and durable receipt; no blind retry |
| Transactional push/email/SMS and reviewed campaigns | operations or reliability / customer_success or engineering | Job queue, campaign recipients, provider events | Delivered/failed/dead/suppressed terminal result; queued is not delivered |
| Providers, callbacks, queues, schedulers, synthetics | reliability / engineering | Monitor ledger, circuits, jobs, incidents | Recovery observation and incident transition; provider status page alone is insufficient |
| Access, offboarding, export, audit | operations envelope / admin-only authority | Workforce principals, session cutoffs, subscriptions, receipts/events/audits | Revocation/export completion across every target with reconciliation |

Every service entry in the release-owned registry also declares its existing case types, action authority, and one or more stable queue-runbook anchors. Governance remains an information-architecture group, not an unversioned eighth queue. Any service not mapped here must open an `operations` policy-gap case before launch rather than adding an ad hoc dashboard card.

## 9. Metric catalogue

Metrics are drill-downs over authoritative records, never decorative numbers. Empty state text is `No eligible production data yet` with a watermark and development-only test path.

| Metric key | Definition and eligibility | Source / grain | Freshness and drill-down |
| --- | --- | --- | --- |
| `ops.open_cases` | Cases not resolved/closed/cancelled in current environment | `ops_issues`, current | Request-time; case list |
| `ops.urgent_cases` | Open cases carrying P0 or P1 priority | `ops_issues`, current | Request-time; critical-priority case list |
| `ops.unassigned_cases` | Open cases without named assignee | `ops_issues`, current | Request-time; My Work/queue |
| `ops.sla_breached` | Distinct open cases breaching either applicable SLA phase | Case envelope + queue policy | Request-time; exact overdue case union |
| `ops.sla_first_response_breached` | Open case with no first response and due time elapsed | Case envelope + queue policy | Request-time; exact case |
| `ops.sla_resolution_breached` | Active, unpaused case whose active deadline elapsed | Case envelope + policy clock | Request-time; exact case |
| `ops.critical_incidents` | Non-resolved critical service incidents | `service_incidents` | Synthetic interval; incident |
| `ops.monitor_freshness` | Age of latest environment-bound durable monitor observation | `ops_monitor_state` by target | Critical after 12m in current V1 UI; monitor/incident |
| `ops.provider_degraded_lanes` | Provider-operation circuits not healthy/closed/OK | provider circuit RPC | Request-time; provider lane |
| `ops.jobs_pending_retryable_dead` | Queue counts by terminal/recovery state | job queue health RPC | Request-time; filtered jobs/case |
| `ops.communication_terminal_outcomes` | Recipient/provider outcomes separated into delivered, failed, dead, suppressed | campaign recipients/provider events | Provider callback watermark; campaign/correlation |
| `ops.money_pending_approval` | Money requests in `PENDING_APPROVAL` | Money Desk ledger | Request-time; request/decision history |
| `ops.money_execution_work` | Approved, executing, processing, or failed manual money requests | Money Desk attempts | Request-time; request/attempt/provider ref |
| `ops.tailor_readiness` | Trust, profile, marketplace, payout, availability, and shop states shown separately | Tailor/profile/item records | Request-time; exact tailor |
| `ops.vision_outcomes` | Saved scans, explicit review requirements, completed/failed capture sessions | scan and telemetry records | Request-time; purpose-limited case |

Hourly/daily rollups are not authoritative until eligibility views, watermark advancement, late-event correction, nightly reconciliation, and drift-case creation are implemented and proven.

## 10. Cache and invalidation matrix

| Data | Owner | TTL / stale-on-error | Invalidation and recovery |
| --- | --- | --- | --- |
| Access keys/public certs | Ops auth verifier | 15m fresh; maximum 24h stale only under the explicit verifier policy | Refresh by issuer/key ID; unknown key or unverifiable assertion denies |
| Workforce session, role, action eligibility | Authoritative request | no shared cache; stale-on-error forbidden | Reread on request/action; revocation cutoff wins immediately |
| My Work, queue, case, customer/tailor/order detail | Typed Edge read gateway | `private, no-store`; request-local dedupe only | Targeted refresh after mutation/realtime event |
| Money, deletion, trust, access, evidence | Typed action/read service | no cache; stale-on-error forbidden | Reread before every command and after step-up |
| Provider/incident display | Reliability projection | bounded request read with checked-at; vendor state never substitutes | Durable observation transition opens/recovers incident |
| Historical rollups | Future reconciled rollup owner | up to 5m; watermark required | Source watermark and nightly reconciliation |
| Knowledge metadata | Ops release | 5–15m, release/environment namespaced | New deploy/version |
| Public discovery | One public cache owner | short reviewed TTL; harmless last-known-good only | Entity-version event plus purge; tombstone is synchronous and always checked first |
| Ops service worker | Ops release | static shell assets only, release-versioned | Activate new worker and delete old static cache; never cache navigation/API/data/Access/evidence |

## 11. Alert and runbook registry

| Signal | Severity/routing | Dedupe and recovery | Runbook |
| --- | --- | --- | --- |
| Critical/high service incident | Immediate owning Slack channel plus exact authenticated Ops link | Incident fingerprint + environment; explicit recovery transition | `/ops/knowledge#reliability` |
| Monitor silence > current freshness threshold | Critical engineering alert | Target/environment fingerprint; recover on fresh healthy observation | `/ops/knowledge#reliability` |
| Dead-letter or repeated retry pressure | High/medium by customer impact | Queue/job family window; terminal recovery recorded | `/ops/knowledge#reliability` |
| Provider circuit degraded | Severity from affected operation | Provider + operation + environment | `/ops/knowledge#reliability` |
| Trust/safety high-risk report | Immediate trust/admin alert | Case/dedupe key; resolution/restriction recovery | `/ops/knowledge#trust` |
| Money provider ambiguity or ledger mismatch | Immediate finance/admin; never automated blind retry | Money request/correlation/provider reference | `/ops/knowledge#money` |
| Deletion deadline/obligation risk | Customer-success/admin | Deletion request ID | `/ops/knowledge#privacy` |
| Delivery event-critical exception | Ops/customer-success | Fulfilment run/order/correlation | `/ops/knowledge#delivery` |
| Healthy summary and non-urgent due work | Launch-gated scheduled digest | One environment/day; no repeated green messages | `/ops/knowledge#operations` |

Slack carries safe case, release, and correlation identifiers only. The Ops incident/case ledger is authoritative. Missing runbook, owner, exact deep link, or recovery rule invalidates an alert configuration.

## 12. Change, proof, and rollback registry

Every release records code SHA, environment, database migration watermark, Edge function versions, Worker deployment, Access audiences/policies, provider modes, query-count headers, browser paths, operator identity, correlation IDs, and terminal outcomes.

Required proof order:

1. Typecheck, lint, Deno checks/tests, migration lint, and `git diff --check`.
2. Development database migrations in dependency order; read back the remote ledger and runtime environment.
3. Development Edge deployment with deny/allow tests and query-count budgets.
4. In-app-browser proof for desktop routes, invalid IDs, direct unauthorized routes, sensitive GET checkpoint, stale/duplicate/conflict states, and exact contextual returns.
5. Physical iPhone and Android proof for install, alert receipt, exact deep link, sign-out cleanup, revocation, and forbidden routes/actions.
6. Production secret-name and project-identity review, exact dry run, and batches of at most five migrations with an observation interval between batches.
7. Production Edge, Access, and Worker canary; verify callbacks, queues, advisors, Disk I/O, synthetics, and one affected workflow.
8. Parallel-run comparison and named operator sign-off before retiring legacy Ops.

Database rollback is forward-only. A bad schema batch stops further promotion and receives a corrective migration. A bad Edge or Worker deployment rolls back to the prior deployment while canonical mutations remain paused. Legacy `/ops` remains the rollback surface until parity, canary, rollback-window, and operator sign-off are recorded.

## 13. Current certification gaps

- Production migrations A–F are promoted and verified through `20260911011000`; pending migrations `20260911012000`, `20260911013000`, `20260911014000`, and `20260911015000` remain local until their development authorization, export, retention/recovery, and case-lineage matrices pass.
- Production Edge secret-name proof confirms `DRAPE_OPS_ENV` and the environment-specific `WEB_PUSH_VAPID_*` trio. `CF_ACCESS_SENSITIVE_AUD` remains intentionally absent until the real sensitive Access application exists.
- All eight previously promoted canonical `ops-*` Edge gateways are active in production with Supabase JWT verification and auth-before-validation deny proof. The ninth source-owned gateway, `ops-export-action`, is local-only and fail-closed in the production certifier. The 38 issue/push producer bundles still require coordinated redeployment and exact version evidence.
- The `drape-ops` and `drapeon-health-monitor` Workers do not yet exist in the Cloudflare account; the legacy web surface remains the rollback owner.
- The production normal/sensitive Access policy and fresh-MFA browser matrix have not been certified.
- Two-person Money Desk maker/checker has not been exercised with two real eligible production-like principals.
- Physical iPhone and Android PWA notification, exact-deep-link, route-deny, sign-out, and revocation proof remains outstanding.
- The isolated Ops application still needs a fresh hydrated browser pass after restarting the stale local port-3005 process.
- The scoped asynchronous action-receipt export is source-complete but intentionally unpromoted; its content is isolated, formula-safe, requester-bound, capped, and purged after fifteen minutes, while request/event metadata remains auditable. Merge/split lineage is also source-complete but intentionally unpromoted: links are immutable, domain records and histories remain untouched, split context is explicit, and both cases use optimistic concurrency. Reconciled metric rollups, restore drill, and final legacy retirement remain intentionally unshipped.

These are launch gates, not reasons to populate placeholder data or weaken an authority boundary.
