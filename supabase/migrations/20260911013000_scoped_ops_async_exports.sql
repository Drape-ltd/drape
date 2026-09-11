-- Purpose-limited Ops export requests. Export content is isolated from normal
-- read projections, short lived, requester-bound, and fully event-audited.

create table if not exists public.ops_export_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('OPX-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  environment text not null check (environment in ('DEVELOPMENT', 'PRODUCTION')),
  dataset text not null check (dataset in ('ACTION_RECEIPTS')),
  format text not null default 'CSV' check (format = 'CSV'),
  status text not null default 'REQUESTED' check (status in ('REQUESTED', 'PROCESSING', 'READY', 'FAILED', 'EXPIRED', 'CANCELLED')),
  reason text not null check (length(trim(reason)) between 12 and 500),
  filters jsonb not null default '{}'::jsonb,
  row_limit integer not null check (row_limit between 1 and 1000),
  requester_principal_id uuid not null references public.ops_workforce_principals(id) on delete restrict,
  requester_email text not null,
  requester_role text not null check (requester_role in ('admin', 'engineering')),
  sensitive_assurance boolean not null check (sensitive_assurance = true),
  idempotency_key text not null check (length(idempotency_key) between 16 and 180),
  correlation_id uuid not null,
  source_watermark timestamptz,
  row_count integer check (row_count is null or (row_count >= 0 and row_count <= row_limit)),
  content text,
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'),
  failure_code text,
  generation_attempts integer not null default 0 check (generation_attempts between 0 and 3),
  download_count integer not null default 0 check (download_count between 0 and 3),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  last_downloaded_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint ops_export_requests_filters_object check (
    jsonb_typeof(filters) = 'object' and octet_length(filters::text) <= 4096
  ),
  constraint ops_export_requests_content_size check (
    content is null or octet_length(content) <= 5242880
  ),
  constraint ops_export_requests_ready_content check (
    status <> 'READY' or (
      content is not null and content_sha256 is not null and
      row_count is not null and completed_at is not null and expires_at is not null
    )
  ),
  unique (requester_principal_id, environment, idempotency_key)
);

create index if not exists ops_export_requests_requester_recent_idx
  on public.ops_export_requests (requester_principal_id, environment, requested_at desc);

create index if not exists ops_export_requests_expiry_idx
  on public.ops_export_requests (expires_at)
  where content is not null and status = 'READY';

create table if not exists public.ops_export_events (
  id uuid primary key default gen_random_uuid(),
  export_request_id uuid not null references public.ops_export_requests(id) on delete restrict,
  event_type text not null check (event_type in ('REQUESTED', 'PROCESSING', 'READY', 'FAILED', 'DOWNLOADED', 'EXPIRED', 'CANCELLED')),
  actor_principal_id uuid references public.ops_workforce_principals(id) on delete set null,
  actor_label text,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  correlation_id uuid not null,
  occurred_at timestamptz not null default now(),
  constraint ops_export_events_details_object check (
    jsonb_typeof(details) = 'object' and octet_length(details::text) <= 4096
  )
);

create index if not exists ops_export_events_request_idx
  on public.ops_export_events (export_request_id, occurred_at desc, id desc);

alter table public.ops_export_requests enable row level security;
alter table public.ops_export_events enable row level security;
revoke all on table public.ops_export_requests from anon, authenticated;
revoke all on table public.ops_export_events from anon, authenticated;
grant select, insert, update, delete on table public.ops_export_requests to service_role;
grant select, insert on table public.ops_export_events to service_role;

create or replace function public.set_ops_export_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_ops_export_requests_updated_at on public.ops_export_requests;
create trigger trg_ops_export_requests_updated_at
before update on public.ops_export_requests
for each row execute function public.set_ops_export_updated_at();

create or replace function public.request_ops_export(
  p_dataset text,
  p_reason text,
  p_filters jsonb,
  p_row_limit integer,
  p_idempotency_key text,
  p_actor_principal_id uuid,
  p_actor_label text,
  p_actor_role text,
  p_environment text,
  p_sensitive_assurance boolean,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dataset text := upper(trim(coalesce(p_dataset, '')));
  v_reason text := trim(coalesce(p_reason, ''));
  v_environment text := upper(trim(coalesce(p_environment, '')));
  v_role text := lower(trim(coalesce(p_actor_role, '')));
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_from timestamptz;
  v_to timestamptz;
  v_principal public.ops_workforce_principals%rowtype;
  v_request public.ops_export_requests%rowtype;
begin
  if v_dataset <> 'ACTION_RECEIPTS' or v_role not in ('admin', 'engineering') then
    raise exception 'The requested export scope is not supported.' using errcode = '42501';
  end if;
  if length(v_reason) < 12 or length(v_reason) > 500 then
    raise exception 'A specific export reason is required.' using errcode = '22023';
  end if;
  if p_row_limit is null or p_row_limit < 1 or p_row_limit > 1000 then
    raise exception 'Export row limit is invalid.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_filters) <> 'object'
    or octet_length(v_filters::text) > 4096
    or exists (
      select 1 from jsonb_object_keys(v_filters) as entry(key)
      where entry.key not in ('outcome', 'from', 'to')
    ) then
    raise exception 'Export filters are invalid.' using errcode = '22023';
  end if;
  if coalesce(v_filters->>'outcome', 'ALL') not in ('ALL', 'SUCCEEDED', 'PENDING', 'FAILED', 'CANCELLED') then
    raise exception 'Export outcome filter is invalid.' using errcode = '22023';
  end if;
  begin
    if nullif(trim(coalesce(v_filters->>'from', '')), '') is not null then
      v_from := (v_filters->>'from')::timestamptz;
    end if;
    if nullif(trim(coalesce(v_filters->>'to', '')), '') is not null then
      v_to := (v_filters->>'to')::timestamptz;
    end if;
  exception
    when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Export date filters are invalid.' using errcode = '22023';
  end;
  if v_from is not null and v_to is not null and v_from > v_to then
    raise exception 'Export date range is invalid.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_idempotency_key, ''))) < 16 or length(p_idempotency_key) > 180
    or p_actor_principal_id is null or p_correlation_id is null
    or length(trim(coalesce(p_actor_label, ''))) < 3 or length(p_actor_label) > 180 then
    raise exception 'Export identity and idempotency context are required.' using errcode = '22023';
  end if;
  if p_sensitive_assurance is distinct from true then
    raise exception 'Fresh sensitive assurance is required.' using errcode = '42501';
  end if;

  select * into v_principal
  from public.ops_workforce_principals
  where id = p_actor_principal_id
  for share;

  if v_principal.id is null
    or v_principal.status <> 'ACTIVE'
    or lower(trim(p_actor_label)) <> lower(v_principal.email)
    or not (v_role = any(v_principal.roles))
    or not (v_role = 'admin' or v_role = 'engineering')
    or not (lower(v_environment) = any(v_principal.permitted_environments))
    or v_principal.access_review_due_at is null
    or v_principal.access_review_due_at <= now() then
    raise exception 'Workforce principal is not authorized for exports.' using errcode = '42501';
  end if;
  if public.current_ops_environment() <> v_environment then
    raise exception 'Ops database environment mismatch.' using errcode = '42501';
  end if;

  select * into v_request
  from public.ops_export_requests
  where requester_principal_id = p_actor_principal_id
    and environment = v_environment
    and idempotency_key = trim(p_idempotency_key);
  if v_request.id is not null then
    return jsonb_build_object(
      'duplicate', true,
      'id', v_request.id,
      'reference', v_request.reference,
      'status', v_request.status,
      'correlationId', v_request.correlation_id
    );
  end if;

  insert into public.ops_export_requests (
    environment, dataset, reason, filters, row_limit,
    requester_principal_id, requester_email, requester_role,
    sensitive_assurance, idempotency_key, correlation_id
  ) values (
    v_environment, v_dataset, v_reason, v_filters, p_row_limit,
    p_actor_principal_id, lower(trim(p_actor_label)), v_role,
    true, trim(p_idempotency_key), p_correlation_id
  ) on conflict (requester_principal_id, environment, idempotency_key) do nothing
  returning * into v_request;

  if v_request.id is null then
    select * into v_request
    from public.ops_export_requests
    where requester_principal_id = p_actor_principal_id
      and environment = v_environment
      and idempotency_key = trim(p_idempotency_key);
    return jsonb_build_object(
      'duplicate', true,
      'id', v_request.id,
      'reference', v_request.reference,
      'status', v_request.status,
      'correlationId', v_request.correlation_id
    );
  end if;

  insert into public.ops_export_events (
    export_request_id, event_type, actor_principal_id, actor_label,
    summary, details, correlation_id
  ) values (
    v_request.id, 'REQUESTED', p_actor_principal_id, lower(trim(p_actor_label)),
    'A purpose-limited Ops export was requested.',
    jsonb_build_object('dataset', v_dataset, 'rowLimit', p_row_limit, 'filters', v_filters),
    p_correlation_id
  );

  return jsonb_build_object(
    'duplicate', false,
    'id', v_request.id,
    'reference', v_request.reference,
    'status', v_request.status,
    'correlationId', v_request.correlation_id
  );
end;
$$;

create or replace function public.claim_ops_export(
  p_export_request_id uuid,
  p_actor_principal_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.ops_export_requests%rowtype;
  v_principal public.ops_workforce_principals%rowtype;
begin
  select * into v_principal from public.ops_workforce_principals where id = p_actor_principal_id for share;
  select * into v_request from public.ops_export_requests
  where id = p_export_request_id for update;
  if v_request.id is null then raise exception 'Export request not found.' using errcode = 'P0002'; end if;
  if v_request.requester_principal_id <> p_actor_principal_id or v_request.correlation_id <> p_correlation_id then
    raise exception 'Export request identity mismatch.' using errcode = '42501';
  end if;
  if v_principal.id is null or v_principal.status <> 'ACTIVE'
    or not (v_principal.roles && array['admin', 'engineering']::text[])
    or v_principal.access_review_due_at is null or v_principal.access_review_due_at <= now()
    or not (lower(v_request.environment) = any(v_principal.permitted_environments))
    or public.current_ops_environment() <> v_request.environment then
    raise exception 'Export principal is unavailable or revoked.' using errcode = '42501';
  end if;
  if v_request.status not in ('REQUESTED', 'FAILED') or v_request.generation_attempts >= 3 then
    return jsonb_build_object('claimed', false, 'request', to_jsonb(v_request) - 'content');
  end if;

  update public.ops_export_requests
  set status = 'PROCESSING', started_at = now(), completed_at = null,
      expires_at = null, content = null, content_sha256 = null,
      row_count = null, source_watermark = null, failure_code = null,
      generation_attempts = generation_attempts + 1
  where id = v_request.id
  returning * into v_request;

  insert into public.ops_export_events (
    export_request_id, event_type, actor_principal_id, actor_label,
    summary, correlation_id
  ) values (
    v_request.id, 'PROCESSING', p_actor_principal_id, v_request.requester_email,
    'The isolated export generator claimed this request.', p_correlation_id
  );
  return jsonb_build_object('claimed', true, 'request', to_jsonb(v_request) - 'content');
end;
$$;

create or replace function public.complete_ops_export(
  p_export_request_id uuid,
  p_actor_principal_id uuid,
  p_correlation_id uuid,
  p_content text,
  p_content_sha256 text,
  p_row_count integer,
  p_source_watermark timestamptz
)
returns public.ops_export_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.ops_export_requests%rowtype;
  v_principal public.ops_workforce_principals%rowtype;
begin
  select * into v_principal from public.ops_workforce_principals where id = p_actor_principal_id for share;
  select * into v_request from public.ops_export_requests
  where id = p_export_request_id for update;
  if v_request.id is null then raise exception 'Export request not found.' using errcode = 'P0002'; end if;
  if v_request.requester_principal_id <> p_actor_principal_id
    or v_request.correlation_id <> p_correlation_id
    or v_request.status <> 'PROCESSING' then
    raise exception 'Export request cannot be completed from its current state.' using errcode = '55000';
  end if;
  if public.current_ops_environment() <> v_request.environment then
    raise exception 'Ops database environment mismatch.' using errcode = '42501';
  end if;
  if v_principal.id is null or v_principal.status <> 'ACTIVE'
    or not (v_principal.roles && array['admin', 'engineering']::text[])
    or v_principal.access_review_due_at is null or v_principal.access_review_due_at <= now()
    or not (lower(v_request.environment) = any(v_principal.permitted_environments)) then
    raise exception 'Export principal is unavailable or revoked.' using errcode = '42501';
  end if;
  if p_content is null or octet_length(p_content) > 5242880
    or p_content_sha256 !~ '^[a-f0-9]{64}$'
    or p_row_count is null or p_row_count < 0 or p_row_count > v_request.row_limit then
    raise exception 'Generated export is outside its approved boundary.' using errcode = '22023';
  end if;

  update public.ops_export_requests
  set status = 'READY', content = p_content, content_sha256 = p_content_sha256,
      row_count = p_row_count, source_watermark = p_source_watermark,
      completed_at = now(), expires_at = now() + interval '15 minutes', failure_code = null
  where id = v_request.id
  returning * into v_request;

  insert into public.ops_export_events (
    export_request_id, event_type, actor_principal_id, actor_label,
    summary, details, correlation_id
  ) values (
    v_request.id, 'READY', p_actor_principal_id, v_request.requester_email,
    'The scoped export is ready for a short-lived requester-bound download.',
    jsonb_build_object('rowCount', p_row_count, 'sourceWatermark', p_source_watermark, 'sha256', p_content_sha256),
    p_correlation_id
  );
  return v_request;
end;
$$;

create or replace function public.fail_ops_export(
  p_export_request_id uuid,
  p_actor_principal_id uuid,
  p_correlation_id uuid,
  p_failure_code text
)
returns public.ops_export_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.ops_export_requests%rowtype;
  v_failure_code text := upper(trim(coalesce(p_failure_code, 'GENERATION_FAILED')));
begin
  select * into v_request from public.ops_export_requests
  where id = p_export_request_id for update;
  if v_request.id is null then raise exception 'Export request not found.' using errcode = 'P0002'; end if;
  if v_request.requester_principal_id <> p_actor_principal_id
    or v_request.correlation_id <> p_correlation_id
    or v_request.status <> 'PROCESSING' then
    raise exception 'Export request cannot fail from its current state.' using errcode = '55000';
  end if;
  if public.current_ops_environment() <> v_request.environment then
    raise exception 'Ops database environment mismatch.' using errcode = '42501';
  end if;
  if v_failure_code !~ '^[A-Z0-9_]{3,80}$' then v_failure_code := 'GENERATION_FAILED'; end if;

  update public.ops_export_requests
  set status = 'FAILED', content = null, content_sha256 = null,
      row_count = null, source_watermark = null, completed_at = now(),
      expires_at = null, failure_code = v_failure_code
  where id = v_request.id
  returning * into v_request;

  insert into public.ops_export_events (
    export_request_id, event_type, actor_principal_id, actor_label,
    summary, details, correlation_id
  ) values (
    v_request.id, 'FAILED', p_actor_principal_id, v_request.requester_email,
    'The export generator recorded a bounded terminal failure.',
    jsonb_build_object('failureCode', v_failure_code), p_correlation_id
  );
  return v_request;
end;
$$;

create or replace function public.consume_ops_export_download(
  p_export_request_id uuid,
  p_actor_principal_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.ops_export_requests%rowtype;
  v_principal public.ops_workforce_principals%rowtype;
begin
  select * into v_principal from public.ops_workforce_principals where id = p_actor_principal_id for share;
  select * into v_request from public.ops_export_requests
  where id = p_export_request_id for update;
  if v_request.id is null then raise exception 'Export request not found.' using errcode = 'P0002'; end if;
  if v_request.requester_principal_id <> p_actor_principal_id then
    raise exception 'Only the requesting operator may download this export.' using errcode = '42501';
  end if;
  if v_principal.id is null or v_principal.status <> 'ACTIVE'
    or not (v_principal.roles && array['admin', 'engineering']::text[])
    or v_principal.access_review_due_at is null or v_principal.access_review_due_at <= now()
    or not (lower(v_request.environment) = any(v_principal.permitted_environments))
    or public.current_ops_environment() <> v_request.environment then
    raise exception 'Export principal is unavailable or revoked.' using errcode = '42501';
  end if;
  if v_request.status <> 'READY' or v_request.content is null
    or v_request.expires_at is null or v_request.expires_at <= now()
    or v_request.download_count >= 3 then
    raise exception 'Export download is no longer available.' using errcode = '55000';
  end if;

  update public.ops_export_requests
  set download_count = download_count + 1, last_downloaded_at = now()
  where id = v_request.id
  returning * into v_request;

  insert into public.ops_export_events (
    export_request_id, event_type, actor_principal_id, actor_label,
    summary, details, correlation_id
  ) values (
    v_request.id, 'DOWNLOADED', p_actor_principal_id, v_request.requester_email,
    'The requesting operator consumed a short-lived export download.',
    jsonb_build_object('downloadCount', v_request.download_count), p_correlation_id
  );

  return jsonb_build_object(
    'id', v_request.id,
    'reference', v_request.reference,
    'dataset', v_request.dataset,
    'content', v_request.content,
    'sha256', v_request.content_sha256,
    'rowCount', v_request.row_count,
    'sourceWatermark', v_request.source_watermark,
    'expiresAt', v_request.expires_at,
    'downloadCount', v_request.download_count
  );
end;
$$;

revoke all on function public.set_ops_export_updated_at() from public, anon, authenticated;
revoke all on function public.request_ops_export(text, text, jsonb, integer, text, uuid, text, text, text, boolean, uuid) from public, anon, authenticated;
revoke all on function public.claim_ops_export(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_ops_export(uuid, uuid, uuid, text, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_ops_export(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.consume_ops_export_download(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.request_ops_export(text, text, jsonb, integer, text, uuid, text, text, text, boolean, uuid) to service_role;
grant execute on function public.claim_ops_export(uuid, uuid, uuid) to service_role;
grant execute on function public.complete_ops_export(uuid, uuid, uuid, text, text, integer, timestamptz) to service_role;
grant execute on function public.fail_ops_export(uuid, uuid, uuid, text) to service_role;
grant execute on function public.consume_ops_export_download(uuid, uuid, uuid) to service_role;
