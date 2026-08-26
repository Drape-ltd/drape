do $$
begin
  if to_regclass('public.custom_order_brief_drafts') is null then
    raise exception 'custom_order_brief_drafts table is missing';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'custom_order_brief_drafts' and c.relrowsecurity
  ) then
    raise exception 'custom_order_brief_drafts RLS is not enabled';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'custom_order_brief_drafts'
      and policyname = 'customers read own custom order drafts'
  ) then
    raise exception 'custom-order draft owner policy is missing';
  end if;
end $$;
