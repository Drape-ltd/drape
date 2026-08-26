import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const expectedPhases = ['INITIAL_ORDER', 'CONSULTATION', 'FULFILLMENT', 'MATERIAL_ADVANCE', 'ADJUSTMENT', 'TIP']
const expectedLedgerAccounts = [
  'CUSTOMER_RECEIVABLE',
  'PROVIDER_CLEARING',
  'PROVIDER_FEE_EXPENSE',
  'TAILOR_ENTITLEMENT',
  'TAILOR_ELIGIBLE',
  'TAILOR_RELEASED',
  'CONSULTATION_ENTITLEMENT',
  'MATERIAL_ADVANCE_LIABILITY',
  'FULFILLMENT_LIABILITY',
  'TAX_LIABILITY',
  'TIP_LIABILITY',
  'DRAPEON_SUBSIDY_EXPENSE',
  'DRAPEON_REVENUE',
]
const expectedFinancialCaseTypes = [
  'CONSULTATION_ATTENDANCE',
  'MATERIAL_REQUEST',
  'FULFILLMENT_RECONCILIATION',
  'TIMELINE_AMENDMENT',
  'QUALITY_CONCERN',
  'RETURN',
  'REFUND',
  'PAYMENT_FAILURE',
  'PAYOUT_FAILURE',
  'SAFETY_FRAUD',
  'REVIEWED_EXCEPTION',
]
const expectedConcernOutcomes = [
  'EXPLANATION_OR_UPDATE',
  'ALTERATION_OR_FIX',
  'REMAKE',
  'PARTIAL_REFUND',
  'FULL_REFUND',
  'OPS_HELP',
]
const expectedMoneyDeskActions = [
  'PAYOUT_RELEASE',
  'TIP_PAYOUT',
  'MATERIAL_ADVANCE_RELEASE',
  'CUSTOMER_REFUND',
  'PAYOUT_DESTINATION_CHANGE',
  'MANUAL_FX',
  'POST_RELEASE_RECOVERY',
  'POLICY_OVERRIDE',
  'OTHER_REVIEWED',
]
const expectedTaxTransactionTypes = [
  'CUSTOM_ORDER',
  'READY_MADE_ORDER',
  'CONSULTATION',
  'MATERIAL_ADVANCE',
  'ORDER_AMENDMENT',
  'FULFILLMENT_CHARGE',
  'TIP_OR_GRATUITY',
]
const expectedTaxResponsibleParties = [
  'TAILOR',
  'DRAPEON_MARKETPLACE_FACILITATOR',
  'CUSTOMER_IMPORTER',
]
const expectedTaxCollectionModes = ['COLLECTED_AT_CHECKOUT', 'PAYABLE_ON_IMPORT', 'BLOCKED']

const [prisma, shared, pricing, financialCases, moneyDesk, taxDecision, materialMigration, adjustmentPhaseMigration, benefitPhaseMigration, benefitCoreMigration, ledgerMigration, caseMigration, moneyDeskBaseMigration, taxDecisionBaseMigration, taxDecisionSourceMigration, canonicalDoc] = await Promise.all([
  readFile(path.join(root, 'packages/db/prisma/schema.prisma'), 'utf8'),
  readFile(path.join(root, 'packages/shared/src/commercial-contracts.ts'), 'utf8'),
  readFile(path.join(root, 'packages/shared/src/commercial-pricing.ts'), 'utf8'),
  readFile(path.join(root, 'packages/shared/src/financial-cases.ts'), 'utf8'),
  readFile(path.join(root, 'packages/shared/src/money-desk.ts'), 'utf8'),
  readFile(path.join(root, 'packages/shared/src/tax-decision.ts'), 'utf8'),
  readFile(path.join(root, 'supabase/migrations/20260525000001_material_advances.sql'), 'utf8'),
  readFile(path.join(root, 'supabase/migrations/20260801040000_add_adjustment_payment_phase.sql'), 'utf8'),
  readFile(path.join(root, 'supabase/migrations/20260801070000_add_benefit_payment_contracts.sql'), 'utf8'),
  readFile(path.join(root, 'supabase/migrations/20260801070010_commercial_benefits_tips_reporting.sql'), 'utf8'),
  readFile(path.join(root, 'supabase/migrations/20260731140000_commercial_ledger_pricing_foundation.sql'), 'utf8'),
  readFile(path.join(root, 'supabase/migrations/20260731150000_financial_case_evidence_foundation.sql'), 'utf8'),
  readFile(path.join(root, 'supabase/migrations/20260801010000_money_desk_security_approvals.sql'), 'utf8'),
  readFile(path.join(root, 'supabase/migrations/20260816090000_tax_decision_controls_foundation.sql'), 'utf8'),
  readFile(path.join(root, 'supabase/migrations/20260816090300_harden_tax_control_source_evidence.sql'), 'utf8'),
  readFile(path.join(root, 'docs/drapeon-commercial-money-tax-and-resolution-architecture.md'), 'utf8'),
])

const moneyDeskMigration = `${moneyDeskBaseMigration}\n${benefitCoreMigration}`
const taxDecisionMigration = `${taxDecisionBaseMigration}\n${taxDecisionSourceMigration}`

const failures = []
const prismaEnum = prisma.match(/enum OrderPaymentPhase\s*{([\s\S]*?)@@map\("order_payment_phase"\)/)?.[1] ?? ''
const prismaPhases = prismaEnum
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => /^[A-Z_]+$/.test(line))
const sharedPhaseBlock = shared.match(/ORDER_PAYMENT_PHASES\s*=\s*\[([\s\S]*?)\]\s*as const/)?.[1] ?? ''
const sharedPhases = Array.from(sharedPhaseBlock.matchAll(/['\"]([A-Z_]+)['\"]/g), (match) => match[1])

if (JSON.stringify(prismaPhases) !== JSON.stringify(expectedPhases)) {
  failures.push(`Prisma phases differ: ${prismaPhases.join(', ') || 'none'}`)
}

if (JSON.stringify(sharedPhases) !== JSON.stringify(expectedPhases)) {
  failures.push(`shared phases differ: ${sharedPhases.join(', ') || 'none'}`)
}

if (!/alter type order_payment_phase add value 'MATERIAL_ADVANCE'/i.test(materialMigration)) {
  failures.push('Supabase material-advance enum migration is missing')
}

if (!/alter type order_payment_phase add value 'ADJUSTMENT'/i.test(adjustmentPhaseMigration)) {
  failures.push('Supabase adjustment enum migration is missing')
}

if (!/alter type public\.order_payment_phase add value if not exists 'TIP'/i.test(benefitPhaseMigration)) {
  failures.push('Supabase tip enum migration is missing')
}

if (!/alter type public\.payment_provider add value if not exists 'COVERAGE'/i.test(benefitPhaseMigration)) {
  failures.push('Supabase coverage provider migration is missing')
}

if (!canonicalDoc.includes('## Supersession Register')) {
  failures.push('canonical architecture is missing its supersession register')
}

if (!canonicalDoc.includes('Policy version: `commercial-2026-07-31-v1`')) {
  failures.push('canonical architecture policy version differs from the shared contract')
}

for (const account of expectedLedgerAccounts) {
  if (!pricing.includes(`| '${account}'`)) failures.push(`shared ledger account is missing: ${account}`)
  if (!ledgerMigration.includes(`'${account}'`)) failures.push(`Supabase ledger account is missing: ${account}`)
}

for (const requiredField of [
  'commercial_policy_version',
  'pricing_reservation_id',
  'correlation_id',
  'original_currency',
  'settlement_currency',
  'provider_fee_amount',
]) {
  if (!ledgerMigration.includes(requiredField)) failures.push(`Supabase commercial field is missing: ${requiredField}`)
}

if (!ledgerMigration.includes('create constraint trigger commercial_ledger_entries_balance_guard')) {
  failures.push('deferred balanced-ledger constraint is missing')
}

if (!ledgerMigration.includes('check (not tax_fallback)')) {
  failures.push('pricing reservation does not fail closed on fallback tax')
}

for (const caseType of expectedFinancialCaseTypes) {
  if (!financialCases.includes(`'${caseType}'`)) failures.push(`shared financial-case type is missing: ${caseType}`)
  if (!caseMigration.includes(`'${caseType}'`)) failures.push(`Supabase financial-case type is missing: ${caseType}`)
}

for (const outcome of expectedConcernOutcomes) {
  if (!financialCases.includes(`'${outcome}'`)) failures.push(`shared concern outcome is missing: ${outcome}`)
  if (!caseMigration.includes(`'${outcome}'`)) failures.push(`Supabase concern outcome is missing: ${outcome}`)
}

for (const requiredCaseInvariant of [
  'create_customer_concern_case',
  'append_financial_case_evidence',
  'financial_case_events_append_only',
  'financial_case_evidence_append_only',
  'disputes_sync_financial_case',
]) {
  if (!caseMigration.includes(requiredCaseInvariant)) failures.push(`financial-case invariant is missing: ${requiredCaseInvariant}`)
}

for (const action of expectedMoneyDeskActions) {
  if (!moneyDesk.includes(`'${action}'`)) failures.push(`shared Money Desk action is missing: ${action}`)
  if (!moneyDeskMigration.includes(`'${action}'`)) failures.push(`Supabase Money Desk action is missing: ${action}`)
}

for (const requiredMoneyDeskInvariant of [
  'issue_money_desk_jit_grant',
  'assert_money_desk_jit',
  'submit_money_desk_request',
  'decide_money_desk_request',
  'begin_money_desk_execution',
  'complete_money_desk_execution',
  'prevent_money_desk_append_only_mutation',
  'The preparer cannot approve their own request.',
]) {
  if (!moneyDeskMigration.includes(requiredMoneyDeskInvariant)) failures.push(`Money Desk invariant is missing: ${requiredMoneyDeskInvariant}`)
}

for (const transactionType of expectedTaxTransactionTypes) {
  if (!taxDecision.includes(`'${transactionType}'`)) failures.push(`shared tax transaction type is missing: ${transactionType}`)
  if (!taxDecisionMigration.includes(`'${transactionType}'`)) failures.push(`Supabase tax transaction type is missing: ${transactionType}`)
  if (!canonicalDoc.includes(`\`${transactionType}\``)) failures.push(`canonical tax architecture is missing: ${transactionType}`)
}

for (const responsibleParty of expectedTaxResponsibleParties) {
  if (!taxDecision.includes(`'${responsibleParty}'`)) failures.push(`shared tax responsible party is missing: ${responsibleParty}`)
  if (!taxDecisionMigration.includes(`'${responsibleParty}'`)) failures.push(`Supabase tax responsible party is missing: ${responsibleParty}`)
}

for (const collectionMode of expectedTaxCollectionModes) {
  if (!taxDecision.includes(`'${collectionMode}'`)) failures.push(`shared tax collection mode is missing: ${collectionMode}`)
  if (!taxDecisionMigration.includes(`'${collectionMode}'`)) failures.push(`Supabase tax collection mode is missing: ${collectionMode}`)
}

for (const requiredTaxInvariant of [
  'tax-fulfillment-2026-08-15-v1',
  'prevent_tax_policy_control_mutation',
  'resolve_reviewed_tax_responsibility_control',
  'valid_reviewed_tax_source_urls',
  "liability_granularity = 'ORDER'",
  'enable row level security',
]) {
  if (!taxDecisionMigration.includes(requiredTaxInvariant)) failures.push(`reviewed tax-control invariant is missing: ${requiredTaxInvariant}`)
}

if (!canonicalDoc.includes('`PROMOTIONAL_COVERAGE` is intentionally not a `TaxTransactionType`')) {
  failures.push('canonical tax architecture does not preserve promotional coverage as funding-only')
}
if (!canonicalDoc.includes('`OTHER_REVIEWED` is also intentionally excluded from static tax mapping')) {
  failures.push('canonical tax architecture does not fail closed for OTHER_REVIEWED')
}

if (failures.length > 0) {
  console.error(`Commercial contract parity failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log(`Commercial contract parity passed for ${expectedPhases.length} phases, ${expectedLedgerAccounts.length} ledger accounts, ${expectedFinancialCaseTypes.length} financial-case types, ${expectedMoneyDeskActions.length} Money Desk actions, and ${expectedTaxTransactionTypes.length} reviewed tax transaction types.`)
