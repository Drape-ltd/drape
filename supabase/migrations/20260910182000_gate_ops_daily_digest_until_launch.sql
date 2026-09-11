-- Keep the routine Ops digest silent during prelaunch and explicit test periods.
-- Immediate incident and recovery alerts remain active. Launch is an intentional
-- feature-flag change with an operator identity, not a deployment side effect.

insert into public.feature_flags (
  key,
  enabled,
  description,
  audience,
  rollout_percent,
  metadata
)
values (
  'ops_slack_daily_digest',
  false,
  'Send the production daily Ops queue digest after Drapeon is publicly launched.',
  'OPS',
  0,
  jsonb_build_object(
    'launch_gate', true,
    'enable_when', 'PUBLIC_LAUNCH_APPROVED'
  )
)
on conflict (key) do update
set
  description = excluded.description,
  audience = excluded.audience,
  metadata = public.feature_flags.metadata || excluded.metadata,
  updated_at = now();

create or replace function public.enqueue_ops_slack_daily_digest()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_enabled boolean := false;
begin
  select enabled and rollout_percent = 100
  into v_enabled
  from public.feature_flags
  where key = 'ops_slack_daily_digest';

  if coalesce(v_enabled, false) is not true then
    return null;
  end if;

  v_event_id := public.enqueue_domain_event(
    p_event_type := 'ops.digest.slack_delivery_requested',
    p_aggregate_type := 'ops_queue',
    p_idempotency_key := 'ops-slack-digest:' || current_date::text,
    p_payload := jsonb_build_object('digestDate', current_date),
    p_aggregate_id := current_date::text,
    p_actor_id := null,
    p_actor_role := 'SYSTEM',
    p_order_id := null,
    p_metadata := jsonb_build_object('launchGate', 'ops_slack_daily_digest'),
    p_jobs := array['SEND_OPS_SLACK_DIGEST']::text[],
    p_priority := 60,
    p_max_attempts := 8,
    p_run_at := now()
  );
  return v_event_id;
end;
$$;

revoke all on function public.enqueue_ops_slack_daily_digest() from public, anon, authenticated;
grant execute on function public.enqueue_ops_slack_daily_digest() to service_role;

comment on function public.enqueue_ops_slack_daily_digest() is
  'Queues the daily Ops Slack digest only after the ops_slack_daily_digest launch flag is explicitly enabled at 100 percent.';
