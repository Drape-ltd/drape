-- Consultation profile fields were added after tailor_profiles was restricted
-- with column-level grants. PostgREST rejects an entire SELECT when even one
-- selected column is missing permission, which prevented authenticated tailors
-- from opening the profile and fulfillment editor.

grant select (
  consultation_mode,
  consultation_requirement,
  consultation_fee_amount,
  consultation_currency,
  consultation_duration_minutes,
  consultation_call_type,
  consultation_fee_creditable,
  consultation_policy_version,
  consultation_policy_published_at
) on table public.tailor_profiles to authenticated;
grant update (
  consultation_mode,
  consultation_requirement,
  consultation_fee_amount,
  consultation_currency,
  consultation_duration_minutes,
  consultation_call_type,
  consultation_fee_creditable,
  consultation_policy_version,
  consultation_policy_published_at
) on table public.tailor_profiles to authenticated;
