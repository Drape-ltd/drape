# Drape Order Flow Research Brief

Date: April 25, 2026

## Purpose

This document turns the current Drape order-flow gap map into a research-backed working brief.

It is not a changelog.

It answers:

- what the current product is trying to do
- what the existing research already supports
- where earlier decisions should now be revisited
- what additional gaps still matter before launch-quality signoff

Use this with:

- [order-flow-gap-map.md](/Users/onaopemipodimowo/drape/docs/order-flow-gap-map.md)
- [v1-decisions-consultation-and-order-gating.md](/Users/onaopemipodimowo/drape/docs/v1-decisions-consultation-and-order-gating.md)
- [v1-decisions-fabric-sourcing-handoff-billing.md](/Users/onaopemipodimowo/drape/docs/v1-decisions-fabric-sourcing-handoff-billing.md)
- [v1-decisions-remedy-ladder-and-refund-matrix.md](/Users/onaopemipodimowo/drape/docs/v1-decisions-remedy-ladder-and-refund-matrix.md)
- [v1-decisions-deadline-and-event-critical-order-policy.md](/Users/onaopemipodimowo/drape/docs/v1-decisions-deadline-and-event-critical-order-policy.md)
- [v1-decisions-rush-orders-and-deadline-premium-policy.md](/Users/onaopemipodimowo/drape/docs/v1-decisions-rush-orders-and-deadline-premium-policy.md)
- [research-fabric-sourcing-and-handoff-2026-04-02.md](/Users/onaopemipodimowo/drape/docs/research-fabric-sourcing-and-handoff-2026-04-02.md)
- [research-consultation-no-show-reschedule-and-expiry-policy-2026-04-02.md](/Users/onaopemipodimowo/drape/docs/research-consultation-no-show-reschedule-and-expiry-policy-2026-04-02.md)

## Summary

High confidence:

- Standard ready-made fulfillment should stay Drape-managed.
- Flat domestic and international fulfillment fees are a sane V1 default.
- Fabric ownership, fabric handoff, and fabric approval must be treated as real product logic, not just chat context.
- Deadline risk should be treated as part of scope for custom work.
- Cancellation and refund policy should be stage-based, not blanket.

Medium confidence:

- Paid consultation should be optional, not universal.
- Bulk custom should be supported as a managed special-case flow before a true productized multi-recipient model exists.

Open conflict:

- Earlier V1 consultation decisions said consultation should not be a paid standalone service.
- The newer product direction now points toward optional paid consultation for some tailors.
- That is a real policy change, not just implementation detail.

## 1. Ready-Made Research Position

Ready-made is now much closer to the right e-commerce shape.

The strongest current position is:

- customer pays item plus standard fulfillment fee up front
- tailor prepares the order
- Drape handles normal dispatch
- customer tracks receipt and closes the loop

This is more coherent than:

- tailor finding courier pricing manually every time
- customer being hit with a second normal shipping invoice
- tailor being asked to manage logistics like a freight app

Research and product logic both support the simpler approach for V1.

The remaining ready-made gaps are not about the happy path anymore.
They are about:

- cancellation
- exchange
- return or failed delivery
- dispatch delays
- multi-item checkout

## 2. Custom Research Position

Custom is already structurally strong.

The biggest remaining custom gaps are not “can the app create a custom order.”
They are:

- paid consultation policy
- fabric logistics
- bulk or group custom orders
- clearer production-stage meaning

These are the places where real tailoring businesses differ from generic marketplace logic.

## 3. Production-Stage Research Answer

The question is not whether `Designing`, `Sourcing`, `Cutting`, `Sewing`, and `Finishing` are valid.
They are.

The question is whether Drape uses them in the cleanest place.

Best interpretation:

- if ambiguity is still commercial or conceptual, keep it in `Messages` or `Consultation`
- if payment is accepted and the tailor still has real creative or pattern work to do, that is when `Designing` should appear
- if material procurement is happening after payment, use `Sourcing`
- if the order is straightforward, skip unnecessary stages instead of forcing fake ceremony

This matters because:

- customers read stage names as truth
- stage names imply who acts next
- weak stage naming causes anxiety and support load

Recommended lane-specific guidance:

- ready-made should stay commerce-simple
- custom should use deeper production stages only when the work actually warrants them

## 4. Consultation Research Answer

The older V1 stance was:

- consultation is optional
- consultation is not paid in V1

That was a reasonable simplification, but it does not fully match how many real tailors work.

New recommended stance:

- consultation remains optional by default
- consultation may be free
- consultation may be paid, as a tailor-level choice
- paid consultation must be clearly disclosed before booking
- if paid, the customer should pay before the slot is confirmed
- the tailor should only start the call after payment is confirmed

This is strongest when:

- the work is high ambiguity
- the fit risk is high
- the event timing is sensitive
- fabric direction is unclear
- the customer may consume significant planning time before deciding

Important:

- paid consultation should not become a hidden rush fee
- the cancellation and no-show policy must be clear
- Drape should decide whether the consultation fee is stand-alone or creditable toward the later order

## 5. Fabric Research Answer

The current product already knows:

- customer supplies fabric
- tailor sources fabric

That is not enough.

Research strongly supports these rules:

- who sources fabric and how it reaches the tailor are two different things
- local fabric handoff is a real scenario
- some tailors will not work with customer fabric unless they inspect it
- some tailors reject customer fabric because of quality, drape, weight, or insufficient yardage
- smaller tailors should not be expected to front material cost before payment

Best working model:

- if the tailor sources fabric, the quote is the funding moment
- if the customer supplies fabric, production should not advance until receipt is confirmed
- local dropoff, local pickup, shipped fabric, and bring-to-consultation should all be valid handoff modes
- tailor must be allowed to reject unsuitable customer fabric before cutting begins

## 6. Bulk Custom Research Answer

Group custom orders are not edge-case fantasy.
They are normal in:

- weddings
- family events
- asoebi
- coordinated looks

The ordinary one-person custom flow does not really solve:

- multiple measurement sets
- multiple recipients
- split delivery timing
- one buyer paying for several garments
- different sizes and fabric needs inside one event

Best V1 stance:

- do not fake this as standard single-recipient custom
- treat it as a managed special-case flow until product support exists

Later product shape could become:

- one parent event order
- linked recipient orders underneath
- separate progress per recipient
- one payer if needed

## 7. Additional Gaps Revealed By The Research Corpus

These are worth calling out even if they are not the first thing to build.

### Deadline and event severity

The research strongly supports treating event-date misses as high-severity cases for custom.

### Consultation no-show and stall behavior

If consultation becomes paid, the no-show policy becomes much more important than before.

### Remedy ladder needs to touch fulfillment too

The current remedy matrix is strongest on custom production faults.
It now needs explicit fulfillment branches too:

- dispatch delay
- failed delivery
- return to sender
- item delivered late for the event

### Ops bookkeeping needs richer structure

As Drape becomes dispatch-managed, ops needs clearer records for:

- who booked dispatch
- when it was booked
- what it cost
- what exception path was used

## 8. Recommended Decision Updates

These are the key updates suggested by the current corpus.

### Update 1

Replace the earlier “consultation is not paid in V1” stance with:

- consultation is optional
- consultation can be free or paid
- if paid, payment must happen before the session is confirmed

### Update 2

Keep standard delivery and shipping Drape-managed for both ready-made and custom.

### Update 3

Treat fabric logistics as a first-class custom-order policy area, not a hidden sub-case.

### Update 4

Treat bulk custom as a managed special-case flow until multi-recipient product support exists.

### Update 5

Clarify production stages so stage names reflect actual work and actor responsibility.

## 9. Best Next Research-To-Implementation Sequence

1. Lock cancellation and refund windows.
2. Lock paid consultation policy.
3. Lock fabric rejection and replacement policy.
4. Lock Drape dispatch SLA and extension policy.
5. Lock ready-made exchange and delivery-failure policy.
6. Only then move on to multi-item checkout and premium logistics extras.

## Bottom Line

The product is no longer weak because the happy paths are unclear.

It is now mostly strong on happy paths.

The remaining work is about operational reality:

- what happens when timing slips
- what happens when fabric is wrong
- what happens when consultation takes real time
- what happens when one buyer is really ordering for several people

That is the level where launch trust will now be won or lost.
