-- Credits are display/allocation facts, not hidden mutations of the accepted
-- quote. Promotions reduce customer due; consultation credit already reduced
-- the tailoring subtotal before capture.
do $$
declare v_constraint text;
begin
  select conname into v_constraint from pg_constraint
  where conrelid='public.commercial_pricing_reservations'::regclass
    and contype='c' and pg_get_constraintdef(oid) like '%total_amount =%subtotal_amount%'
  limit 1;
  if v_constraint is not null then
    execute format('alter table public.commercial_pricing_reservations drop constraint %I',v_constraint);
  end if;
end;
$$;
alter table public.commercial_pricing_reservations drop constraint if exists commercial_pricing_exact_total_v2;
alter table public.commercial_pricing_reservations add constraint commercial_pricing_exact_total_v2 check (
  total_amount + greatest(coalesce((breakdown->>'promotionAmount')::integer,0),0)
    = subtotal_amount + platform_fee_amount + tax_amount + shipping_amount
);

alter table public.commercial_receipts drop constraint if exists commercial_receipt_exact_total;
alter table public.commercial_receipts add constraint commercial_receipt_exact_total check (
  total_amount + promotion_amount = subtotal_amount + platform_fee_amount + tax_amount + shipping_amount
);
alter table public.commercial_receipts drop constraint if exists commercial_receipt_credit_bounds;
alter table public.commercial_receipts add constraint commercial_receipt_credit_bounds check (
  promotion_amount <= subtotal_amount + platform_fee_amount + tax_amount + shipping_amount
);

create or replace function public.create_funded_commercial_pricing_reservation(
  p_idempotency_key text, p_customer_id uuid, p_order_id text, p_quote_id uuid,
  p_purpose text, p_currency currency, p_subtotal_amount integer,
  p_platform_fee_amount integer, p_tax_amount integer, p_shipping_amount integer,
  p_total_amount integer, p_tax_jurisdiction text, p_tax_source text,
  p_tax_fallback boolean, p_breakdown jsonb, p_correlation_id uuid,
  p_fabric_funding_policy_version text, p_fabric_source_snapshot text,
  p_tailoring_amount integer, p_fabric_allowance_amount integer,
  p_fabric_allowance_coverage jsonb, p_fabric_sourcing_assumptions text,
  p_expires_at timestamptz default now() + interval '15 minutes'
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_request_hash text; v_row public.commercial_pricing_reservations%rowtype;
  v_quote public.order_quotes%rowtype; v_promotion integer;
begin
  select * into v_quote from public.order_quotes where id=p_quote_id and order_id::text=p_order_id and status='ACCEPTED';
  if v_quote.id is null then raise exception 'ACCEPTED_FUNDED_QUOTE_REQUIRED'; end if;
  if p_fabric_funding_policy_version <> 'fabric-funding-2026-08-01-v1'
    or v_quote.fabric_funding_policy_version <> p_fabric_funding_policy_version
    or v_quote.fabric_source_snapshot <> p_fabric_source_snapshot
    or v_quote.tailoring_amount <> p_tailoring_amount
    or v_quote.fabric_allowance_amount <> p_fabric_allowance_amount
    or v_quote.fabric_allowance_coverage is distinct from p_fabric_allowance_coverage
    or v_quote.fabric_sourcing_assumptions is distinct from p_fabric_sourcing_assumptions then
    raise exception 'FUNDED_PRICING_QUOTE_MISMATCH';
  end if;
  v_promotion:=greatest(coalesce((p_breakdown->>'promotionAmount')::integer,0),0);
  if p_total_amount + v_promotion <> p_subtotal_amount+p_platform_fee_amount+p_tax_amount+p_shipping_amount then
    raise exception 'Pricing total does not equal its locked components after promotion.';
  end if;
  if coalesce(p_tax_fallback,false) then raise exception 'A fallback tax result cannot be reserved for checkout.'; end if;
  v_request_hash:=encode(digest(concat_ws('|',p_customer_id::text,p_order_id,p_quote_id::text,p_purpose,
    p_currency::text,p_subtotal_amount,p_platform_fee_amount,p_tax_amount,p_shipping_amount,p_total_amount,
    coalesce(p_tax_jurisdiction,''),p_tax_source,p_tax_fallback::text,coalesce(p_breakdown,'{}'::jsonb)::text,
    p_fabric_funding_policy_version,p_fabric_source_snapshot,p_tailoring_amount,p_fabric_allowance_amount,
    p_fabric_allowance_coverage::text,p_fabric_sourcing_assumptions),'sha256'),'hex');
  insert into public.commercial_pricing_reservations (
    idempotency_key,request_hash,customer_id,order_id,quote_id,purpose,currency,subtotal_amount,
    platform_fee_amount,tax_amount,shipping_amount,total_amount,tax_jurisdiction,tax_source,tax_fallback,
    breakdown,correlation_id,expires_at,fabric_funding_policy_version,fabric_source_snapshot,
    tailoring_amount,fabric_allowance_amount,fabric_allowance_coverage,fabric_sourcing_assumptions
  ) values (
    p_idempotency_key,v_request_hash,p_customer_id,p_order_id,p_quote_id,p_purpose,p_currency,p_subtotal_amount,
    p_platform_fee_amount,p_tax_amount,p_shipping_amount,p_total_amount,p_tax_jurisdiction,p_tax_source,false,
    coalesce(p_breakdown,'{}'::jsonb),p_correlation_id,p_expires_at,p_fabric_funding_policy_version,
    p_fabric_source_snapshot,p_tailoring_amount,p_fabric_allowance_amount,p_fabric_allowance_coverage,
    p_fabric_sourcing_assumptions
  ) on conflict(idempotency_key) do nothing;
  select * into v_row from public.commercial_pricing_reservations where idempotency_key=p_idempotency_key;
  if v_row.request_hash <> v_request_hash then raise exception 'Pricing idempotency key was reused with different values.'; end if;
  return jsonb_build_object('id',v_row.id,'reservationToken',v_row.reservation_token,'expiresAt',v_row.expires_at,
    'correlationId',v_row.correlation_id,'pricingVersion',v_row.pricing_version,'policyVersion',v_row.policy_version);
end;
$$;
