-- Drapeon commercial architecture, implementation 5.
-- Publishes tailor consultation terms, snapshots them onto each booking, and
-- turns Daily join/leave metadata into reviewable attendance evidence.

alter table public.tailor_profiles
  add column if not exists consultation_mode text not null default 'FREE',
  add column if not exists consultation_requirement text not null default 'OPTIONAL',
  add column if not exists consultation_fee_amount integer,
  add column if not exists consultation_currency currency,
  add column if not exists consultation_duration_minutes integer not null default 30,
  add column if not exists consultation_call_type text not null default 'VIDEO',
  add column if not exists consultation_fee_creditable boolean not null default false,
  add column if not exists consultation_policy_version text not null default 'consultation-2026-07-31-v1',
  add column if not exists consultation_policy_published_at timestamptz;

alter table public.tailor_profiles
  add constraint tailor_profiles_consultation_mode_check
    check (consultation_mode in ('UNAVAILABLE', 'FREE', 'PAID')),
  add constraint tailor_profiles_consultation_requirement_check
    check (consultation_requirement in ('OPTIONAL', 'REQUIRED')),
  add constraint tailor_profiles_consultation_duration_check
    check (consultation_duration_minutes in (15, 30, 45, 60)),
  add constraint tailor_profiles_consultation_call_type_check
    check (consultation_call_type in ('AUDIO', 'VIDEO', 'AUDIO_OR_VIDEO')),
  add constraint tailor_profiles_consultation_money_check
    check (
      (consultation_mode = 'PAID' and consultation_fee_amount > 0 and consultation_currency is not null)
      or (consultation_mode <> 'PAID' and consultation_fee_amount is null)
    ),
  add constraint tailor_profiles_consultation_credit_check
    check (not consultation_fee_creditable or consultation_mode = 'PAID');

update public.tailor_profiles
set consultation_policy_published_at = coalesce(consultation_policy_published_at, updated_at, created_at)
where consultation_policy_published_at is null;

alter table public.consultation_bookings
  add column if not exists policy_version text not null default 'consultation-2026-07-31-v1',
  add column if not exists fee_mode text not null default 'FREE',
  add column if not exists fee_amount integer,
  add column if not exists fee_currency currency,
  add column if not exists fee_creditable boolean not null default false,
  add column if not exists payment_status text not null default 'NOT_REQUIRED',
  add column if not exists paid_at timestamptz,
  add column if not exists cancellation_policy jsonb not null default '{"moreThan24Hours":"FULL_REFUND","inside24Hours":"FIFTY_PERCENT_REFUND","tailorCancellation":"FULL_REFUND","providerFailure":"FULL_REFUND_OR_RESCHEDULE"}'::jsonb,
  add column if not exists attendance_policy jsonb not null default '{"graceMinutes":10,"claimantWaitMinutes":15,"attendedOverlapMinutes":5,"contestWindowHours":24}'::jsonb,
  add column if not exists commercial_snapshot_locked_at timestamptz;

update public.consultation_bookings booking
set fee_mode = case when coalesce(order_record.consultation_fee, 0) > 0 then 'PAID' else 'FREE' end,
    fee_amount = case when coalesce(order_record.consultation_fee, 0) > 0 then order_record.consultation_fee else null end,
    fee_currency = case when coalesce(order_record.consultation_fee, 0) > 0 then order_record.currency else null end,
    payment_status = case when coalesce(order_record.consultation_fee, 0) > 0 then 'PENDING' else 'NOT_REQUIRED' end,
    commercial_snapshot_locked_at = coalesce(booking.commercial_snapshot_locked_at, booking.confirmed_at, booking.created_at)
from public.orders order_record
where order_record.id = booking.order_id
  and booking.commercial_snapshot_locked_at is null;

alter table public.consultation_bookings
  add constraint consultation_bookings_fee_mode_check check (fee_mode in ('FREE', 'PAID')),
  add constraint consultation_bookings_fee_money_check check (
    (fee_mode = 'PAID' and fee_amount > 0 and fee_currency is not null)
    or (fee_mode = 'FREE' and fee_amount is null)
  ),
  add constraint consultation_bookings_payment_status_check check (
    payment_status in ('NOT_REQUIRED', 'PENDING', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED', 'FAILED')
  ),
  add constraint consultation_bookings_fee_credit_check check (not fee_creditable or fee_mode = 'PAID');

alter table public.order_call_rooms
  add column if not exists consultation_booking_id uuid references public.consultation_bookings(id) on delete set null;

create index if not exists order_call_rooms_consultation_booking_idx
  on public.order_call_rooms(consultation_booking_id, created_at desc)
  where consultation_booking_id is not null;

create table public.consultation_attendance_evidence (
  booking_id uuid primary key references public.consultation_bookings(id) on delete restrict,
  order_id text not null references public.orders(id) on delete restrict,
  provider text not null default 'DAILY' check (provider = 'DAILY'),
  provider_evidence_complete boolean not null default false,
  customer_verified_seconds integer not null default 0 check (customer_verified_seconds >= 0),
  tailor_verified_seconds integer not null default 0 check (tailor_verified_seconds >= 0),
  verified_overlap_seconds integer not null default 0 check (verified_overlap_seconds >= 0),
  customer_waited_through_deadline boolean not null default false,
  tailor_waited_through_deadline boolean not null default false,
  customer_late_visit boolean not null default false,
  tailor_late_visit boolean not null default false,
  derived_outcome text not null default 'PENDING_WINDOW' check (derived_outcome in (
    'PENDING_WINDOW', 'ATTENDED', 'CUSTOMER_NO_SHOW_ELIGIBLE', 'TAILOR_NO_SHOW_ELIGIBLE',
    'CONNECTION_OR_SCHEDULING_ISSUE', 'INSUFFICIENT_EVIDENCE'
  )),
  evidence_snapshot jsonb not null default '{}'::jsonb,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.consultation_attendance_reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.consultation_bookings(id) on delete restrict,
  order_id text not null references public.orders(id) on delete restrict,
  financial_case_id uuid not null unique references public.financial_cases(id) on delete restrict,
  reported_by uuid not null references auth.users(id) on delete restrict,
  reported_by_role text not null check (reported_by_role in ('CUSTOMER', 'TAILOR')),
  reported_reason text not null check (char_length(reported_reason) between 10 and 1000),
  status text not null default 'COUNTERPARTY_REVIEW' check (status in (
    'COUNTERPARTY_REVIEW', 'OPS_REVIEW', 'RESOLVED', 'CANCELLED'
  )),
  evidence_outcome_at_report text not null,
  counterparty_due_at timestamptz not null default (now() + interval '24 hours'),
  counterparty_response text check (counterparty_response is null or char_length(counterparty_response) between 2 and 1000),
  counterparty_responded_at timestamptz,
  resolution_code text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index consultation_attendance_reviews_status_due_idx
  on public.consultation_attendance_reviews(status, counterparty_due_at);

create or replace function public.refresh_consultation_attendance_evidence(p_booking_id uuid)
returns public.consultation_attendance_evidence
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.consultation_bookings%rowtype;
  v_customer_seconds integer := 0;
  v_tailor_seconds integer := 0;
  v_overlap_seconds integer := 0;
  v_customer_waited boolean := false;
  v_tailor_waited boolean := false;
  v_customer_late boolean := false;
  v_tailor_late boolean := false;
  v_complete boolean := false;
  v_outcome text;
  v_result public.consultation_attendance_evidence%rowtype;
begin
  select * into v_booking from public.consultation_bookings where id = p_booking_id;
  if v_booking.id is null then raise exception 'Consultation booking not found.'; end if;

  select
    coalesce(sum(greatest(0, extract(epoch from least(coalesce(p.left_at, now()), v_booking.scheduled_end_at) - greatest(p.joined_at, v_booking.scheduled_start_at - interval '5 minutes')))) filter (where p.user_id = v_booking.customer_id), 0)::integer,
    coalesce(sum(greatest(0, extract(epoch from least(coalesce(p.left_at, now()), v_booking.scheduled_end_at) - greatest(p.joined_at, v_booking.scheduled_start_at - interval '5 minutes')))) filter (where p.user_id = v_booking.tailor_id), 0)::integer,
    coalesce(bool_or(p.user_id = v_booking.customer_id and p.joined_at <= v_booking.scheduled_start_at + interval '10 minutes' and coalesce(p.left_at, now()) >= p.joined_at + interval '15 minutes'), false),
    coalesce(bool_or(p.user_id = v_booking.tailor_id and p.joined_at <= v_booking.scheduled_start_at + interval '10 minutes' and coalesce(p.left_at, now()) >= p.joined_at + interval '15 minutes'), false),
    coalesce(bool_or(p.user_id = v_booking.customer_id and p.joined_at > v_booking.scheduled_start_at + interval '15 minutes'), false),
    coalesce(bool_or(p.user_id = v_booking.tailor_id and p.joined_at > v_booking.scheduled_start_at + interval '15 minutes'), false)
  into v_customer_seconds, v_tailor_seconds, v_customer_waited, v_tailor_waited, v_customer_late, v_tailor_late
  from public.order_call_participations p
  join public.order_call_rooms room on room.id = p.call_room_id
  where room.consultation_booking_id = p_booking_id
    and p.joined_at < v_booking.scheduled_end_at
    and coalesce(p.left_at, now()) > v_booking.scheduled_start_at - interval '5 minutes';

  select coalesce(max(greatest(0, extract(epoch from least(coalesce(customer.left_at, now()), coalesce(tailor.left_at, now()), v_booking.scheduled_end_at) - greatest(customer.joined_at, tailor.joined_at, v_booking.scheduled_start_at - interval '5 minutes')))), 0)::integer
  into v_overlap_seconds
  from public.order_call_participations customer
  join public.order_call_rooms customer_room on customer_room.id = customer.call_room_id
  join public.order_call_participations tailor on tailor.call_room_id = customer.call_room_id
  where customer_room.consultation_booking_id = p_booking_id
    and customer.user_id = v_booking.customer_id
    and tailor.user_id = v_booking.tailor_id
    and customer.joined_at < coalesce(tailor.left_at, now())
    and tailor.joined_at < coalesce(customer.left_at, now());

  select exists (
    select 1 from public.order_call_sessions session
    join public.order_call_rooms room on room.id = session.call_room_id
    where room.consultation_booking_id = p_booking_id and session.status = 'ENDED'
  ) into v_complete;

  v_outcome := case
    when not v_complete then 'INSUFFICIENT_EVIDENCE'
    when now() < v_booking.scheduled_start_at + interval '15 minutes' then 'PENDING_WINDOW'
    when v_overlap_seconds >= 300 then 'ATTENDED'
    when v_tailor_waited and v_customer_seconds = 0 then 'CUSTOMER_NO_SHOW_ELIGIBLE'
    when v_customer_waited and v_tailor_seconds = 0 then 'TAILOR_NO_SHOW_ELIGIBLE'
    when v_customer_seconds > 0 or v_tailor_seconds > 0 then 'CONNECTION_OR_SCHEDULING_ISSUE'
    else 'INSUFFICIENT_EVIDENCE'
  end;

  insert into public.consultation_attendance_evidence (
    booking_id, order_id, provider_evidence_complete, customer_verified_seconds,
    tailor_verified_seconds, verified_overlap_seconds, customer_waited_through_deadline,
    tailor_waited_through_deadline, customer_late_visit, tailor_late_visit,
    derived_outcome, evidence_snapshot, evaluated_at, updated_at
  ) values (
    v_booking.id, v_booking.order_id, v_complete, v_customer_seconds,
    v_tailor_seconds, v_overlap_seconds, v_customer_waited, v_tailor_waited,
    v_customer_late, v_tailor_late, v_outcome,
    jsonb_build_object('policyVersion', v_booking.policy_version, 'graceMinutes', 10, 'claimantWaitMinutes', 15, 'attendedOverlapMinutes', 5),
    now(), now()
  ) on conflict (booking_id) do update set
    provider_evidence_complete = excluded.provider_evidence_complete,
    customer_verified_seconds = excluded.customer_verified_seconds,
    tailor_verified_seconds = excluded.tailor_verified_seconds,
    verified_overlap_seconds = excluded.verified_overlap_seconds,
    customer_waited_through_deadline = excluded.customer_waited_through_deadline,
    tailor_waited_through_deadline = excluded.tailor_waited_through_deadline,
    customer_late_visit = excluded.customer_late_visit,
    tailor_late_visit = excluded.tailor_late_visit,
    derived_outcome = excluded.derived_outcome,
    evidence_snapshot = excluded.evidence_snapshot,
    evaluated_at = excluded.evaluated_at,
    updated_at = now()
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.submit_consultation_attendance_report(
  p_booking_id uuid,
  p_actor_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_booking public.consultation_bookings%rowtype;
  v_evidence public.consultation_attendance_evidence%rowtype;
  v_role text;
  v_counterparty uuid;
  v_case public.financial_cases%rowtype;
  v_review public.consultation_attendance_reviews%rowtype;
  v_hash text;
begin
  if p_actor_id is null then raise exception 'Authentication required.'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Explain what happened in at least 10 characters.'; end if;
  if nullif(trim(p_idempotency_key), '') is null then raise exception 'Idempotency key is required.'; end if;
  select * into v_booking from public.consultation_bookings where id = p_booking_id for update;
  if v_booking.id is null then raise exception 'Consultation booking not found.'; end if;
  if v_booking.customer_id = p_actor_id then v_role := 'CUSTOMER'; v_counterparty := v_booking.tailor_id;
  elsif v_booking.tailor_id = p_actor_id then v_role := 'TAILOR'; v_counterparty := v_booking.customer_id;
  else raise exception 'You are not part of this consultation.'; end if;
  if now() < v_booking.scheduled_start_at + interval '15 minutes' then raise exception 'Wait until the attendance window has ended.'; end if;

  v_evidence := public.refresh_consultation_attendance_evidence(p_booking_id);
  v_hash := encode(digest(concat_ws('|', p_booking_id::text, p_actor_id::text, trim(p_reason)), 'sha256'), 'hex');
  select * into v_case from public.financial_cases where idempotency_key = p_idempotency_key;
  if v_case.id is not null and v_case.request_hash <> v_hash then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
  if v_case.id is null then
    insert into public.financial_cases (
      idempotency_key, request_hash, order_id, case_type, status, opened_by,
      opened_by_role, counterparty_id, reason_code, summary, claim_details,
      requested_outcome, money_movement_blocked, eligibility_status,
      eligibility_snapshot, policy_version, counterparty_response_requested_at
    ) values (
      p_idempotency_key, v_hash, v_booking.order_id, 'CONSULTATION_ATTENDANCE',
      'COUNTERPARTY_REVIEW', p_actor_id, v_role, v_counterparty,
      'CONSULTATION_NO_SHOW', trim(p_reason),
      jsonb_build_object('bookingId', p_booking_id, 'claimedByRole', v_role),
      'OPS_HELP', true,
      case when v_evidence.derived_outcome in ('CUSTOMER_NO_SHOW_ELIGIBLE', 'TAILOR_NO_SHOW_ELIGIBLE') then 'ELIGIBLE' else 'OPS_REVIEW' end,
      to_jsonb(v_evidence), v_booking.policy_version, now()
    ) returning * into v_case;

    insert into public.financial_case_events(case_id, event_type, actor_id, actor_role, payload, correlation_id)
    values (v_case.id, 'CASE_OPENED', p_actor_id, v_role, jsonb_build_object('bookingId', p_booking_id), v_case.correlation_id);
    insert into public.financial_case_evidence(
      case_id, evidence_type, source, evidence_tier, verification_status,
      source_table, source_record_id, metadata, submitted_by_role
    ) values (
      v_case.id, 'DAILY_ATTENDANCE_SUMMARY', 'CALL_PROVIDER', 'A',
      case when v_evidence.provider_evidence_complete then 'VERIFIED' else 'CLAIMED' end,
      'consultation_attendance_evidence', p_booking_id::text, to_jsonb(v_evidence), 'SYSTEM'
    );
  end if;

  insert into public.consultation_attendance_reviews(
    booking_id, order_id, financial_case_id, reported_by, reported_by_role,
    reported_reason, evidence_outcome_at_report
  ) values (
    p_booking_id, v_booking.order_id, v_case.id, p_actor_id, v_role,
    trim(p_reason), v_evidence.derived_outcome
  ) on conflict (booking_id) do nothing
  returning * into v_review;
  if v_review.id is null then select * into v_review from public.consultation_attendance_reviews where booking_id = p_booking_id; end if;
  return jsonb_build_object('reviewId', v_review.id, 'caseId', v_case.id, 'caseReference', v_case.reference, 'status', v_review.status, 'evidenceOutcome', v_evidence.derived_outcome);
end;
$$;

create or replace function public.respond_to_consultation_attendance_report(
  p_booking_id uuid,
  p_actor_id uuid,
  p_response text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.consultation_attendance_reviews%rowtype;
  v_booking public.consultation_bookings%rowtype;
  v_actor_role text;
  v_case public.financial_cases%rowtype;
begin
  if char_length(trim(coalesce(p_response, ''))) < 2 then raise exception 'Add a response.'; end if;
  select * into v_review from public.consultation_attendance_reviews where booking_id = p_booking_id for update;
  if v_review.id is null then raise exception 'Attendance report not found.'; end if;
  if v_review.status <> 'COUNTERPARTY_REVIEW' then raise exception 'This report is no longer waiting for a response.'; end if;
  select * into v_booking from public.consultation_bookings where id = p_booking_id;
  if v_booking.customer_id = p_actor_id then v_actor_role := 'CUSTOMER';
  elsif v_booking.tailor_id = p_actor_id then v_actor_role := 'TAILOR';
  else raise exception 'You are not part of this consultation.'; end if;
  if v_actor_role = v_review.reported_by_role then raise exception 'The counterpart must respond to this report.'; end if;

  update public.consultation_attendance_reviews set
    counterparty_response = trim(p_response), counterparty_responded_at = now(),
    status = 'OPS_REVIEW', updated_at = now()
  where id = v_review.id returning * into v_review;
  select * into v_case from public.financial_cases where id = v_review.financial_case_id;
  update public.financial_cases set status = 'OPS_REVIEW', counterparty_responded_at = now(), updated_at = now() where id = v_case.id;
  insert into public.financial_case_events(case_id, event_type, actor_id, actor_role, payload, correlation_id)
  values (v_case.id, 'COUNTERPARTY_RESPONSE_ADDED', p_actor_id, v_actor_role, jsonb_build_object('response', trim(p_response)), v_case.correlation_id);
  return jsonb_build_object('reviewId', v_review.id, 'caseId', v_case.id, 'status', v_review.status);
end;
$$;

alter table public.consultation_attendance_evidence enable row level security;
alter table public.consultation_attendance_reviews enable row level security;

create policy "Order parties read consultation attendance evidence" on public.consultation_attendance_evidence
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_id and (o.customer_id::text = auth.uid()::text or o.tailor_id::text = auth.uid()::text))
  );
create policy "Order parties read consultation attendance reviews" on public.consultation_attendance_reviews
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_id and (o.customer_id::text = auth.uid()::text or o.tailor_id::text = auth.uid()::text))
  );

revoke all on public.consultation_attendance_evidence from anon, authenticated;
revoke all on public.consultation_attendance_reviews from anon, authenticated;
grant select on public.consultation_attendance_evidence to authenticated;
grant select on public.consultation_attendance_reviews to authenticated;
grant select, insert, update on public.consultation_attendance_evidence to service_role;
grant select, insert, update on public.consultation_attendance_reviews to service_role;
revoke all on function public.refresh_consultation_attendance_evidence(uuid) from public, anon, authenticated;
grant execute on function public.refresh_consultation_attendance_evidence(uuid) to service_role;
revoke all on function public.submit_consultation_attendance_report(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.submit_consultation_attendance_report(uuid, uuid, text, text) to service_role;
revoke all on function public.respond_to_consultation_attendance_report(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.respond_to_consultation_attendance_report(uuid, uuid, text) to service_role;

comment on table public.consultation_attendance_evidence is
  'Derived Daily metadata only. Stores no audio, video, recording, or transcript.';
comment on table public.consultation_attendance_reviews is
  'Human-review workflow; a report never moves money automatically.';
