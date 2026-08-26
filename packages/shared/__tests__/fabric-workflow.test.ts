import {
  deriveFabricCandidateFundingBreakdown,
  deriveFabricCuttingBlockers,
  deriveFabricUserFacingState,
  validateFabricCandidate,
} from '../src/fabric-workflow'
import { FABRIC_FUNDING_POLICY_V2_VERSION } from '../src/fabric-funding'

const image = {
  originalStoragePath: 'orders/o1/fabric/c1/original.jpg',
  displayStoragePath: 'orders/o1/fabric/c1/display.jpg',
  mediaType: 'IMAGE' as const,
  crop: { x: 0, y: 0, width: 1200, height: 900, sourceWidth: 1200, sourceHeight: 1600, aspectRatio: '4:3' as const },
}

describe('fabric funding v2 workflow', () => {
  it('validates the immutable candidate and rejects public evidence URLs', () => {
    expect(validateFabricCandidate({
      orderId: 'order-1', componentCode: 'FABRIC', supplierCostAmount: 50_000,
      currency: 'ngn', privateSupplierEstimateStoragePath: 'orders/o1/fabric/c1/estimate.jpg',
      customerMedia: [image], availabilityNote: 'Available today', quantitySpecification: 'Six yards of cotton',
      deadlineImpact: 'NONE', policyVersion: FABRIC_FUNDING_POLICY_V2_VERSION,
      correlationId: 'corr-1', idempotencyKey: 'candidate-1',
    }).currency).toBe('NGN')
    expect(() => validateFabricCandidate({
      orderId: 'order-1', componentCode: 'FABRIC', supplierCostAmount: 50_000,
      currency: 'NGN', privateSupplierEstimateStoragePath: 'https://public.example/estimate.jpg',
      customerMedia: [image], availabilityNote: 'Available today', quantitySpecification: 'Six yards',
      deadlineImpact: 'NONE', policyVersion: FABRIC_FUNDING_POLICY_V2_VERSION,
      correlationId: 'corr-1', idempotencyKey: 'candidate-1',
    })).toThrow(/private storage path/u)
  })

  it('charges only the pre-tax shortfall plus separately disclosed tax and fees', () => {
    expect(deriveFabricCandidateFundingBreakdown({ supplierCostAmount: 65_000, remainingProtectedAllowanceAmount: 50_000, shortfallTaxAmount: 1_125, shortfallFeeAmount: 500 })).toEqual({
      supplierCostAmount: 65_000,
      protectedAllowanceAmount: 50_000,
      shortfallSubtotalAmount: 15_000,
      shortfallTaxAmount: 1_125,
      shortfallFeeAmount: 500,
      shortfallChargeAmount: 16_625,
      authorizedFabricAllocationAfterPayment: 65_000,
    })
  })

  it('derives clear states without treating broad production stage as fabric truth', () => {
    expect(deriveFabricUserFacingState({ fabricSource: 'TAILOR_SOURCES', candidateStatus: 'AWAITING_CUSTOMER_DECISION' })).toBe('AWAITING_FABRIC_APPROVAL')
    expect(deriveFabricUserFacingState({ fabricSource: 'CUSTOMER_SUPPLIES', handoffStatus: 'IN_TRANSIT' })).toBe('FABRIC_IN_TRANSIT')
  })

  it('returns precise cutting blockers in recovery order', () => {
    expect(deriveFabricCuttingBlockers({
      fabricSource: 'TAILOR_SOURCES', measurementsReady: true, styleReady: true,
      candidateStatus: 'AWAITING_CUSTOMER_DECISION', shortfallPaid: true,
      providerReleaseSucceeded: false, receiptPresent: false, acquiredProofPresent: false,
      reconciliationStatus: 'PENDING',
    }).map((blocker) => blocker.code)).toEqual([
      'FABRIC_CUSTOMER_APPROVAL_REQUIRED',
      'FABRIC_RELEASE_NOT_SUCCESSFUL',
      'FABRIC_RECEIPT_REQUIRED',
      'ACQUIRED_FABRIC_PROOF_REQUIRED',
      'FABRIC_RECONCILIATION_REQUIRED',
    ])
  })

  it('keeps customer-supplied fabric blocked until fresh receipt proof exists', () => {
    expect(deriveFabricCuttingBlockers({
      fabricSource: 'CUSTOMER_SUPPLIES', measurementsReady: true, styleReady: true,
      handoffStatus: 'RECEIVED_SUITABLE', handoffReceiptProofPresent: false,
    })).toEqual([{
      code: 'CUSTOMER_FABRIC_RECEIPT_PROOF_REQUIRED',
      message: 'Upload fresh proof that the customer fabric was received.',
      recoveryAction: 'CONFIRM_FABRIC_RECEIPT',
    }])
    expect(deriveFabricCuttingBlockers({
      fabricSource: 'CUSTOMER_SUPPLIES', measurementsReady: true, styleReady: true,
      handoffStatus: 'RECEIVED_SUITABLE', handoffReceiptProofPresent: true,
    })).toEqual([])
  })
})
