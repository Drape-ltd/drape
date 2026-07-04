-- TestFlight readiness: structured product feedback and deletion integrity.

create table if not exists public.product_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  context text not null check (
    context in (
      'vision_scan_saved',
      'vision_scan_failed',
      'order_completed',
      'general'
    )
  ),
  rating integer check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 2000),
  measurement_scan_id uuid references public.measurement_scans(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  app_variant text,
  platform text,
  app_version text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint product_feedback_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint product_feedback_metadata_size_check
    check (pg_column_size(metadata) < 16384)
);

create index if not exists product_feedback_user_created_idx
  on public.product_feedback (user_id, created_at desc);

create index if not exists product_feedback_context_created_idx
  on public.product_feedback (context, created_at desc);

create index if not exists product_feedback_scan_idx
  on public.product_feedback (measurement_scan_id, created_at desc)
  where measurement_scan_id is not null;

create index if not exists product_feedback_order_idx
  on public.product_feedback (order_id, created_at desc)
  where order_id is not null;

alter table public.product_feedback enable row level security;

drop policy if exists "Users manage own product feedback" on public.product_feedback;
drop policy if exists "Users select own product feedback" on public.product_feedback;
drop policy if exists "Users insert own product feedback" on public.product_feedback;
drop policy if exists "Users delete own product feedback" on public.product_feedback;

create policy "Users select own product feedback"
  on public.product_feedback
  for select using (auth.uid() = user_id);

create policy "Users insert own product feedback"
  on public.product_feedback
  for insert
  with check (
    auth.uid() = user_id
    and (
      measurement_scan_id is null
      or exists (
        select 1
        from public.measurement_scans scan
        where scan.id = measurement_scan_id
          and scan.user_id = auth.uid()
      )
    )
    and (
      order_id is null
      or exists (
        select 1
        from public.orders feedback_order
        where feedback_order.id = order_id
          and (
            feedback_order.customer_id = auth.uid()
            or feedback_order.tailor_id = auth.uid()
            or exists (
              select 1
              from public.tailor_profiles feedback_tailor
              where feedback_tailor.id = feedback_order.tailor_profile_id
                and feedback_tailor.user_id = auth.uid()
            )
          )
      )
    )
  );

create policy "Users delete own product feedback"
  on public.product_feedback
  for delete using (auth.uid() = user_id);

revoke all on table public.product_feedback from public, anon, authenticated;
grant select, insert, delete on table public.product_feedback to authenticated;

-- Keep account deletion from leaving orphaned customer, tailor, review, payout, or client-link rows.
-- Orders are shared marketplace history, so they must be retained explicitly
-- instead of cascading away when one participant requests account deletion.
alter table if exists public.orders
  drop constraint if exists orders_customer_id_fkey;
alter table if exists public.orders
  add constraint orders_customer_id_fkey
  foreign key (customer_id) references public.users(id) on delete restrict;

alter table if exists public.orders
  drop constraint if exists orders_tailor_profile_id_fkey;
alter table if exists public.orders
  add constraint orders_tailor_profile_id_fkey
  foreign key (tailor_profile_id) references public.tailor_profiles(id) on delete restrict;

alter table if exists public.reviews
  drop constraint if exists reviews_order_id_fkey;
alter table if exists public.reviews
  add constraint reviews_order_id_fkey
  foreign key (order_id) references public.orders(id) on delete cascade;

alter table if exists public.reviews
  drop constraint if exists reviews_tailor_profile_id_fkey;
alter table if exists public.reviews
  add constraint reviews_tailor_profile_id_fkey
  foreign key (tailor_profile_id) references public.tailor_profiles(id) on delete cascade;

alter table if exists public.disputes
  drop constraint if exists disputes_order_id_fkey;
alter table if exists public.disputes
  add constraint disputes_order_id_fkey
  foreign key (order_id) references public.orders(id) on delete cascade;

alter table if exists public.payouts
  drop constraint if exists payouts_tailor_profile_id_fkey;
alter table if exists public.payouts
  add constraint payouts_tailor_profile_id_fkey
  foreign key (tailor_profile_id) references public.tailor_profiles(id) on delete cascade;

alter table if exists public.tailor_clients
  drop constraint if exists tailor_clients_linked_user_id_fkey;
alter table if exists public.tailor_clients
  add constraint tailor_clients_linked_user_id_fkey
  foreign key (linked_user_id) references public.users(id) on delete set null;

-- Bound high-churn / externally supplied fields so authenticated clients cannot
-- bloat hot tables with oversized JSON or profile text.
alter table if exists public.measurement_scans
  drop constraint if exists measurement_scans_snapshot_size_check;
alter table if exists public.measurement_scans
  add constraint measurement_scans_snapshot_size_check
  check (pg_column_size(measurement_snapshot) < 65536) not valid;

alter table if exists public.audit_logs
  drop constraint if exists audit_logs_payload_size_check;
alter table if exists public.audit_logs
  add constraint audit_logs_payload_size_check
  check (payload is null or pg_column_size(payload) < 32768) not valid;

alter table if exists public.account_deletion_requests
  drop constraint if exists account_deletion_requests_metadata_size_check;
alter table if exists public.account_deletion_requests
  add constraint account_deletion_requests_metadata_size_check
  check (metadata is null or pg_column_size(metadata) < 16384) not valid;

create index if not exists account_deletion_requests_completed_processed_idx
  on public.account_deletion_requests (processed_at)
  where status = 'COMPLETED' and processed_at is not null;

alter table if exists public.order_group_members
  add column if not exists invite_expires_at timestamptz;

update public.order_group_members
set invite_expires_at = invited_at + interval '30 days'
where invite_expires_at is null
  and invited_at is not null
  and status in ('INVITED', 'ACCEPTED', 'DECLINED');

create index if not exists order_group_members_invite_expiry_idx
  on public.order_group_members (invite_expires_at)
  where invite_expires_at is not null;

alter table if exists public.media_assets
  drop constraint if exists media_assets_metadata_size_check;
alter table if exists public.media_assets
  add constraint media_assets_metadata_size_check
  check (pg_column_size(metadata) < 32768) not valid;

alter table if exists public.tailor_profiles
  drop constraint if exists tailor_profiles_display_name_length_check;
alter table if exists public.tailor_profiles
  add constraint tailor_profiles_display_name_length_check
  check (char_length(trim(display_name)) between 1 and 120) not valid;

alter table if exists public.tailor_profiles
  drop constraint if exists tailor_profiles_bio_length_check;
alter table if exists public.tailor_profiles
  add constraint tailor_profiles_bio_length_check
  check (bio is null or char_length(bio) <= 2000) not valid;

alter table if exists public.tailor_profiles
  drop constraint if exists tailor_profiles_location_length_check;
alter table if exists public.tailor_profiles
  add constraint tailor_profiles_location_length_check
  check (char_length(location) <= 200) not valid;

alter table if exists public.tailor_profiles
  drop constraint if exists tailor_profiles_specialty_tags_count_check;
alter table if exists public.tailor_profiles
  add constraint tailor_profiles_specialty_tags_count_check
  check (array_length(specialty_tags, 1) is null or array_length(specialty_tags, 1) <= 30) not valid;

-- Feature flag internals are for signed-in app sessions and service tooling,
-- not anonymous roadmap enumeration.
revoke execute on function public.get_feature_flags(text) from anon;

-- Record when measurement scan rows are created or changed without duplicating
-- the sensitive measurement snapshot into the audit log payload.
create or replace function public.audit_measurement_scan_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.audit_logs (actor_id, actor_role, event, severity, payload)
  values (
    new.user_id::text,
    'CUSTOMER',
    case when tg_op = 'INSERT' then 'measurement_scan.created' else 'measurement_scan.updated' end,
    'info',
    jsonb_build_object(
      'scan_id', new.id,
      'capture_method', new.capture_method,
      'capture_version', new.capture_version,
      'status', new.status,
      'operation', tg_op
    )
  );

  return new;
end;
$$;

drop trigger if exists measurement_scans_audit_change on public.measurement_scans;
drop trigger if exists measurement_scans_audit_insert on public.measurement_scans;
drop trigger if exists measurement_scans_audit_security_update on public.measurement_scans;

create trigger measurement_scans_audit_insert
after insert on public.measurement_scans
for each row execute function public.audit_measurement_scan_change();

create trigger measurement_scans_audit_security_update
after update of status, capture_method, capture_version on public.measurement_scans
for each row
when (
  old.status is distinct from new.status
  or old.capture_method is distinct from new.capture_method
  or old.capture_version is distinct from new.capture_version
)
execute function public.audit_measurement_scan_change();

-- Atomically consume one failed collection-code attempt so parallel guesses
-- cannot bypass the five-attempt lockout with stale read-modify-write state.
create or replace function public.increment_collection_code_attempt(
  p_order_id uuid,
  p_max_attempts integer default 5
)
returns table(attempts integer, locked boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempts integer;
begin
  update public.orders
  set
    collection_code_attempts = collection_code_attempts + 1,
    collection_code_last_attempt_at = now(),
    updated_at = now()
  where id = p_order_id
    and collection_code_attempts < p_max_attempts
  returning collection_code_attempts into v_attempts;

  if found then
    return query select v_attempts, v_attempts >= p_max_attempts;
    return;
  end if;

  select collection_code_attempts
  into v_attempts
  from public.orders
  where id = p_order_id;

  return query select coalesce(v_attempts, p_max_attempts), true;
end;
$$;

revoke all on function public.increment_collection_code_attempt(uuid, integer) from public, anon, authenticated;
grant execute on function public.increment_collection_code_attempt(uuid, integer) to service_role;
