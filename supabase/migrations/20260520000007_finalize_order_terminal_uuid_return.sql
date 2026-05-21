-- Keep finalize_order_terminal tolerant of legacy text/uuid drift while
-- preserving the public RPC contract that returns UUID order IDs.

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
  where id::text = p_order_id::text
  for update;

  if not found then
    raise exception 'Order % was not found.', p_order_id using errcode = 'P0002';
  end if;

  if v_order.stage = v_target_stage then
    return query
    select
      v_order.id::uuid,
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
  where id::text = v_order.id::text;

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
  values (v_order.id::uuid, v_target_stage, p_note);

  insert into public.audit_logs (actor_id, actor_role, order_id, event, severity, payload)
  values (
    p_actor_id,
    p_actor_role,
    v_order.id::uuid,
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
    v_order.id::uuid,
    v_order.stage::text,
    v_target_stage::text,
    v_inventory_released,
    false;
end;
$$;
