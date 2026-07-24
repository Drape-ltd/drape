# Manual QA Runbook

Date: April 2, 2026

## Purpose

This is the hands-on QA path for launch-critical Drape flows.

For Drapeon Vision state, native lifecycle, failure signatures, and its real-device sequence, use `docs/drapeon-vision-design-and-regression-runbook.md` as the authoritative companion to this runbook.

Use this after:

- env vars are in place
- migrations are applied
- edge functions are deployed
- a fresh mobile build is installed

## Test Accounts

Prepare at least:

- `customer_a`
- `customer_b`
- `tailor_a`
- `tailor_b`

Try to keep:

- one customer and one tailor with clean new accounts
- one tailor with payout-ready status
- one tailor with payout setup intentionally incomplete

## Device / Network Modes

Run each major flow in at least one of these conditions:

- normal Wi-Fi
- weak mobile network / throttled connection
- app backgrounded and resumed mid-flow

## Customer Core Flow

1. Sign up.
2. Complete customer setup.
3. Open a tailor profile.
4. Submit a custom brief.
5. Confirm:
   - validation is clear
   - phone/profile setup persists
   - no dead-end retry state appears

## Tailor Core Flow

1. Sign up.
2. Complete tailor setup.
3. Open the incoming brief.
4. Send a quote.
5. Confirm:
   - payout-readiness guard behaves honestly
   - quote fields are visible to the customer
   - no raw internal error leaks into the UI

## Custom Payment Flow

1. Customer opens the quote.
2. Start payment.
3. Test:
   - successful payment
   - cancelled payment
   - resume from `PAYMENT_PENDING`
4. Confirm:
   - order reaches `CONFIRMED`
   - resumed payment does not duplicate the order/payment state

## Ready-Made Payment Flow

1. Open a ready-made item.
2. Start checkout.
3. Test:
   - successful checkout
   - cancelled checkout
   - resume saved pending checkout
4. Confirm:
   - order opens correctly from the order screen
   - totals and fulfillment fee match expectations

## Messaging And Abuse Flow

1. Send a normal text message.
2. Send a photo.
3. Send a voice note.
4. Try obvious contact sharing.
5. Try obviously abusive language.
6. Use the in-thread `Report abuse or pressure` path.
7. Confirm:
   - blocked messages fail cleanly
   - drafts are preserved on weak connection
   - report path opens with the right order context
   - pausing chat closes the composer for both sides until it is reopened

## Consultation Flow

1. Tailor requests consultation.
2. Customer opens the consultation thread.
3. Tailor starts the call.
4. Customer joins.
5. Confirm:
   - missing `DAILY_API_KEY` fails gracefully
   - thread remains the fallback source of truth

## Measurement / Fabric Risk Flow

1. Create a custom order with customer-supplied fabric.
2. Tailor requests measurement confirmation.
3. Customer confirms.
4. Tailor confirms fabric receipt.
5. Open a material issue before cutting.
6. Customer responds.
7. Confirm:
   - cutting stays blocked until blockers resolve
   - material issue state is visible on both sides

## Drapeon Vision Real-Device Regression

Run this on a fresh native development build, not only after a Metro reload.

1. Cold-launch the app and open Fit 360 through Saved measurements.
2. Complete one continuous rightward turn from front through the opposite side.
3. Confirm the post-back instruction keeps the same direction.
4. Review and fully scroll the result without the floating action covering content.
5. Retake and complete a second scan.
6. Exit during warm-up, reopen, and confirm a third session receives frames.
7. Complete one specialist lower-body scan.
8. Exit through X and save; confirm both return to the correct contextual parent.
9. Confirm no duplicate `PreviewView`, app termination, stale capture, pooled layout-event error, or permanent hold state appears in Metro or native logs.
10. Record tape comparisons separately; runtime completion is not accuracy certification.

## Contextual Navigation Regression

1. Open an order detail.
2. Open that order's conversation.
3. Leave the conversation for another primary tab.
4. Tap the Messages dock destination.
5. Confirm the inbox opens immediately with no conversation flash.
6. Open the conversation from the inbox, then use Back.
7. Repeat from a notification/deep link when available.
8. Confirm no order ID or child params remain attached to the Messages tab root.

## Shipping / Collection Flow

### Shipping

1. Tailor advances through finishing.
2. Try marking `SHIPPED` without:
   - photo proof
   - tracking
   - carrier
3. Confirm each failure is blocked clearly.
4. Mark shipped with valid inputs.
5. Open customer order.
6. Test tracking link open and failure fallback copy.
7. If a live tracking provider is enabled, fire one delivered webhook event from that provider.
8. Confirm receipt only after shipment exists.
9. Confirm:
   - provider delivery webhook advances the order to `DELIVERED`
   - delivery breadcrumbs appear in `/ops` if something is skipped or fails

### Collection

1. Tailor marks ready for collection.
2. Customer sees collection code.
3. Tailor confirms collection with the code.
4. Confirm:
   - handoff closes correctly
   - completed-order aftercare path remains visible
5. Enter the wrong code 5 times on a staging order.
6. Confirm:
   - the order locks cleanly
   - the API copy mentions the 24-hour reset window
   - after 24 hours, the code can be retried without ops intervention

## Reviews / Aftercare Flow

1. Complete an order.
2. Leave a customer review inside the 14-day window.
3. Confirm published vs held review behavior.
4. Open completed order.
5. Use the aftercare support path.
6. Confirm:
   - review entry is available only in valid states
   - aftercare guidance is visible on completed orders

## Privacy / Security Flow

1. Open privacy settings.
2. Toggle optional analytics.
3. Open data request flow.
4. Submit an in-app data request.
5. Open account deletion flow.
6. Change phone number.
7. Confirm:
   - data request submits in-app and still offers a mail fallback
   - phone change requires recent verification
   - deletion copy reflects request/review reality
   - privacy links fall back cleanly if web pages do not open

## Tailor Trust / Access Flow

1. Open `Trust & access`.
2. Verify messaging for:
   - profile incomplete
   - verification pending
   - payout setup missing
   - ready state
3. Try sending a paid quote with payout setup missing.
4. Try publishing a paid ready-made item with payout setup missing.
5. Submit a seller access review request from a blocked or review state.
6. Confirm the app blocks honestly and routes the user to the right next step.

## Notifications

For every launch-critical cross-role action, record an acceptance row containing:

- initiating device and role
- order ID and action/event ID
- persisted order stage plus audit/event row
- counterpart state observed
- push job terminal status and provider response
- email job terminal status and provider response
- notification received timestamp on a real backgrounded device
- notification tap destination

Do not count a foreground realtime update, a queued job, or a successful Edge response as notification delivery.

Test at minimum: new brief, quote, quote revision, payment, fabric/style approval request, stage update, cancellation review, emergency support, consultation/call invitation, dispatch, delivery, refund, and ops resolution.

Test at least:

- new message
- quote received
- stage update
- ready for collection / shipped

Confirm:

- push opens the correct screen
- cold-start open still routes correctly
- notification settings are respected

## Ops Spot Checks

Confirm in `/ops`:

- disputes appear
- review holds appear
- workflow issues appear
- deletion requests appear
- payout visibility is present

## QA Output Format

For each bug found, capture:

- account used
- order id or reference
- exact stage
- expected behavior
- actual behavior
- whether it reproduced on retry
- whether it reproduced on weak connection
