-- Provider transfer and bank settlement are separate facts. In particular, a
-- Stripe transfer only reaches the connected-account balance; it is not proof
-- that the tailor's bank received the money.

alter table public.payouts
  add column if not exists provider_transfer_status text not null default 'NOT_STARTED',
  add column if not exists bank_settlement_status text not null default 'UNKNOWN',
  add column if not exists provider_destination_id text,
  add column if not exists provider_bank_payout_id text,
  add column if not exists bank_settlement_expected_at timestamptz,
  add column if not exists bank_settlement_completed_at timestamptz,
  add column if not exists bank_settlement_failed_at timestamptz,
  add column if not exists bank_settlement_failure_code text;

alter table public.payouts drop constraint if exists payouts_provider_transfer_status_check;
alter table public.payouts add constraint payouts_provider_transfer_status_check check (
  provider_transfer_status in (
    'NOT_STARTED', 'PROCESSING', 'AVAILABLE_IN_PROVIDER_BALANCE',
    'PAID_TO_BANK', 'FAILED', 'REVERSED'
  )
);

alter table public.payouts drop constraint if exists payouts_bank_settlement_status_check;
alter table public.payouts add constraint payouts_bank_settlement_status_check check (
  bank_settlement_status in (
    'NOT_APPLICABLE', 'PENDING', 'IN_TRANSIT', 'PAID',
    'FAILED', 'CANCELED', 'UNKNOWN'
  )
);

update public.payouts
set
  provider_transfer_status = case
    when provider = 'PAYSTACK' and status = 'PAID' then 'PAID_TO_BANK'
    when provider = 'STRIPE' and status = 'PAID' then 'AVAILABLE_IN_PROVIDER_BALANCE'
    when status = 'PROCESSING' then 'PROCESSING'
    when status = 'FAILED' then 'FAILED'
    when status = 'REVERSED' then 'REVERSED'
    else provider_transfer_status
  end,
  bank_settlement_status = case
    when provider = 'PAYSTACK' and status = 'PAID' then 'PAID'
    when provider = 'PAYSTACK' then 'NOT_APPLICABLE'
    when provider = 'STRIPE' and status = 'PAID' then 'UNKNOWN'
    else bank_settlement_status
  end,
  bank_settlement_completed_at = case
    when provider = 'PAYSTACK' and status = 'PAID' then coalesce(bank_settlement_completed_at, completed_at, processed_at)
    else bank_settlement_completed_at
  end
where provider_transfer_status = 'NOT_STARTED'
   or bank_settlement_status = 'UNKNOWN';

create index if not exists payouts_provider_bank_payout_id_idx
  on public.payouts (provider, provider_bank_payout_id)
  where provider_bank_payout_id is not null;

create index if not exists payouts_destination_settlement_idx
  on public.payouts (provider, provider_destination_id, bank_settlement_status, initiated_at desc);

create table if not exists public.provider_payout_events (
  id uuid primary key default gen_random_uuid(),
  provider payment_provider not null,
  provider_event_id text not null,
  event_type text not null,
  provider_destination_id text,
  provider_bank_payout_id text,
  payout_id text references public.payouts(id) on delete set null,
  -- tailor_profiles.id is a legacy text identifier in the authoritative schema.
  -- Keep provider observations compatible with that boundary rather than
  -- coercing it to the UUID used by auth.users/profile ownership.
  tailor_profile_id text references public.tailor_profiles(id) on delete set null,
  amount integer,
  currency currency,
  status text,
  arrival_at timestamptz,
  failure_code text,
  failure_message text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz,
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index if not exists provider_payout_events_destination_idx
  on public.provider_payout_events (provider, provider_destination_id, created_at desc);

create index if not exists provider_payout_events_payout_idx
  on public.provider_payout_events (payout_id, created_at desc)
  where payout_id is not null;

alter table public.provider_payout_events enable row level security;

drop policy if exists provider_payout_events_tailor_read on public.provider_payout_events;
create policy provider_payout_events_tailor_read
on public.provider_payout_events
for select
to authenticated
using (
  exists (
    select 1
    from public.tailor_profiles tp
    where tp.id = provider_payout_events.tailor_profile_id
      and tp.user_id = auth.uid()::text
  )
);

comment on column public.payouts.provider_payout_id is
  'Provider release reference. For Stripe this is a transfer ID, not a bank payout ID.';
comment on column public.payouts.provider_bank_payout_id is
  'Exact provider bank-payout reference when a provider event can be safely linked to this payout.';
comment on table public.provider_payout_events is
  'Immutable provider settlement observations. Unlinked Stripe auto-payout events remain account-level and must not falsely complete an order payout.';
