-- Drape V1 — Initial Schema
-- Structure: enums → tables → RLS enable → policies → triggers

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────

create type user_role as enum ('CUSTOMER', 'TAILOR');
create type garment_context as enum ('MENSWEAR', 'WOMENSWEAR', 'BOTH', 'PREFER_NOT_TO_SAY');
create type body_shape as enum ('RECTANGLE', 'BROAD_SHOULDERS', 'FULL_HIPS', 'DEFINED_WAIST', 'FULL_MIDSECTION', 'ATHLETIC', 'PREFER_NOT_TO_SAY');
create type fit_style as enum ('SLIM', 'REGULAR', 'RELAXED');
create type tailor_tier as enum ('VERIFIED', 'RISING', 'MASTER');
create type availability_status as enum ('OPEN', 'LIMITED', 'FULLY_BOOKED');
create type fabric_source as enum ('CUSTOMER_SUPPLIED', 'TAILOR_SOURCES');
create type delivery_method as enum ('SHIPPING', 'LOCAL_COLLECTION');
create type order_stage as enum (
  'DRAFT', 'PENDING_QUOTE', 'QUOTE_SENT', 'PAYMENT_PENDING',
  'CONFIRMED', 'CUTTING', 'SEWING', 'FINISHING',
  'SHIPPED', 'READY_FOR_COLLECTION', 'DELIVERED', 'COLLECTED',
  'COMPLETE', 'DECLINED', 'EXPIRED', 'IN_DISPUTE', 'REFUNDED', 'CANCELLED'
);
create type currency as enum ('GBP', 'USD', 'EUR', 'NGN', 'GHS', 'KES');
create type payment_provider as enum ('STRIPE', 'PAYSTACK');
create type dispute_status as enum ('OPEN', 'UNDER_REVIEW', 'RESOLVED_REFUNDED', 'RESOLVED_RELEASED');
create type client_type as enum ('ON_DRAPE', 'PRIVATE');
create type message_type as enum ('TEXT', 'PHOTO', 'VOICE_NOTE');

-- ─────────────────────────────────────────────
-- HELPER: current user id from JWT
-- ─────────────────────────────────────────────

create or replace function auth_uid()
returns uuid language sql stable as $$
  select auth.uid()
$$;

-- ─────────────────────────────────────────────
-- TABLES
-- ─────────────────────────────────────────────

create table users (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text unique not null,
  display_name text not null,
  role         user_role not null,
  phone        text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create table customer_profiles (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid unique not null references users(id) on delete cascade,
  chest_cm              numeric,
  waist_cm              numeric,
  hips_cm               numeric,
  shoulder_width_cm     numeric,
  inseam_cm             numeric,
  sleeve_length_cm      numeric,
  neck_circumference_cm numeric,
  height_cm             numeric,
  fit_style             fit_style,
  unit_preference       text default 'cm',
  garment_context       garment_context,
  body_shape            body_shape,
  fit_flags             text[] default '{}',
  body_note             text check (char_length(body_note) <= 150),
  completion_prompt_shown boolean default false,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create table tailor_profiles (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid unique not null references users(id) on delete cascade,
  display_name          text not null,
  business_name         text,
  bio                   text,
  location              text not null,
  languages             text[] default '{}',
  specialty_tags        text[] default '{}',
  price_range_min       integer,
  price_range_max       integer,
  currency              currency default 'GBP',
  tier                  tailor_tier default 'VERIFIED',
  availability          availability_status default 'OPEN',
  is_verified           boolean default false,
  is_live               boolean default false,
  avg_rating            numeric default 0,
  total_reviews         integer default 0,
  total_orders          integer default 0,
  avg_response_hours    numeric,
  ships_internationally boolean default false,
  stripe_account_id     text,
  paystack_account_id   text,
  id_document_path      text,
  id_verified_at        timestamptz,
  bypass_attempts       integer default 0,
  tier_lost_at          timestamptz,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create table portfolio_photos (
  id                uuid primary key default gen_random_uuid(),
  tailor_profile_id uuid not null references tailor_profiles(id) on delete cascade,
  storage_path      text not null,
  public_url        text not null,
  caption           text,
  display_order     integer default 0,
  ocr_flagged       boolean default false,
  ocr_reviewed_at   timestamptz,
  created_at        timestamptz default now()
);

create table tailor_clients (
  id                    uuid primary key default gen_random_uuid(),
  tailor_profile_id     uuid not null references tailor_profiles(id) on delete cascade,
  client_type           client_type default 'PRIVATE',
  linked_user_id        uuid references users(id),
  name                  text not null,
  email                 text,
  phone                 text,
  chest_cm              numeric,
  waist_cm              numeric,
  hips_cm               numeric,
  shoulder_width_cm     numeric,
  inseam_cm             numeric,
  sleeve_length_cm      numeric,
  neck_circumference_cm numeric,
  height_cm             numeric,
  fit_notes             text,
  general_notes         text,
  invite_token          text unique,
  invite_sent_at        timestamptz,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create table offline_orders (
  id               uuid primary key default gen_random_uuid(),
  tailor_client_id uuid not null references tailor_clients(id) on delete cascade,
  garment_type     text not null,
  description      text,
  price            integer,
  currency         currency default 'GBP',
  status           text default 'completed',
  notes            text,
  completed_at     timestamptz,
  created_at       timestamptz default now()
);

create table orders (
  id                     uuid primary key default gen_random_uuid(),
  reference              text unique not null default gen_random_uuid()::text,
  customer_id            uuid not null references users(id),
  tailor_profile_id      uuid not null references tailor_profiles(id),
  garment_type           text not null,
  description            text not null,
  occasion               text,
  deadline               timestamptz,
  fabric_source          fabric_source not null,
  delivery_method        delivery_method not null,
  special_note           text,
  fabric_tracking        text,
  quoted_amount          integer,
  currency               currency default 'GBP',
  quoted_completion_date timestamptz,
  quote_note             text,
  quote_expires_at       timestamptz,
  stage                  order_stage default 'DRAFT',
  stage_updated_at       timestamptz default now(),
  payment_provider       payment_provider,
  payment_intent_id      text,
  escrow_released        boolean default false,
  escrow_released_at     timestamptz,
  auto_release_at        timestamptz,
  collection_code        text,
  collection_code_expiry timestamptz,
  collection_code_used   boolean default false,
  dispute_id             uuid,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now()
);

create table order_stage_updates (
  id        uuid primary key default gen_random_uuid(),
  order_id  uuid not null references orders(id) on delete cascade,
  stage     order_stage not null,
  note      text,
  photo_url text,
  created_at timestamptz default now()
);

create table order_photos (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  storage_path text not null,
  public_url   text not null,
  created_at   timestamptz default now()
);

create table messages (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,
  sender_id  uuid not null references users(id),
  type       message_type default 'TEXT',
  content    text,
  media_url  text,
  duration   integer,
  read_at    timestamptz,
  blocked    boolean default false,
  created_at timestamptz default now()
);

create table reviews (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid unique not null references orders(id),
  tailor_profile_id   uuid not null references tailor_profiles(id),
  rating              integer not null check (rating between 1 and 5),
  content             text check (char_length(content) <= 300),
  tags                text[] default '{}',
  tailor_response     text,
  tailor_responded_at timestamptz,
  published_at        timestamptz,
  flagged             boolean default false,
  created_at          timestamptz default now()
);

create table disputes (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid unique not null references orders(id),
  reason        text not null,
  description   text not null,
  evidence_urls text[] default '{}',
  status        dispute_status default 'OPEN',
  resolution    text,
  resolved_at   timestamptz,
  resolved_by   uuid references users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table payouts (
  id                 uuid primary key default gen_random_uuid(),
  tailor_profile_id  uuid not null references tailor_profiles(id),
  amount             integer not null,
  currency           currency not null,
  provider           payment_provider not null,
  provider_payout_id text,
  order_id           uuid,
  processed_at       timestamptz default now()
);

create table contact_bypass_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  surface     text not null,
  content     text not null,
  attempt     integer not null,
  reviewed    boolean default false,
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at  timestamptz default now()
);

-- ─────────────────────────────────────────────
-- REALTIME
-- ─────────────────────────────────────────────

alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table order_stage_updates;

-- ─────────────────────────────────────────────
-- ROW-LEVEL SECURITY — enable on all tables
-- ─────────────────────────────────────────────

alter table users enable row level security;
alter table customer_profiles enable row level security;
alter table tailor_profiles enable row level security;
alter table portfolio_photos enable row level security;
alter table tailor_clients enable row level security;
alter table offline_orders enable row level security;
alter table orders enable row level security;
alter table order_stage_updates enable row level security;
alter table order_photos enable row level security;
alter table messages enable row level security;
alter table reviews enable row level security;
alter table disputes enable row level security;
alter table payouts enable row level security;
alter table contact_bypass_logs enable row level security;

-- ─────────────────────────────────────────────
-- RLS POLICIES
-- All tables exist at this point, so cross-table references are safe
-- ─────────────────────────────────────────────

-- users
create policy "Users can view their own profile" on users
  for select using (auth_uid() = id);
create policy "Users can update their own profile" on users
  for update using (auth_uid() = id);

-- customer_profiles
create policy "Customer owns their profile" on customer_profiles
  for all using (auth_uid() = user_id);
create policy "Tailor reads customer profile for active orders" on customer_profiles
  for select using (
    exists (
      select 1 from orders o
      join tailor_profiles tp on tp.id = o.tailor_profile_id
      where o.customer_id = customer_profiles.user_id
        and tp.user_id = auth_uid()
        and o.stage not in ('DRAFT', 'DECLINED', 'EXPIRED', 'CANCELLED')
    )
  );

-- tailor_profiles
create policy "Tailor owns their profile" on tailor_profiles
  for all using (auth_uid() = user_id);
create policy "Public can view live tailor profiles" on tailor_profiles
  for select using (is_live = true);

-- portfolio_photos
create policy "Tailor manages their portfolio" on portfolio_photos
  for all using (
    exists (select 1 from tailor_profiles tp where tp.id = tailor_profile_id and tp.user_id = auth_uid())
  );
create policy "Public views portfolio of live tailors" on portfolio_photos
  for select using (
    exists (select 1 from tailor_profiles tp where tp.id = tailor_profile_id and tp.is_live = true)
  );

-- tailor_clients (private — only the tailor, enforced at Postgres level)
create policy "Tailor owns their client records" on tailor_clients
  for all using (
    exists (select 1 from tailor_profiles tp where tp.id = tailor_profile_id and tp.user_id = auth_uid())
  );

-- offline_orders
create policy "Tailor owns offline orders" on offline_orders
  for all using (
    exists (
      select 1 from tailor_clients tc
      join tailor_profiles tp on tp.id = tc.tailor_profile_id
      where tc.id = tailor_client_id and tp.user_id = auth_uid()
    )
  );

-- orders
create policy "Customer sees their orders" on orders
  for select using (auth_uid() = customer_id);
create policy "Customer creates orders" on orders
  for insert with check (auth_uid() = customer_id);
create policy "Customer updates their orders" on orders
  for update using (auth_uid() = customer_id);
create policy "Tailor sees their orders" on orders
  for select using (
    exists (select 1 from tailor_profiles tp where tp.id = tailor_profile_id and tp.user_id = auth_uid())
  );
create policy "Tailor updates their orders" on orders
  for update using (
    exists (select 1 from tailor_profiles tp where tp.id = tailor_profile_id and tp.user_id = auth_uid())
  );

-- order_stage_updates
create policy "Order parties see stage updates" on order_stage_updates
  for select using (
    exists (
      select 1 from orders o
      where o.id = order_id
        and (o.customer_id = auth_uid()
          or exists (select 1 from tailor_profiles tp where tp.id = o.tailor_profile_id and tp.user_id = auth_uid()))
    )
  );
create policy "Tailor creates stage updates" on order_stage_updates
  for insert with check (
    exists (
      select 1 from orders o
      join tailor_profiles tp on tp.id = o.tailor_profile_id
      where o.id = order_id and tp.user_id = auth_uid()
    )
  );

-- order_photos
create policy "Order parties see order photos" on order_photos
  for select using (
    exists (
      select 1 from orders o
      where o.id = order_id
        and (o.customer_id = auth_uid()
          or exists (select 1 from tailor_profiles tp where tp.id = o.tailor_profile_id and tp.user_id = auth_uid()))
    )
  );

-- messages
create policy "Order parties see messages" on messages
  for select using (
    exists (
      select 1 from orders o
      where o.id = order_id
        and (o.customer_id = auth_uid()
          or exists (select 1 from tailor_profiles tp where tp.id = o.tailor_profile_id and tp.user_id = auth_uid()))
    )
  );
create policy "Order parties send messages" on messages
  for insert with check (
    auth_uid() = sender_id
    and exists (
      select 1 from orders o
      where o.id = order_id
        and (o.customer_id = auth_uid()
          or exists (select 1 from tailor_profiles tp where tp.id = o.tailor_profile_id and tp.user_id = auth_uid()))
    )
  );

-- reviews
create policy "Published reviews are public" on reviews
  for select using (published_at is not null and flagged = false);
create policy "Customer creates review for their order" on reviews
  for insert with check (
    exists (select 1 from orders o where o.id = order_id and o.customer_id = auth_uid())
  );
create policy "Tailor responds to their reviews" on reviews
  for update using (
    exists (select 1 from tailor_profiles tp where tp.id = tailor_profile_id and tp.user_id = auth_uid())
  );

-- disputes
create policy "Order customer sees their dispute" on disputes
  for select using (
    exists (select 1 from orders o where o.id = order_id and o.customer_id = auth_uid())
  );
create policy "Order tailor sees dispute" on disputes
  for select using (
    exists (
      select 1 from orders o
      join tailor_profiles tp on tp.id = o.tailor_profile_id
      where o.id = order_id and tp.user_id = auth_uid()
    )
  );
create policy "Customer opens dispute" on disputes
  for insert with check (
    exists (select 1 from orders o where o.id = order_id and o.customer_id = auth_uid())
  );

-- payouts
create policy "Tailor sees their payouts" on payouts
  for select using (
    exists (select 1 from tailor_profiles tp where tp.id = tailor_profile_id and tp.user_id = auth_uid())
  );

-- contact_bypass_logs — no public policy; platform admin access only

-- ─────────────────────────────────────────────
-- TRIGGERS
-- ─────────────────────────────────────────────

create or replace function handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_updated_at before update on users for each row execute function handle_updated_at();
create trigger customer_profiles_updated_at before update on customer_profiles for each row execute function handle_updated_at();
create trigger tailor_profiles_updated_at before update on tailor_profiles for each row execute function handle_updated_at();
create trigger tailor_clients_updated_at before update on tailor_clients for each row execute function handle_updated_at();
create trigger orders_updated_at before update on orders for each row execute function handle_updated_at();
create trigger disputes_updated_at before update on disputes for each row execute function handle_updated_at();

-- ─────────────────────────────────────────────
-- AUTO-CREATE USER ROW ON SIGNUP
-- ─────────────────────────────────────────────

create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'CUSTOMER')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
