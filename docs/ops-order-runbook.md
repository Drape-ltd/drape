# Drape Ops Order Runbook

Date: April 25, 2026

## Purpose

This is the internal operating runbook for Drape's core order flows.

It is meant to help ops answer:

- what happens next
- who owns the next action
- when to intervene
- when to refund, hold, or escalate

## Golden Rule

Keep the order thread as the source of truth.

If the issue is active:

- keep communication in Drape
- log the action taken
- do not create invisible side agreements unless they are written back into the order record or support note

## Core Fulfillment Ownership

### Pickup

- tailor owns the handoff readiness
- customer owns collection timing
- Drape owns support if the handoff fails or becomes unsafe

### Standard delivery and shipping

- Drape owns dispatch once the order is marked `Ready for Drape dispatch`
- tailor does not need to manage normal dispatch in-app
- ops moves the order forward to:
  - `Out for delivery`
  - or `Shipped`

## Stage And Handoff Truth

Use [order-stage-playbook.md](/Users/onaopemipodimowo/drape/docs/order-stage-playbook.md) as the source of truth for:

- what each stage means
- who acts next
- when a stage should start
- when a stage should end

Ops should especially treat these definitions as hard rules:

- `Ready for Drape dispatch` means the order is actually packed and handoff-ready.
- `Dispatch booked` means Drape has really committed the handoff to a provider or rider path. It is not just an intention.
- `Delivered` means the handoff is recorded, but the customer still has a final closeout window.
- `Complete` means the order is closed.

## Ready-Made Standard Flow

1. Customer pays item plus standard fulfillment fee.
2. Tailor marks `Preparing order`.
3. Tailor marks `Ready for Drape dispatch` or `Ready for collection`.
4. Ops checks dispatch queue.
5. Ops books or arranges dispatch for standard delivery or shipping.
6. Ops updates order to `Out for delivery` or `Shipped`.
7. Customer confirms receipt.

## Custom Standard Flow

1. Customer submits brief.
2. Tailor quotes or requests consultation.
3. Customer pays accepted quote.
4. Tailor progresses work.
5. Tailor marks `Preparing order`.
6. Tailor marks `Ready for Drape dispatch` or `Ready for collection`.
7. Ops arranges standard non-pickup handoff.

## Cancellation and Refund Windows

### Before payment

- customer can walk away
- no refund question yet

### Paid but before `Preparing order`

Ready-made:

- default customer cancellation should be the simplest refund window
- tailor cancellation should require a reason

Custom:

- use Drape review if work has started to become committed

### After `Preparing order`

- do not allow blind instant cancellation
- route through Drape review
- use the in-order cancellation review lane whenever handoff has not started yet

### After dispatch is arranged

- treat as support or dispute
- refund depends on what was already booked or consumed

## Paid Consultation Operating Rule

If paid consultation is enabled later:

- customer pays before the slot is confirmed
- tailor starts the call only after payment is confirmed
- ops should know whether the fee is:
  - kept separate
  - or credited to a later order

If the customer pays but the consultation never really happens:

- follow the consultation no-show and reschedule rule
- do not let the order sit in limbo indefinitely

## Fabric Issue Operating Rule

If `CUSTOMER_SUPPLIES` fabric:

- do not allow production to continue until receipt is confirmed
- record how the fabric arrived
- if the tailor rejects the fabric, require a clear reason

Allowed next steps:

- customer sends more fabric
- tailor sources replacement with customer approval
- customer changes the design
- Drape reviews cancellation

If `TAILOR_SOURCES` fabric:

- source after payment, not before
- require clear direction on type, color, and quality level

## Bulk Custom Operating Rule

If one buyer is ordering for several people:

- treat it as a managed special-case flow
- do not pretend one ordinary custom order cleanly covers multiple recipients

Ops should record:

- main payer
- recipient count
- whether the group is linked to an event
- whether separate progress tracking is needed

## Dispatch Queue Rule

When an order is `Ready for Drape dispatch`:

- ops should review it promptly
- if dispatch cannot be arranged in the normal window, update the order and notify the customer
- if the tailor needs more time before dispatch, require an explicit reason
- if a cancellation review opens before dispatch is booked, pause the dispatch queue action until ops resolves it

## High-Severity Cases

Treat these as high priority:

- event-date risk
- seller-caused missed deadline
- lost parcel
- wrong item shipped
- fabric received dispute
- customer says the courier never arrived
- delivery failed and the order is time-sensitive

## Evidence Checklist

Before resolving a dispute or refund:

- review order stage history
- review message thread
- review handoff notes
- review any photo proof
- review fabric notes if relevant
- confirm whether dispatch was actually booked

## Delivery Failure And Return Rule

If dispatch fails after booking:

- keep the order inside the dispatch or delivery review lane
- do not quietly mark it complete
- log whether the failure was:
  - customer unreachable
  - wrong address
  - failed local delivery
  - returned to sender
  - delivered scan disputed by customer

For launch, use these defaults:

- `Need fulfillment change` stays ops-managed and only before dispatch is actually booked
- once dispatch is booked, changing pickup, delivery, or shipping is no longer a self-serve customer action
- if the parcel returns to sender, ops decides whether to:
  - retry dispatch
  - switch the fulfillment method
  - deduct a real logistics cost before refund
  - or move the order into dispute

## Settlement Rule

For launch:

- do not treat live order funds as free operating cash during active handoff
- warning goes out after 12 days in `Shipped` or `Out for delivery`
- system auto-marks `Delivered` after 14 days if nothing else happened
- closure and payout logic should only move after the delivered or collected closeout window, not at shipment start

## Ops Escalation Questions

Ask:

- who acts next
- is the order still recoverable
- has irreversible work already happened
- has money already been consumed by materials or logistics
- is this a support case, a remedy case, or a dispute case

## Priority Build Implications

The runbook assumes future product support for:

- cancellation policy by stage
- consultation fee policy
- fabric handoff mode
- dispatch SLA and extension handling
- exchange and delivery-failure policy

Until then, ops should use this runbook as the manual standard.
