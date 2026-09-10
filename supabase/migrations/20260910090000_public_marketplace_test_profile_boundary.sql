alter table public.tailor_profiles
  add column if not exists is_test_profile boolean not null default false;

comment on column public.tailor_profiles.is_test_profile is
  'Service-managed marker for disposable QA and provider fixtures. Test profiles remain usable in authenticated QA flows but are never eligible for public marketplace reads.';

update public.tailor_profiles
set is_test_profile = true
where display_name in ('Stripe QA Atelier', 'Web QA Tailor', 'Signup QA Tailor')
   or business_name ilike 'Web QA Tailor %';

create index if not exists tailor_profiles_public_marketplace_idx
  on public.tailor_profiles (ranking_score desc nulls last, avg_rating desc nulls last)
  where is_live = true and is_verified = true and is_test_profile = false;

create or replace function public.guard_tailor_test_profile_marker()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    if tg_op = 'INSERT' and new.is_test_profile then
      raise exception 'Only Drapeon services can mark a profile as a test fixture.';
    end if;
    if tg_op = 'UPDATE' and new.is_test_profile is distinct from old.is_test_profile then
      raise exception 'Only Drapeon services can change the test-profile marker.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_tailor_test_profile_marker on public.tailor_profiles;
create trigger trg_guard_tailor_test_profile_marker
before insert or update of is_test_profile on public.tailor_profiles
for each row execute function public.guard_tailor_test_profile_marker();

drop policy if exists "Public can view live tailor profiles" on public.tailor_profiles;
create policy "Public can view live tailor profiles"
  on public.tailor_profiles for select
  using (is_live = true and is_verified = true and is_test_profile = false);

drop policy if exists "Public views portfolio of live tailors" on public.portfolio_photos;
create policy "Public views portfolio of live tailors"
  on public.portfolio_photos for select
  using (
    exists (
      select 1
      from public.tailor_profiles tp
      where tp.id = portfolio_photos.tailor_profile_id
        and tp.is_live = true
        and tp.is_verified = true
        and tp.is_test_profile = false
    )
  );

drop policy if exists "public: view live portfolio" on public.portfolio_items;
create policy "public: view live portfolio"
  on public.portfolio_items for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.tailor_profiles tp
      where tp.id = portfolio_items.tailor_profile_id
        and tp.is_live = true
        and tp.is_verified = true
        and tp.is_test_profile = false
    )
  );

drop policy if exists "public reads live seller items" on public.seller_items;
create policy "public reads live seller items"
  on public.seller_items for select
  using (
    is_live = true
    and exists (
      select 1
      from public.tailor_profiles tp
      where tp.id = seller_items.tailor_profile_id
        and tp.is_live = true
        and tp.is_verified = true
        and tp.is_test_profile = false
    )
  );

grant select (is_test_profile) on public.tailor_profiles to authenticated;
revoke all on function public.guard_tailor_test_profile_marker() from public;
grant execute on function public.guard_tailor_test_profile_marker() to service_role;
