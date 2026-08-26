import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { TAX_FULFILLMENT_POLICY_VERSION } from '../../../packages/shared/src/tax-decision.ts'
import { resolveReviewedTaxDecision } from './tax-decision.ts'

function client(result: { data: unknown; error: unknown }) {
  return {
    rpc: async () => result,
  } as unknown as SupabaseClient
}

Deno.test('reviewed tax resolver rejects unknown transaction types before RPC', async () => {
  const result = await resolveReviewedTaxDecision({
    supabase: client({ data: null, error: null }),
    policyVersion: TAX_FULFILLMENT_POLICY_VERSION,
    jurisdictionCountryCode: 'GH',
    transactionType: 'UNKNOWN',
    fulfillmentClassification: 'LOCAL_DELIVERY',
  })
  assertEquals(result, { status: 'BLOCKED', reason: 'UNSUPPORTED_TRANSACTION_TYPE' })
})

Deno.test('reviewed tax resolver fails closed when the service RPC fails', async () => {
  const result = await resolveReviewedTaxDecision({
    supabase: client({ data: null, error: new Error('unavailable') }),
    policyVersion: TAX_FULFILLMENT_POLICY_VERSION,
    jurisdictionCountryCode: 'GH',
    transactionType: 'CUSTOM_ORDER',
    fulfillmentClassification: 'LOCAL_DELIVERY',
  })
  assertEquals(result, { status: 'BLOCKED', reason: 'CONTROL_RESOLUTION_FAILED' })
})

Deno.test('reviewed tax resolver validates a service response before returning it', async () => {
  const result = await resolveReviewedTaxDecision({
    supabase: client({
      error: null,
      data: {
        status: 'RESOLVED',
        controlId: '11111111-1111-4111-8111-111111111111',
        controlKey: 'GH:CUSTOM_ORDER:LOCAL_DELIVERY',
        policyVersion: TAX_FULFILLMENT_POLICY_VERSION,
        jurisdictionCountryCode: 'GH',
        jurisdictionRegionCode: null,
        transactionType: 'CUSTOM_ORDER',
        fulfillmentClassification: 'LOCAL_DELIVERY',
        supplyCharacterization: 'COMPOSITE',
        liabilityGranularity: 'ORDER',
        responsibleParty: 'DRAPEON_MARKETPLACE_FACILITATOR',
        statutoryRole: 'Marketplace facilitator and remitter',
        registrationSubject: 'DRAPEON',
        registrationRuleId: '22222222-2222-4222-8222-222222222222',
        marketplaceFacilitatorApplies: true,
        collectionMode: 'COLLECTED_AT_CHECKOUT',
        calculationStrategy: 'REVIEWED_STATIC_OR_PROVIDER',
        providerReference: null,
        invoiceTreatment: 'Drapeon records collected tax separately.',
        filingLiabilityAccount: 'TAX_LIABILITY:GH',
        amendmentMayInherit: false,
        sourceUrls: ['https://gra.gov.gh/'],
        legalReviewer: 'tax-reviewer@drapeon.co',
        financeApprover: 'finance-approver@drapeon.co',
        engineeringApprover: 'engineering-approver@drapeon.co',
        reviewedAt: '2026-08-01T00:00:00.000Z',
        reviewDueAt: '2027-08-01T00:00:00.000Z',
        effectiveFrom: '2026-08-01T00:00:00.000Z',
        effectiveTo: null,
        supersedesControlId: null,
        changeReason: 'Initial reviewed dry-run control.',
      },
    }),
    policyVersion: TAX_FULFILLMENT_POLICY_VERSION,
    jurisdictionCountryCode: 'GH',
    transactionType: 'CUSTOM_ORDER',
    fulfillmentClassification: 'LOCAL_DELIVERY',
    at: '2026-08-16T00:00:00.000Z',
  })
  assertEquals(result.status, 'RESOLVED')
})
