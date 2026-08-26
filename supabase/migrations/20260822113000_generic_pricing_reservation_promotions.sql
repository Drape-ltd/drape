-- Generic (non-funded) checkout reservations must preserve the same promotion
-- equation as funded-fabric checkout: customer due plus the disclosed benefit
-- equals the locked subtotal, fees, tax, and fulfillment components.

create or replace function public.create_commercial_pricing_reservation(
  p_idempotency_key text,
  p_customer_id uuid,
  p_order_id text,
  p_quote_id uuid,
  p_purpose text,
  p_currency currency,
  p_subtotal_amount integer,
  p_platform_fee_amount integer,
  p_tax_amount integer,
  p_shipping_amount integer,
  p_total_amount integer,
  p_tax_jurisdiction text,
  p_tax_source text,
  p_tax_fallback boolean,
  p_breakdown jsonb default '{}'::jsonb,
  p_correlation_id uuid default gen_random_uuid(),
  p_expires_at timestamptz default now() + interval '15 minutes'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_request_hash text;
  v_row public.commercial_pricing_reservations%rowtype;
  v_promotion_amount integer;
begin
  if nullif(trim(p_idempotency_key), '') is null then
    raise exception 'Pricing reservation idempotency key is required.';
  end if;
  if p_subtotal_amount < 0 or p_platform_fee_amount < 0 or p_tax_amount < 0 or p_shipping_amount < 0 then
    raise exception 'Pricing amounts must be non-negative minor units.';
  end if;

  begin
    v_promotion_amount := coalesce((p_breakdown->>'promotionAmount')::integer, 0);
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Promotion amount must be a non-negative integer in minor units.';
  end;
  if v_promotion_amount < 0 then
    raise exception 'Promotion amount must be a non-negative integer in minor units.';
  end if;
  if p_total_amount + v_promotion_amount <>
      p_subtotal_amount + p_platform_fee_amount + p_tax_amount + p_shipping_amount then
    raise exception 'Pricing total does not equal its locked components after promotion.';
  end if;
  if coalesce(p_tax_fallback, false) then
    raise exception 'A fallback tax result cannot be reserved for checkout.';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '30 minutes' then
    raise exception 'Pricing reservation expiry must be within 30 minutes.';
  end if;

  v_request_hash := encode(digest(concat_ws('|',
    p_customer_id::text, coalesce(p_order_id, ''), coalesce(p_quote_id::text, ''), p_purpose,
    p_currency::text, p_subtotal_amount::text, p_platform_fee_amount::text,
    p_tax_amount::text, p_shipping_amount::text, p_total_amount::text,
    coalesce(p_tax_jurisdiction, ''), p_tax_source, p_tax_fallback::text,
    coalesce(p_breakdown, '{}'::jsonb)::text
  ), 'sha256'), 'hex');

  insert into public.commercial_pricing_reservations (
    idempotency_key, request_hash, customer_id, order_id, quote_id, purpose, currency,
    subtotal_amount, platform_fee_amount, tax_amount, shipping_amount, total_amount,
    tax_jurisdiction, tax_source, tax_fallback, breakdown, correlation_id, expires_at
  ) values (
    p_idempotency_key, v_request_hash, p_customer_id, p_order_id, p_quote_id, p_purpose, p_currency,
    p_subtotal_amount, p_platform_fee_amount, p_tax_amount, p_shipping_amount, p_total_amount,
    p_tax_jurisdiction, p_tax_source, coalesce(p_tax_fallback, false), coalesce(p_breakdown, '{}'::jsonb),
    p_correlation_id, p_expires_at
  )
  on conflict (idempotency_key) do nothing;

  select * into v_row
  from public.commercial_pricing_reservations
  where idempotency_key = p_idempotency_key;

  if v_row.request_hash <> v_request_hash then
    raise exception 'Pricing idempotency key was reused with different values.';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'reservationToken', v_row.reservation_token,
    'expiresAt', v_row.expires_at,
    'correlationId', v_row.correlation_id,
    'pricingVersion', v_row.pricing_version,
    'policyVersion', v_row.policy_version
  );
end;
$$;

revoke all on function public.create_commercial_pricing_reservation(
  text, uuid, text, uuid, text, currency, integer, integer, integer, integer,
  integer, text, text, boolean, jsonb, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_commercial_pricing_reservation(
  text, uuid, text, uuid, text, currency, integer, integer, integer, integer,
  integer, text, text, boolean, jsonb, uuid, timestamptz
) to service_role;
