do $$
declare
  required_column text;
begin
  foreach required_column in array array[
    'consultation_mode',
    'consultation_requirement',
    'consultation_fee_amount',
    'consultation_currency',
    'consultation_duration_minutes',
    'consultation_call_type',
    'consultation_fee_creditable',
    'consultation_policy_version',
    'consultation_policy_published_at'
  ] loop
    if not has_column_privilege('authenticated', 'public.tailor_profiles', required_column, 'SELECT') then
      raise exception 'authenticated is missing SELECT on tailor_profiles.%', required_column;
    end if;
    if not has_column_privilege('authenticated', 'public.tailor_profiles', required_column, 'UPDATE') then
      raise exception 'authenticated is missing UPDATE on tailor_profiles.%', required_column;
    end if;
  end loop;
end $$;
