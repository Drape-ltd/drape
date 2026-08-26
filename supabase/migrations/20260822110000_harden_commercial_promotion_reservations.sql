-- Promotion reservations are money movements: usage limits and campaign budgets
-- must include active reservations, not only completed redemptions. Keep the
-- failure reasons specific enough for mobile/web recovery without exposing SQL.

create or replace function public.reserve_order_benefit(
  p_order_id text,
  p_customer_id uuid,
  p_code text default null,
  p_grant_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_order public.orders%rowtype;
  v_benefit public.commercial_benefits%rowtype;
  v_campaign public.commercial_campaigns%rowtype;
  v_code public.commercial_promotion_codes%rowtype;
  v_grant public.commercial_grants%rowtype;
  v_existing public.commercial_benefit_reservations%rowtype;
  v_active public.commercial_benefit_reservations%rowtype;
  v_gross integer;
  v_order_discount integer := 0;
  v_shipping_discount integer := 0;
  v_total integer;
  v_due integer;
  v_hash text;
  v_row public.commercial_benefit_reservations%rowtype;
  v_account_uses integer := 0;
  v_total_uses integer := 0;
begin
  if (p_code is null) = (p_grant_id is null) then
    raise exception 'Choose exactly one promotion code or account grant.';
  end if;
  if nullif(trim(p_idempotency_key), '') is null then
    raise exception 'An idempotency key is required.';
  end if;

  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null or v_order.customer_id<>p_customer_id::text then
    raise exception 'Order not found for this customer.';
  end if;
  if v_order.commercial_policy_version<>'commercial-2026-07-31-v1'
    or v_order.stage not in ('QUOTE_SENT','PAYMENT_PENDING','PAYMENT_FAILED') then
    raise exception 'Benefits are not available at this order stage.';
  end if;

  v_gross := coalesce(v_order.total_amount,v_order.quoted_amount,0);
  if v_gross<=0 then raise exception 'Order pricing is incomplete.'; end if;
  v_hash := encode(digest(concat_ws('|',p_order_id,p_customer_id,upper(trim(coalesce(p_code,''))),coalesce(p_grant_id::text,'')),'sha256'),'hex');

  select * into v_existing
  from public.commercial_benefit_reservations
  where idempotency_key=p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.request_hash<>v_hash then
      raise exception 'Idempotency key was reused with different benefit details.';
    end if;
    return to_jsonb(v_existing);
  end if;

  select * into v_active
  from public.commercial_benefit_reservations
  where order_id=p_order_id and status='RESERVED' and expires_at>now()
  for update;
  if v_active.id is not null then
    raise exception 'An active promotion is already applied to this order.';
  end if;

  if p_code is not null then
    select * into v_code
    from public.commercial_promotion_codes
    where code=upper(trim(p_code));
    if v_code.id is null then raise exception 'Promotion code not found.'; end if;
    if v_code.status='EXPIRED' then raise exception 'Promotion code expired.'; end if;
    if v_code.status='PAUSED' then raise exception 'Promotion code temporarily unavailable.'; end if;
    if v_code.status in ('REVOKED') then raise exception 'Promotion code is no longer valid.'; end if;
    select * into v_benefit from public.commercial_benefits where id=v_code.benefit_id;
  else
    select * into v_grant
    from public.commercial_grants
    where id=p_grant_id and user_id=p_customer_id
    for update;
    if v_grant.id is null or v_grant.status<>'AVAILABLE' then
      raise exception 'Account grant is unavailable.';
    end if;
    if v_grant.expires_at is not null and v_grant.expires_at<=now() then
      update public.commercial_grants set status='EXPIRED' where id=v_grant.id and status='AVAILABLE';
      raise exception 'Account grant expired.';
    end if;
    select * into v_benefit from public.commercial_benefits where id=v_grant.benefit_id;
  end if;

  select * into v_campaign
  from public.commercial_campaigns
  where id=v_benefit.campaign_id
  for update;
  if v_campaign.status<>'ACTIVE' or v_campaign.feature_key<>'CONTROLLED_CORE' then
    raise exception 'Promotion is temporarily unavailable.';
  end if;
  if v_campaign.starts_at is not null and v_campaign.starts_at>now() then
    raise exception 'Promotion is temporarily unavailable.';
  end if;
  if v_campaign.ends_at is not null and v_campaign.ends_at<=now() then
    raise exception 'Promotion code expired.';
  end if;
  if v_benefit.currency is not null and v_benefit.currency<>v_order.currency then
    raise exception 'Benefit currency does not match the order.';
  end if;
  if v_gross<v_benefit.minimum_order_amount then
    raise exception 'Order does not meet the benefit minimum.';
  end if;

  select count(*) into v_account_uses
  from public.commercial_benefit_reservations x
  where x.benefit_id=v_benefit.id
    and x.customer_id=p_customer_id
    and (
      (x.status='RESERVED' and x.expires_at>now())
      or exists (
        select 1 from public.commercial_benefit_redemptions r
        where r.reservation_id=x.id and r.status<>'REVERSED'
      )
    );
  if v_account_uses>=v_benefit.per_account_limit then
    raise exception 'Account benefit limit reached.';
  end if;

  if v_benefit.total_limit is not null then
    select count(*) into v_total_uses
    from public.commercial_benefit_reservations x
    where x.benefit_id=v_benefit.id
      and (
        (x.status='RESERVED' and x.expires_at>now())
        or exists (
          select 1 from public.commercial_benefit_redemptions r
          where r.reservation_id=x.id and r.status<>'REVERSED'
        )
      );
    if v_total_uses>=v_benefit.total_limit then
      raise exception 'Promotion redemption limit reached.';
    end if;
  end if;

  if v_benefit.kind in ('PERCENT_DISCOUNT','CREATOR_CODE') then
    if v_benefit.value>10000 then raise exception 'Promotion percentage is invalid.'; end if;
    v_order_discount:=floor(coalesce(v_order.subtotal_amount,0)::numeric*v_benefit.value/10000)::integer;
  elsif v_benefit.kind in ('FIXED_DISCOUNT','ACCOUNT_GRANT','GOODWILL_GRANT') then
    v_order_discount:=least(
      case when v_grant.id is not null then coalesce(v_grant.remaining_amount,v_benefit.value) else v_benefit.value end,
      coalesce(v_order.subtotal_amount,0)
    );
  elsif v_benefit.kind='FREE_SHIPPING' then
    v_shipping_discount:=coalesce(v_order.shipping_amount,0);
  elsif v_benefit.kind='CAPPED_SHIPPING' then
    v_shipping_discount:=least(v_benefit.value,coalesce(v_order.shipping_amount,0));
  elsif v_benefit.kind='COMPLIMENTARY_ORDER' then
    v_order_discount:=v_gross-coalesce(v_order.shipping_amount,0);
    v_shipping_discount:=coalesce(v_order.shipping_amount,0);
  end if;
  if v_benefit.maximum_amount is not null then
    v_order_discount:=least(v_order_discount,v_benefit.maximum_amount);
  end if;

  v_total:=v_order_discount+v_shipping_discount;
  if v_total<=0 then raise exception 'Benefit has no value for this order.'; end if;
  v_due:=v_gross-v_total;
  if v_campaign.budget_amount is not null
    and v_campaign.reserved_amount+v_campaign.consumed_amount+v_total>v_campaign.budget_amount then
    raise exception 'Campaign budget is exhausted.';
  end if;

  insert into public.commercial_benefit_reservations(
    order_id,customer_id,benefit_id,promotion_code_id,grant_id,currency,
    gross_order_amount,order_discount_amount,shipping_discount_amount,total_benefit_amount,
    customer_due_amount,funding_source,idempotency_key,request_hash,policy_version
  ) values (
    p_order_id,p_customer_id,v_benefit.id,v_code.id,v_grant.id,v_order.currency,
    v_gross,v_order_discount,v_shipping_discount,v_total,v_due,v_campaign.funding_source,
    p_idempotency_key,v_hash,v_campaign.policy_version
  ) returning * into v_row;

  update public.commercial_campaigns
  set reserved_amount=reserved_amount+v_total,updated_at=now()
  where id=v_campaign.id;
  if v_grant.id is not null then
    update public.commercial_grants set status='RESERVED' where id=v_grant.id;
  end if;

  return jsonb_build_object(
    'id',v_row.id,
    'reservationToken',v_row.reservation_token,
    'expiresAt',v_row.expires_at,
    'grossOrderAmount',v_gross,
    'orderDiscountAmount',v_order_discount,
    'shippingDiscountAmount',v_shipping_discount,
    'totalBenefitAmount',v_total,
    'customerDueAmount',v_due,
    'currency',v_row.currency,
    'fundingSource',v_row.funding_source,
    'correlationId',v_row.correlation_id
  );
end
$$;

revoke all on function public.reserve_order_benefit(text,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_order_benefit(text,uuid,text,uuid,text) to service_role;
