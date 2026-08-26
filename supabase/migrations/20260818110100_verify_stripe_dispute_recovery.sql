do $$
begin
  if to_regclass('public.provider_disputes') is null then
    raise exception 'provider_disputes was not created';
  end if;
  if to_regclass('public.provider_transfer_reversals') is null then
    raise exception 'provider_transfer_reversals was not created';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'provider_disputes'
      and policyname = 'provider_disputes_parties_read'
  ) then
    raise exception 'provider dispute party-read policy is missing';
  end if;
  if exists (
    select 1
    from (values
      ('provider_disputes'),
      ('order_settlement_plans'),
      ('order_settlement_tranches')
    ) expected(tablename)
    where not exists (
      select 1
      from pg_publication_tables published
      where published.pubname = 'supabase_realtime'
        and published.schemaname = 'public'
        and published.tablename = expected.tablename
    )
  ) then
    raise exception 'provider dispute and settlement realtime publication is incomplete';
  end if;
end $$;
