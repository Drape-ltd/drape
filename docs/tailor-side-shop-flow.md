# Drape V1 Tailor-Side Shop Flow

## Purpose

This document defines how the seller side of Drape should work as we expand from:

- custom-only tailoring

to:

- custom orders
- ready-made items
- boutique-friendly selling

It is meant to be a practical build guide, not just a product idea dump.

It should be used together with:

- [v1-seller-direction.md](/Users/onaopemipodimowo/drape/docs/v1-seller-direction.md)
- [v1-launch-blockers.md](/Users/onaopemipodimowo/drape/docs/v1-launch-blockers.md)

## Product Goal

The tailor side should feel like a simple seller console.

Not:

- a confusing admin dashboard
- a full ERP
- a giant boutique management tool

It should help a seller do five things well:

1. present themselves clearly
2. accept custom work
3. list ready-made items
4. manage fulfillment
5. get paid clearly

## Seller Types

For product thinking, Drape should support:

- solo tailor
- boutique owner
- boutique with in-house tailors

For UI and code compatibility, we can still keep the `tailor` naming in most places for now.

## Core Seller Navigation

Recommended mobile seller navigation for V1:

- `Dashboard`
- `Shop`
- `Orders`
- `Clients`
- `Profile`

### Dashboard

Purpose:

- quick view of what needs attention now

Show:

- new custom requests
- orders needing stage updates
- ready-made items low on stock or marked sold
- payout / earnings summary
- recent reviews

Keep it short and scannable.

### Shop

Purpose:

- manage ready-made items

### Orders

Purpose:

- manage both custom and ready-made orders

### Clients

Purpose:

- customer history
- notes
- ratings about customers later

### Profile

Purpose:

- public seller presence
- custom / shop capabilities
- trust
- fulfillment methods

## Seller Flow Split

The seller now has two main business lanes.

### Lane 1: Custom

1. seller receives custom request
2. reviews order details
3. sends quote
4. buyer accepts
5. seller updates stages
6. seller completes delivery / collection

### Lane 2: Ready-made

1. seller adds item
2. buyer opens item
3. buyer chooses size
4. buyer starts purchase
5. seller fulfills via pickup / delivery / shipping
6. order completes

These two lanes should feel related, not like two separate apps.

## Seller Profile Changes

The seller profile should support both custom work and ready-made selling.

### Public profile should show

- name
- business name if present
- location
- availability
- about
- rating
- reviews
- order count
- portfolio
- styles they make
- fulfillment methods
- whether they accept custom work
- whether they offer ready-made items

### Public profile actions

- `Message`
- `Custom order`
- `Shop now`

Only show the actions the seller actually supports.

## Tailor Profile UX Rules

Use the cleaner UI system already emerging in the app:

- KPI cards
- sheets
- quick links
- small dismissible hints

Avoid:

- duplicated content
- long explainers
- inline sections that are better as drill-downs

### Main profile structure

1. identity block
2. about
3. KPI row
4. capability row
5. CTA row

### KPI row should cover

- rating
- reviews
- orders
- portfolio
- styles

These should open sheets or destination screens.

Do not repeat those same sections below if the KPI already handles them.

## Shop Tab

This is the new seller-side feature area.

### Main states

- `Live`
- `Drafts`
- `Sold`

### Each item should show

- hero photo
- title
- category
- sizes
- price
- currency
- availability
- fulfillment methods

### Seller actions per item

- `Edit`
- `Hide`
- `Mark sold`
- `Duplicate`

### Top-level actions

- `Add item`
- `Filter`
- `Sort`

Keep V1 very light.

## Add Item Flow

This should feel like the existing tailor setup flow:

- clear
- visual
- not text-heavy
- one step at a time

### Suggested fields

#### Step 1: Basics

- title
- category
- short description
- size options

#### Step 2: Photos

- upload item photos
- optional short video later

#### Step 3: Price

- amount
- currency
- optional sale note later

#### Step 4: Fulfillment

- pickup available
- local delivery available
- shipping available
- optional location note

#### Step 5: Publish

- preview
- save draft
- publish live

## Data Model Recommendation

### Add `seller_items`

Recommended fields:

- `id`
- `tailor_profile_id`
- `title`
- `description`
- `category`
- `sizes`
- `price_amount`
- `currency`
- `photos`
- `is_live`
- `is_ready_made`
- `pickup_available`
- `delivery_available`
- `shipping_available`
- `stock_status`
- `created_at`
- `updated_at`

### Recommended enums

`stock_status`

- `IN_STOCK`
- `LOW_STOCK`
- `SOLD_OUT`
- `HIDDEN`

### Keep simple

Do not build:

- inventory by warehouse
- advanced variants matrix
- multi-item carts
- returns engine

## Orders: How Ready-Made Should Work

Do not create a second totally separate order system.

### Add to `orders`

- `order_kind`
  - `CUSTOM`
  - `READY_MADE`

- `seller_item_id` nullable
- `seller_item_snapshot` JSON nullable

### Why snapshot

We want the order to preserve what was sold at that time:

- title
- chosen size
- price
- photos
- fulfillment method

even if the seller edits or hides the item later.

## Order Detail: Seller View

Seller order screen should work for both order kinds.

### Custom order screen

Keep mostly as-is:

- customer details
- custom request details
- quote
- stages
- messages
- delivery / collection

### Ready-made order screen

Show:

- item sold
- chosen size
- fulfillment method
- shipping / pickup details
- payment summary
- status actions

### Shared order actions

- `Message customer`
- `Mark ready`
- `Mark shipped`
- `Mark delivered`
- `Mark collected`

Use only the relevant actions per fulfillment method.

## Pricing UX

Yes, we should use a simpler trust-building version of the Airbnb idea.

### Buyer side and seller side should both show a price breakdown.

For ready-made:

- item price
- delivery fee
- platform fee if any
- total

For custom:

- quote amount
- delivery fee
- platform fee if any
- total

### Important rule

Do not surprise either side with hidden math.

The same breakdown should be visible in:

- quote review
- order summary
- payment handoff
- seller earnings summary

## Currency Strategy

Currency should be handled in two layers.

### Layer 1: source currency

This is the real currency the seller lists or quotes in.

It is the source of truth for:

- item price
- quote amount
- order amount
- payouts

### Layer 2: display currency

This is what the customer sees as a convenience view.

Example:

- `NGN 85,000`
- `approx. $54`

### Rules

- store original amount and original currency
- never overwrite source currency with display conversion
- checkout and payouts should lock to source currency
- display conversion should be clearly treated as informational

## Where Currency Conversion Should Appear

### Seller side

- item edit screen
- order detail
- earnings view

### Buyer side

- profile shop item cards
- item detail
- quote review
- order totals

### V1 recommendation

Use live exchange rates for display, but keep settlement narrow and reliable.

Do not build cross-currency payout complexity before the payment rails are stable.

## Fulfillment Model

Every seller and every item should clearly state what is possible.

### Fulfillment options

- `Pickup`
- `Delivery`
- `Shipping`

### Seller profile should show

- whether each method is supported generally

### Item detail should show

- which of those methods this specific item supports

### Order should store

- chosen fulfillment method
- delivery address if needed
- tracking if needed

## Shipping and Boutique Reality

Many boutiques will want to:

- sell ready-made
- deliver locally
- ship nationally
- maybe ship internationally later

V1 should support this with:

- a clean choice in the order flow
- clear seller controls
- simple status updates

Not with:

- deep logistics automation on day one

## Seller Dashboard Recommendations

This should remain simple.

### Top blocks

- `New custom requests`
- `Shop orders to fulfill`
- `Orders waiting on you`
- `This week’s earnings`

### Helpful secondary blocks

- `Recent reviews`
- `Items needing attention`
- `Pickup / delivery reminders`

Avoid long educational text here.

## Reviews and Trust

Seller should still be able to:

- see all reviews
- reply to reviews
- understand rating trend

### Recommendation

Keep reviews in a dedicated surface.

Main profile should show:

- KPI only

Tap opens:

- reviews sheet or screen

Do not repeat review cards on the profile page.

## Customer Reputation

Yes, we should support Airbnb-style customer reputation.

### Tailor side implications

Seller should be able to:

- see reviews left about a customer
- leave a review about a customer after a completed order

This helps with:

- trust
- repeated difficult customers
- boutique confidence

### Where seller should see this

- client detail
- maybe later in order detail

## UI Style Rules For Seller Side

Seller-side screens should follow the app-wide polish pass:

- simpler language
- fewer cards
- fewer banners
- tighter spacing
- no giant explainer blocks

### Use

- quick links
- KPI cards
- sheets
- compact summaries
- tap-first patterns

### Avoid

- permanent guide cards
- long intros
- duplicate sections
- repeated review or portfolio blocks

## Backend and Security Notes

This change should still follow the architecture and security guidance already guiding the app.

### Backend rules

- keep logic server-enforced
- validate item creation and edits on backend
- validate order kind transitions on backend
- keep fulfillment actions constrained by order state

### Security rules

- RLS on seller items
- seller can manage only own items
- buyers can read only live items
- keep contact details hidden until the right milestone
- maintain anti-offline protections in ready-made flows too

### Performance rules

- compress item photos
- lazy load seller item lists
- use small list payloads
- keep image-heavy screens resilient on weak networks

## Implementation Sequence

### Phase 1

- add seller capabilities to profile
- add `Shop now` entry point to public profile
- add currency display strategy

### Phase 2

- add `seller_items`
- add seller-side `Shop` tab
- add item create/edit flow

### Phase 3

- add buyer item listing from seller profile
- add item detail

### Phase 4

- extend `orders` to support `READY_MADE`
- add ready-made order flow

### Phase 5

- tighten earnings, shipping states, and fulfillment UX

## Build Checklist

### Product

- lock seller language
- lock custom + ready-made scope
- lock fulfillment options

### Data

- add seller capability fields
- add `seller_items`
- add `order_kind`

### UI

- seller `Shop` tab
- public `Shop now`
- item card
- item detail
- order summary with breakdown

### Backend

- seller item RLS
- ready-made order create path
- fulfillment state rules

### Trust

- reviews stay dedicated
- customer reputation visible to sellers
- pricing breakdown visible to both sides

## Success Outcome

When this is done, a seller should be able to:

- present themselves like a real business
- take custom work
- sell ready-made pieces
- offer pickup / delivery / shipping
- see clear price and payout logic

And Drape should still feel like one product, not two stitched together systems.
