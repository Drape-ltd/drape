# Drape V1 Checkout and Fulfillment Flow

## Purpose

This document defines how checkout should work for Drape V1 across:

- custom orders
- ready-made purchases
- pickup
- local delivery
- shipping

It is meant to give us one clear source of truth before implementation.

Use this together with:

- [v1-seller-direction.md](/Users/onaopemipodimowo/drape/docs/v1-seller-direction.md)
- [tailor-side-shop-flow.md](/Users/onaopemipodimowo/drape/docs/tailor-side-shop-flow.md)
- [v1-launch-blockers.md](/Users/onaopemipodimowo/drape/docs/v1-launch-blockers.md)

## Main Goal

Checkout should feel:

- simple
- trustworthy
- easy to understand
- the same on both custom and ready-made orders

A customer should always understand:

- what they are buying
- who they are buying from
- how they will receive it
- what they are paying for
- what happens next

## Core Principle

We should not build two completely different checkout systems.

For V1:

- custom order checkout
- ready-made checkout

should share the same structure and visual language.

The only real difference is what creates the payable order:

- custom = accepted quote
- ready-made = selected item

## Checkout Types

### 1. Custom order checkout

This starts after:

- customer sends order details
- seller replies with quote
- customer accepts quote

### 2. Ready-made checkout

This starts after:

- customer opens item
- selects size
- chooses fulfillment option
- taps continue

## Shared Checkout Structure

Every checkout should have four parts.

### 1. Order summary

Show:

- seller name
- item or garment type
- selected size if ready-made
- order type:
  - `Custom`
  - `Ready-made`

### 2. Fulfillment

Show:

- pickup
- delivery
- shipping

Only show the options actually available for:

- that seller
- that item or order

### 3. Price breakdown

Show:

- item or quote amount
- delivery fee
- platform fee if any
- total

### 4. Final action

Use a clear button:

- `Continue to payment`
- `Confirm order`
- `Pay now`

depending on the payment stage

## Fulfillment Model

V1 should support three fulfillment paths.

### Pickup

Use when:

- customer will collect from seller

Customer sees:

- pickup selected
- pickup location
- any pickup note

Seller sees:

- pickup order
- collection flow
- collection code flow where applicable

### Local delivery

Use when:

- seller offers hand-delivery
- same-city or short-range delivery is possible

Customer sees:

- delivery selected
- delivery address
- delivery fee if any

Seller sees:

- delivery order
- address summary
- any local delivery note

### Shipping

Use when:

- third-party courier or shipping provider is used

Customer sees:

- shipping selected
- shipping address
- shipping fee

Seller sees:

- shipping order
- shipping address
- tracking field when shipped

## V1 Fulfillment Rules

### Seller-level capability

Seller profile should store whether seller supports:

- pickup
- delivery
- shipping

### Item-level capability

Ready-made items should also store which of those are available for that item.

### Order-level source of truth

Each order should store the selected fulfillment method.

Do not infer fulfillment later from profile defaults.

## Customer Checkout Flow: Custom Order

### Step 1: Review quote

Show:

- seller
- garment
- quote note
- expected completion date
- order deadline if provided

### Step 2: Choose fulfillment

Show only allowed options.

If shipping or delivery:

- capture or confirm address

If pickup:

- show pickup location and note

### Step 3: Show final breakdown

Show:

- quote amount
- delivery fee
- total

### Step 4: Payment handoff

If payments are active:

- continue to payment provider

If payments are not active yet:

- hold as payment-pending order with clear next step

## Customer Checkout Flow: Ready-Made

### Step 1: Review item

Show:

- item photo
- title
- chosen size
- seller

### Step 2: Choose fulfillment

Show:

- pickup
- delivery
- shipping

Only show valid choices.

### Step 3: Confirm address if needed

Use:

- saved address if available
- or new address entry

### Step 4: Show final breakdown

Show:

- item price
- delivery fee
- total

### Step 5: Payment handoff

Continue to payment.

## Price Breakdown Rules

We should copy the good part of Airbnb-style trust UX:

- simple math
- visible fees
- no surprises

### V1 breakdown model

- base amount
- fulfillment fee
- platform fee if any
- total

### For custom orders

- base amount = quote

### For ready-made

- base amount = item price

### Important rule

Do not hide delivery cost until after the user commits.

## Currency Strategy

Currency should be handled in two layers.

### 1. Source currency

This is the real transaction currency.

Store:

- amount
- currency

This is the source of truth for:

- checkout
- payment
- earnings
- reporting

### 2. Display conversion

This is optional convenience for the customer.

Example:

- `NGN 85,000`
- `Approx. $54`

### Rules

- do not replace source currency with display conversion
- checkout total should stay in source currency
- converted display should be treated as informational
- if exchange data is stale, hide the approximation rather than showing misleading numbers

## Recommended Currency UX

### Seller side

Seller should set:

- item or quote amount
- source currency

### Buyer side

Buyer should see:

- source currency clearly
- optional approximate local display

### Order screen

Order should preserve:

- locked source amount
- locked source currency

## Address Handling

We already have delivery address capture in the custom order flow.

V1 should standardize address behavior across both order types.

### Suggested approach

- if customer has a recent address, prefill it
- allow search via OpenStreet / Nominatim
- allow manual correction
- store full address snapshot on the order

### Rule

Do not require address entry unless fulfillment method needs it.

## Checkout UI Rules

Keep checkout clean and short.

### Use

- stacked summary cards
- segmented fulfillment options
- clear totals
- one primary CTA

### Avoid

- long explainer paragraphs
- giant banners
- repeated warnings
- hidden fees

### Good screen sequence

1. order summary
2. fulfillment choice
3. address if needed
4. total
5. CTA

## Seller-Side Fulfillment UX

Tailor or boutique should not need to guess what to do next.

### For pickup orders

Seller sees:

- pickup selected
- customer collection instructions
- collection code flow if active

### For delivery orders

Seller sees:

- delivery selected
- address summary
- delivery status action

### For shipping orders

Seller sees:

- shipping selected
- address summary
- tracking number input
- ship action

## Recommended Order States

We should keep using the shared order machine where possible.

### Shared later-stage states

- `READY_FOR_COLLECTION`
- `SHIPPED`
- `DELIVERED`
- `COLLECTED`
- `COMPLETE`

### Custom and ready-made can share these

The main difference is just what happens before payment and confirmation.

## Data Model Recommendation

### Existing order fields already useful

- `delivery_method`
- `delivery_address`
- `quoted_amount`
- `currency`
- `quoted_completion_date`
- `tracking_number`

### Add for V1 expansion

- `order_kind`
  - `CUSTOM`
  - `READY_MADE`

- `seller_item_id` nullable
- `seller_item_snapshot` nullable JSON
- `fulfillment_fee_amount` nullable
- `platform_fee_amount` nullable
- `total_amount` nullable

These additions make checkout and totals much easier to reason about later.

## Payment Handoff

V1 payment routing should respect region and provider logic, but checkout should still feel unified.

### Internal routing

- Stripe for supported global flows
- Paystack for supported Africa flows

### UX rule

Do not make the user choose provider manually unless absolutely necessary.

The app should route them based on:

- seller currency
- supported provider
- region logic

## Failure States

Checkout must fail clearly, not mysteriously.

### Good failure examples

- `This item is no longer available.`
- `Shipping is not available for this order.`
- `Please add a delivery address.`
- `This payment could not be completed.`

### Avoid

- generic `Something went wrong`
- hidden failure after payment redirection

## Boutique-Specific Notes

Boutiques may fulfill in different ways than solo tailors.

That is okay.

V1 checkout should support boutiques by letting them:

- list ready-made items
- offer pickup
- offer delivery
- offer shipping
- keep custom work and ready-made orders under one seller identity

We do not need separate boutique checkout.

## Implementation Sequence

### Phase 1

- lock fulfillment options
- lock pricing breakdown structure
- lock currency display rules

### Phase 2

- add order-kind and checkout fields
- reuse current custom order flow with clearer summary

### Phase 3

- add ready-made item checkout
- add seller item snapshot to order

### Phase 4

- connect payment routing
- tighten shipping and pickup states

## Success Criteria

Checkout is working when:

- customer understands the purchase clearly
- seller understands the fulfillment clearly
- pricing is transparent
- delivery choice is explicit
- source currency is preserved
- ready-made and custom feel like one product

## Immediate Build Recommendation

When we start implementation, build in this order:

1. lock the checkout screen structure
2. lock fulfillment data fields
3. lock order pricing fields
4. add ready-made item checkout on top of the existing order system

That keeps us disciplined and prevents payment and shipping work from drifting.
