# Tailor-Sourced Fabric Funding And Quote Allocation

Date: August 1, 2026

Status: Approved product and implementation design. This document governs new-policy custom orders and supersedes conflicting language that treats every material request as a separately paid add-on. Existing orders retain their captured commercial policy.

## Objective

Tailor-sourced fabric must be transparent at quote time, funded without forcing the tailor to act as a lender, protected from premature release, and reconciled without silently changing the accepted order or paying the tailor twice.

Product copy uses **protected order funds** rather than **escrow** unless Drapeon's legal and provider arrangements support the regulated term.

## Locked Product Contract

- Selecting `TAILOR_SOURCES` makes a fabric allowance mandatory in the tailor quote.
- The quote and checkout separately display tailoring or production, fabric allowance, fulfillment, platform fees, tax, credits or promotions, and total.
- The fabric allowance uses the order currency and is captured as a distinct protected material liability. It is not part of the unreleased tailor settlement base.
- Customer fabric approval authorizes the proposed selection only. Approval never charges the customer, releases money, confirms purchase, or unlocks cutting by itself.
- The tailor requests the exact amount needed from the remaining funded allowance. A named, JIT-authorized Ops user reviews evidence and releases it through the configured payout provider.
- The full funded fabric allowance is excluded from the tailor settlement base. If released fabric money later proves unused, the customer refund is recovered from still-locked tailor settlement so the released excess cannot remain as earnings.
- Unused allowance is reconciled and refunded or credited to the customer. It never silently becomes tailor earnings.
- An amount above the remaining allowance requires an accepted, provider-paid commercial adjustment before release.
- Selecting `CUSTOMER_SUPPLIES` requires a zero fabric allowance and disables the tailor material-release lane.

## Quote And Checkout

When the tailor sources fabric, the quote cannot be a single unexplained seller total. The quote must record:

- tailoring and construction amount
- fabric allowance amount and currency
- what the allowance covers, including fabric, lining, embroidery, or related agreed materials
- sourcing assumptions, quantity, quality, or supplier estimate when available
- completion date and any deadline dependency
- immutable pricing and policy versions

The customer sees the same allocation before acceptance and on the immutable receipt. Customer copy explains that only supported material cost is released and unused value is reconciled.

## Fabric And Funding State Machine

1. The accepted quote funds the disclosed fabric allowance.
2. The tailor submits candidate supplier proof and an estimate from private evidence storage.
3. The customer approves the fabric or requests changes.
4. The tailor requests an exact release no greater than the remaining allowance.
5. Ops reviews the candidate, estimate, allowance balance, payout readiness, and duplicate risk.
6. Provider-confirmed release moves only the approved material liability to the tailor.
7. The tailor confirms the approved fabric is acquired or in hand and uploads final receipt evidence.
8. Exact spend closes reconciliation. Unused value or overage opens a canonical financial case and Ops task.
9. Cutting requires approved fabric and evidence that the approved fabric is acquired. Missing or inconsistent receipts create an Ops issue and block future advances; they do not silently rewrite the accepted order.

Every transition is append-only, idempotent, correlation-linked, and visible to both order parties with role-appropriate copy.

## Material Advance And Proposed Change

A planned fabric release within the funded allowance is not a second customer payment. It is a release claim against the material liability already captured at initial checkout.

A proposed change remains a separate commercial contract. The material-release request must stop and offer a prefilled material adjustment when:

- the requested amount exceeds the remaining allowance
- the fabric specification or garment scope changes
- the change affects the promised deadline
- an additional customer-funded material was not included in the accepted quote

The accepted adjustment ID, payment, material request, Ops approval, provider release, receipt, and reconciliation share one correlation chain. Provider confirmation is authoritative; client navigation or UI success is not payment or release proof.

## Role Experiences

### Customer

- Sees the fabric allowance before checkout and on the receipt.
- Reviews supplier proof and the exact requested release inside Drapeon.
- May approve, request fabric changes, or decline a material request with a recorded reason.
- Never sees an unexplained second charge for a request within the funded allowance.
- Sees release, receipt, reconciliation, refund, or exception outcomes.

### Tailor

- Cannot send a tailor-sourced quote without a fabric allowance and coverage details.
- Sees remaining allowance and whether a request requires an adjustment.
- Uploads supplier evidence, requests release, and sees Ops/provider outcomes.
- Uploads final receipt and acquired-fabric proof.
- Sees released material value excluded from remaining settlement.

### Ops

- Uses named MFA/JIT authorization, preparer/approver separation, and idempotent provider execution.
- Sees the accepted allocation, remaining liability, evidence, customer decision, payout readiness, and prior releases.
- Records terminal success or failure and receives overdue-release, missing-receipt, unused-value, and overage alerts.
- Uses the Drapeon ledger as authority. Spreadsheet exports are diagnostic only.

## Security, Notifications, And Observability

- Supplier estimates and receipts remain private and open through signed, expiring in-app or responsive-web viewers.
- Missing proof is a blocked state and can never be approved.
- Push and email mirror the authoritative request, decision, release, receipt, and reconciliation events and open the exact order.
- Every queued notification and provider job records a terminal outcome.
- Sentry records correlation ID, order ID, advance ID, adjustment ID, actor role, policy version, provider, and safe failure context without exposing payment secrets or private evidence URLs.

## Delivery And Verification

Implement and dry-run in this order:

1. Shared allocation types, database contracts, ledger invariants, and legacy compatibility.
2. Conditional tailor quote form and customer checkout/receipt breakdown.
3. Fabric approval, funded release request, JIT Ops approval, and provider payout.
4. Over-allowance routing through a linked proposed change.
5. Receipt, acquired-fabric evidence, reconciliation, refund, and settlement deduction.
6. Mobile, responsive web, email, push, Ops alerts, Sentry, and audit parity.
7. Physical iPhone, Android, responsive-web, customer, tailor, and Ops dry runs after each section, followed by one major end-to-end run.

The current Cutting-stage test order is not retrofitted. Complete it through production, Drapeon fulfillment, delivery, completion, and aftercare. Use a fresh custom order to prove funded allowance, rejected fabric, approved release, receipt reconciliation, and an over-allowance adjustment without double charging.

## Implementation Checkpoint — Section 4

Implemented locally on August 1, 2026. Database migrations were activated and verified in DEV on August 2, 2026; Edge activation and physical-role proof remain queued.

- Mobile and responsive web compare the exact supplier cost with the authoritative remaining allowance and present the uncovered amount before submission.
- An over-allowance request creates a `MATERIAL` commercial adjustment for the tax-aware customer charge while preserving the material shortfall as the only addition to the protected fabric allocation.
- The supplier proof, adjustment, allocation, provider payment, and eventual material release claim share a durable correlation link.
- Acceptance alone does not move money or create a release claim.
- Provider-confirmed payment atomically increases the allocation by the material shortfall and creates the original exact release claim for customer approval.
- Direct or stale clients that call the funded-release endpoint above the remaining balance receive `FABRIC_RELEASE_ADJUSTMENT_REQUIRED` with requested, remaining, and shortfall amounts; the database continues to reject any bypass.
- Retry after a partial payment-webhook failure can activate a paid but not-yet-linked fabric claim without double-funding the allocation.

Required dry run after activation: within-allowance control, over-allowance proposal, decline, accept-and-pay, webhook retry, generated release approval, Ops release, and proof that the allocation increased only by the pre-tax shortfall.

## Implementation Checkpoint — Section 5

Implemented locally on August 1, 2026. Database migrations were activated and verified in DEV on August 2, 2026; Edge activation and physical-role proof remain queued.

- Funded claims require two distinct private artifacts after provider-confirmed release: the final supplier receipt and acquired-fabric proof. Duplicate submissions are idempotent and conflicting retries are rejected.
- Reconciliation produces one explicit outcome: exact, unused value, or overage. Both parties see role-appropriate state instead of a raw database enum.
- Exact spend closes the claim. Unused value and overage open a canonical financial case and remain blocking until a recorded terminal resolution.
- Unused released value creates an exact `CUSTOMER_REFUND` Money Desk request. Execution first reduces only still-locked tailor settlement by the same value, then invokes the existing provider refund adapter, and finalizes the customer refund only after the Money Desk request reaches `SUCCEEDED`.
- Material refunds persist provider-started and provider-completed markers. An ambiguous provider attempt is blocked from automatic retry and routed to Ops verification, preventing a second refund while the first outcome is unknown.
- Recovered released value is recorded separately from never-released allowance, preserving the allocation invariant and preventing double counting.
- An unapproved overage never charges the customer. Finance/Admin can record that the tailor absorbs it; any customer-funded alternative must use the separately accepted and provider-paid proposed-change flow.
- New-policy settlement plans use the locked tailoring allocation as entitlement and display the excluded fabric allowance and any unused-value recovery on mobile and responsive web.
- Existing funded-fabric settlement plans are repaired only while every tranche is still `LOCKED`. Any plan with eligibility or release ledger activity remains unchanged for explicit Ops review.
- Cutting is blocked in both Edge preflight and a database trigger until approved funded fabric has a provider-confirmed release, acquired-fabric evidence, and exact or Ops-resolved reconciliation.

Required dry run after activation: exact receipt, duplicate exact retry, conflicting retry, unused-value Money Desk maker/checker/refund/finalization, provider-refund failure and retry, overage/no-customer-charge resolution, cutting gate before and after reconciliation, private receipt/acquired-fabric viewing on iPhone, Android, and responsive web, and proof that settlement plus fabric releases never exceed the accepted commercial allocation.

## Implementation Checkpoint — Section 6

Implemented locally on August 1, 2026. Database migrations were activated and verified in DEV on August 2, 2026; Edge activation, provider delivery proof, and physical-device proof remain queued.

- Shared policy now enumerates every protected-fabric request, decision, release, failure, receipt, reconciliation, refund, overage, reminder, and overdue event with its audience, importance, channels, exact order/material destination, and explicit no-SMS rule.
- Customer and tailor push notifications carry both order ID and material advance ID. Mobile deep links preserve the event action and surface the focused material outcome instead of opening a generic home or order list.
- Push and transactional email are queued with separate idempotency keys for both roles where parity is required. Existing durable job processing records `DELIVERED`, `SKIPPED`, or `DEAD` channel outcomes after retries.
- Money Desk rejection, provider-confirmed release, release failure, receipt reconciliation, unused-value refund completion, and overage resolution now share the authoritative material Edge action rather than allowing the Ops dashboard to bypass notifications and audit events with direct SQL finalization.
- Final receipt submission acknowledges both roles. Exact reconciliation closes cleanly; unused value and overage create or refresh an Ops alert; terminal refund or overage resolution closes the linked reconciliation alert.
- A scheduled reconciliation monitor reminds the tailor after 24 hours, alerts both parties and Ops after 48 hours, escalates at 72 hours, and keeps cutting and future releases visibly blocked until the final receipt and acquired-fabric proof arrive.
- The monitor also recovers the safe post-provider gap where a customer refund succeeded but application finalization did not. Recovery is idempotent and never reissues the provider refund.
- Sentry failure events include safe correlation, order, advance, linked adjustment, actor-role, policy-version, and provider context. Private evidence URLs and payment secrets are excluded.
- Order timeline rows and append-only audit events mirror each authoritative transition, while Ops issues and Ops audit logs record alert creation, refresh, automatic resolution, and provider ambiguity.

Required dry run after activation: customer request notification and deep link, approval and rejection on the counterpart tailor device, Money Desk approval/rejection, provider success and forced provider failure, 24-hour reminder and 48/72-hour escalation using controlled timestamps, exact/unused/overage reconciliation, provider-refund finalization recovery, push/email terminal delivery outcomes, responsive-web parity at narrow and desktop widths, and safe Sentry tags with no evidence URL or payment secret.
