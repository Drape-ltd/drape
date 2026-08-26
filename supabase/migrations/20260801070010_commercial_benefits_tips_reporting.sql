-- Implementation 10: controlled commercial benefits, post-completion tips,
-- immutable outcomes, and finance reporting. Future reward programmes remain
-- disabled and cannot be activated through customer-facing contracts.

create table public.commercial_campaigns (
  id uuid primary key default gen_random_uuid(), name text not null,
  status text not null default 'DRAFT' check(status in ('DRAFT','PENDING_APPROVAL','ACTIVE','PAUSED','ENDED','REVOKED')),
  funding_source text not null check(funding_source in ('DRAPEON','TAILOR','PARTNER')),
  currency currency, budget_amount integer check(budget_amount is null or budget_amount>0),
  reserved_amount integer not null default 0 check(reserved_amount>=0), consumed_amount integer not null default 0 check(consumed_amount>=0),
  starts_at timestamptz, ends_at timestamptz, policy_version text not null default 'benefits-2026-08-01-v1',
  feature_key text not null default 'CONTROLLED_CORE' check(feature_key in ('CONTROLLED_CORE','REWARDED_REFERRALS','TAILOR_MILESTONES','COMMISSION_WAIVERS','AFFILIATE_PAYOUTS','SWEEPSTAKES')),
  created_by uuid references auth.users(id), created_by_email text, approved_by uuid references auth.users(id), approved_by_email text, approved_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(feature_key='CONTROLLED_CORE' or status<>'ACTIVE'),
  check(budget_amount is null or reserved_amount+consumed_amount<=budget_amount)
);

alter table public.commercial_receipts drop constraint if exists commercial_receipt_exact_total;
alter table public.commercial_receipts drop constraint if exists commercial_receipt_credit_bounds;
alter table public.commercial_receipts drop constraint if exists commercial_receipts_total_amount_check;
alter table public.commercial_receipts add constraint commercial_receipts_total_amount_check check(total_amount>=0);
alter table public.commercial_receipts add constraint commercial_receipt_exact_total check(total_amount+promotion_amount=subtotal_amount+platform_fee_amount+tax_amount+shipping_amount);
alter table public.commercial_receipts add constraint commercial_receipt_credit_bounds check(consultation_credit_amount<=subtotal_amount and promotion_amount<=subtotal_amount+platform_fee_amount+tax_amount+shipping_amount);

create table public.commercial_benefits (
  id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.commercial_campaigns(id) on delete restrict,
  kind text not null check(kind in ('PERCENT_DISCOUNT','FIXED_DISCOUNT','FREE_SHIPPING','CAPPED_SHIPPING','ACCOUNT_GRANT','COMPLIMENTARY_ORDER','GOODWILL_GRANT','CREATOR_CODE')),
  value integer not null default 0 check(value>=0), maximum_amount integer check(maximum_amount is null or maximum_amount>0),
  minimum_order_amount integer not null default 0 check(minimum_order_amount>=0), currency currency,
  per_account_limit integer not null default 1 check(per_account_limit>0), total_limit integer check(total_limit is null or total_limit>0),
  tax_treatment text not null default 'LOCKED_PRICE_INCLUDED' check(tax_treatment='LOCKED_PRICE_INCLUDED'),
  created_at timestamptz not null default now()
);

create table public.commercial_promotion_codes (
  id uuid primary key default gen_random_uuid(), benefit_id uuid not null references public.commercial_benefits(id) on delete restrict,
  code text not null unique check(code=upper(code) and length(code) between 3 and 40), status text not null default 'ACTIVE' check(status in ('ACTIVE','PAUSED','EXPIRED','REVOKED')),
  created_at timestamptz not null default now()
);

create table public.commercial_grants (
  id uuid primary key default gen_random_uuid(), benefit_id uuid not null references public.commercial_benefits(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict, original_amount integer,
  remaining_amount integer, currency currency, status text not null default 'AVAILABLE' check(status in ('AVAILABLE','RESERVED','CONSUMED','EXPIRED','REVOKED','FRAUD_HELD')),
  expires_at timestamptz, reason text not null, correlation_id uuid not null default gen_random_uuid(),
  created_by uuid references auth.users(id), created_by_email text, created_at timestamptz not null default now(),
  check((original_amount is null and remaining_amount is null) or (original_amount>=0 and remaining_amount between 0 and original_amount))
);

create table public.commercial_benefit_reservations (
  id uuid primary key default gen_random_uuid(), order_id text not null references public.orders(id) on delete restrict,
  customer_id uuid not null references auth.users(id) on delete restrict, benefit_id uuid not null references public.commercial_benefits(id) on delete restrict,
  promotion_code_id uuid references public.commercial_promotion_codes(id) on delete restrict, grant_id uuid references public.commercial_grants(id) on delete restrict,
  currency currency not null, gross_order_amount integer not null check(gross_order_amount>0),
  order_discount_amount integer not null default 0 check(order_discount_amount>=0), shipping_discount_amount integer not null default 0 check(shipping_discount_amount>=0),
  total_benefit_amount integer not null check(total_benefit_amount>0), customer_due_amount integer not null check(customer_due_amount>=0),
  funding_source text not null check(funding_source in ('DRAPEON','TAILOR','PARTNER')),
  status text not null default 'RESERVED' check(status in ('RESERVED','CONSUMED','RELEASED','EXPIRED','REVOKED','REVERSED','FRAUD_HELD')),
  reservation_token uuid not null unique default gen_random_uuid(), idempotency_key text not null unique, request_hash text not null,
  expires_at timestamptz not null default now()+interval '15 minutes', consumed_at timestamptz,
  policy_version text not null default 'benefits-2026-08-01-v1', correlation_id uuid not null default gen_random_uuid(), created_at timestamptz not null default now(),
  check(total_benefit_amount=order_discount_amount+shipping_discount_amount),
  check(customer_due_amount+total_benefit_amount=gross_order_amount),
  check((promotion_code_id is not null)::integer+(grant_id is not null)::integer=1)
);
create unique index commercial_benefit_one_active_order_idx on public.commercial_benefit_reservations(order_id) where status='RESERVED';

create table public.commercial_benefit_redemptions (
  id uuid primary key default gen_random_uuid(), reservation_id uuid not null unique references public.commercial_benefit_reservations(id) on delete restrict,
  order_id text not null references public.orders(id) on delete restrict, customer_id uuid not null references auth.users(id) on delete restrict,
  amount integer not null check(amount>0), currency currency not null, funding_source text not null,
  ledger_transaction_id uuid references public.commercial_ledger_transactions(id) on delete restrict,
  status text not null default 'CONSUMED' check(status in ('CONSUMED','SETTLED','REVERSED','FRAUD_HELD')),
  correlation_id uuid not null, created_at timestamptz not null default now()
);

create table public.order_tips (
  id uuid primary key default gen_random_uuid(), order_id text not null unique references public.orders(id) on delete restrict,
  customer_id uuid not null references auth.users(id) on delete restrict, tailor_id uuid not null references auth.users(id) on delete restrict,
  amount integer not null check(amount>0), currency currency not null, platform_fee_amount integer not null default 0 check(platform_fee_amount=0),
  status text not null default 'PENDING' check(status in ('PENDING','PROCESSING','SUCCEEDED','PAYOUT_PENDING','PAID_OUT','FAILED','REFUNDED','DISPUTED','HELD')),
  provider payment_provider, provider_reference text, payment_id uuid references public.order_payments(id) on delete restrict,
  ledger_transaction_id uuid references public.commercial_ledger_transactions(id) on delete restrict,
  idempotency_key text not null unique, request_hash text not null, correlation_id uuid not null default gen_random_uuid(),
  payout_id text references public.payouts(id) on delete restrict, payout_provider_reference text,
  failure_reason text, paid_at timestamptz, paid_out_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

alter table public.money_desk_requests drop constraint if exists money_desk_requests_action_type_check;
alter table public.money_desk_requests add constraint money_desk_requests_action_type_check check(action_type in (
  'PAYOUT_RELEASE','TIP_PAYOUT','MATERIAL_ADVANCE_RELEASE','CUSTOMER_REFUND','PAYOUT_DESTINATION_CHANGE','MANUAL_FX','POST_RELEASE_RECOVERY','POLICY_OVERRIDE','OTHER_REVIEWED'
));
create table public.order_tip_events (
  id uuid primary key default gen_random_uuid(), tip_id uuid not null references public.order_tips(id) on delete restrict,
  event_type text not null, actor_role text not null check(actor_role in ('CUSTOMER','TAILOR','OPS','SYSTEM')),
  payload jsonb not null default '{}'::jsonb, correlation_id uuid not null, created_at timestamptz not null default now()
);

create or replace function public.prevent_commercial_benefit_history_mutation() returns trigger language plpgsql as $$ begin raise exception 'Commercial redemptions and tip events are append-only.'; end $$;
create trigger commercial_redemptions_append_only before update or delete on public.commercial_benefit_redemptions for each row execute function public.prevent_commercial_benefit_history_mutation();
create trigger order_tip_events_append_only before update or delete on public.order_tip_events for each row execute function public.prevent_commercial_benefit_history_mutation();

create or replace function public.reserve_order_benefit(p_order_id text,p_customer_id uuid,p_code text default null,p_grant_id uuid default null,p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_order public.orders%rowtype; v_benefit public.commercial_benefits%rowtype; v_campaign public.commercial_campaigns%rowtype; v_code public.commercial_promotion_codes%rowtype; v_grant public.commercial_grants%rowtype; v_existing public.commercial_benefit_reservations%rowtype; v_gross integer; v_order_discount integer:=0; v_shipping_discount integer:=0; v_total integer; v_due integer; v_hash text; v_row public.commercial_benefit_reservations%rowtype; v_used integer;
begin
  if (p_code is null)=(p_grant_id is null) then raise exception 'Choose exactly one promotion code or account grant.'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null or v_order.customer_id<>p_customer_id::text then raise exception 'Order not found for this customer.'; end if;
  if v_order.commercial_policy_version<>'commercial-2026-07-31-v1' or v_order.stage not in ('QUOTE_SENT','PAYMENT_PENDING','PAYMENT_FAILED') then raise exception 'Benefits are not available at this order stage.'; end if;
  v_gross:=coalesce(v_order.total_amount,v_order.quoted_amount,0); if v_gross<=0 then raise exception 'Order pricing is incomplete.'; end if;
  v_hash:=encode(digest(concat_ws('|',p_order_id,p_customer_id,upper(trim(coalesce(p_code,''))),coalesce(p_grant_id::text,'')),'sha256'),'hex');
  select * into v_existing from public.commercial_benefit_reservations where idempotency_key=p_idempotency_key;
  if v_existing.id is not null then if v_existing.request_hash<>v_hash then raise exception 'Idempotency key was reused with different benefit details.'; end if; return to_jsonb(v_existing); end if;
  if p_code is not null then
    select * into v_code from public.commercial_promotion_codes where code=upper(trim(p_code)) and status='ACTIVE'; if v_code.id is null then raise exception 'Promotion code is unavailable.'; end if;
    select * into v_benefit from public.commercial_benefits where id=v_code.benefit_id;
  else
    select * into v_grant from public.commercial_grants where id=p_grant_id and user_id=p_customer_id and status='AVAILABLE' and (expires_at is null or expires_at>now()) for update; if v_grant.id is null then raise exception 'Account grant is unavailable.'; end if;
    select * into v_benefit from public.commercial_benefits where id=v_grant.benefit_id;
  end if;
  select * into v_campaign from public.commercial_campaigns where id=v_benefit.campaign_id for update;
  if v_campaign.status<>'ACTIVE' or v_campaign.feature_key<>'CONTROLLED_CORE' or (v_campaign.starts_at is not null and v_campaign.starts_at>now()) or (v_campaign.ends_at is not null and v_campaign.ends_at<=now()) then raise exception 'Benefit campaign is unavailable.'; end if;
  if v_benefit.currency is not null and v_benefit.currency<>v_order.currency then raise exception 'Benefit currency does not match the order.'; end if;
  if v_gross<v_benefit.minimum_order_amount then raise exception 'Order does not meet the benefit minimum.'; end if;
  select count(*) into v_used from public.commercial_benefit_redemptions r join public.commercial_benefit_reservations x on x.id=r.reservation_id where x.benefit_id=v_benefit.id and r.customer_id=p_customer_id and r.status<>'REVERSED';
  if v_used>=v_benefit.per_account_limit then raise exception 'Account benefit limit reached.'; end if;
  if v_benefit.kind in ('PERCENT_DISCOUNT','CREATOR_CODE') then v_order_discount:=floor(coalesce(v_order.subtotal_amount,0)::numeric*v_benefit.value/10000)::integer;
  elsif v_benefit.kind in ('FIXED_DISCOUNT','ACCOUNT_GRANT','GOODWILL_GRANT') then v_order_discount:=least(case when v_grant.id is not null then coalesce(v_grant.remaining_amount,v_benefit.value) else v_benefit.value end,coalesce(v_order.subtotal_amount,0));
  elsif v_benefit.kind='FREE_SHIPPING' then v_shipping_discount:=coalesce(v_order.shipping_amount,0);
  elsif v_benefit.kind='CAPPED_SHIPPING' then v_shipping_discount:=least(v_benefit.value,coalesce(v_order.shipping_amount,0));
  elsif v_benefit.kind='COMPLIMENTARY_ORDER' then v_order_discount:=v_gross-coalesce(v_order.shipping_amount,0); v_shipping_discount:=coalesce(v_order.shipping_amount,0); end if;
  if v_benefit.maximum_amount is not null then v_order_discount:=least(v_order_discount,v_benefit.maximum_amount); end if;
  v_total:=v_order_discount+v_shipping_discount; if v_total<=0 then raise exception 'Benefit has no value for this order.'; end if; v_due:=v_gross-v_total;
  if v_campaign.budget_amount is not null and v_campaign.reserved_amount+v_campaign.consumed_amount+v_total>v_campaign.budget_amount then raise exception 'Campaign budget is exhausted.'; end if;
  insert into public.commercial_benefit_reservations(order_id,customer_id,benefit_id,promotion_code_id,grant_id,currency,gross_order_amount,order_discount_amount,shipping_discount_amount,total_benefit_amount,customer_due_amount,funding_source,idempotency_key,request_hash,policy_version)
  values(p_order_id,p_customer_id,v_benefit.id,v_code.id,v_grant.id,v_order.currency,v_gross,v_order_discount,v_shipping_discount,v_total,v_due,v_campaign.funding_source,p_idempotency_key,v_hash,v_campaign.policy_version) returning * into v_row;
  update public.commercial_campaigns set reserved_amount=reserved_amount+v_total,updated_at=now() where id=v_campaign.id;
  if v_grant.id is not null then update public.commercial_grants set status='RESERVED' where id=v_grant.id; end if;
  return jsonb_build_object('id',v_row.id,'reservationToken',v_row.reservation_token,'expiresAt',v_row.expires_at,'grossOrderAmount',v_gross,'orderDiscountAmount',v_order_discount,'shippingDiscountAmount',v_shipping_discount,'totalBenefitAmount',v_total,'customerDueAmount',v_due,'currency',v_row.currency,'fundingSource',v_row.funding_source,'correlationId',v_row.correlation_id);
end $$;

create or replace function public.consume_order_benefit(p_reservation_token uuid,p_customer_id uuid,p_order_id text,p_ledger_transaction_id uuid default null)
returns public.commercial_benefit_redemptions language plpgsql security definer set search_path=public as $$
declare v_res public.commercial_benefit_reservations%rowtype; v_red public.commercial_benefit_redemptions%rowtype; v_campaign_id uuid;
begin
  select * into v_res from public.commercial_benefit_reservations where reservation_token=p_reservation_token and customer_id=p_customer_id and order_id=p_order_id for update;
  if v_res.id is null then raise exception 'Benefit reservation was not found.'; end if;
  select * into v_red from public.commercial_benefit_redemptions where reservation_id=v_res.id; if v_red.id is not null then return v_red; end if;
  if v_res.status<>'RESERVED' or v_res.expires_at<=now() then raise exception 'Benefit reservation is no longer available.'; end if;
  update public.commercial_benefit_reservations set status='CONSUMED',consumed_at=now() where id=v_res.id;
  select campaign_id into v_campaign_id from public.commercial_benefits where id=v_res.benefit_id;
  update public.commercial_campaigns set reserved_amount=reserved_amount-v_res.total_benefit_amount,consumed_amount=consumed_amount+v_res.total_benefit_amount,updated_at=now() where id=v_campaign_id;
  if v_res.grant_id is not null then update public.commercial_grants set status='CONSUMED',remaining_amount=greatest(coalesce(remaining_amount,v_res.total_benefit_amount)-v_res.total_benefit_amount,0) where id=v_res.grant_id; end if;
  insert into public.commercial_benefit_redemptions(reservation_id,order_id,customer_id,amount,currency,funding_source,ledger_transaction_id,correlation_id) values(v_res.id,v_res.order_id,v_res.customer_id,v_res.total_benefit_amount,v_res.currency,v_res.funding_source,p_ledger_transaction_id,v_res.correlation_id) returning * into v_red;
  return v_red;
end $$;

create or replace function public.lock_order_benefit_for_payment(p_reservation_token uuid,p_customer_id uuid,p_order_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_res public.commercial_benefit_reservations%rowtype;
begin
  select * into v_res from public.commercial_benefit_reservations where reservation_token=p_reservation_token and customer_id=p_customer_id and order_id=p_order_id for update;
  if v_res.id is null then raise exception 'Benefit reservation was not found.'; end if;
  if v_res.status<>'RESERVED' or v_res.expires_at<=now() then raise exception 'Benefit reservation is no longer available.'; end if;
  update public.commercial_benefit_reservations set expires_at=greatest(expires_at,now()+interval '24 hours') where id=v_res.id returning * into v_res;
  return jsonb_build_object('id',v_res.id,'status',v_res.status,'expiresAt',v_res.expires_at,'reservationToken',v_res.reservation_token);
end $$;

create or replace function public.expire_commercial_benefit_reservations(p_limit integer default 250)
returns integer language plpgsql security definer set search_path=public as $$
declare v_res public.commercial_benefit_reservations%rowtype; v_campaign uuid; v_count integer:=0;
begin
  for v_res in select * from public.commercial_benefit_reservations where status='RESERVED' and expires_at<=now() order by expires_at for update skip locked limit greatest(1,least(p_limit,1000)) loop
    select campaign_id into v_campaign from public.commercial_benefits where id=v_res.benefit_id;
    update public.commercial_benefit_reservations set status='EXPIRED' where id=v_res.id and status='RESERVED';
    if found then
      update public.commercial_campaigns set reserved_amount=greatest(reserved_amount-v_res.total_benefit_amount,0),updated_at=now() where id=v_campaign;
      if v_res.grant_id is not null then update public.commercial_grants set status=case when expires_at is not null and expires_at<=now() then 'EXPIRED' else 'AVAILABLE' end where id=v_res.grant_id and status='RESERVED'; end if;
      v_count:=v_count+1;
    end if;
  end loop;
  return v_count;
end $$;

create or replace function public.release_order_benefit(p_reservation_id uuid,p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_res public.commercial_benefit_reservations%rowtype; v_campaign uuid;
begin
  select * into v_res from public.commercial_benefit_reservations where id=p_reservation_id and customer_id=p_customer_id for update;
  if v_res.id is null then raise exception 'Benefit reservation was not found.'; end if;
  if v_res.status<>'RESERVED' then return jsonb_build_object('id',v_res.id,'status',v_res.status,'existing',true); end if;
  select campaign_id into v_campaign from public.commercial_benefits where id=v_res.benefit_id;
  update public.commercial_benefit_reservations set status='RELEASED' where id=v_res.id;
  update public.commercial_campaigns set reserved_amount=greatest(reserved_amount-v_res.total_benefit_amount,0),updated_at=now() where id=v_campaign;
  if v_res.grant_id is not null then update public.commercial_grants set status='AVAILABLE' where id=v_res.grant_id and status='RESERVED'; end if;
  return jsonb_build_object('id',v_res.id,'status','RELEASED');
end $$;

create or replace function public.prepare_order_tip(p_order_id text,p_customer_id uuid,p_amount integer,p_currency currency,p_idempotency_key text)
returns public.order_tips language plpgsql security definer set search_path=public,extensions as $$
declare v_order public.orders%rowtype; v_tip public.order_tips%rowtype; v_hash text;
begin
  select * into v_order from public.orders where id=p_order_id; if v_order.id is null or v_order.customer_id<>p_customer_id::text then raise exception 'Order was not found.'; end if;
  if v_order.stage not in ('COMPLETE','DELIVERED','COLLECTED') then raise exception 'Tips become available after completion.'; end if;
  if p_amount<=0 or p_currency<>v_order.currency then raise exception 'Tip amount or currency is invalid.'; end if;
  v_hash:=encode(digest(concat_ws('|',p_order_id,p_customer_id,p_amount,p_currency),'sha256'),'hex');
  select * into v_tip from public.order_tips where idempotency_key=p_idempotency_key or order_id=p_order_id;
  if v_tip.id is not null then if v_tip.request_hash<>v_hash then raise exception 'This order already has a different tip.'; end if; return v_tip; end if;
  insert into public.order_tips(order_id,customer_id,tailor_id,amount,currency,idempotency_key,request_hash) values(p_order_id,p_customer_id,v_order.tailor_id::uuid,p_amount,p_currency,p_idempotency_key,v_hash) returning * into v_tip;
  insert into public.order_tip_events(tip_id,event_type,actor_role,payload,correlation_id) values(v_tip.id,'TIP_PREPARED','CUSTOMER',jsonb_build_object('amount',p_amount,'currency',p_currency),v_tip.correlation_id);
  return v_tip;
end $$;

create or replace function public.ops_prepare_commercial_campaign(
  p_name text,p_funding_source text,p_currency currency,p_budget_amount integer,p_kind text,p_value integer,
  p_maximum_amount integer,p_minimum_order_amount integer,p_code text,p_actor_email text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_campaign uuid; v_benefit uuid;
begin
  if length(trim(p_name))<3 or p_funding_source not in ('DRAPEON','TAILOR','PARTNER') or p_kind not in ('PERCENT_DISCOUNT','FIXED_DISCOUNT','FREE_SHIPPING','CAPPED_SHIPPING','ACCOUNT_GRANT','COMPLIMENTARY_ORDER','GOODWILL_GRANT','CREATOR_CODE') then raise exception 'Campaign details are invalid.'; end if;
  if p_budget_amount is not null and p_budget_amount<=0 then raise exception 'Campaign budget must be positive.'; end if;
  if p_value<0 or (p_kind in ('PERCENT_DISCOUNT','CREATOR_CODE') and p_value>10000) then raise exception 'Benefit value is invalid.'; end if;
  if p_kind not in ('ACCOUNT_GRANT','COMPLIMENTARY_ORDER','GOODWILL_GRANT') and (p_code is null or length(trim(p_code))<3) then raise exception 'A promotion code is required.'; end if;
  insert into public.commercial_campaigns(name,status,funding_source,currency,budget_amount,feature_key,created_by_email)
  values(trim(p_name),'PENDING_APPROVAL',p_funding_source,p_currency,p_budget_amount,'CONTROLLED_CORE',lower(trim(p_actor_email))) returning id into v_campaign;
  insert into public.commercial_benefits(campaign_id,kind,value,maximum_amount,minimum_order_amount,currency)
  values(v_campaign,p_kind,p_value,p_maximum_amount,coalesce(p_minimum_order_amount,0),p_currency) returning id into v_benefit;
  if p_code is not null and length(trim(p_code))>=3 then insert into public.commercial_promotion_codes(benefit_id,code,status) values(v_benefit,upper(trim(p_code)),'ACTIVE'); end if;
  return v_campaign;
end $$;

create or replace function public.ops_activate_commercial_campaign(p_campaign_id uuid,p_actor_email text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_campaign public.commercial_campaigns%rowtype;
begin
  select * into v_campaign from public.commercial_campaigns where id=p_campaign_id for update;
  if v_campaign.id is null or v_campaign.status<>'PENDING_APPROVAL' or v_campaign.feature_key<>'CONTROLLED_CORE' then raise exception 'Campaign is not awaiting controlled activation.'; end if;
  if lower(coalesce(v_campaign.created_by_email,''))=lower(trim(p_actor_email)) then raise exception 'Campaign activation requires a different named operator.'; end if;
  update public.commercial_campaigns set status='ACTIVE',approved_by_email=lower(trim(p_actor_email)),approved_at=now(),updated_at=now() where id=p_campaign_id;
  return jsonb_build_object('id',p_campaign_id,'status','ACTIVE','approvedAt',now());
end $$;

create or replace function public.ops_create_commercial_grant(p_benefit_id uuid,p_user_id uuid,p_amount integer,p_expires_at timestamptz,p_reason text,p_actor_email text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_benefit public.commercial_benefits%rowtype; v_campaign public.commercial_campaigns%rowtype; v_id uuid; v_amount integer;
begin
  select * into v_benefit from public.commercial_benefits where id=p_benefit_id;
  if v_benefit.id is null or v_benefit.kind not in ('ACCOUNT_GRANT','GOODWILL_GRANT','COMPLIMENTARY_ORDER') then raise exception 'Benefit does not support account grants.'; end if;
  select * into v_campaign from public.commercial_campaigns where id=v_benefit.campaign_id;
  if v_campaign.status<>'ACTIVE' or v_campaign.feature_key<>'CONTROLLED_CORE' then raise exception 'Grant campaign is not active.'; end if;
  v_amount:=case when v_benefit.kind='COMPLIMENTARY_ORDER' then null else coalesce(p_amount,v_benefit.value) end;
  if v_amount is not null and v_amount<=0 then raise exception 'Grant amount must be positive.'; end if;
  if length(trim(p_reason))<12 then raise exception 'Grant reason must include reviewed evidence.'; end if;
  insert into public.commercial_grants(benefit_id,user_id,original_amount,remaining_amount,currency,expires_at,reason,created_by,created_by_email)
  values(v_benefit.id,p_user_id,v_amount,v_amount,coalesce(v_benefit.currency,v_campaign.currency),p_expires_at,trim(p_reason),null,lower(trim(p_actor_email))) returning id into v_id;
  return v_id;
end $$;

create or replace view public.commercial_benefit_reporting as
select c.id campaign_id,c.name,c.status,c.funding_source,c.currency,c.budget_amount,c.reserved_amount,c.consumed_amount,
  (array_agg(distinct b.id) filter(where b.id is not null))[1] benefit_id,
  coalesce(count(distinct r.id),0)::bigint redemption_count,coalesce(sum(r.amount) filter(where r.status<>'REVERSED'),0)::bigint redeemed_amount,
  coalesce(count(distinct r.id) filter(where r.status='REVERSED'),0)::bigint reversal_count
from public.commercial_campaigns c left join public.commercial_benefits b on b.campaign_id=c.id left join public.commercial_benefit_reservations x on x.benefit_id=b.id left join public.commercial_benefit_redemptions r on r.reservation_id=x.id group by c.id;

create or replace view public.commercial_tip_reporting as
select currency,status,count(*)::bigint tip_count,coalesce(sum(amount),0)::bigint tip_amount,
  min(created_at) oldest_created_at,max(updated_at) latest_updated_at
from public.order_tips group by currency,status;

create or replace view public.commercial_delivery_outcome_reporting as
select e.metadata->>'source' source,j.job_type,j.status,count(*)::bigint outcome_count,
  min(j.created_at) oldest_created_at,max(j.updated_at) latest_updated_at
from public.job_queue j join public.domain_events e on e.id=j.event_id
where e.metadata->>'source' in ('tip-confirmation','release-order-tip')
group by e.metadata->>'source',j.job_type,j.status;

alter table public.commercial_campaigns enable row level security; alter table public.commercial_benefits enable row level security; alter table public.commercial_promotion_codes enable row level security; alter table public.commercial_grants enable row level security; alter table public.commercial_benefit_reservations enable row level security; alter table public.commercial_benefit_redemptions enable row level security; alter table public.order_tips enable row level security; alter table public.order_tip_events enable row level security;
create policy commercial_grants_owner_read on public.commercial_grants for select to authenticated using(user_id=auth.uid());
create policy commercial_reservations_owner_read on public.commercial_benefit_reservations for select to authenticated using(customer_id=auth.uid());
create policy commercial_redemptions_owner_read on public.commercial_benefit_redemptions for select to authenticated using(customer_id=auth.uid());
create policy order_tips_parties_read on public.order_tips for select to authenticated using(customer_id=auth.uid() or tailor_id=auth.uid());
create policy order_tip_events_parties_read on public.order_tip_events for select to authenticated using(exists(select 1 from public.order_tips t where t.id=tip_id and (t.customer_id=auth.uid() or t.tailor_id=auth.uid())));
revoke all on public.commercial_campaigns,public.commercial_benefits,public.commercial_promotion_codes,public.commercial_grants,public.commercial_benefit_reservations,public.commercial_benefit_redemptions,public.order_tips,public.order_tip_events from anon,authenticated;
grant select on public.commercial_grants,public.commercial_benefit_reservations,public.commercial_benefit_redemptions,public.order_tips,public.order_tip_events to authenticated;
grant all on public.commercial_campaigns,public.commercial_benefits,public.commercial_promotion_codes,public.commercial_grants,public.commercial_benefit_reservations,public.commercial_benefit_redemptions,public.order_tips,public.order_tip_events to service_role;
revoke all on function public.reserve_order_benefit(text,uuid,text,uuid,text),public.consume_order_benefit(uuid,uuid,text,uuid),public.lock_order_benefit_for_payment(uuid,uuid,text),public.expire_commercial_benefit_reservations(integer),public.release_order_benefit(uuid,uuid),public.prepare_order_tip(text,uuid,integer,currency,text),public.ops_prepare_commercial_campaign(text,text,currency,integer,text,integer,integer,integer,text,text),public.ops_activate_commercial_campaign(uuid,text),public.ops_create_commercial_grant(uuid,uuid,integer,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.reserve_order_benefit(text,uuid,text,uuid,text),public.consume_order_benefit(uuid,uuid,text,uuid),public.lock_order_benefit_for_payment(uuid,uuid,text),public.expire_commercial_benefit_reservations(integer),public.release_order_benefit(uuid,uuid),public.prepare_order_tip(text,uuid,integer,currency,text),public.ops_prepare_commercial_campaign(text,text,currency,integer,text,integer,integer,integer,text,text),public.ops_activate_commercial_campaign(uuid,text),public.ops_create_commercial_grant(uuid,uuid,integer,timestamptz,text,text) to service_role;

do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname='expire-commercial-benefits';
    perform cron.schedule('expire-commercial-benefits','*/5 * * * *',$job$select public.expire_commercial_benefit_reservations(250);$job$);
  end if;
end $$;
