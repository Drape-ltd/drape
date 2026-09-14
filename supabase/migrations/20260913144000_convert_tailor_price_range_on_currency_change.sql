-- Account currency changes preserve immutable order currencies while converting
-- the tailor's public price guide instead of relabelling the same minor units.

create or replace function public.update_account_currency_with_price_conversion(
  p_user_id uuid,
  p_role text,
  p_currency public.currency,
  p_source text default 'USER_SELECTED',
  p_region_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user public.users%rowtype;
  v_profile public.tailor_profiles%rowtype;
  v_previous_currency public.currency;
  v_from_rate numeric;
  v_to_rate numeric;
  v_price_min integer;
  v_price_max integer;
  v_now timestamptz := now();
begin
  if upper(trim(coalesce(p_role, ''))) not in ('CUSTOMER', 'TAILOR') then
    raise exception 'A valid account role is required.' using errcode = '22023';
  end if;

  select * into v_user
  from public.users
  where id = p_user_id
  for update;

  if v_user.id is null or upper(v_user.role::text) <> upper(trim(p_role)) then
    raise exception 'This profile does not match the active account role.' using errcode = '42501';
  end if;

  if upper(trim(p_role)) = 'TAILOR' then
    select * into v_profile
    from public.tailor_profiles
    where user_id = p_user_id
    for update;

    if v_profile.id is null then
      raise exception 'The tailor profile could not be loaded.' using errcode = 'P0001';
    end if;

    v_previous_currency := coalesce(v_profile.currency, v_user.default_currency, 'USD'::public.currency);
    v_from_rate := case v_previous_currency
      when 'USD' then 1 when 'GBP' then 0.79 when 'EUR' then 0.92
      when 'NGN' then 1580 when 'GHS' then 15.6 when 'KES' then 129
      when 'CAD' then 1.36 else 1 end;
    v_to_rate := case p_currency
      when 'USD' then 1 when 'GBP' then 0.79 when 'EUR' then 0.92
      when 'NGN' then 1580 when 'GHS' then 15.6 when 'KES' then 129
      when 'CAD' then 1.36 else 1 end;

    v_price_min := case when v_profile.price_range_min is null then null
      else greatest(1, round((v_profile.price_range_min::numeric / v_from_rate) * v_to_rate)::integer) end;
    v_price_max := case when v_profile.price_range_max is null then null
      else greatest(1, round((v_profile.price_range_max::numeric / v_from_rate) * v_to_rate)::integer) end;

    update public.tailor_profiles
    set currency = p_currency,
        price_range_min = v_price_min,
        price_range_max = v_price_max,
        updated_at = v_now
    where id = v_profile.id;
  end if;

  update public.users
  set default_currency = p_currency,
      currency_source = upper(trim(coalesce(nullif(p_source, ''), 'USER_SELECTED'))),
      region_code = coalesce(nullif(upper(trim(coalesce(p_region_code, ''))), ''), region_code),
      currency_confirmed_at = v_now,
      updated_at = v_now
  where id = p_user_id;

  return jsonb_build_object(
    'currency', p_currency,
    'previousCurrency', coalesce(v_previous_currency, v_user.default_currency, p_currency),
    'priceRangeConverted', upper(trim(p_role)) = 'TAILOR' and v_previous_currency is distinct from p_currency,
    'priceRangeMin', v_price_min,
    'priceRangeMax', v_price_max,
    'historicalRecordsChanged', false
  );
end;
$$;

revoke all on function public.update_account_currency_with_price_conversion(uuid,text,public.currency,text,text)
  from public, anon, authenticated;
grant execute on function public.update_account_currency_with_price_conversion(uuid,text,public.currency,text,text)
  to service_role;

comment on function public.update_account_currency_with_price_conversion(uuid,text,public.currency,text,text) is
  'Atomically updates account/storefront currency and converts the public tailor price guide with Drapeon reference rates; historical orders, payments, earnings, and payout destinations remain unchanged.';
