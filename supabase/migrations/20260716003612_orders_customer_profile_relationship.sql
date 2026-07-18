-- Let PostgREST resolve orders -> customer_profiles embeds without relying on
-- app-side fallback joins. NOT VALID keeps legacy dev rows from blocking deploys.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_customer_profiles_customer_id_fkey'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_customer_profiles_customer_id_fkey
      foreign key (customer_id)
      references public.customer_profiles(user_id)
      on delete cascade
      not valid;
  end if;
end $$;

notify pgrst, 'reload schema';
