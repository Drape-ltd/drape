-- Backfill the canonical Ops envelope after the target project has been bound.
-- UNKNOWN remains fail closed; the deployment must configure the project before
-- this migration runs.

create or replace function public.backfill_ops_case_envelope()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_environment text := public.current_ops_environment();
  v_case_count integer := 0;
  v_deletion_count integer := 0;
  v_event_count integer := 0;
begin
  if v_environment not in ('DEVELOPMENT', 'PRODUCTION') then
    raise exception 'Configure ops_runtime_configuration before backfilling cases.' using errcode = '55000';
  end if;

  update public.ops_issues
  set environment = v_environment,
      canonical_status = case status
        when 'OPEN' then 'NEW'
        when 'IN_REVIEW' then 'IN_PROGRESS'
        when 'ESCALATED' then 'ESCALATED'
        when 'RESOLVED' then 'RESOLVED'
        when 'DISMISSED' then 'CLOSED'
        else canonical_status
      end,
      queue_key = coalesce(queue_key, case
        when issue_type ~ '(DELETION|PRIVACY)' then 'privacy-deletion'
        when issue_type ~ '(VERIFICATION|TRUST|SAFETY|BYPASS)' then 'trust-safety'
        when issue_type ~ '(PAYOUT|PAYMENT|REFUND|SETTLEMENT)' then 'money-desk'
        when issue_type ~ '(DELIVERY|DISPATCH|FULFILLMENT)' then 'delivery-supply'
        when issue_type ~ '(INCIDENT|PROVIDER|WEBHOOK|JOB)' then 'reliability'
        else 'operations'
      end),
      owning_team = coalesce(owning_team, case
        when issue_type ~ '(DELETION|PRIVACY)' then 'customer_success'
        when issue_type ~ '(VERIFICATION|TRUST|SAFETY|BYPASS)' then 'trust'
        when issue_type ~ '(PAYOUT|PAYMENT|REFUND|SETTLEMENT)' then 'finance'
        when issue_type ~ '(INCIDENT|PROVIDER|WEBHOOK|JOB)' then 'engineering'
        else 'ops'
      end),
      provenance = case
        when provenance <> 'UNKNOWN' then provenance
        when v_environment = 'DEVELOPMENT' then 'QA'
        else 'UNKNOWN'
      end;
  get diagnostics v_case_count = row_count;

  -- Fire the authoritative projection for historical deletion requests. This
  -- creates missing cases and normalizes existing ones without changing the
  -- domain status.
  update public.account_deletion_requests
  set status = status;
  get diagnostics v_deletion_count = row_count;

  insert into public.ops_case_events (
    issue_id, event_type, visibility, sensitivity, from_status, to_status,
    summary, payload, idempotency_key, correlation_id, occurred_at
  )
  select
    issue.id,
    'STATE_TRANSITION',
    'INTERNAL',
    'HIGHLY_RESTRICTED',
    null,
    request.status,
    'Historical account deletion request projected into the canonical privacy queue.',
    jsonb_build_object('requestId', request.id, 'role', request.role, 'backfilled', true),
    'account-deletion-backfill:' || request.id::text,
    issue.correlation_id,
    request.requested_at
  from public.account_deletion_requests request
  join public.ops_issues issue
    on issue.related_entity_type = 'account_deletion_request'
   and issue.related_entity_id = request.id::text
  on conflict (issue_id, idempotency_key) do nothing;
  get diagnostics v_event_count = row_count;

  return jsonb_build_object(
    'environment', v_environment,
    'casesUpdated', v_case_count,
    'deletionRequestsProjected', v_deletion_count,
    'eventsInserted', v_event_count
  );
end;
$$;

revoke all on function public.backfill_ops_case_envelope() from public, anon, authenticated;
grant execute on function public.backfill_ops_case_envelope() to service_role;

comment on function public.backfill_ops_case_envelope() is
  'Idempotently projects existing operational records after the target project is environment-bound.';

comment on table public.ops_issues is
  'Canonical Ops case envelope. Domain records remain authoritative and every action is environment-bound.';
