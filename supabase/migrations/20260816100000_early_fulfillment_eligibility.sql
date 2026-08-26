-- Drapeon tax and fulfillment architecture, Implementation 11B.
-- Adds structured fulfillment locations and persisted eligibility snapshots.
-- Existing accepted orders are not rewritten or repriced.

alter table public.tailor_pickup_details
  add column if not exists pickup_address_line1 text,
  add column if not exists pickup_city text,
  add column if not exists pickup_region text,
  add column if not exists pickup_postal_code text,
  add column if not exists pickup_country_code text,
  add column if not exists pickup_location_verification_source text,
  add column if not exists pickup_location_verification_reference text,
  add column if not exists pickup_location_verified_at timestamptz;

alter table public.tailor_pickup_details
  drop constraint if exists tailor_pickup_country_code_format;
alter table public.tailor_pickup_details
  add constraint tailor_pickup_country_code_format
  check (pickup_country_code is null or pickup_country_code ~ '^[A-Z]{2}$');

alter table public.custom_order_brief_drafts
  add column if not exists fulfillment_contract_version text,
  add column if not exists fulfillment_policy_version text,
  add column if not exists fulfillment_method public.delivery_method,
  add column if not exists fulfillment_status text,
  add column if not exists fulfillment_blocked_reason text,
  add column if not exists fulfillment_origin_snapshot jsonb,
  add column if not exists fulfillment_destination_snapshot jsonb,
  add column if not exists fulfillment_corridor_control_id uuid references public.tax_corridor_controls(id) on delete restrict,
  add column if not exists fulfillment_collection_mode text,
  add column if not exists fulfillment_fingerprint text,
  add column if not exists fulfillment_resolved_at timestamptz,
  add column if not exists pricing_invalidated_at timestamptz,
  add column if not exists pricing_invalidation_reason text;

alter table public.custom_order_brief_drafts
  drop constraint if exists custom_order_draft_fulfillment_status_check;
alter table public.custom_order_brief_drafts
  add constraint custom_order_draft_fulfillment_status_check
  check (fulfillment_status is null or fulfillment_status in ('ELIGIBLE','BLOCKED'));
alter table public.custom_order_brief_drafts
  drop constraint if exists custom_order_draft_collection_mode_check;
alter table public.custom_order_brief_drafts
  add constraint custom_order_draft_collection_mode_check
  check (fulfillment_collection_mode is null or fulfillment_collection_mode in ('COLLECTED_AT_CHECKOUT','PAYABLE_ON_IMPORT','BLOCKED'));

alter table public.orders
  add column if not exists fulfillment_contract_version text,
  add column if not exists fulfillment_policy_version text,
  add column if not exists fulfillment_classification text,
  add column if not exists fulfillment_origin_snapshot jsonb,
  add column if not exists fulfillment_destination_snapshot jsonb,
  add column if not exists fulfillment_corridor_control_id uuid references public.tax_corridor_controls(id) on delete restrict,
  add column if not exists fulfillment_collection_mode text,
  add column if not exists fulfillment_fingerprint text,
  add column if not exists fulfillment_resolved_at timestamptz,
  add column if not exists pricing_invalidated_at timestamptz,
  add column if not exists pricing_invalidation_reason text;

alter table public.orders
  drop constraint if exists orders_fulfillment_classification_check;
alter table public.orders
  add constraint orders_fulfillment_classification_check
  check (fulfillment_classification is null or fulfillment_classification in ('LOCAL_COLLECTION','LOCAL_DELIVERY','INTERNATIONAL_SHIPPING'));
alter table public.orders
  drop constraint if exists orders_fulfillment_collection_mode_check;
alter table public.orders
  add constraint orders_fulfillment_collection_mode_check
  check (fulfillment_collection_mode is null or fulfillment_collection_mode in ('COLLECTED_AT_CHECKOUT','PAYABLE_ON_IMPORT','BLOCKED'));

create table if not exists public.fulfillment_selection_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  tailor_profile_id text not null references public.tailor_profiles(id) on delete cascade,
  draft_id uuid references public.custom_order_brief_drafts(id) on delete set null,
  order_id text references public.orders(id) on delete set null,
  event_type text not null check (event_type in ('RESOLVED','BLOCKED','METHOD_CHANGED','LOCATION_CHANGED','PRICING_INVALIDATED')),
  method public.delivery_method not null,
  status text not null check (status in ('ELIGIBLE','BLOCKED')),
  blocked_reason text,
  previous_fingerprint text,
  next_fingerprint text,
  policy_version text,
  corridor_control_id uuid references public.tax_corridor_controls(id) on delete restrict,
  correlation_id uuid not null default gen_random_uuid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists fulfillment_selection_events_draft_idx
  on public.fulfillment_selection_events (draft_id, created_at desc);
create index if not exists fulfillment_selection_events_order_idx
  on public.fulfillment_selection_events (order_id, created_at desc);

alter table public.fulfillment_selection_events enable row level security;
revoke all on public.fulfillment_selection_events from anon, authenticated;
grant all on public.fulfillment_selection_events to service_role;

create or replace function public.prevent_fulfillment_selection_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Fulfillment selection events are append-only.';
end;
$$;

drop trigger if exists fulfillment_selection_events_append_only on public.fulfillment_selection_events;
create trigger fulfillment_selection_events_append_only
before update or delete on public.fulfillment_selection_events
for each row execute function public.prevent_fulfillment_selection_event_mutation();

comment on column public.tailor_pickup_details.pickup_location_verified_at is
  'Required with structured pickup fields before new-policy local collection or delivery may resolve.';
comment on table public.fulfillment_selection_events is
  'Append-only Implementation 11B evidence for eligibility, location changes, and pricing invalidation.';
