# Drape V1 Seller Direction

## Purpose

This document defines the next product direction for Drape based on:

- what we have already built
- what real tailors and boutique owners are saying
- the current app architecture
- the need to keep V1 simple, clear, and shippable

It is meant to guide product, UI, backend, and rollout decisions without breaking the existing custom-order flow.

## Core Product Shift

Drape should stop thinking of itself as only a custom-tailoring app.

For V1, Drape should become:

- a simple place to find a trusted tailor or boutique
- place a custom order
- or buy a ready-made item
- choose pickup or delivery
- keep messages and order progress in one place

This keeps the current backbone, but broadens who the seller is and what a buyer can do.

## Why This Shift Matters

The latest field feedback points to three important truths:

1. Simpler words are necessary.
2. Many sellers are really boutiques with tailors behind them.
3. Some customers want custom work, but others want something ready-made they can buy now.

That means the product should support both:

- custom work
- ready-made buying

without making the app feel heavy or confusing.

## Product Positioning

### External

Drape is a place to find a trusted tailor or boutique for:

- custom clothing
- ready-made pieces
- pickup or delivery

### Internal

We can keep the current `tailor` wording in the app for now, but the product model should behave more like `seller`.

That seller can be:

- a solo tailor
- a boutique owner
- a boutique with in-house tailors

## Plain Language Rules

Use simpler words across app and web.

Prefer:

- `Tailor`
- `Shop`
- `Custom order`
- `Shop now`
- `Order`
- `Delivery`
- `Pickup`
- `Price`
- `Available now`
- `Message`

Reduce or remove:

- `brief`
- `journey`
- `handoff`
- `workspace`
- `operational visibility`
- `clarity` when a simpler phrase works

### Copy Principle

Every screen should answer one question quickly:

- what is this
- what can I do here
- what should I tap next

If text does not help that, cut it or move it behind a dismissible hint.

## Current Architecture We Should Keep

The current custom-order stack is already coherent enough to build on:

- mobile app and web app are the client layer
- Supabase Auth handles identity
- Supabase Postgres holds profiles, orders, reviews, messages, and trust data
- Supabase Storage holds portfolio and order media
- Edge Functions handle privileged order actions
- RLS protects per-user access

### Current Core Tables Already Carrying V1

- `customer_profiles`
- `tailor_profiles`
- `portfolio_photos`
- `orders`
- `order_stage_updates`
- `messages`
- `reviews`
- `saved_tailors`
- `tailor_clients`

### Important Current Reality

The app is already built around:

1. discovery
2. profile
3. custom order creation
4. quote send / accept
5. order stages
6. delivery / collection
7. review

We should not break that flow.

## Product Decision

### V1 supports two buyer paths

1. `Custom order`
2. `Shop now`

### V1 does not become a full marketplace admin system yet

Do not build:

- full inventory management
- advanced seller storefront tooling
- cart complexity across multiple sellers
- discount systems
- complex returns logic

For V1, the goal is much smaller:

- let a seller show ready-made items
- let a buyer open and act on them cleanly
- preserve the custom-order flow

## Recommended V1 Seller Model

Keep the current table name `tailor_profiles`, but evolve the data shape to represent a broader seller.

### Add conceptually

- `seller_type`
  - `TAILOR`
  - `BOUTIQUE`
  - optional later: `TAILOR_SHOP`

- `fulfillment_methods`
  - `PICKUP`
  - `DELIVERY`
  - `SHIPPING`

- `supports_custom_orders`
- `supports_ready_made`

- `business_name`
  - already present

This keeps compatibility with the current app while letting profiles behave more like modern seller pages.

## Recommended V1 Shop Model

Add a lightweight ready-made item model.

### Proposed table

`seller_items`

Fields:

- `id`
- `tailor_profile_id`
- `title`
- `description`
- `price`
- `currency`
- `category`
- `sizes`
- `photos`
- `is_ready_made`
- `is_live`
- `stock_note`
- `pickup_available`
- `delivery_available`
- `shipping_available`
- `created_at`
- `updated_at`

### V1 constraints

- no multi-variant inventory engine
- no warehouse logic
- no advanced stock syncing
- no multi-seller basket

Each item is just a clean listing that a buyer can act on.

## Recommended V1 Order Strategy

Do not create a separate order universe unless necessary.

### Keep one order system

Use the current `orders` table for both:

- custom orders
- ready-made purchases

### Add a simple discriminator

- `order_kind`
  - `CUSTOM`
  - `READY_MADE`

### For ready-made orders

The order can still use:

- customer
- seller
- price
- delivery method
- status
- messages

The difference is just:

- no custom garment spec is required
- item information is copied into the order snapshot

This avoids splitting messaging, tracking, and review logic into a second system.

## Profile Direction

Seller profile should become a decision page, not a wall of text.

### Main goal

A customer should quickly understand:

- who this seller is
- what they make
- whether they are trusted
- whether they support custom or ready-made
- how to act now

### Recommended structure

1. identity block
2. about
3. KPI row
4. action row
5. fulfillment / pricing summary

### KPI row

Use clickable KPI tiles only:

- rating
- reviews
- orders
- styles
- portfolio

Do not repeat the same content again lower on the page if the KPI already opens it.

### Action row

- `Message`
- `Custom order`
- `Shop now`

If the seller does not support one path, hide that action.

### Fulfillment summary

Keep it short:

- pickup
- delivery
- shipping
- price range
- location

## Boutique-Friendly Profile Design

Boutiques need to feel natural in the same profile shell.

That means:

- allow `business_name`
- allow a cleaner logo/avatar treatment later
- allow `About` to describe either one tailor or a shop
- allow `Available now` to describe selling state, not just appointment state

We do not need a separate boutique UI for V1.

We just need the profile shell to support both kinds of sellers.

## Discovery Direction

Discovery should still start simple.

### Keep current approach

- browse live sellers
- search by style / location
- save sellers

### Add gradually

- `Custom`
- `Ready-made`
- `Pickup`
- `Delivery`
- `Shipping`
- `Boutique`

These can start as filters or chips, not a large discovery rebuild.

## Custom Order Flow

Keep the current custom-order flow as the main trust-building engine.

### Current path to preserve

1. discover seller
2. open profile
3. submit custom order
4. tailor sends quote
5. customer accepts quote
6. order moves through stages
7. delivery / collection
8. review

### Changes to make

- rename `brief` in UI toward `custom order` or `order details`
- keep the same backend order shape
- preserve message thread and review behavior

## Ready-Made Flow

Add a lightweight path that reuses as much of the order system as possible.

### Suggested path

1. customer opens seller profile
2. taps `Shop now`
3. sees ready-made items
4. opens item detail
5. chooses size
6. chooses pickup or delivery
7. creates order
8. seller confirms fulfillment
9. order progresses to collection or delivery

### What not to add yet

- complex checkout flows
- seller-managed inventory back office
- returns system
- buyer-side cart across many sellers

## Shipping Direction

Shipping is now part of the core product promise, not a side concern.

### V1 shipping should support

- pickup
- local delivery
- third-party shipping

### V1 shipping does not need

- deep automation everywhere
- advanced label purchasing in every country on day one

### Product requirement

Every seller or item should clearly tell the customer:

- pickup available or not
- delivery available or not
- shipping available or not

Then the order should carry the chosen method clearly.

## UI Design Rules For This Direction

We should keep following the UI pattern work already underway.

### Principles

- fewer words
- smaller helper text
- clear tap targets
- one action path per block
- no duplicated sections
- dismissible hints where needed

### What to avoid

- long hero copy
- duplicate review sections
- static sections that could be KPIs
- giant explainer boxes
- repeating the same trust message in multiple places

### Good pattern

Use:

- KPI cards
- sheets
- quick links
- dismissible `Best use` hints

Instead of:

- permanent guide cards
- repeated banners
- long educational copy

## Architecture Impact

This direction does not require a rewrite.

### Client layer

Keep:

- mobile app
- web app

Add:

- seller item list screens
- item detail screen
- shop entry points in seller profile

### API / function layer

Keep:

- current order actions
- current review path
- current delivery webhook path

Add:

- item create/update functions later if needed
- ready-made order create path
- fulfillment validation for pickup / delivery / shipping selection

### Database layer

Keep:

- `orders`, `messages`, `reviews`

Add:

- seller item table
- small seller capability fields
- order kind discriminator

### Security layer

Keep:

- RLS
- server-side validation
- storage controls

Add:

- item ownership policies
- fulfillment visibility rules
- anti-offline checks across ready-made messaging too

## Security and Operational Notes

This direction still has to honor the existing security and backend fundamentals:

- do not trust client-side decisions
- validate all seller item writes on backend
- keep RLS strict
- hide contact details before the correct milestone
- log abuse and contact-bypass attempts
- keep uploads constrained and reviewed

For ready-made, the same abuse and trust rules should still apply.

## Rollout Plan

### Phase 1: Language and profile reframing

- simplify copy across app and web
- treat seller profile as custom + ready-made capable
- add `Shop now` CTA
- add fulfillment messaging

### Phase 2: Seller capabilities

- add seller capability fields
- add seller type
- expose pickup / delivery / shipping on profile

### Phase 3: Ready-made catalog

- add `seller_items`
- add seller-side item creation
- add customer-side item browsing from profile

### Phase 4: Ready-made orders

- add `order_kind`
- create ready-made order flow
- reuse existing order tracking and messaging

### Phase 5: Shipping hardening

- connect ready-made and custom orders cleanly to shipping choices
- improve tracking and delivery state handling

## What We Should Build Next

1. Decide final V1 wording changes
2. Add seller capability fields
3. Add `Shop now` entry point to seller profile
4. Design lightweight `seller_items`
5. Reuse `orders` for ready-made with `order_kind`

## What We Should Not Build Yet

- full boutique ERP
- advanced inventory logic
- multi-seller cart
- full logistics automation
- seller analytics dashboard
- category explosion

## Success Criteria

V1 should let a customer:

- find a trusted tailor or boutique
- place a custom order
- or buy something ready-made
- choose pickup or delivery
- keep communication and progress in one place

V1 should let a seller:

- show work clearly
- show styles clearly
- accept custom requests
- show ready-made pieces
- manage fulfillment simply

And we should get there by extending the current architecture, not replacing it.
