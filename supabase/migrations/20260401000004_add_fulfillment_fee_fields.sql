alter table tailor_profiles
  add column if not exists delivery_fee integer not null default 0,
  add column if not exists shipping_fee integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tailor_profiles_delivery_fee_nonnegative'
  ) then
    alter table tailor_profiles
      add constraint tailor_profiles_delivery_fee_nonnegative
      check (delivery_fee >= 0);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tailor_profiles_shipping_fee_nonnegative'
  ) then
    alter table tailor_profiles
      add constraint tailor_profiles_shipping_fee_nonnegative
      check (shipping_fee >= 0);
  end if;
end
$$;

alter table orders
  add column if not exists fulfillment_fee integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_fulfillment_fee_nonnegative'
  ) then
    alter table orders
      add constraint orders_fulfillment_fee_nonnegative
      check (fulfillment_fee >= 0);
  end if;
end
$$;

comment on column tailor_profiles.delivery_fee is 'Default local delivery fee in minor currency units.';
comment on column tailor_profiles.shipping_fee is 'Default shipping fee in minor currency units.';
comment on column orders.fulfillment_fee is 'Fulfillment fee snapshot in minor currency units for the selected delivery method.';
