# Ops Production Migration Batch Plan

Status: Executed and verified through Batch K; standalone application activated
Prepared: September 11, 2026

## Promotion boundary

No batch may be promoted until the production project identity is displayed and confirmed, the exact remote migration ledger is reread, and `supabase db push --dry-run` proves that the pending list matches this plan. Stop if an unexpected migration appears, more than five migrations would be applied, the project reference differs, or production health is already degraded.

The September 11 release installed `DRAPE_OPS_ENV` and the production-specific VAPID trio, promoted batches A–K in reviewed batches of no more than five, bound the production runtime, and deployed all ten `ops-*` Edge gateways with Supabase JWT verification enabled. Distinct normal and sensitive Cloudflare Access audiences are installed. Sensitive actions still require the separate fresh 15-minute assertion and never fall back to the normal audience.

Applied migrations are immutable. Any correction is a new forward migration and starts a new reviewed batch. Database migrations, Edge functions, Ops Worker deployment, Cloudflare Access policy, and provider secrets are separate release units.

The production completion claim is executable. Copy `apps/ops/scripts/production-evidence.example.json` to a dated, access-controlled evidence record, replace only fields proven by the steps below, and run:

```text
OPS_PRODUCTION_EVIDENCE_PATH=/absolute/path/to/evidence.json pnpm --filter @drape/ops prod:certify
```

The command rereads live Drape-PROD Edge secret names and function status, then verifies the authoritative migration snapshot, Access matrix, exact non-secret Cloudflare IdP/application/Worker/route/schedule identifiers, iPhone/Android notification matrix, maker/checker exercise, parallel-run reconciliation, rollback window, and named operator sign-off. It fails closed when authentication is unavailable, the evidence file is absent, or any item is absent or false. The evidence file contains no credentials or customer data.

## Proposed dependency-safe batches

| Batch | Migration versions | Purpose |
| --- | --- | --- |
| A | `20260910182000`, `20260910183500`, `20260910185000`, `20260910190000`, `20260910191500` | Gate pre-launch digest noise; establish named workforce principals, hardened push ownership, public tombstones, and canonical case foundation. |
| B | `20260910192000`, `20260910193000`, `20260910194000`, `20260910195000`, `20260910200000` | Bind runtime environment; backfill the canonical case envelope; repair safe updates; add deletion and case collaboration actions. |
| C | `20260910201000`, `20260910202000`, `20260910203000`, `20260910204000`, `20260910205000` | Add trust receipts and reliability ledger, then apply the reviewed identity-cast and severity corrections. |
| D | `20260910206000`, `20260910207000`, `20260910208000`, `20260910209000`, `20260910210000` | Restore incident severity, add incident commands and monotonic observations, extend Money Desk tip scope, and finalize asynchronous cancellation refunds. |
| E | `20260910211000`, `20260910212000`, `20260910213000`, `20260910214000`, `20260911010000` | Add queue/SLA policy and bounded first-response backfill, apply the two terminal/cast corrections required by the development proof, and bind installed Ops push subscriptions to one environment. |
| F | `20260911011000` | Forward-only repair for the cancellation finalizer's legacy `disputes.resolved_by` UUID assignment, discovered by the post-promotion lint and proven in development before production. |
| G | `20260911012000` | Applied least-privilege repair binding case collaboration to active queue policy with a durable, policy-authorized escalation transition. |
| H | `20260911013000` | Applied purpose-limited asynchronous action-receipt export schema and RPC boundary. |
| I | `20260911014000` | Applied scheduler release unit for export timeout recovery and fifteen-minute content purge. |
| J | `20260911015000` | Applied immutable case-lineage release unit with admin-only merge/split controls. |
| K | `20260911016000` | Applied workforce-offboarding release unit with atomic Drapeon revocation and maker/checker external closure. |

The version order is mandatory. If the production dry run contains older pending migrations, this plan must be regenerated rather than appending them to Batch A.

## Per-batch runbook

1. Record the production project reference, current migration watermark, deploy SHA, database Disk I/O, connection pressure, scheduler activity, queue/dead-letter depth, webhook failures, and Security/Performance Advisor findings.
2. Verify the required Ops Edge secret names exist. Never print their values; compare VAPID public-key fingerprints and Access audience identifiers through an approved secret-management path.
3. Run migration lint and inspect the exact dry-run list. Confirm the batch contains at most five versions and no migration outside the reviewed range.
4. Apply only the reviewed batch. Record start/end time and CLI result.
5. Re-read the remote migration ledger and verify every version in the batch is present exactly once.
6. Verify Advisors, Disk I/O/latency, connections, scheduler jobs, job queue/dead letters, communication provider events, payment callbacks, and one affected synthetic path.
7. Stop for a full observation interval before the next batch. Do not hide a failing signal by applying a later corrective migration in the same batch.
8. After the final batch and application canary, run `pnpm --filter @drape/ops prod:certify`; a nonzero exit blocks the completion claim and legacy retirement.

## Batch-specific proof

- **A:** daily digest remains launch-gated; production principals and push rows are environment-bound; a tombstoned profile/item cannot appear in public discovery; canonical case tables and indexes exist.
- **B:** runtime environment reads `PRODUCTION`; case counts reconcile before/after backfill; deletion/collaboration duplicate idempotency and stale-version conflicts fail safely.
- **C:** trust approve/reject writes a receipt and the reliability monitor creates one deduplicated incident; identity and severity casts no longer error.
- **D:** incident acknowledge/snooze/resolve is monotonic; duplicate monitor observations cannot rewind state; tip and cancellation refund flows preserve terminal outcomes and queue delivery records.
- **E:** every active queue resolves one policy/version; SLA due times and first-response evidence reconcile with source events; terminal RPCs accept only the reviewed signature; an enabled Ops push row always identifies `development` or `production`, and sender lookup cannot cross that boundary.
- **G:** an owning role can acknowledge/assign/note only where the queue permits it; a non-owning role, retired/future policy, and forbidden action all fail closed; escalation persists the reason, policy version, backup team, case event, audit, and receipt atomically; duplicate replay is idempotent and stale versions conflict safely.
- **H:** only active admin/engineering principals in the bound environment can request an action-receipt export; invalid dates, unknown filters, broad datasets, missing reason, more than 1,000 rows, cross-operator download, stale/revoked principal, fourth download, and expired content all fail closed; duplicate idempotency returns the original request; generated CSV neutralizes spreadsheet formulas and watermarks every row.
- **I:** a stalled requested/processing export closes to a durable `GENERATOR_TIMEOUT` failure; ready content is removed no later than the bounded scheduler interval after its fifteen-minute expiry; no expired payload is returned; request and event metadata remain; the job is idempotent and does not create repeated events for the same terminal transition.
- **J:** merge/split locks cases in deterministic order, rejects stale or cyclic lineage, retains source records, copies only allowlisted split context, and writes paired immutable events plus one durable receipt.
- **K:** an admin cannot revoke or certify their own principal; stale target/case versions fail safely; Drapeon session cutoff and every Ops push subscription are revoked atomically; the case remains non-terminal until a different admin records all four bounded external-system evidence references; replay is idempotent and phone requests fail at both application and Edge boundaries.

## Edge and application release order

After every required migration batch is healthy, deploy the independently authenticated Edge functions to production, verify their versions, and exercise deny paths before allowing the new Ops Worker to receive `ops.drapeon.co/*`. The read gateway must reject missing/expired/wrong-audience assertions and wrong-role operations. The push action must reject missing assertions, expired/revoked principals, environment mismatch, unapproved endpoint hosts, and cross-principal subscription takeover. Redeploy every issue-producing Edge function that embeds `_shared/web-push.ts` before enabling urgent alerts so its sender bundle includes the environment filter and encrypted exact-case payload. `pnpm --filter @drape/ops producers:verify` must reconcile the source manifest; then run `prod:producers:verify` with the dated production evidence path after recording every resulting live function version. Stop if any of the 38 producers is absent, inactive, unrecorded, or has drifted from the reviewed version. The Money action must reject normal-audience-only assertions, stale MFA, wrong-role decisions/executions, maker self-approval, expired grants, and duplicate execution; the production Ops Worker must not receive a service-role binding.

## Roll-forward and rollback

Schema rollback is forward-only. If a batch misbehaves, stop application traffic and ship a reviewed corrective migration. If the standalone Worker or Edge gateway fails, restore the prior `drape-ops` Worker version and keep canonical writes paused; do not restore the embedded customer-web Ops bundle or rewrite the migration ledger.
