-- One live Money Desk request may control a target at a time. Historical terminal
-- requests remain immutable evidence and may be followed by an explicitly new review.
with ranked_active_requests as (
  select
    id,
    correlation_id,
    row_number() over (
      partition by action_type, target_type, target_id
      order by
        case status
          when 'EXECUTING' then 1
          when 'APPROVED' then 2
          else 3
        end,
        created_at,
        id
    ) as target_rank
  from public.money_desk_requests
  where status in ('PENDING_APPROVAL', 'APPROVED', 'EXECUTING')
), cancelled_duplicates as (
  update public.money_desk_requests request
  set status = 'CANCELLED', updated_at = now()
  from ranked_active_requests ranked
  where request.id = ranked.id
    and ranked.target_rank > 1
  returning request.id, request.correlation_id
)
insert into public.money_desk_events (
  request_id,
  event_type,
  actor_email,
  actor_role,
  payload,
  correlation_id
)
select
  duplicate.id,
  'REQUEST_CANCELLED',
  'system@drapeon.co',
  'ADMIN',
  jsonb_build_object(
    'reason', 'Duplicate active target request cancelled before enforcing target idempotency.',
    'migration', '20260909061500_money_desk_active_target_idempotency'
  ),
  duplicate.correlation_id
from cancelled_duplicates duplicate;

create unique index if not exists money_desk_requests_one_active_target_idx
  on public.money_desk_requests (action_type, target_type, target_id)
  where status in ('PENDING_APPROVAL', 'APPROVED', 'EXECUTING');
