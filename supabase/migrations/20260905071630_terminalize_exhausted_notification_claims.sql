-- One-time development-safe cleanup for claims that exceeded their retry
-- budget before claim_due_jobs was hardened. This records terminal outcomes;
-- it does not replay or send any historical notification.

with exhausted as (
  update public.job_queue
     set status = 'DEAD',
         locked_at = null,
         locked_by = null,
         completed_at = now(),
         last_error = coalesce(last_error, 'Worker claim expired after the maximum attempts.')
   where status = 'PROCESSING'
     and locked_at < now() - interval '15 minutes'
     and attempt_count >= max_attempts
  returning *
), recorded_attempts as (
  insert into public.job_attempts (
    job_id, attempt_no, worker_id, status, error, finished_at
  )
  select
    id,
    greatest(1, attempt_count),
    coalesce(locked_by, 'migration/exhausted-claim-cleanup'),
    'DEAD',
    'Worker claim expired after the maximum attempts.',
    now()
  from exhausted
  returning job_id
)
insert into public.notification_delivery_outcomes (
  event_id, job_id, channel, recipient_user_id, order_id, status, reason, metadata
)
select
  exhausted.event_id,
  exhausted.id,
  case
    when exhausted.job_type = 'SEND_PUSH' then 'PUSH'
    when exhausted.job_type = 'SEND_SMS' then 'SMS'
    else 'EMAIL'
  end,
  null,
  coalesce(
    nullif(exhausted.payload ->> 'orderId', '')::uuid,
    nullif(exhausted.payload #>> '{order,id}', '')::uuid
  ),
  'DEAD',
  'WORKER_CLAIM_EXHAUSTED',
  jsonb_build_object('attempt_count', exhausted.attempt_count)
from exhausted
where exhausted.job_type in (
  'SEND_PUSH', 'SEND_SMS', 'SEND_ACCOUNT_EVENT_EMAIL',
  'SEND_ORDER_EVENT_EMAIL', 'SEND_ORDER_CONFIRMATION_EMAILS',
  'SEND_OPS_VERIFICATION_EMAIL'
)
on conflict (job_id) do update set
  status = 'DEAD',
  reason = 'WORKER_CLAIM_EXHAUSTED',
  metadata = public.notification_delivery_outcomes.metadata || excluded.metadata,
  terminal_at = now();
