-- Drape V1 - keep profile completion stable across legacy review statuses.
--
-- Some dev/test rows still carry APPROVED from the older verification flow.
-- Any later tailor_profiles update, including payout account updates, fires the
-- completion trigger. Without APPROVED compatibility those rows can be
-- recomputed as incomplete and the mobile route guard sends the tailor back to
-- setup even though no setup action happened.

create or replace function public.compute_tailor_profile_completed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.profile_completed := (
    new.display_name is not null and trim(new.display_name) <> '' and
    new.location is not null and trim(new.location) <> '' and
    new.id_verification_status in ('PENDING', 'VERIFIED', 'APPROVED')
  );
  return new;
end;
$$;

update public.tailor_profiles
set profile_completed = (
  display_name is not null and trim(display_name) <> '' and
  location is not null and trim(location) <> '' and
  id_verification_status in ('PENDING', 'VERIFIED', 'APPROVED')
)
where profile_completed is distinct from (
  display_name is not null and trim(display_name) <> '' and
  location is not null and trim(location) <> '' and
  id_verification_status in ('PENDING', 'VERIFIED', 'APPROVED')
);
