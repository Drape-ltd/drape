-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Schema Fixes
-- All renames are wrapped in DO blocks so they're idempotent and safe to re-run
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. ENUM additions ─────────────────────────────────────────────────────────

alter type order_stage add value if not exists 'CONSULTATION' before 'QUOTE_SENT';
alter type order_stage add value if not exists 'DESIGNING'    before 'CUTTING';
alter type order_stage add value if not exists 'SOURCING'     before 'CUTTING';

alter type message_type add value if not exists 'VOICE' after 'VOICE_NOTE';

-- ── 2. Conditional column renames ────────────────────────────────────────────

do $$
begin

  -- messages: content → body
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'content'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'body'
  ) then
    alter table messages rename column content to body;
  end if;

  -- messages: media_url → photo_url
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'media_url'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'photo_url'
  ) then
    alter table messages rename column media_url to photo_url;
  end if;

  -- reviews: content → body
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reviews' and column_name = 'content'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reviews' and column_name = 'body'
  ) then
    alter table reviews rename column content to body;
  end if;

  -- tailor_profiles: id_document_path → id_document_url (only if target doesn't already exist)
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tailor_profiles' and column_name = 'id_document_path'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tailor_profiles' and column_name = 'id_document_url'
  ) then
    alter table tailor_profiles rename column id_document_path to id_document_url;
  end if;

end $$;

-- ── 3. orders — add missing columns ──────────────────────────────────────────

alter table orders add column if not exists garment_type                     text;
alter table orders add column if not exists garment_description              text;
alter table orders add column if not exists tailor_id                        uuid;
alter table orders add column if not exists reference_photos                 text[] default '{}';
alter table orders add column if not exists fit_note                         text;
alter table orders add column if not exists customer_measurements_snapshot   jsonb;
alter table orders add column if not exists consultation_fee                 integer;

-- ── 4. messages — add missing columns ────────────────────────────────────────

alter table messages add column if not exists body        text;   -- no-op if rename already ran
alter table messages add column if not exists photo_url   text;   -- no-op if rename already ran
alter table messages add column if not exists voice_url   text;
alter table messages add column if not exists sender_role text check (sender_role in ('CUSTOMER', 'TAILOR'));
alter table messages add column if not exists sender_name text;

-- ── 5. customer_profiles — add missing columns ────────────────────────────────

alter table customer_profiles add column if not exists measurements  jsonb;
alter table customer_profiles add column if not exists display_name  text;

-- ── 6. tailor_profiles — add missing columns ─────────────────────────────────

alter table tailor_profiles add column if not exists id_document_url       text;   -- no-op if rename ran
alter table tailor_profiles add column if not exists id_verification_status text
  default 'NOT_SUBMITTED'
  check (id_verification_status in ('NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED'));
alter table tailor_profiles add column if not exists portfolio_photo_urls   text[] default '{}';
alter table tailor_profiles add column if not exists portfolio_video_urls   text[] default '{}';

-- ── 7. reviews — add missing columns ─────────────────────────────────────────

alter table reviews add column if not exists body           text;   -- no-op if rename ran
alter table reviews add column if not exists reviewer_name  text;
alter table reviews add column if not exists tailor_id      uuid;

-- ── 8. disputes — add missing columns ────────────────────────────────────────

alter table disputes add column if not exists customer_id uuid;

-- ── 9. push_tokens — new table ───────────────────────────────────────────────

create table if not exists push_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid unique not null references auth.users(id) on delete cascade,
  token      text not null,
  platform   text not null check (platform in ('ios', 'android')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table push_tokens enable row level security;

drop policy if exists "User manages their own push token" on push_tokens;
create policy "User manages their own push token" on push_tokens
  for all using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

create or replace function handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists push_tokens_updated_at on push_tokens;
create trigger push_tokens_updated_at
  before update on push_tokens
  for each row execute function handle_updated_at();

-- ── 10. tailor_client_notes — new table ──────────────────────────────────────

create table if not exists tailor_client_notes (
  id          uuid primary key default gen_random_uuid(),
  tailor_id   uuid not null references auth.users(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (tailor_id, customer_id)
);

alter table tailor_client_notes enable row level security;

drop policy if exists "Tailor owns their client notes" on tailor_client_notes;
create policy "Tailor owns their client notes" on tailor_client_notes
  for all using (tailor_id::text = auth.uid()::text)
  with check (tailor_id::text = auth.uid()::text);

drop trigger if exists tailor_client_notes_updated_at on tailor_client_notes;
create trigger tailor_client_notes_updated_at
  before update on tailor_client_notes
  for each row execute function handle_updated_at();

-- ── 11. Realtime ──────────────────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'push_tokens'
  ) then
    alter publication supabase_realtime add table push_tokens;
  end if;
end $$;

-- ── 12. Indexes ───────────────────────────────────────────────────────────────

create index if not exists orders_tailor_id_idx         on orders (tailor_id);
create index if not exists orders_customer_id_stage_idx on orders (customer_id, stage);
create index if not exists reviews_tailor_id_idx        on reviews (tailor_id);
create index if not exists disputes_customer_id_idx     on disputes (customer_id);
