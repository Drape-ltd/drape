-- Fix remote SQL lint errors caused by legacy text-typed RPC overloads.
-- The app passes UUIDs as strings over PostgREST, but the server functions
-- should accept UUID parameters so comparisons stay typed and lint-clean.

drop function if exists public.ops_resolve_dispute(text, text, text);
drop function if exists public.ops_decide_verification(text, text);
drop function if exists public.finalize_order_terminal(
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  text[],
  text,
  boolean,
  boolean,
  boolean,
  boolean
);

create or replace function public.resolve_payment_provider_for_currency(p_currency currency)
returns payment_provider
language plpgsql
immutable
as $$
begin
  case p_currency
    when 'NGN', 'GHS', 'KES' then
      return 'PAYSTACK'::payment_provider;
    when 'USD', 'GBP', 'EUR', 'CAD' then
      return 'STRIPE'::payment_provider;
    else
      raise exception 'Unsupported currency % for payment routing', p_currency;
  end case;
end;
$$;

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

create or replace function public.finalize_order_terminal(
  p_order_id uuid,
  p_target_stage text,
  p_actor_id text default null,
  p_actor_role text default null,
  p_event text default 'order.stage_changed',
  p_note text default null,
  p_payload jsonb default '{}'::jsonb,
  p_expected_stages text[] default null,
  p_special_note text default null,
  p_replace_special_note boolean default false,
  p_clear_payment_session boolean default false,
  p_reset_fulfillment_payment boolean default false,
  p_release_ready_made_inventory boolean default false
)
returns table (
  order_id uuid,
  previous_stage text,
  current_stage text,
  inventory_released boolean,
  idempotent boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_target_stage public.order_stage;
  v_inventory_released boolean := false;
  v_trimmed_target text := upper(trim(coalesce(p_target_stage, '')));
begin
  if v_trimmed_target not in ('COMPLETE', 'DECLINED', 'EXPIRED', 'REFUNDED', 'CANCELLED') then
    raise exception 'Target stage % is not terminal.', p_target_stage using errcode = '22023';
  end if;

  v_target_stage := v_trimmed_target::public.order_stage;

  select *
    into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order % was not found.', p_order_id using errcode = 'P0002';
  end if;

  if v_order.stage = v_target_stage then
    return query
    select
      v_order.id,
      v_order.stage::text,
      v_order.stage::text,
      false,
      true;
    return;
  end if;

  if public.is_terminal_order_stage(v_order.stage) then
    raise exception 'Order % is already terminal at stage %.', v_order.id, v_order.stage
      using errcode = 'P0001';
  end if;

  if p_expected_stages is not null and not (v_order.stage::text = any(p_expected_stages)) then
    raise exception 'Order % is at stage % but expected one of %.', v_order.id, v_order.stage, p_expected_stages
      using errcode = 'P0001';
  end if;

  update public.orders
  set
    stage = v_target_stage,
    stage_updated_at = now(),
    special_note = case
      when p_replace_special_note then p_special_note
      else special_note
    end,
    payment_provider = case
      when p_clear_payment_session then null
      else payment_provider
    end,
    payment_intent_id = case
      when p_clear_payment_session then null
      else payment_intent_id
    end,
    payment_checkout_url = case
      when p_clear_payment_session then null
      else payment_checkout_url
    end,
    fulfillment_payment_requested_at = case
      when p_reset_fulfillment_payment then null
      else fulfillment_payment_requested_at
    end,
    fulfillment_payment_paid_at = case
      when p_reset_fulfillment_payment then null
      else fulfillment_payment_paid_at
    end,
    fulfillment_payment_provider = case
      when p_reset_fulfillment_payment then null
      else fulfillment_payment_provider
    end,
    fulfillment_payment_intent_id = case
      when p_reset_fulfillment_payment then null
      else fulfillment_payment_intent_id
    end,
    fulfillment_payment_checkout_url = case
      when p_reset_fulfillment_payment then null
      else fulfillment_payment_checkout_url
    end,
    escrow_released = false,
    escrow_released_at = null,
    auto_release_at = null
  where id = v_order.id;

  if p_release_ready_made_inventory
    and coalesce(v_order.order_kind::text, 'CUSTOM') = 'READY_MADE'
    and nullif(trim(coalesce(v_order.seller_item_id, '')), '') is not null then
    perform public.release_seller_item_inventory(
      v_order.seller_item_id::uuid,
      greatest(coalesce(v_order.item_quantity, 1), 1),
      nullif(trim(coalesce(v_order.item_size, '')), '')
    );
    v_inventory_released := true;
  end if;

  insert into public.order_stage_updates (order_id, stage, note)
  values (v_order.id, v_target_stage, p_note);

  insert into public.audit_logs (actor_id, actor_role, order_id, event, severity, payload)
  values (
    p_actor_id,
    p_actor_role,
    v_order.id,
    p_event,
    case
      when v_target_stage in ('REFUNDED', 'CANCELLED', 'DECLINED', 'EXPIRED') then 'warn'
      else 'info'
    end,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
      'from_stage', v_order.stage,
      'to_stage', v_target_stage,
      'inventory_released', v_inventory_released
    )
  );

  return query
  select
    v_order.id,
    v_order.stage::text,
    v_target_stage::text,
    v_inventory_released,
    false;
end;
$$;

grant execute on function public.ops_resolve_dispute(uuid, text, text) to service_role;
grant execute on function public.ops_decide_verification(uuid, text) to service_role;
grant execute on function public.finalize_order_terminal(
  uuid,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  text[],
  text,
  boolean,
  boolean,
  boolean,
  boolean
) to service_role;
