-- A reopened case represents a new operational response window. Historical
-- deadlines remain in the audit/event ledgers; the active case clock restarts
-- from the reopen transition instead of remaining permanently overdue.

create or replace function public.apply_ops_case_queue_policy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_policy public.ops_queue_policies%rowtype;
  v_first_response_minutes integer;
  v_resolution_minutes integer;
  v_entering_pause boolean := false;
  v_leaving_pause boolean := false;
  v_pause_seconds bigint := 0;
  v_reopening boolean := false;
begin
  if new.environment not in ('DEVELOPMENT', 'PRODUCTION') or new.queue_key is null then
    return new;
  end if;

  select * into v_policy
  from public.ops_queue_policies
  where environment = new.environment
    and queue_key = new.queue_key
    and active
    and retired_at is null
    and effective_at <= now()
  order by effective_at desc
  limit 1;

  if v_policy.id is null then return new; end if;

  v_first_response_minutes := nullif(v_policy.first_response_minutes ->> new.priority, '')::integer;
  v_resolution_minutes := nullif(v_policy.active_resolution_minutes ->> new.priority, '')::integer;
  if tg_op = 'UPDATE' then
    v_reopening := old.canonical_status in ('RESOLVED', 'CLOSED', 'CANCELLED')
      and new.canonical_status = 'NEW';
  end if;

  new.owning_team := coalesce(new.owning_team, v_policy.primary_team);
  new.sla_policy_version := coalesce(new.sla_policy_version, v_policy.version);

  if v_reopening then
    new.first_responded_at := null;
    new.first_response_due_at := now() + make_interval(mins => coalesce(v_first_response_minutes, 4320));
    new.active_resolution_due_at := now() + make_interval(mins => coalesce(v_resolution_minutes, 10080));
    new.sla_clock_paused_at := null;
    new.paused_duration_seconds := 0;
    new.last_meaningful_activity_at := now();
  else
    new.first_response_due_at := coalesce(
      new.first_response_due_at,
      coalesce(new.created_at, now()) + make_interval(mins => coalesce(v_first_response_minutes, 4320))
    );
    new.active_resolution_due_at := coalesce(
      new.active_resolution_due_at,
      coalesce(new.created_at, now()) + make_interval(mins => coalesce(v_resolution_minutes, 10080))
    );
    new.last_meaningful_activity_at := coalesce(new.last_meaningful_activity_at, new.updated_at, new.created_at, now());
  end if;

  if tg_op = 'UPDATE' then
    if old.first_responded_at is null and new.first_responded_at is null
      and old.canonical_status = 'NEW' and new.canonical_status <> 'NEW' then
      new.first_responded_at := now();
    end if;

    v_entering_pause := new.canonical_status = any(v_policy.pause_statuses)
      and not (old.canonical_status = any(v_policy.pause_statuses));
    v_leaving_pause := old.canonical_status = any(v_policy.pause_statuses)
      and not (new.canonical_status = any(v_policy.pause_statuses));

    if v_entering_pause and new.sla_clock_paused_at is null then
      new.sla_clock_paused_at := now();
    elsif v_leaving_pause and old.sla_clock_paused_at is not null then
      v_pause_seconds := greatest(0, extract(epoch from (now() - old.sla_clock_paused_at))::bigint);
      new.paused_duration_seconds := coalesce(old.paused_duration_seconds, 0) + v_pause_seconds;
      new.active_resolution_due_at := new.active_resolution_due_at + make_interval(secs => v_pause_seconds::double precision);
      new.sla_clock_paused_at := null;
    end if;
  elsif new.canonical_status = any(v_policy.pause_statuses) then
    new.sla_clock_paused_at := coalesce(new.sla_clock_paused_at, now());
  end if;

  return new;
end;
$$;

-- Repair currently open cases whose most recent reopen happened after their
-- retained deadline. The original clock remains preserved in audit history.
update public.ops_issues issue
set first_responded_at = null,
    first_response_due_at = coalesce(issue.last_seen_at, issue.updated_at, now())
      + make_interval(mins => coalesce(nullif(policy.first_response_minutes ->> issue.priority, '')::integer, 4320)),
    active_resolution_due_at = coalesce(issue.last_seen_at, issue.updated_at, now())
      + make_interval(mins => coalesce(nullif(policy.active_resolution_minutes ->> issue.priority, '')::integer, 10080)),
    sla_clock_paused_at = null,
    paused_duration_seconds = 0,
    last_meaningful_activity_at = coalesce(issue.last_seen_at, issue.updated_at, now())
from public.ops_queue_policies policy
where issue.environment = policy.environment
  and issue.queue_key = policy.queue_key
  and policy.active
  and policy.retired_at is null
  and issue.canonical_status = 'NEW'
  and issue.active_resolution_due_at < coalesce(issue.last_seen_at, issue.updated_at, now())
  and exists (
    select 1
    from public.ops_audit_logs audit
    where audit.issue_id = issue.id
      and audit.action_taken = 'ISSUE_REOPENED'
      and audit.created_at >= coalesce(issue.last_seen_at, issue.updated_at) - interval '5 minutes'
  );
