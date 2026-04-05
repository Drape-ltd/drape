-- ─────────────────────────────────────────────────────────────────────────────
-- Drape V1 — Internal ops workflow helpers
--
-- Purpose:
--   - Resolve disputes atomically so orders, dispute rows, audit logs, and
--     stage history never drift apart.
--   - Apply verification approve/reject decisions consistently from both the
--     ops dashboard and the legacy one-click email flow.
-- ─────────────────────────────────────────────────────────────────────────────

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

  select d.order_id
    into v_order_id
  from disputes d
  where d.id = p_dispute_id
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
  where id = v_order_id
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
  where id = p_dispute_id;

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
  where user_id = p_tailor_user_id
    and id_verification_status = 'PENDING'
  returning id, display_name into v_profile_id, v_display_name;

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
