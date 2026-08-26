-- Persist Expo push tickets and reconcile their receipts. Ticket acceptance only
-- proves Expo accepted the request; it does not prove APNs/FCM accepted it.

do $$
declare
  push_token_id_type text;
begin
  if to_regclass('public.push_delivery_attempts') is null then
    select format_type(attribute.atttypid, attribute.atttypmod)
      into push_token_id_type
    from pg_attribute attribute
    where attribute.attrelid = 'public.push_tokens'::regclass
      and attribute.attname = 'id'
      and attribute.attnum > 0
      and not attribute.attisdropped;

    if push_token_id_type is null then
      raise exception 'Could not resolve public.push_tokens.id type';
    end if;

    -- Older environments used text IDs while newer projects use UUID IDs.
    -- Derive the live type so the receipt foreign key remains valid in both.
    execute format($table$
      create table public.push_delivery_attempts (
        id uuid primary key default gen_random_uuid(),
        user_id uuid references auth.users(id) on delete set null,
        push_token_id %s references public.push_tokens(id) on delete set null,
        provider text not null default 'EXPO' check (provider in ('EXPO')),
        ticket_id text,
        status text not null check (
          status in (
            'TICKET_ACCEPTED',
            'TICKET_ERROR',
            'RECEIPT_PENDING',
            'PROVIDER_ACCEPTED',
            'DELIVERY_ERROR',
            'RECEIPT_EXPIRED'
          )
        ),
        notification_kind text,
        order_id uuid,
        message_id uuid,
        error_code text,
        error_message text,
        receipt_check_count integer not null default 0 check (receipt_check_count >= 0),
        next_check_at timestamptz,
        ticket_created_at timestamptz not null default now(),
        receipt_checked_at timestamptz,
        provider_accepted_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    $table$, push_token_id_type);
  end if;
end $$;

create unique index if not exists push_delivery_attempts_ticket_key
  on public.push_delivery_attempts (ticket_id)
  where ticket_id is not null;

create index if not exists push_delivery_attempts_due_idx
  on public.push_delivery_attempts (next_check_at, ticket_created_at)
  where status in ('TICKET_ACCEPTED', 'RECEIPT_PENDING');

create index if not exists push_delivery_attempts_user_created_idx
  on public.push_delivery_attempts (user_id, created_at desc);

create index if not exists push_delivery_attempts_order_created_idx
  on public.push_delivery_attempts (order_id, created_at desc)
  where order_id is not null;

alter table public.push_delivery_attempts enable row level security;

revoke all on table public.push_delivery_attempts from anon, authenticated;
grant select, insert, update, delete on table public.push_delivery_attempts to service_role;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'process-push-receipts';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'process-push-receipts',
    '*/5 * * * *',
    $job$select util.invoke_edge_function('process-push-receipts', '{"limit":500}'::jsonb, 300000);$job$
  );
end $$;
