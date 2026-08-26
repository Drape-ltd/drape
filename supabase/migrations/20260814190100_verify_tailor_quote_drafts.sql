do $$
begin
  if to_regclass('public.tailor_quote_drafts') is null then
    raise exception 'tailor_quote_drafts table is missing';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tailor_quote_drafts'
      and policyname = 'tailors read own quote drafts'
  ) then
    raise exception 'tailor quote draft read policy is missing';
  end if;
end $$;
