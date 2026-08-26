-- Let either party offer a small set of concrete consultation times while one
-- protected reschedule request remains authoritative.

alter table public.consultation_reschedule_requests
  add column if not exists proposed_start_options timestamptz[],
  add column if not exists accepted_start_at timestamptz;

update public.consultation_reschedule_requests
set proposed_start_options = array[proposed_start_at]
where proposed_start_options is null or cardinality(proposed_start_options) = 0;

alter table public.consultation_reschedule_requests
  alter column proposed_start_options set not null,
  add constraint consultation_reschedule_option_count_check check (
    cardinality(proposed_start_options) between 1 and 3
  ),
  add constraint consultation_reschedule_accepted_option_check check (
    accepted_start_at is null or accepted_start_at = any(proposed_start_options)
  );

comment on column public.consultation_reschedule_requests.proposed_start_options is
  'One to three concrete start times offered to the counterparty in their local timezone.';

comment on column public.consultation_reschedule_requests.accepted_start_at is
  'The exact offered time accepted by the counterparty.';
