-- Immutable Ops case lineage and typed merge/split actions.
--
-- Domain records remain authoritative. A merge closes only the duplicate case
-- envelope and links it to the surviving case; it never rewrites or deletes
-- source domain data, events, or receipts. A split creates a linked child and
-- copies only the context identifiers explicitly selected by the operator.

create table if not exists public.ops_case_lineage (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('DEVELOPMENT', 'PRODUCTION')),
  relationship_type text not null check (relationship_type in ('MERGED_INTO', 'SPLIT_FROM')),
  source_issue_id uuid not null references public.ops_issues(id) on delete restrict,
  source_case_number text not null,
  target_issue_id uuid not null references public.ops_issues(id) on delete restrict,
  target_case_number text not null,
  selected_context text[] not null default '{}'::text[],
  reason text not null,
  actor_principal_id uuid references public.ops_workforce_principals(id) on delete set null,
  actor_label text not null,
  idempotency_key text not null,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  constraint ops_case_lineage_distinct_cases check (source_issue_id <> target_issue_id),
  constraint ops_case_lineage_reason_bounded check (length(reason) between 12 and 1000),
  constraint ops_case_lineage_actor_bounded check (length(actor_label) between 3 and 180),
  constraint ops_case_lineage_idempotency_bounded check (length(idempotency_key) between 16 and 180),
  constraint ops_case_lineage_context_allowlist check (
    selected_context <@ array['user_id','tailor_profile_id','order_id','related_entity','provider']::text[]
  ),
  unique (source_issue_id, idempotency_key)
);

create unique index if not exists ops_case_lineage_one_merge_source_idx
  on public.ops_case_lineage (source_issue_id)
  where relationship_type = 'MERGED_INTO';

create index if not exists ops_case_lineage_source_timeline_idx
  on public.ops_case_lineage (source_issue_id, created_at desc);

create index if not exists ops_case_lineage_target_timeline_idx
  on public.ops_case_lineage (target_issue_id, created_at desc);

create index if not exists ops_case_lineage_correlation_idx
  on public.ops_case_lineage (correlation_id, created_at desc);

alter table public.ops_case_lineage enable row level security;
revoke all on table public.ops_case_lineage from public, anon, authenticated;
grant select, insert on table public.ops_case_lineage to service_role;

drop trigger if exists trg_ops_case_lineage_immutable on public.ops_case_lineage;
create trigger trg_ops_case_lineage_immutable
before update or delete on public.ops_case_lineage
for each row execute function public.reject_ops_case_event_mutation();

create or replace function public.perform_ops_case_lineage_action(
  p_source_issue_id uuid,
  p_action text,
  p_target_case_number text,
  p_child_title text,
  p_child_summary text,
  p_selected_context text[],
  p_reason text,
  p_expected_source_version bigint,
  p_expected_target_version bigint,
  p_idempotency_key text,
  p_actor_principal_id uuid,
  p_actor_label text,
  p_environment text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action text := upper(trim(coalesce(p_action, '')));
  v_environment text := upper(trim(coalesce(p_environment, '')));
  v_target_case_number text := upper(trim(coalesce(p_target_case_number, '')));
  v_child_title text := trim(coalesce(p_child_title, ''));
  v_child_summary text := trim(coalesce(p_child_summary, ''));
  v_reason text := trim(coalesce(p_reason, ''));
  v_selected_context text[] := coalesce(p_selected_context, '{}'::text[]);
  v_principal public.ops_workforce_principals%rowtype;
  v_source public.ops_issues%rowtype;
  v_target public.ops_issues%rowtype;
  v_source_policy public.ops_queue_policies%rowtype;
  v_target_policy public.ops_queue_policies%rowtype;
  v_lineage public.ops_case_lineage%rowtype;
  v_receipt public.ops_action_receipts%rowtype;
  v_source_previous_status text;
  v_target_id uuid;
  v_child_id uuid := gen_random_uuid();
  v_now timestamptz := now();
begin
  if v_action not in ('MERGE_CASE', 'SPLIT_CASE') then
    raise exception 'Unsupported case lineage action.' using errcode = '22023';
  end if;
  if p_source_issue_id is null or p_actor_principal_id is null or p_correlation_id is null then
    raise exception 'Source case, workforce principal, and correlation ID are required.' using errcode = '22023';
  end if;
  if p_expected_source_version is null or p_expected_source_version < 1 then
    raise exception 'Expected source case version is required.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_idempotency_key, ''))) < 16 or length(p_idempotency_key) > 180 then
    raise exception 'A bounded idempotency key is required.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_actor_label, ''))) < 3 or length(p_actor_label) > 180 then
    raise exception 'A named workforce actor is required.' using errcode = '22023';
  end if;
  if length(v_reason) < 12 or length(v_reason) > 1000 then
    raise exception 'A lineage reason between 12 and 1000 characters is required.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_selected_context) as context_key
    where context_key not in ('user_id', 'tailor_profile_id', 'order_id', 'related_entity', 'provider')
  ) then
    raise exception 'Split context contains an unsupported field.' using errcode = '22023';
  end if;
  if v_action = 'MERGE_CASE' then
    if v_target_case_number !~ '^OPS-[A-Z0-9-]{4,60}$' then
      raise exception 'A valid target case number is required.' using errcode = '22023';
    end if;
    if p_expected_target_version is null or p_expected_target_version < 1 then
      raise exception 'Expected target case version is required.' using errcode = '22023';
    end if;
  else
    if length(v_child_title) < 8 or length(v_child_title) > 180 then
      raise exception 'A child case title between 8 and 180 characters is required.' using errcode = '22023';
    end if;
    if length(v_child_summary) < 20 or length(v_child_summary) > 2000 then
      raise exception 'A child case summary between 20 and 2000 characters is required.' using errcode = '22023';
    end if;
  end if;

  select * into v_principal
  from public.ops_workforce_principals
  where id = p_actor_principal_id
  for share;

  if v_principal.id is null
    or v_principal.status <> 'ACTIVE'
    or not ('admin' = any(v_principal.roles))
    or not (lower(v_environment) = any(v_principal.permitted_environments))
    or v_principal.access_review_due_at is null
    or v_principal.access_review_due_at <= v_now
  then
    raise exception 'An active, access-reviewed admin principal is required for case lineage.' using errcode = '42501';
  end if;
  if lower(trim(p_actor_label)) <> lower(v_principal.email) then
    raise exception 'Workforce actor does not match the authorized principal.' using errcode = '42501';
  end if;
  if public.current_ops_environment() <> v_environment then
    raise exception 'Ops database environment mismatch.' using errcode = '42501';
  end if;

  select id into v_target_id
  from public.ops_issues
  where v_action = 'MERGE_CASE'
    and case_number = v_target_case_number
    and environment = v_environment;

  if v_action = 'MERGE_CASE' and v_target_id is null then
    raise exception 'The target case was not found in this environment.' using errcode = '22023';
  end if;
  if v_target_id = p_source_issue_id then
    raise exception 'A case cannot be merged into itself.' using errcode = '22023';
  end if;

  -- Lock both merge participants in deterministic UUID order. This prevents
  -- opposing merge requests from deadlocking while their versions are checked.
  perform 1
  from public.ops_issues
  where id = p_source_issue_id
     or (v_action = 'MERGE_CASE' and id = v_target_id)
  order by id
  for update;

  select * into v_source from public.ops_issues where id = p_source_issue_id;
  if v_action = 'MERGE_CASE' then
    select * into v_target from public.ops_issues where id = v_target_id;
  end if;

  if v_source.id is null
    or v_source.environment <> v_environment
    or v_source.provenance = 'UNKNOWN'
  then
    raise exception 'The source case is not actionable in this environment.' using errcode = '42501';
  end if;

  -- Idempotent retries must recover the original receipt even though a
  -- successful merge has already made the source terminal.
  select * into v_lineage
  from public.ops_case_lineage
  where source_issue_id = p_source_issue_id
    and idempotency_key = trim(p_idempotency_key);
  if v_lineage.id is not null then
    if (v_action = 'MERGE_CASE' and (
      v_lineage.relationship_type <> 'MERGED_INTO'
      or v_lineage.target_case_number <> v_target_case_number
    )) or (v_action = 'SPLIT_CASE' and v_lineage.relationship_type <> 'SPLIT_FROM') then
      raise exception 'The idempotency key belongs to a different lineage request.' using errcode = '22023';
    end if;
    select * into v_receipt
    from public.ops_action_receipts
    where issue_id = p_source_issue_id
      and idempotency_key = trim(p_idempotency_key);
    return jsonb_build_object(
      'duplicate', true,
      'lineageId', v_lineage.id,
      'relationshipType', v_lineage.relationship_type,
      'sourceCaseNumber', v_lineage.source_case_number,
      'targetCaseNumber', v_lineage.target_case_number,
      'receiptId', v_receipt.id,
      'recordVersion', v_source.record_version,
      'correlationId', v_lineage.correlation_id
    );
  end if;

  if v_source.canonical_status in ('RESOLVED', 'CLOSED') then
    raise exception 'A terminal source case cannot be merged or split.' using errcode = '55000';
  end if;
  if v_action = 'MERGE_CASE' and (
    v_target.id is null
    or v_target.environment <> v_environment
    or v_target.provenance = 'UNKNOWN'
    or v_target.canonical_status in ('RESOLVED', 'CLOSED')
  ) then
    raise exception 'The surviving target case is not actionable.' using errcode = '55000';
  end if;

  if v_source.record_version <> p_expected_source_version then
    raise exception 'SOURCE_CASE_VERSION_CONFLICT:%', v_source.record_version using errcode = '40001';
  end if;
  v_source_previous_status := v_source.canonical_status;
  if v_action = 'MERGE_CASE' and v_target.record_version <> p_expected_target_version then
    raise exception 'TARGET_CASE_VERSION_CONFLICT:%', v_target.record_version using errcode = '40001';
  end if;

  if exists (
    select 1 from public.ops_case_lineage
    where source_issue_id = p_source_issue_id
      and relationship_type = 'MERGED_INTO'
  ) then
    raise exception 'The source case has already been merged.' using errcode = '55000';
  end if;
  if v_action = 'MERGE_CASE' and exists (
    select 1 from public.ops_case_lineage
    where source_issue_id = v_target.id
      and relationship_type = 'MERGED_INTO'
  ) then
    raise exception 'The selected survivor has already been merged into another case.' using errcode = '55000';
  end if;
  if v_action = 'MERGE_CASE' and exists (
    with recursive reachable(issue_id) as (
      select target_issue_id
      from public.ops_case_lineage
      where source_issue_id = v_target.id
      union
      select lineage.target_issue_id
      from public.ops_case_lineage lineage
      join reachable on lineage.source_issue_id = reachable.issue_id
    )
    select 1 from reachable where issue_id = v_source.id
  ) then
    raise exception 'The requested merge would create a lineage cycle.' using errcode = '22023';
  end if;

  select * into v_source_policy
  from public.ops_queue_policies policy
  where policy.environment = v_environment
    and policy.queue_key = v_source.queue_key
    and policy.active
    and policy.retired_at is null
    and policy.effective_at <= v_now
  order by (policy.version = v_source.sla_policy_version) desc, policy.effective_at desc
  limit 1;

  if v_source_policy.id is null or not (v_principal.roles && v_source_policy.permitted_roles) then
    raise exception 'The admin principal is not authorized for the source queue.' using errcode = '42501';
  end if;

  if v_action = 'MERGE_CASE' then
    select * into v_target_policy
    from public.ops_queue_policies policy
    where policy.environment = v_environment
      and policy.queue_key = v_target.queue_key
      and policy.active
      and policy.retired_at is null
      and policy.effective_at <= v_now
    order by (policy.version = v_target.sla_policy_version) desc, policy.effective_at desc
    limit 1;

    if v_target_policy.id is null or not (v_principal.roles && v_target_policy.permitted_roles) then
      raise exception 'The admin principal is not authorized for the target queue.' using errcode = '42501';
    end if;

    update public.ops_issues
    set canonical_status = 'CLOSED',
        status = 'RESOLVED',
        resolved_at = coalesce(resolved_at, v_now),
        closed_at = v_now,
        recommended_action = 'Merged into ' || v_target.case_number || '. Continue work only on the surviving case.',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'mergedIntoIssueId', v_target.id,
          'mergedIntoCaseNumber', v_target.case_number,
          'mergedAt', v_now
        )
    where id = v_source.id and record_version = p_expected_source_version;
    if not found then
      raise exception 'The source case changed during merge.' using errcode = '40001';
    end if;

    update public.ops_issues
    set last_seen_at = v_now,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'lastMergedSourceIssueId', v_source.id,
          'lastMergedSourceCaseNumber', v_source.case_number,
          'lastMergeAt', v_now
        )
    where id = v_target.id and record_version = p_expected_target_version;
    if not found then
      raise exception 'The target case changed during merge.' using errcode = '40001';
    end if;

    select * into v_source from public.ops_issues where id = p_source_issue_id;
    select * into v_target from public.ops_issues where id = v_target_id;

    insert into public.ops_case_lineage (
      environment, relationship_type, source_issue_id, source_case_number,
      target_issue_id, target_case_number, selected_context, reason,
      actor_principal_id, actor_label, idempotency_key, correlation_id, created_at
    ) values (
      v_environment, 'MERGED_INTO', v_source.id, v_source.case_number,
      v_target.id, v_target.case_number, '{}'::text[], v_reason,
      v_principal.id, trim(p_actor_label), trim(p_idempotency_key), p_correlation_id, v_now
    ) returning * into v_lineage;
  else
    insert into public.ops_issues (
      id, issue_type, severity, status, source, actor_id, actor_role, order_id,
      user_id, tailor_profile_id, related_entity_type, related_entity_id,
      provider, stage, title, description, recommended_action, dedupe_key,
      metadata, queue_key, owning_team, priority, sensitivity, environment,
      canonical_status, sla_policy_version, provenance, reopened_from_issue_id,
      correlation_id, last_seen_at, created_at, updated_at
    ) values (
      v_child_id,
      v_source.issue_type,
      v_source.severity,
      'OPEN',
      v_source.source,
      null,
      null,
      case when 'order_id' = any(v_selected_context) then v_source.order_id else null end,
      case when 'user_id' = any(v_selected_context) then v_source.user_id else null end,
      case when 'tailor_profile_id' = any(v_selected_context) then v_source.tailor_profile_id else null end,
      case when 'related_entity' = any(v_selected_context) then v_source.related_entity_type else null end,
      case when 'related_entity' = any(v_selected_context) then v_source.related_entity_id else null end,
      case when 'provider' = any(v_selected_context) then v_source.provider else null end,
      v_source.stage,
      v_child_title,
      v_child_summary,
      'Triage this split child independently while preserving the parent case lineage.',
      'case-split:' || v_source.id::text || ':' || v_child_id::text,
      jsonb_build_object(
        'splitFromIssueId', v_source.id,
        'splitFromCaseNumber', v_source.case_number,
        'selectedContext', to_jsonb(v_selected_context),
        'splitAt', v_now
      ),
      v_source.queue_key,
      v_source.owning_team,
      v_source.priority,
      v_source.sensitivity,
      v_environment,
      'NEW',
      v_source.sla_policy_version,
      v_source.provenance,
      null,
      p_correlation_id,
      v_now,
      v_now,
      v_now
    );

    update public.ops_issues
    set last_seen_at = v_now
    where id = v_source.id and record_version = p_expected_source_version;
    if not found then
      raise exception 'The source case changed during split.' using errcode = '40001';
    end if;

    select * into v_source from public.ops_issues where id = p_source_issue_id;
    select * into v_target from public.ops_issues where id = v_child_id;

    insert into public.ops_case_lineage (
      environment, relationship_type, source_issue_id, source_case_number,
      target_issue_id, target_case_number, selected_context, reason,
      actor_principal_id, actor_label, idempotency_key, correlation_id, created_at
    ) values (
      v_environment, 'SPLIT_FROM', v_source.id, v_source.case_number,
      v_target.id, v_target.case_number, v_selected_context, v_reason,
      v_principal.id, trim(p_actor_label), trim(p_idempotency_key), p_correlation_id, v_now
    ) returning * into v_lineage;
  end if;

  insert into public.ops_action_receipts (
    issue_id, action_key, idempotency_key, actor_principal_id,
    expected_record_version, resulting_record_version, outcome, human_status,
    correlation_id, side_effects, blockers, next_action, completed_at
  ) values (
    v_source.id,
    'CASE_' || v_action,
    trim(p_idempotency_key),
    v_principal.id,
    p_expected_source_version,
    v_source.record_version,
    'SUCCEEDED',
    case when v_action = 'MERGE_CASE'
      then 'Duplicate case closed and linked to the surviving case.'
      else 'Independent child case created with explicitly selected context.'
    end,
    p_correlation_id,
    jsonb_build_array(jsonb_build_object(
      'type', 'CASE_LINEAGE',
      'lineageId', v_lineage.id,
      'relationshipType', v_lineage.relationship_type,
      'targetCaseNumber', v_lineage.target_case_number
    )),
    '[]'::jsonb,
    case when v_action = 'MERGE_CASE'
      then 'Continue work on ' || v_target.case_number || '.'
      else 'Triage child case ' || v_target.case_number || ' independently.'
    end,
    v_now
  ) returning * into v_receipt;

  insert into public.ops_case_events (
    issue_id, event_type, visibility, sensitivity, actor_principal_id,
    actor_label, from_status, to_status, summary, payload,
    idempotency_key, correlation_id, occurred_at
  ) values
    (
      v_source.id,
      case when v_action = 'MERGE_CASE' then 'MERGE' else 'SPLIT' end,
      'INTERNAL', v_source.sensitivity, v_principal.id, trim(p_actor_label),
      v_source_previous_status,
      v_source.canonical_status,
      case when v_action = 'MERGE_CASE'
        then 'Case merged into survivor ' || v_target.case_number || '.'
        else 'Independent child case ' || v_target.case_number || ' created.'
      end,
      jsonb_build_object(
        'lineageId', v_lineage.id,
        'relationshipType', v_lineage.relationship_type,
        'targetIssueId', v_target.id,
        'targetCaseNumber', v_target.case_number,
        'selectedContext', to_jsonb(v_selected_context),
        'reason', v_reason
      ),
      'case-lineage:' || v_lineage.id::text || ':source',
      p_correlation_id,
      v_now
    ),
    (
      v_target.id,
      case when v_action = 'MERGE_CASE' then 'MERGE' else 'SPLIT' end,
      'INTERNAL', v_target.sensitivity, v_principal.id, trim(p_actor_label),
      v_target.canonical_status,
      v_target.canonical_status,
      case when v_action = 'MERGE_CASE'
        then 'Duplicate case ' || v_source.case_number || ' merged into this survivor.'
        else 'This child was split from parent case ' || v_source.case_number || '.'
      end,
      jsonb_build_object(
        'lineageId', v_lineage.id,
        'relationshipType', v_lineage.relationship_type,
        'sourceIssueId', v_source.id,
        'sourceCaseNumber', v_source.case_number,
        'selectedContext', to_jsonb(v_selected_context),
        'reason', v_reason
      ),
      'case-lineage:' || v_lineage.id::text || ':target',
      p_correlation_id,
      v_now
    );

  insert into public.ops_audit_logs (
    issue_id, action_taken, performed_by, performed_role, reason,
    before_state, after_state, created_at
  ) values (
    v_source.id,
    'CASE_' || v_action,
    trim(p_actor_label),
    array_to_string(v_principal.roles, ','),
    v_reason,
    jsonb_build_object('recordVersion', p_expected_source_version, 'caseNumber', v_source.case_number),
    jsonb_build_object(
      'recordVersion', v_source.record_version,
      'relationshipType', v_lineage.relationship_type,
      'targetIssueId', v_target.id,
      'targetCaseNumber', v_target.case_number,
      'lineageId', v_lineage.id
    ),
    v_now
  );

  return jsonb_build_object(
    'duplicate', false,
    'lineageId', v_lineage.id,
    'relationshipType', v_lineage.relationship_type,
    'sourceCaseNumber', v_lineage.source_case_number,
    'targetCaseNumber', v_lineage.target_case_number,
    'receiptId', v_receipt.id,
    'recordVersion', v_source.record_version,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.perform_ops_case_lineage_action(uuid,text,text,text,text,text[],text,bigint,bigint,text,uuid,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.perform_ops_case_lineage_action(uuid,text,text,text,text,text[],text,bigint,bigint,text,uuid,text,text,uuid)
  to service_role;

comment on table public.ops_case_lineage is
  'Immutable case-to-case lineage. Domain records, case events, and receipts remain authoritative and are never collapsed by merge or split.';
comment on function public.perform_ops_case_lineage_action(uuid,text,text,text,text,text[],text,bigint,bigint,text,uuid,text,text,uuid) is
  'Admin-only, idempotent, environment-bound merge/split boundary with deterministic locks, optimistic concurrency, explicit split context, durable events, and receipts.';
