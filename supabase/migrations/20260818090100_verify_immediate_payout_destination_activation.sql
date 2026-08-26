do $$
declare
  v_profile_id public.tailor_profiles.id%type;
begin
  if exists (
    select 1 from public.tailor_profiles
    where payout_destination_hold_until is not null
  ) then
    raise exception 'Legacy payout destination holds were not cleared.';
  end if;

  select id into v_profile_id from public.tailor_profiles limit 1;
  if v_profile_id is not null then
    update public.tailor_profiles
    set payout_destination_hold_until = now() + interval '72 hours'
    where id = v_profile_id;

    if exists (
      select 1 from public.tailor_profiles
      where id = v_profile_id and payout_destination_hold_until is not null
    ) then
      raise exception 'Database guard allowed a payout destination release hold.';
    end if;
  end if;
end;
$$;
