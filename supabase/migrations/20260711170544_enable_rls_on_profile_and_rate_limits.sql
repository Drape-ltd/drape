-- Supabase advisor hardening:
-- These tables already have policies in production/dev, but advisor reported
-- that RLS itself was disabled. Enabling RLS makes the existing policies apply.

alter table if exists public.rate_limit_counters enable row level security;
alter table if exists public.tailor_profiles enable row level security;

-- SQL lint hardening for environments that still have historical text/uuid
-- drift on order/profile identifiers.
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
  where id::text = p_order_id::text
    and collection_code_attempts < p_max_attempts
  returning collection_code_attempts into v_attempts;

  if found then
    return query select v_attempts, v_attempts >= p_max_attempts;
    return;
  end if;

  select collection_code_attempts
  into v_attempts
  from public.orders
  where id::text = p_order_id::text;

  return query select coalesce(v_attempts, p_max_attempts), true;
end;
$$;

revoke all on function public.increment_collection_code_attempt(uuid, integer) from public, anon, authenticated;
grant execute on function public.increment_collection_code_attempt(uuid, integer) to service_role;

create or replace function public.ops_resolve_dispute(
  p_dispute_id uuid,
  p_outcome text,
  p_resolution text default null
)
returns table (
  order_id uuid,
  dispute_status dispute_status,
  order_stage order_stage
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_now timestamptz := now();
  v_note text;
  v_next_dispute_status dispute_status;
  v_next_order_stage order_stage;
begin
  if p_outcome = 'REFUND' then
    v_next_dispute_status := 'RESOLVED_REFUNDED';
    v_next_order_stage := 'REFUNDED';
    v_note := coalesce(
      nullif(trim(coalesce(p_resolution, '')), ''),
      'Ops resolved the dispute in the customer''s favor and refunded the order.'
    );
  elsif p_outcome = 'RELEASE' then
    v_next_dispute_status := 'RESOLVED_RELEASED';
    v_next_order_stage := 'COMPLETE';
    v_note := coalesce(
      nullif(trim(coalesce(p_resolution, '')), ''),
      'Ops resolved the dispute in the tailor''s favor and released payment.'
    );
  else
    raise exception 'Invalid dispute outcome: %', p_outcome using errcode = '22023';
  end if;

  select d.order_id::uuid
    into v_order_id
  from disputes d
  where d.id::text = p_dispute_id::text
    and d.status in ('OPEN', 'UNDER_REVIEW')
  for update;

  if v_order_id is null then
    raise exception 'Dispute is no longer open for review.' using errcode = 'P0001';
  end if;

  update orders
  set
    stage = v_next_order_stage,
    stage_updated_at = v_now,
    escrow_released = case when p_outcome = 'RELEASE' then true else false end,
    escrow_released_at = case when p_outcome = 'RELEASE' then coalesce(escrow_released_at, v_now) else null end,
    auto_release_at = null
  where id::text = v_order_id::text
    and stage = 'IN_DISPUTE';

  if not found then
    raise exception 'Order is no longer in dispute.' using errcode = 'P0001';
  end if;

  update disputes
  set
    status = v_next_dispute_status,
    resolution = v_note,
    resolved_at = v_now,
    resolved_by = null
  where id::text = p_dispute_id::text;

  insert into order_stage_updates (order_id, stage, note)
  values (v_order_id, v_next_order_stage, v_note);

  insert into audit_logs (actor_id, actor_role, order_id, event, severity, payload)
  values (
    null,
    'OPS',
    v_order_id,
    'ops.dispute_resolved',
    case when p_outcome = 'RELEASE' then 'info' else 'warn' end,
    jsonb_build_object(
      'dispute_id', p_dispute_id,
      'outcome', p_outcome,
      'from_stage', 'IN_DISPUTE',
      'to_stage', v_next_order_stage,
      'status', v_next_dispute_status,
      'resolution', v_note,
      'source', 'ops_dashboard'
    )
  );

  return query
  select v_order_id, v_next_dispute_status, v_next_order_stage;
end;
$$;

grant execute on function public.ops_resolve_dispute(uuid, text, text) to service_role;

create or replace function public.ops_decide_verification(
  p_tailor_user_id uuid,
  p_decision text
)
returns table (
  profile_id uuid,
  status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
  v_display_name text;
  v_now timestamptz := now();
  v_status text;
begin
  if p_decision = 'APPROVE' then
    v_status := 'VERIFIED';
  elsif p_decision = 'REJECT' then
    v_status := 'REJECTED';
  else
    raise exception 'Invalid verification decision: %', p_decision using errcode = '22023';
  end if;

  update tailor_profiles
  set
    id_verification_status = v_status,
    is_live = (p_decision = 'APPROVE'),
    id_verified_at = case when p_decision = 'APPROVE' then coalesce(id_verified_at, v_now) else null end
  where user_id::text = p_tailor_user_id::text
    and id_verification_status = 'PENDING'
  returning id::uuid, display_name into v_profile_id, v_display_name;

  if v_profile_id is null then
    raise exception 'Tailor verification is no longer pending.' using errcode = 'P0001';
  end if;

  insert into audit_logs (actor_id, actor_role, order_id, event, severity, payload)
  values (
    null,
    'OPS',
    null,
    'id_verification.decision',
    case when p_decision = 'APPROVE' then 'info' else 'warn' end,
    jsonb_build_object(
      'decision', p_decision,
      'tailor_id', p_tailor_user_id,
      'display_name', v_display_name,
      'source', 'ops_dashboard'
    )
  );

  return query
  select v_profile_id, v_status;
end;
$$;

grant execute on function public.ops_decide_verification(uuid, text) to service_role;
