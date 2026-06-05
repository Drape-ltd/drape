alter table if exists public.payouts
  alter column id set default gen_random_uuid();
