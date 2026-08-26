-- Residual settlement must follow the independently reviewed terminal order
-- outcome when one exists. Older rows retain the legacy order_outcome field,
-- so keep that as a compatibility fallback.

create or replace function public.derive_order_residual_settlement(
  p_order_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_payment public.order_payments%rowtype;
  v_resolution public.order_refund_resolutions%rowtype;
  v_refunded_tailor_work integer := 0;
  v_original_tailor_allocation integer;
  v_residual_tailor_entitlement integer;
  v_fulfilment_liability integer;
  v_payment_remaining integer;
  v_existing_release public.payouts%rowtype;
begin
  select * into v_order
  from public.orders
  where id::text = p_order_id;
  if not found then raise exception 'Order was not found.'; end if;

  select * into v_payment
  from public.order_payments
  where order_id::text = p_order_id
    and phase = 'INITIAL_ORDER'
    and status in ('SUCCEEDED', 'PARTIAL_REFUND')
  order by created_at desc
  limit 1;
  if not found then raise exception 'The settled order payment was not found.'; end if;

  select * into v_resolution
  from public.order_refund_resolutions
  where order_id = p_order_id
    and status = 'SUCCEEDED'
    and coalesce(reviewed_order_outcome, order_outcome) = 'CLOSE_ORDER'
    and coalesce(reviewed_outcome_applied_at, outcome_applied_at) is not null
  order by coalesce(reviewed_outcome_applied_at, outcome_applied_at) desc, updated_at desc
  limit 1;
  if not found then
    raise exception 'A completed close-order refund decision is required before residual settlement.';
  end if;

  select coalesce(sum(tailor_work_amount), 0)::integer
  into v_refunded_tailor_work
  from public.order_refund_resolutions
  where order_id = p_order_id and status = 'SUCCEEDED';

  v_original_tailor_allocation := coalesce(v_order.source_amount, 0);
  v_residual_tailor_entitlement := v_original_tailor_allocation - v_refunded_tailor_work;
  v_fulfilment_liability := greatest(
    coalesce(v_order.shipping_amount, 0),
    coalesce(v_order.fulfillment_fee, 0)
  );
  v_payment_remaining := coalesce(v_payment.amount, 0) - coalesce(v_payment.refunded_amount, 0);

  if v_order.stage::text <> 'COMPLETE' then
    raise exception 'The reviewed order must be closed before residual settlement.';
  end if;
  if exists (
    select 1 from public.disputes
    where order_id::text = p_order_id and status in ('OPEN', 'UNDER_REVIEW')
  ) then
    raise exception 'The order still has an open dispute.';
  end if;
  if v_original_tailor_allocation <= 0 or v_residual_tailor_entitlement <= 0 then
    raise exception 'No positive residual tailor entitlement remains.';
  end if;
  if v_payment.currency::text is distinct from v_order.currency::text then
    raise exception 'The payment and order currencies do not match.';
  end if;
  if v_payment_remaining <> v_residual_tailor_entitlement + v_fulfilment_liability then
    raise exception 'The remaining payment does not equal tailor entitlement plus fulfilment liability.';
  end if;

  select * into v_existing_release
  from public.payouts
  where order_id::text = p_order_id
    and payout_purpose = 'ORDER_EARNING'
    and status in ('PROCESSING', 'PAID')
  order by processed_at desc nulls last
  limit 1;
  if found then
    raise exception 'An order-earning payout is already processing or paid.';
  end if;

  return jsonb_build_object(
    'policyVersion', 'order-residual-settlement-v1',
    'orderId', v_order.id,
    'orderReference', v_order.reference,
    'sourcePaymentId', v_payment.id,
    'refundResolutionId', v_resolution.id,
    'currency', v_payment.currency,
    'provider', v_payment.provider,
    'originalTailorAllocation', v_original_tailor_allocation,
    'refundedTailorWork', v_refunded_tailor_work,
    'residualTailorEntitlement', v_residual_tailor_entitlement,
    'fulfillmentLiability', v_fulfilment_liability,
    'paymentRemaining', v_payment_remaining
  );
end;
$$;

revoke all on function public.derive_order_residual_settlement(text) from public, anon, authenticated;
grant execute on function public.derive_order_residual_settlement(text) to service_role;
