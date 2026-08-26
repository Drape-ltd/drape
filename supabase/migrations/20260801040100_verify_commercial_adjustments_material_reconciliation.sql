-- Rollback-only proof for Implementation 7 amendment and reconciliation invariants.
do $$
declare
  v_order public.orders%rowtype;
  v_actor uuid;
  v_counterparty uuid;
  v_created jsonb;
  v_duplicate jsonb;
  v_adjustment public.commercial_adjustments%rowtype;
  v_advance_id uuid := gen_random_uuid();
  v_reconciliation jsonb;
  v_deadline timestamptz := now() + interval '45 days';
begin
  select o.* into v_order
  from public.orders o
  join public.users customer_user on customer_user.id::text = o.customer_id::text
  join public.users tailor_user on tailor_user.id::text = o.tailor_id::text
  where o.customer_id is not null and o.tailor_id is not null
  limit 1;
  if v_order.id is null then
    raise notice 'Implementation 7 workflow proof skipped: no order with two live parties.';
    return;
  end if;

  v_actor := v_order.tailor_id::uuid;
  v_counterparty := v_order.customer_id::uuid;
  update public.orders set stage = 'SEWING', commercial_policy_version = 'commercial-2026-07-31-v1' where id = v_order.id;

  v_created := public.create_commercial_adjustment(
    'verify-adjustment:' || gen_random_uuid()::text, v_order.id, v_actor, 'TAILOR',
    'DEADLINE_EXTENSION', 'Verification deadline amendment',
    'The production timeline needs a recorded counterpart decision.', 'CUSTOMER',
    100, coalesce(v_order.currency, v_order.quoted_currency::currency, 'USD'::currency),
    v_deadline, '{}'::uuid[], gen_random_uuid()
  );
  select * into v_adjustment from public.commercial_adjustments where id = (v_created ->> 'adjustmentId')::uuid;
  v_duplicate := public.create_commercial_adjustment(
    v_adjustment.idempotency_key, v_order.id, v_actor, 'TAILOR',
    'DEADLINE_EXTENSION', 'Verification deadline amendment',
    'The production timeline needs a recorded counterpart decision.', 'CUSTOMER',
    100, v_adjustment.currency, v_deadline, '{}'::uuid[], v_adjustment.correlation_id
  );
  if (v_duplicate ->> 'adjustmentId')::uuid <> v_adjustment.id or not (v_duplicate ->> 'duplicate')::boolean then
    raise exception 'Implementation 7 adjustment idempotency proof failed.';
  end if;

  begin
    update public.commercial_adjustments set summary = 'Mutation must fail' where id = v_adjustment.id;
    raise exception 'Implementation 7 immutable claim proof failed.';
  exception when others then
    if sqlerrm not like 'Commercial adjustment claims are immutable%' then raise; end if;
  end;

  perform public.respond_commercial_adjustment(v_adjustment.id, v_counterparty, 'CUSTOMER', 'ACCEPTED', 'Accepted in verification.');
  select * into v_adjustment from public.commercial_adjustments where id = v_adjustment.id;
  if v_adjustment.status <> 'PAYMENT_PENDING'
    or abs(extract(epoch from ((select deadline from public.orders where id = v_order.id) - v_deadline))) >= 0.001 then
    raise exception 'Implementation 7 decision, payment gate, or exact deadline proof failed: status %, saved %, expected %.',
      v_adjustment.status, (select deadline from public.orders where id = v_order.id), v_deadline;
  end if;

  begin
    update public.commercial_adjustment_events set payload = '{}'::jsonb where adjustment_id = v_adjustment.id;
    raise exception 'Implementation 7 append-only event proof failed.';
  exception when others then
    if sqlerrm not like 'Commercial adjustment events are append-only%' then raise; end if;
  end;

  insert into public.order_material_advances(
    id, order_id, customer_id, tailor_id, requested_by, title, description,
    amount, currency, status, release_status, released_at, estimate_photo_url,
    estimate_storage_bucket, estimate_storage_path
  ) values (
    v_advance_id, v_order.id, v_counterparty, v_actor, v_actor,
    'Verification material', 'Synthetic released advance for reconciliation verification.',
    100, v_adjustment.currency, 'RELEASED', 'RELEASED', now(),
    'https://example.invalid/estimate.jpg', 'order-photos', 'verify/estimate.jpg'
  );
  v_reconciliation := public.reconcile_material_advance(
    v_advance_id, v_actor, 80, 'order-photos', 'verify/receipt.jpg',
    'https://example.invalid/receipt.jpg', 'Verification receipt.', gen_random_uuid()
  );
  if v_reconciliation ->> 'outcome' <> 'UNUSED_VALUE'
    or (v_reconciliation ->> 'deltaAmount')::integer <> -20
    or (v_reconciliation ->> 'caseId') is null then
    raise exception 'Implementation 7 unused-value reconciliation proof failed.';
  end if;

  raise notice 'Implementation 7 idempotency, immutable claims/events, deadline decision, payment gate, and material reconciliation verification passed.';
  raise exception using errcode = 'P0001', message = 'ROLLBACK_IMPLEMENTATION_7_PROOF';
exception
  when sqlstate 'P0001' then
    if sqlerrm = 'ROLLBACK_IMPLEMENTATION_7_PROOF' then
      raise notice 'Implementation 7 synthetic rows rolled back.';
    else
      raise;
    end if;
end;
$$;
