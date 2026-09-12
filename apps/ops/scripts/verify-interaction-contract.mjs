import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const canonicalData = await readFile(new URL('lib/data.ts', root), 'utf8')
const opsAuth = await readFile(new URL('../web/lib/ops-auth.ts', root), 'utf8')
const identityDocument = await readFile(new URL('../web/app/ops/identity-document/[profileId]/route.ts', root), 'utf8')
const trustCasePanel = await readFile(new URL('components/trust-case-panel.tsx', root), 'utf8')
const sensitiveEvidenceRoute = await readFile(new URL('app/ops/sensitive/evidence/trust/[profileId]/route.ts', root), 'utf8')
const accessCertificatePolicy = await readFile(new URL('../web/lib/ops-access-certificate-policy.mjs', root), 'utf8')
const accessTokenPolicy = await readFile(new URL('../web/lib/ops-access-token-policy.mjs', root), 'utf8')
const edgeAccessVerifier = await readFile(new URL('../../supabase/functions/_shared/ops-access.ts', root), 'utf8')
const sharedIssueContract = await readFile(new URL('../../packages/shared/src/ops-issues.ts', root), 'utf8')
const [palette, shell, workList, myWorkPage, overviewPage, metricCatalogue, metricEligibility, metricCell, idempotentCommand, reportsPage, exportPanel, exportRoute, exportDownloadRoute, exportEdge, exportPolicy, exportMigration, exportRetentionMigration, providersPage, customerPage, tailorPage, orderList, visionPage, communicationsPage, deliveryPage, moneyWorkspace, moneyActionPanel, remainingDomainData, reliabilityProjection, casePanel, caseLineagePanel, deletionPanel, trustDecisionPanel, casePage, caseLookupRoute, caseRoute, caseEdge, casePolicyMigration, caseLineageMigration, incidentPage, incidentPanel, incidentRoute, knowledgePage, serviceCatalogue, serviceCatalogueUi, accessPage, workforcePanel, workforceRoute, workforceEdge, workforcePolicy, workforceMigration, sensitiveRoute, notFoundPage, styles] = await Promise.all([
  readFile(new URL('components/ops-command-palette.tsx', root), 'utf8'),
  readFile(new URL('components/ops-shell.tsx', root), 'utf8'),
  readFile(new URL('components/work-list.tsx', root), 'utf8'),
  readFile(new URL('app/ops/my-work/page.tsx', root), 'utf8'),
  readFile(new URL('app/ops/overview/page.tsx', root), 'utf8'),
  readFile(new URL('lib/metric-catalogue.ts', root), 'utf8'),
  readFile(new URL('lib/metric-eligibility.mjs', root), 'utf8'),
  readFile(new URL('components/ops-metric-cell.tsx', root), 'utf8'),
  readFile(new URL('lib/use-idempotent-command.ts', root), 'utf8'),
  readFile(new URL('app/ops/reports/page.tsx', root), 'utf8'),
  readFile(new URL('components/ops-export-panel.tsx', root), 'utf8'),
  readFile(new URL('app/ops/api/exports/route.ts', root), 'utf8'),
  readFile(new URL('app/ops/api/exports/[exportRequestId]/download/route.ts', root), 'utf8'),
  readFile(new URL('../../supabase/functions/ops-export-action/index.ts', root), 'utf8'),
  readFile(new URL('../../supabase/functions/_shared/ops-export-policy.ts', root), 'utf8'),
  readFile(new URL('../../supabase/migrations/20260911013000_scoped_ops_async_exports.sql', root), 'utf8'),
  readFile(new URL('../../supabase/migrations/20260911014000_expire_ops_export_content.sql', root), 'utf8'),
  readFile(new URL('app/ops/providers/page.tsx', root), 'utf8'),
  readFile(new URL('app/ops/customers/page.tsx', root), 'utf8'),
  readFile(new URL('app/ops/tailors/page.tsx', root), 'utf8'),
  readFile(new URL('components/order-command-list.tsx', root), 'utf8'),
  readFile(new URL('app/ops/vision/page.tsx', root), 'utf8'),
  readFile(new URL('app/ops/communications/page.tsx', root), 'utf8'),
  readFile(new URL('app/ops/delivery/page.tsx', root), 'utf8'),
  readFile(new URL('components/money-desk-workspace.tsx', root), 'utf8'),
  readFile(new URL('components/money-action-panel.tsx', root), 'utf8'),
  readFile(new URL('lib/remaining-domain-data.ts', root), 'utf8'),
  readFile(new URL('../../supabase/functions/_shared/ops-read-projections.ts', root), 'utf8'),
  readFile(new URL('components/case-collaboration-panel.tsx', root), 'utf8'),
  readFile(new URL('components/case-lineage-panel.tsx', root), 'utf8'),
  readFile(new URL('components/deletion-action-panel.tsx', root), 'utf8'),
  readFile(new URL('components/trust-decision-panel.tsx', root), 'utf8'),
  readFile(new URL('app/ops/cases/[caseNumber]/page.tsx', root), 'utf8'),
  readFile(new URL('app/api/cases/lookup/route.ts', root), 'utf8'),
  readFile(new URL('app/api/actions/case/route.ts', root), 'utf8'),
  readFile(new URL('../../supabase/functions/ops-case-action/index.ts', root), 'utf8'),
  readFile(new URL('../../supabase/migrations/20260911012000_authorize_ops_case_collaboration_by_queue.sql', root), 'utf8'),
  readFile(new URL('../../supabase/migrations/20260911015000_ops_case_lineage_actions.sql', root), 'utf8'),
  readFile(new URL('app/ops/incidents/page.tsx', root), 'utf8'),
  readFile(new URL('components/incident-command-panel.tsx', root), 'utf8'),
  readFile(new URL('app/api/actions/incident/route.ts', root), 'utf8'),
  readFile(new URL('app/ops/knowledge/page.tsx', root), 'utf8'),
  readFile(new URL('lib/service-catalogue.ts', root), 'utf8'),
  readFile(new URL('components/ops-service-catalogue.tsx', root), 'utf8'),
  readFile(new URL('app/ops/admin/access/page.tsx', root), 'utf8'),
  readFile(new URL('components/workforce-offboarding-panel.tsx', root), 'utf8'),
  readFile(new URL('app/api/actions/workforce/route.ts', root), 'utf8'),
  readFile(new URL('../../supabase/functions/ops-workforce-action/index.ts', root), 'utf8'),
  readFile(new URL('../../supabase/functions/_shared/ops-workforce-policy.ts', root), 'utf8'),
  readFile(new URL('../../supabase/migrations/20260911016000_ops_workforce_offboarding_actions.sql', root), 'utf8'),
  readFile(new URL('app/ops/sensitive/[action]/route.ts', root), 'utf8'),
  readFile(new URL('app/not-found.tsx', root), 'utf8'),
  readFile(new URL('app/globals.css', root), 'utf8'),
])

const serviceRegistry = serviceCatalogue.split('export const OPS_SERVICE_CATALOGUE')[1] ?? ''
const serviceEntries = serviceRegistry.match(/\{ key: '[^']+'[^\n]+\}/g) ?? []
const queueKeys = [...serviceCatalogue.matchAll(/\{ key: '(support|privacy|trust|money|delivery|reliability|operations)'/g)].map((match) => match[1])
const issueTypeBlock = sharedIssueContract.match(/OPS_ISSUE_TYPES = \[([\s\S]*?)\] as const/u)?.[1] ?? ''
const issueTypes = [...issueTypeBlock.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1])

const checks = [
  ['The route shell owns the global command palette', shell.includes('<OpsCommandPalette destinations={commandDestinations} />')],
  ['Command destinations are derived from role-permitted navigation', shell.includes('permittedGroups.flatMap') && shell.includes('canAccessOpsArea')],
  ['The command palette exposes a labelled modal dialog', palette.includes('<dialog className="ops-command-dialog"') && palette.includes('aria-labelledby="ops-command-title"')],
  ['Command-K and Control-K toggle the palette', palette.includes('(event.metaKey || event.ctrlKey)') && palette.includes("event.key.toLowerCase() === 'k'")],
  ['Arrow keys and Enter operate command results', palette.includes("event.key === 'ArrowDown'") && palette.includes("event.key === 'ArrowUp'") && palette.includes("event.key === 'Enter'")],
  ['Escape closes the command palette from the focused search field', palette.includes("event.key === 'Escape'") && palette.includes('setOpen(false)')],
  ['Phone results are limited to mobile-safe routes', palette.includes('destinations.filter((destination) => destination.mobileSafe)')],
  ['Queue rows expose roving keyboard focus', workList.includes('tabIndex={index === activeRow ? 0 : -1}') && workList.includes('rowLinks.current[bounded]?.focus()')],
  ['Queue rows support Arrow, Home, and End navigation', ['ArrowDown', 'ArrowUp', 'Home', 'End'].every((key) => workList.includes(`event.key === '${key}'`))],
  ['Queue filter state and changing result counts are announced accessibly', workList.includes("aria-pressed={scope === 'open'}") && workList.includes('aria-live="polite"') && workList.includes('aria-atomic="true"') && workList.includes('aria-describedby="ops-work-list-status ops-row-navigation-help"')],
  ['Queue rows expose next action and last activity', workList.includes('data-label="Next action"') && workList.includes('data-label="Activity"')],
  ['Queue filters distinguish overdue, due-soon, and combined critical work', workList.includes('matchesOpsWorkScope(entry, scope, nowMs)') && metricEligibility.includes("case 'overdue': return isSlaBreachedOpenOpsCase") && metricEligibility.includes("case 'due': return isSlaDueSoonOpenOpsCase") && metricEligibility.includes("priority === 'critical'")],
  ['Paused and terminal SLA clocks are excluded from breach and due-soon source sets', metricEligibility.includes('isOpenOpsCase(item) && !item.slaPaused') && metricEligibility.includes("TERMINAL_CASE_STATUSES = new Set(['RESOLVED', 'CLOSED', 'CANCELLED'])") && myWorkPage.includes('deriveOpsCaseMetricSets(items, Date.now())') && overviewPage.includes('deriveOpsCaseMetricSets(items, Date.now())')],
  ['My Work and Overview metrics use the typed catalogue and drill into exact source filters', myWorkPage.includes('<OpsMetricCell') && overviewPage.includes('<OpsMetricCell') && metricCatalogue.includes("drillDownHref: '/ops/queues/all?scope=overdue'") && metricCatalogue.includes("drillDownHref: '/ops/queues/all?priority=critical'") && metricCatalogue.includes("drillDownHref: '/ops/incidents?scope=critical#incident-ledger'")],
  ['SLA phase drill-downs filter the queue by the same first-response and active-resolution predicates', workList.includes('matchesOpsSlaPhase(entry, phase)') && metricEligibility.includes("normalized(item.slaPhase) === 'FIRST_RESPONSE'") && metricEligibility.includes("normalized(item.slaPhase) === 'ACTIVE_RESOLUTION'") && metricCatalogue.includes('scope=overdue&phase=first-response') && metricCatalogue.includes('scope=overdue&phase=resolution')],
  ['Critical incident drill-down and Overview use the same non-terminal critical source set', incidentPage.includes('deriveIncidentMetricSets(reliability.incidents)') && overviewPage.includes('deriveIncidentMetricSets(reliability.incidents)') && incidentPage.includes("selectedScope === 'critical' ? incidentMetrics.critical") && metricEligibility.includes("normalized(incident.severity) === 'CRITICAL'")],
  ['Headline case metrics and queue drill-downs share one executable eligibility contract', myWorkPage.includes('metrics.open.length') && myWorkPage.includes('metrics.urgent.length') && myWorkPage.includes('metrics.unassigned.length') && overviewPage.includes('metrics.open.length') && overviewPage.includes('metrics.breached.length') && workList.includes("from '../lib/metric-eligibility.mjs'") && metricEligibility.includes('export function deriveOpsCaseMetricSets') && metricEligibility.includes('export function matchesOpsWorkScope')],
  ['Every metric declares eligibility, watermark, owner, cache, correction, dimensions, and a non-fabricated empty state', metricCatalogue.includes('eligibility: string') && metricCatalogue.includes('sourceWatermark: string') && metricCatalogue.includes('owner:') && metricCatalogue.includes("cachePolicy: 'PRIVATE_NO_STORE'") && metricCatalogue.includes('lateCorrectionHours: number') && metricCatalogue.includes('dimensions: readonly string[]') && metricCatalogue.includes("emptyState: 'No eligible production data yet'")],
  ['Metric cells expose stable keys, definitions, and canonical drill-downs', metricCell.includes('data-metric-key={metric.key}') && metricCell.includes('title={metric.definition}') && metricCell.includes('metric.drillDownHref')],
  ['Catalogue links target rendered source ledgers rather than absent anchors', metricCatalogue.includes("drillDownHref: '/ops/communications#campaign-ledger'") && metricCatalogue.includes("drillDownHref: '/ops/tailors#tailor-roster'") && communicationsPage.includes('id="campaign-ledger"') && tailorPage.includes('id="tailor-roster"')],
  ['Mutable command inputs receive a new idempotency key while unchanged retries retain their key', idempotentCommand.includes("attempt.current?.fingerprint === fingerprint") && idempotentCommand.includes('crypto.randomUUID()') && idempotentCommand.includes('complete(fingerprint: string)')],
  ['Case notes, deletion, trust, incident, lineage, exports, and money execution share the input-bound idempotency contract', [casePanel, deletionPanel, trustDecisionPanel, incidentPanel, caseLineagePanel, exportPanel, moneyActionPanel].every((source) => source.includes('idempotencyFingerprint') && source.includes('command.begin(fingerprint'))],
  ['Ambiguous mutation responses preserve the same logical command for recovery', [casePanel, deletionPanel, trustDecisionPanel, incidentPanel, caseLineagePanel, exportPanel, moneyActionPanel].every((source) => source.includes('catch')) && casePanel.toLowerCase().includes('retry unchanged') && caseLineagePanel.includes('Retry with the same inputs')],
  ['Reports and reliability metrics drill into filtered source ledgers', reportsPage.includes('outcome=FAILED#receipt-ledger') && providersPage.includes('jobState=DEAD#job-ledger') && providersPage.includes('providerState=degraded#provider-lanes') && incidentPage.includes('/ops/providers#synthetic-paths')],
  ['Reports expose a reason-bound asynchronous export request instead of a direct table dump', reportsPage.includes('<OpsExportPanel') && exportPanel.includes("dataset: 'ACTION_RECEIPTS'") && exportPanel.includes('reason.trim().length < 12') && exportRoute.includes('after(async () =>')],
  ['Exports require named fresh-MFA desktop access at both application and Edge boundaries', exportRoute.includes('isRestrictedOpsPhoneHeaders') && exportRoute.includes('hasFreshOpsMfa(session)') && exportDownloadRoute.includes('hasFreshOpsMfa(session)') && exportEdge.includes('requireSensitive: true') && exportEdge.includes('isPhoneClient')],
  ['Export persistence is requester-bound, bounded, watermarked, short-lived, and retained without payload after expiry', exportPolicy.includes('OPS_EXPORT_MAX_ROWS = 1_000') && exportMigration.includes('requester_principal_id') && exportMigration.includes("now() + interval '15 minutes'") && exportEdge.includes("'export_reference'") && exportEdge.includes("'requested_by'") && exportRetentionMigration.includes("content = null") && exportRetentionMigration.includes("'EXPIRED'")],
  ['Export recovery closes stalled generators to a durable bounded failure', exportRetentionMigration.includes("failure_code = 'GENERATOR_TIMEOUT'") && exportRetentionMigration.includes("status = 'PROCESSING'") && exportRetentionMigration.includes("status = 'REQUESTED'") && exportRetentionMigration.includes("'FAILED'")],
  ['Export downloads prevent CSRF, cross-operator access, formula injection, and shared caching', exportDownloadRoute.includes('export async function POST') && exportDownloadRoute.includes('validateOpsMutationOrigin') && exportMigration.includes('Only the requesting operator may download this export.') && exportEdge.includes('opsExportCsvCell') && exportPolicy.includes("/^[\\u0000-\\u0020]*[=+\\-@]/u") && exportDownloadRoute.includes("'Cache-Control': 'private, no-store, max-age=0'")],
  ['Reliability source rows are bounded and exclude payloads and raw job errors', reliabilityProjection.includes(".select('id,job_type,status,attempt_count,max_attempts,run_at,created_at,updated_at')") && reliabilityProjection.includes('.limit(200)') && reliabilityProjection.includes('hasRecordedError: Boolean(text(row.lastError))') && !providersPage.includes('provider.lastError')],
  ['Marketplace roster and order metrics drill into exact filtered source sets', customerPage.includes('view=deletion#customer-roster') && tailorPage.includes('view=applications#application-roster') && orderList.includes('view=attention#order-ledger')],
  ['Vision, communications, and delivery metrics drill into privacy-safe source ledgers', visionPage.includes('view=failed#session-ledger') && communicationsPage.includes('view=dead-jobs#communication-job-ledger') && deliveryPage.includes('view=in-transit#parcel-ledger')],
  ['Money metrics expose bounded source ledgers and no communication raw errors cross the read boundary', moneyWorkspace.includes('view=payout-blocked#payout-ledger') && moneyWorkspace.includes('view=eligible-tranches#tranche-ledger') && reliabilityProjection.includes("select('id,order_id,status,amount,currency,provider,processed_at')") && !remainingDomainData.includes("processed_at,last_error") && !reliabilityProjection.includes("processed_at,last_error")],
  ['The environment-less legacy case reader is development-only and limited to schema-drift errors', canonicalData.includes('canUseLegacyOpsReadBridge({ environment: currentEnvironment') && canonicalData.includes(".eq('environment', currentEnvironment)") && canonicalData.includes("unavailable('Canonical Ops case queue'")],
  ['Stale Access signing keys are bounded, visible, and cannot authorize sensitive work', accessCertificatePolicy.includes('24 * 60 * 60 * 1000') && accessCertificatePolicy.includes('issuerMatches') && opsAuth.includes('accessCertificateAllowsSensitiveAction(session.accessKeyState)') && opsAuth.includes('accessKeyState: accessKeys.state') && shell.includes('Access signing-key refresh is degraded.') && shell.includes('Sensitive actions remain locked')],
  ['Independent MFA trusts only a fresh token for the dedicated sensitive Access application', opsAuth.includes('CF_ACCESS_SENSITIVE_AUD') && opsAuth.includes('session.audiences.some') && opsAuth.includes('tokenAgeSeconds > maxAgeSeconds') && opsAuth.includes('Independent MFA is enforced by the dedicated Cloudflare Access application')],
  ['Origin-less trust-evidence POSTs are accepted only for explicit same-origin user document navigations', identityDocument.includes('originCheck.receivedOrigin === null') && identityDocument.includes("originCheck.fetchSite === 'same-origin'") && identityDocument.includes("sec-fetch-mode") && identityDocument.includes("=== 'navigate'") && identityDocument.includes("sec-fetch-dest") && identityDocument.includes("=== 'document'") && identityDocument.includes("sec-fetch-user") && identityDocument.includes("=== '?1'")],
  ['Private trust evidence stays inside the dedicated sensitive Access application', trustCasePanel.includes('/ops/sensitive/evidence/trust/') && sensitiveEvidenceRoute.includes('identity-document/[profileId]/route')],
  ['Audited trust evidence opens in a private browser video player instead of downloading a raw storage object', identityDocument.includes('.createSignedUrl(videoPath, TRUST_VIDEO_URL_TTL_SECONDS)') && identityDocument.includes('<video controls playsinline preload="metadata">') && identityDocument.includes("'Content-Type': 'text/html; charset=utf-8'") && identityDocument.includes("media-src ${mediaOrigin}") && !identityDocument.includes('drapeon-trust-challenge-video')],
  ['Case UI recomputes protected access from the live signed session instead of trusting the verified query flag', casePage.includes("protectedState === 'verified' && Boolean(session && hasFreshOpsMfa(session))") && casePage.includes('Protected access expired') && !casePage.includes("protectedAccess={protectedState === 'verified'}")],
  ['Web and Edge Access verifiers require the same signed lifetime and workforce identity claims', opsAuth.includes('hasValidOpsAccessTokenClaims(parsed.payload, now)') && accessTokenPolicy.includes("typeof claims.iat !== 'number'") && accessTokenPolicy.includes("typeof claims.exp !== 'number'") && accessTokenPolicy.includes("typeof claims.sub !== 'string'") && accessTokenPolicy.includes("typeof claims.email !== 'string'") && edgeAccessVerifier.includes("typeof payload.iat !== 'number'") && edgeAccessVerifier.includes("typeof payload.exp !== 'number'") && edgeAccessVerifier.includes("typeof payload.sub !== 'string'") && edgeAccessVerifier.includes("typeof payload.email !== 'string'") && !opsAuth.includes("assertedEmail || parsed.payload.email")],
  ['Phone-safe case collaboration includes a durable escalation control', casePanel.includes("act('ESCALATE')") && casePanel.includes('Escalate to the backup team')],
  ['The case route recognizes escalation without creating a direct domain outcome', caseRoute.includes("'ADD_NOTE', 'ESCALATE'")],
  ['Case collaboration is authorized by the active queue policy', casePolicyMigration.includes('v_principal.roles && v_policy.permitted_roles') && casePolicyMigration.includes("'escalate' = any(v_policy.permitted_actions)")],
  ['Retired and future queue policies cannot authorize a case action', casePolicyMigration.includes('policy.retired_at is null') && casePolicyMigration.includes('policy.effective_at <= v_now')],
  ['Assignment and acknowledgement obey queue action policy', casePolicyMigration.includes("v_action = 'ASSIGN_SELF'") && casePolicyMigration.includes("'assign' = any(v_policy.permitted_actions)") && casePolicyMigration.includes("'acknowledge' = any(v_policy.permitted_actions) or 'triage' = any(v_policy.permitted_actions)")],
  ['Case UI hides actions outside role and queue policy', casePanel.includes('authorizedForQueue') && casePanel.includes('allowAcknowledge') && casePanel.includes('allowAssign') && casePanel.includes('allowEscalate') && casePage.includes('record.permittedRoles.includes(session.role)') && casePage.includes("record.permittedActions.includes('escalate')")],
  ['Case Edge reports queue authorization failures as forbidden', caseEdge.includes("error.code === '42501'") && caseEdge.includes('forbidden ? 403')],
  ['Case Edge does not expose unexpected database errors', caseEdge.includes("'rpc.failed'") && caseEdge.includes("'The case action could not be persisted.'") && !caseEdge.includes(': error.message, code: error.code')],
  ['Merge and split require admin, fresh-MFA, and desktop enforcement at both application and Edge boundaries', caseRoute.includes("session.role !== 'admin'") && caseRoute.includes('hasFreshOpsMfa(session)') && caseRoute.includes('isRestrictedOpsPhoneHeaders') && caseEdge.includes('requireSensitive: true') && caseEdge.includes('isPhoneClient')],
  ['Merge target lookup is a protected authoritative reread, not a client-supplied version', caseLookupRoute.includes("session.role !== 'admin'") && caseLookupRoute.includes('hasFreshOpsMfa(session)') && caseLookupRoute.includes('loadCanonicalOpsData({ caseNumber })') && caseLineagePanel.includes("fetch('/api/cases/lookup'")],
  ['Case lineage is immutable, environment-bound, cycle-safe, and uses deterministic lock ordering', caseLineageMigration.includes('trg_ops_case_lineage_immutable') && caseLineageMigration.includes('public.current_ops_environment() <> v_environment') && caseLineageMigration.includes('with recursive reachable') && caseLineageMigration.includes('order by id\n  for update')],
  ['Case lineage preserves source records and split context is explicit and allowlisted', caseLineageMigration.includes("selected_context <@ array['user_id','tailor_profile_id','order_id','related_entity','provider']") && caseLineageMigration.includes("case when 'order_id' = any(v_selected_context)") && !caseLineageMigration.includes('delete from public.ops_issues')],
  ['Merge and split persist optimistic versions, paired events, durable receipts, and navigable lineage', caseLineageMigration.includes('p_expected_source_version') && caseLineageMigration.includes('p_expected_target_version') && caseLineageMigration.includes("'case-lineage:' || v_lineage.id::text || ':source'") && caseLineageMigration.includes("'case-lineage:' || v_lineage.id::text || ':target'") && caseLineageMigration.includes("'CASE_' || v_action") && casePage.includes('<CaseLineageHistory')],
  ['Lineage conflicts preserve operator inputs and ambiguous retries retain idempotency', caseLineagePanel.includes('Your inputs are preserved') && caseLineagePanel.includes('Retry with the same inputs') && caseLineagePanel.includes('command.begin(fingerprint')],
  ['Phone incident UI omits the terminal resolve control', incidentPage.includes('allowResolve={!phoneRestricted}') && incidentPanel.includes('{allowResolve ? <button')],
  ['Phone incident resolution is rejected by the server route', incidentRoute.includes("action === 'RESOLVE' && isRestrictedOpsPhoneHeaders(request.headers)") && incidentRoute.includes("'desktop-only-action'")],
  ['Every documented queue has a stable Knowledge anchor, named owner, backup, policy version, and runbook', ['support', 'privacy', 'trust', 'money', 'delivery', 'reliability', 'operations'].every((queue) => serviceCatalogue.includes(`key: '${queue}'`)) && serviceCatalogue.includes('primary:') && serviceCatalogue.includes('backup:') && serviceCatalogue.includes('policy:') && serviceCatalogue.includes('runbook:') && knowledgePage.includes('id={queue.key}')],
  ['Queue runbooks expose live SLA, first-action, escalation, and source policy without relying on a repository link', serviceCatalogue.includes('firstResponse:') && serviceCatalogue.includes('activeResolution:') && serviceCatalogue.includes('firstAction:') && serviceCatalogue.includes('escalateWhen:') && knowledgePage.includes('<details className="ops-queue-runbook">') && knowledgePage.includes('Source: {queue.runbook}') && !knowledgePage.includes('<ExternalLink')],
  ['The canonical service registry maps every launch workflow to records, terminal proof, owner, queue, and exact workspace', serviceEntries.length === 14 && serviceEntries.every((entry) => ['queues:', 'owners:', 'records:', 'terminalProof:', 'href:'].every((field) => entry.includes(field)))],
  ['Every launch service declares case types, action authority, and policy-backed runbooks', serviceEntries.length === 14 && serviceEntries.every((entry) => ['caseTypes:', 'authority:', 'runbooks:'].every((field) => entry.includes(field))) && serviceEntries.every((entry) => [...entry.matchAll(/(?:queues|runbooks): \[([^\]]+)\]/g)].every((match) => match[1].split(',').map((value) => value.trim().replaceAll("'", '')).every((value) => queueKeys.includes(value)))) && !serviceRegistry.includes("queues: ['governance']")],
  ['Every shared Ops issue type has at least one service owner and no service invents an unknown type', issueTypes.length > 0 && issueTypes.every((issueType) => serviceRegistry.includes(`'${issueType}'`)) && serviceEntries.every((entry) => [...(entry.match(/caseTypes: \[([^\]]+)\]/)?.[1].matchAll(/'([A-Z_]+)'/g) ?? [])].every((match) => issueTypes.includes(match[1])))],
  ['Knowledge makes service ownership, cases, authority, and runbooks searchable and queue-filterable', serviceCatalogueUi.includes('type="search"') && serviceCatalogueUi.includes('<select value={queue}') && serviceCatalogueUi.includes('service.authority') && serviceCatalogueUi.includes('service.caseTypes') && serviceCatalogueUi.includes('service.runbooks') && serviceCatalogueUi.includes('aria-live="polite"') && serviceCatalogueUi.includes('No mapped workflow matches') && knowledgePage.includes('<OpsServiceCatalogue />')],
  ['Authenticated Knowledge is rendered dynamically under the workforce session boundary', knowledgePage.includes("export const dynamic = 'force-dynamic'")],
  ['Workforce access exposes a protected offboarding workflow instead of a read-only principal list', accessPage.includes('<WorkforceOffboardingPanel') && sensitiveRoute.includes("'workforce-access'") && workforcePanel.includes("fetch('/api/actions/workforce'")],
  ['Workforce revocation is admin-only, fresh-MFA, desktop-only, environment-bound, and enforced at both gateways', workforceRoute.includes("session.role !== 'admin'") && workforceRoute.includes('hasFreshOpsMfa(session)') && workforceRoute.includes('isRestrictedOpsPhoneHeaders') && workforceEdge.includes('requireSensitive: true') && workforceEdge.includes('isPhoneClient') && workforceMigration.includes('public.current_ops_environment() <> v_environment')],
  ['Workforce offboarding immediately revokes sessions and push while retaining external systems as explicit blockers', workforceMigration.includes("session_revoked_before = v_now") && workforceMigration.includes("failure_reason = 'WORKFORCE_ACCESS_REVOKED'") && workforceMigration.includes("'ACCESS_IDP_VERIFICATION_REQUIRED'") && workforceMigration.includes("'SCOPED_CREDENTIALS_VERIFICATION_REQUIRED'") && workforceMigration.includes("canonical_status = 'SCHEDULED_FOLLOW_UP'")],
  ['External offboarding closure requires a different admin, four bounded evidence references, optimistic concurrency, and durable security receipts', workforceMigration.includes('v_initial_actor_id = v_actor.id') && workforceMigration.includes("p_evidence_refs ?& array['accessProvider','collaborationTools','providerDashboards','scopedCredentials']") && workforceMigration.includes('p_expected_case_version') && workforceMigration.includes("'WORKFORCE_VERIFY_EXTERNAL_OFFBOARDING'") && workforceMigration.includes("event_type, visibility, sensitivity") && workforcePanel.includes('Retry unchanged')],
  ['Workforce command shape is independently bounded before RPC without accepting evidence URLs', workforceRoute.includes('validateOpsWorkforceRequest(body)') && workforceEdge.indexOf('verifyCloudflareOpsAccess') < workforceEdge.indexOf('validateOpsWorkforceRequest(body)') && workforceEdge.indexOf('validateOpsWorkforceRequest(body)') < workforceEdge.indexOf("supabase.rpc('perform_ops_workforce_offboarding_action'") && workforcePolicy.includes("value.trim().includes('://')") && workforceMigration.includes("position('://' in trim(v_evidence.value)) > 0")],
  ['Unknown routes remain recoverable without a broad dashboard fallback', notFoundPage.includes('router.back()') && notFoundPage.includes('href="/ops/my-work"') && notFoundPage.includes('href="/ops/knowledge"') && notFoundPage.includes('No broad dashboard fallback was loaded')],
  ['Tablet and phone queues become labelled cards', styles.includes('@media (min-width: 768px) and (max-width: 1100px)') && styles.match(/content: attr\(data-label\)/g)?.length === 2],
  ['Visible focus and reduced-motion policies remain global', styles.includes(':focus-visible') && styles.includes('@media (prefers-reduced-motion: reduce)')],
  ['Drillable summary cells expose visible hover and keyboard focus treatment', styles.includes('.ops-summary-link:hover') && styles.includes('.ops-summary-link:focus-visible::after')],
]

const failures = checks.filter(([, passed]) => !passed)
for (const [label, passed] of checks) console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`)

if (failures.length > 0) {
  console.error(`\nOps interaction contract failed ${failures.length} of ${checks.length} checks.`)
  process.exit(1)
}

console.log(`\nOps interaction contract passed ${checks.length} checks.`)
