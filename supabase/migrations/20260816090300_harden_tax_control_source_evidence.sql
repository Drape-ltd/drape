-- Reviewed controls require real HTTPS source references, not merely a
-- non-empty array placeholder.

create or replace function public.valid_reviewed_tax_source_urls(p_urls text[])
returns boolean language plpgsql immutable strict as $$
declare v_url text;
begin
  if cardinality(p_urls) = 0 then return false; end if;
  foreach v_url in array p_urls loop
    if nullif(trim(v_url), '') is null or v_url !~ '^https://[^[:space:]]+$' then return false; end if;
  end loop;
  return true;
end;
$$;

alter table public.tax_policy_versions
  add constraint tax_policy_versions_valid_sources check (public.valid_reviewed_tax_source_urls(source_urls));
alter table public.tax_registration_controls
  add constraint tax_registration_controls_valid_sources check (public.valid_reviewed_tax_source_urls(source_urls));
alter table public.tax_responsibility_controls
  add constraint tax_responsibility_controls_valid_sources check (public.valid_reviewed_tax_source_urls(source_urls));
alter table public.tax_corridor_controls
  add constraint tax_corridor_controls_valid_sources check (public.valid_reviewed_tax_source_urls(source_urls));

revoke all on function public.valid_reviewed_tax_source_urls(text[]) from public, anon, authenticated;
grant execute on function public.valid_reviewed_tax_source_urls(text[]) to service_role;
