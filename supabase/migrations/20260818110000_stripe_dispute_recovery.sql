-- Stripe disputes and transfer reversals are provider facts, not inferred order
-- states. They freeze unreleased settlement until a reviewed terminal outcome.

create table if not exists public.provider_disputes (
  id uuid primary key default gen_random_uuid(),
  provider payment_provider not null,
  provider_dispute_id text not null,
  provider_charge_id text,
  provider_payment_id text,
  payment_id uuid references public.order_payments(id) on delete set null,
  order_id text references public.orders(id) on delete restrict,
  customer_id uuid references auth.users(id) on delete set null,
  tailor_id uuid references auth.users(id) on delete set null,
  amount integer not null check (amount > 0),
  currency currency not null,
  status text not null check (status in (
    'NEEDS_RESPONSE','UNDER_REVIEW','WON','LOST','WARNING_CLOSED','UNKNOWN'
  )),
  reason text,
  evidence_due_at timestamptz,
  money_movement_blocked boolean not null default true,
  provider_event_id text not null,
  correlation_id uuid not null default gen_random_uuid(),
  metadata jsonb not null default '{}'::jsonb,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (provider, provider_dispute_id)
);

create index if not exists provider_disputes_order_status_idx
  on public.provider_disputes (order_id, status, updated_at desc);

alter table public.provider_disputes enable row level security;
drop policy if exists provider_disputes_parties_read on public.provider_disputes;
create policy provider_disputes_parties_read
on public.provider_disputes for select to authenticated
using (auth.uid() = customer_id or auth.uid() = tailor_id);

revoke all on public.provider_disputes from anon, authenticated;
grant select on public.provider_disputes to authenticated;
grant all on public.provider_disputes to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'provider_disputes'
  ) then
    alter publication supabase_realtime add table public.provider_disputes;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'order_settlement_plans'
  ) then
    alter publication supabase_realtime add table public.order_settlement_plans;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'order_settlement_tranches'
  ) then
    alter publication supabase_realtime add table public.order_settlement_tranches;
  end if;
end $$;

create table if not exists public.provider_transfer_reversals (
  id uuid primary key default gen_random_uuid(),
  payout_id text not null references public.payouts(id) on delete restrict,
  money_desk_request_id uuid not null unique references public.money_desk_requests(id) on delete restrict,
  provider payment_provider not null,
  provider_transfer_id text not null,
  provider_reversal_id text,
  amount integer not null check (amount > 0),
  currency currency not null,
  reason_code text not null,
  status text not null default 'APPROVED' check (status in ('APPROVED','PROCESSING','SUCCEEDED','FAILED','BLOCKED')),
  provider_response jsonb not null default '{}'::jsonb,
  failure_code text,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.provider_transfer_reversals enable row level security;
revoke all on public.provider_transfer_reversals from anon, authenticated;
grant all on public.provider_transfer_reversals to service_role;

create or replace function public.refresh_order_settlement(p_order_id text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_plan public.order_settlement_plans%rowtype; v_dispute boolean; v_custody timestamptz; v_delivery timestamptz; v_handoff timestamptz; v_row public.order_settlement_tranches%rowtype; v_due timestamptz; v_tx uuid;
begin
  select * into v_plan from public.order_settlement_plans where order_id=p_order_id for update;
  if v_plan.id is null then perform public.initialize_order_settlement_plan(p_order_id); select * into v_plan from public.order_settlement_plans where order_id=p_order_id for update; end if;
  if v_plan.id is null then return jsonb_build_object('legacy',true); end if;
  select
    exists(select 1 from public.disputes where order_id=p_order_id and status in ('OPEN','UNDER_REVIEW'))
    or exists(select 1 from public.financial_cases where order_id=p_order_id and status not in ('RESOLVED','CANCELLED'))
    or exists(select 1 from public.provider_disputes where order_id=p_order_id and money_movement_blocked=true)
  into v_dispute;
  if v_dispute then
    update public.order_settlement_plans set status='FROZEN',frozen_reason='OPEN_REVIEW',updated_at=now() where id=v_plan.id;
    update public.order_settlement_tranches set status='BLOCKED',blocked_reason='OPEN_REVIEW',updated_at=now() where plan_id=v_plan.id and status in ('LOCKED','ELIGIBLE','RELEASE_REQUESTED');
    return jsonb_build_object('plan_id',v_plan.id,'status','FROZEN');
  end if;
  update public.order_settlement_plans set status='ACTIVE',frozen_reason=null,updated_at=now() where id=v_plan.id and status='FROZEN';
  update public.order_settlement_tranches set status='LOCKED',blocked_reason=null,updated_at=now() where plan_id=v_plan.id and status='BLOCKED' and blocked_reason='OPEN_REVIEW';
  select min(occurred_at) filter(where evidence_kind in ('DRAPEON_CUSTODY','CARRIER_ACCEPTED')),min(occurred_at) filter(where evidence_kind='VERIFIED_DELIVERY'),min(occurred_at) filter(where evidence_kind='AUTHENTICATED_LOCAL_HANDOFF') into v_custody,v_delivery,v_handoff from public.order_settlement_evidence where plan_id=v_plan.id;
  for v_row in select * from public.order_settlement_tranches where plan_id=v_plan.id and status='LOCKED' order by sequence loop
    v_due:=case v_row.code when 'SHIP_CUSTODY_70' then v_custody when 'SHIP_DELIVERY_20' then v_delivery+interval '72 hours' when 'SHIP_PROTECTION_10' then v_delivery+interval '14 days' when 'LOCAL_HANDOFF_80' then v_handoff when 'LOCAL_SETTLED_20' then v_handoff+interval '72 hours' end;
    if v_due is not null and v_due<=now() then
      select public.post_commercial_ledger_transaction('settlement-eligible:'||v_row.id,'ADJUSTMENT','SETTLEMENT_ELIGIBILITY',p_order_id,v_plan.source_payment_id,v_plan.policy_version,1,v_plan.correlation_id,null,jsonb_build_array(jsonb_build_object('accountCode','TAILOR_ENTITLEMENT','accountScope',p_order_id,'direction','DEBIT','amount',v_row.amount,'currency',v_row.currency),jsonb_build_object('accountCode','TAILOR_ELIGIBLE','accountScope',p_order_id,'direction','CREDIT','amount',v_row.amount,'currency',v_row.currency)),jsonb_build_object('tranche_id',v_row.id,'tranche_code',v_row.code),null,null,'SYSTEM',v_row.currency,v_row.amount,v_row.currency,v_row.amount,1,0) into v_tx;
      update public.order_settlement_tranches set status='ELIGIBLE',eligible_at=v_due,eligibility_ledger_transaction_id=v_tx,updated_at=now() where id=v_row.id;
      insert into public.order_settlement_events(plan_id,tranche_id,event_type,actor_role,payload,correlation_id) values(v_plan.id,v_row.id,'TRANCHE_ELIGIBLE','SYSTEM',jsonb_build_object('code',v_row.code,'amount',v_row.amount,'eligible_at',v_due),v_plan.correlation_id);
    end if;
  end loop;
  return jsonb_build_object('plan_id',v_plan.id,'status','ACTIVE');
end $$;

comment on table public.provider_disputes is
  'Signed provider dispute observations that freeze unreleased order settlement until terminal review.';
comment on table public.provider_transfer_reversals is
  'Money Desk-controlled reversals of already released provider transfers. Provider success and ledger reconciliation remain separate terminal facts.';
