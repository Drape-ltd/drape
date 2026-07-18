alter table public.tailor_profiles
  add column if not exists accepts_custom_orders_now boolean not null default true,
  add column if not exists shop_paused boolean not null default false;

update public.tailor_profiles
set accepts_custom_orders_now = false
where availability = 'FULLY_BOOKED';

create index if not exists tailor_profiles_accepts_custom_orders_now_idx
  on public.tailor_profiles (accepts_custom_orders_now);

create index if not exists tailor_profiles_shop_paused_idx
  on public.tailor_profiles (shop_paused);
