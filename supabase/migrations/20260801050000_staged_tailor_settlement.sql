-- Drapeon commercial architecture, implementation 8.
-- New-policy orders use evidence-backed staged settlement. Existing orders
-- remain on the legacy single-release contract they accepted.

create table public.order_settlement_plans (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique references public.orders(id) on delete restrict,
  customer_id uuid not null references auth.users(id) on delete restrict,
  tailor_id uuid not null references auth.users(id) on delete restrict,
  source_payment_id uuid not null references public.order_payments(id) on delete restrict,
  method text not null check (method in ('SHIPPED', 'LOCAL_HANDOFF')),
  policy_version text not null default 'settlement-2026-08-01-v1',
  currency currency not null,
  entitlement_amount integer not null check (entitlement_amount > 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'FROZEN', 'SETTLED', 'CANCELLED')),
  frozen_reason text,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_settlement_tranches (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.order_settlement_plans(id) on delete restrict,
  order_id text not null references public.orders(id) on delete restrict,
  code text not null check (code in ('SHIP_CUSTODY_70','SHIP_DELIVERY_20','SHIP_PROTECTION_10','LOCAL_HANDOFF_80','LOCAL_SETTLED_20')),
  sequence integer not null check (sequence between 1 and 3),
  basis_points integer not null check (basis_points > 0 and basis_points <= 10000),
  amount integer not null check (amount > 0),
  currency currency not null,
  status text not null default 'LOCKED' check (status in ('LOCKED','ELIGIBLE','RELEASE_REQUESTED','RELEASED','BLOCKED','CANCELLED')),
  eligible_at timestamptz,
  released_at timestamptz,
  blocked_reason text,
  eligibility_ledger_transaction_id uuid references public.commercial_ledger_transactions(id) on delete restrict,
  release_ledger_transaction_id uuid references public.commercial_ledger_transactions(id) on delete restrict,
  payout_id text references public.payouts(id) on delete restrict,
  money_desk_request_id uuid references public.money_desk_requests(id) on delete restrict,
  provider_reference text,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, code),
  unique (order_id, sequence),
  check ((status = 'RELEASED') = (released_at is not null))
);

create table public.order_settlement_evidence (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.order_settlement_plans(id) on delete restrict,
  order_id text not null references public.orders(id) on delete restrict,
  evidence_kind text not null check (evidence_kind in ('DRAPEON_CUSTODY','CARRIER_ACCEPTED','VERIFIED_DELIVERY','AUTHENTICATED_LOCAL_HANDOFF')),
  source text not null check (source in ('DRAPEON_OPS','TRUSTED_CARRIER','CUSTOMER_CONFIRMATION','COLLECTION_CODE','SYSTEM_MIGRATION')),
  occurred_at timestamptz not null,
  external_reference text,
  recorded_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (plan_id, evidence_kind)
);

create table public.order_settlement_events (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.order_settlement_plans(id) on delete restrict,
  tranche_id uuid references public.order_settlement_tranches(id) on delete restrict,
  event_type text not null,
  actor_role text not null check (actor_role in ('CUSTOMER','TAILOR','OPS','SYSTEM')),
  payload jsonb not null default '{}'::jsonb,
  correlation_id uuid not null,
  created_at timestamptz not null default now()
);

alter table public.payouts add column if not exists settlement_tranche_id uuid references public.order_settlement_tranches(id) on delete restrict;
create unique index payouts_settlement_tranche_unique on public.payouts(settlement_tranche_id) where settlement_tranche_id is not null and status in ('PROCESSING','PAID');
create index order_settlement_tranches_queue_idx on public.order_settlement_tranches(status, eligible_at, created_at);
create index order_settlement_evidence_order_idx on public.order_settlement_evidence(order_id, occurred_at);

create or replace function public.prevent_settlement_evidence_mutation() returns trigger language plpgsql as $$
begin raise exception 'Settlement evidence and events are append-only.'; end; $$;
create trigger order_settlement_evidence_append_only before update or delete on public.order_settlement_evidence for each row execute function public.prevent_settlement_evidence_mutation();
create trigger order_settlement_events_append_only before update or delete on public.order_settlement_events for each row execute function public.prevent_settlement_evidence_mutation();

create or replace function public.initialize_order_settlement_plan(p_order_id text)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_order public.orders%rowtype; v_payment public.order_payments%rowtype; v_plan uuid; v_method text; v_amount integer; v_currency currency; v_correlation uuid; v_allocated integer:=0; v_amounts integer[]; v_codes text[]; v_bps integer[]; i integer;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'Order was not found.'; end if;
  if v_order.commercial_policy_version <> 'commercial-2026-07-31-v1' then return null; end if;
  select * into v_payment from public.order_payments where order_id=p_order_id and phase='INITIAL_ORDER' and status in ('SUCCEEDED','PARTIAL_REFUND') order by confirmed_at desc nulls last limit 1;
  if v_payment.id is null or v_payment.ledger_recorded_at is null then raise exception 'A ledger-recorded initial payment is required.'; end if;
  select coalesce((v_payment.commercial_breakdown->>'subtotalAmount')::integer, v_order.subtotal_amount, v_order.source_amount) into v_amount;
  if coalesce(v_amount,0)<=0 then raise exception 'Tailor entitlement is missing.'; end if;
  v_currency:=v_payment.currency; v_correlation:=v_payment.correlation_id;
  v_method:=case when v_order.delivery_method='LOCAL_COLLECTION' then 'LOCAL_HANDOFF' else 'SHIPPED' end;
  insert into public.order_settlement_plans(order_id,customer_id,tailor_id,source_payment_id,method,currency,entitlement_amount,correlation_id)
  values(p_order_id,v_order.customer_id::uuid,v_order.tailor_id::uuid,v_payment.id,v_method,v_currency,v_amount,v_correlation)
  on conflict(order_id) do nothing returning id into v_plan;
  if v_plan is null then select id into v_plan from public.order_settlement_plans where order_id=p_order_id; return v_plan; end if;
  if v_method='LOCAL_HANDOFF' then v_codes:=array['LOCAL_HANDOFF_80','LOCAL_SETTLED_20']; v_bps:=array[8000,2000]; else v_codes:=array['SHIP_CUSTODY_70','SHIP_DELIVERY_20','SHIP_PROTECTION_10']; v_bps:=array[7000,2000,1000]; end if;
  v_amounts:=array[]::integer[];
  for i in 1..array_length(v_codes,1) loop v_amounts:=array_append(v_amounts,(v_amount::bigint*v_bps[i]/10000)::integer); v_allocated:=v_allocated+v_amounts[i]; end loop;
  v_amounts[1]:=v_amounts[1]+(v_amount-v_allocated);
  for i in 1..array_length(v_codes,1) loop
    insert into public.order_settlement_tranches(plan_id,order_id,code,sequence,basis_points,amount,currency,correlation_id)
    values(v_plan,p_order_id,v_codes[i],i,v_bps[i],v_amounts[i],v_currency,v_correlation);
  end loop;
  insert into public.order_settlement_events(plan_id,event_type,actor_role,payload,correlation_id) values(v_plan,'PLAN_CREATED','SYSTEM',jsonb_build_object('method',v_method,'entitlement_amount',v_amount,'currency',v_currency),v_correlation);
  return v_plan;
end $$;

create or replace function public.record_order_settlement_evidence(p_order_id text,p_evidence_kind text,p_source text,p_occurred_at timestamptz,p_external_reference text default null,p_recorded_by uuid default null,p_metadata jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_plan public.order_settlement_plans%rowtype; v_id uuid;
begin
  if p_evidence_kind not in ('DRAPEON_CUSTODY','CARRIER_ACCEPTED','VERIFIED_DELIVERY','AUTHENTICATED_LOCAL_HANDOFF') then raise exception 'Unsupported settlement evidence.'; end if;
  if p_source not in ('DRAPEON_OPS','TRUSTED_CARRIER','CUSTOMER_CONFIRMATION','COLLECTION_CODE','SYSTEM_MIGRATION') then raise exception 'Unsupported evidence source.'; end if;
  select * into v_plan from public.order_settlement_plans where order_id=p_order_id;
  if v_plan.id is null then v_plan.id:=public.initialize_order_settlement_plan(p_order_id); select * into v_plan from public.order_settlement_plans where id=v_plan.id; end if;
  if v_plan.id is null then return null; end if;
  insert into public.order_settlement_evidence(plan_id,order_id,evidence_kind,source,occurred_at,external_reference,recorded_by,metadata,correlation_id)
  values(v_plan.id,p_order_id,p_evidence_kind,p_source,p_occurred_at,nullif(trim(coalesce(p_external_reference,'')),''),p_recorded_by,coalesce(p_metadata,'{}'::jsonb),v_plan.correlation_id)
  on conflict(plan_id,evidence_kind) do nothing returning id into v_id;
  if v_id is not null then insert into public.order_settlement_events(plan_id,event_type,actor_role,payload,correlation_id) values(v_plan.id,'EVIDENCE_RECORDED',case when p_recorded_by is null then 'SYSTEM' else 'OPS' end,jsonb_build_object('evidence_kind',p_evidence_kind,'source',p_source,'occurred_at',p_occurred_at),v_plan.correlation_id); end if;
  perform public.refresh_order_settlement(p_order_id);
  return v_id;
end $$;

create or replace function public.refresh_order_settlement(p_order_id text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_plan public.order_settlement_plans%rowtype; v_dispute boolean; v_custody timestamptz; v_delivery timestamptz; v_handoff timestamptz; v_row public.order_settlement_tranches%rowtype; v_due timestamptz; v_tx uuid;
begin
  select * into v_plan from public.order_settlement_plans where order_id=p_order_id for update;
  if v_plan.id is null then perform public.initialize_order_settlement_plan(p_order_id); select * into v_plan from public.order_settlement_plans where order_id=p_order_id for update; end if;
  if v_plan.id is null then return jsonb_build_object('legacy',true); end if;
  select exists(select 1 from public.disputes where order_id=p_order_id and status in ('OPEN','UNDER_REVIEW')) or exists(select 1 from public.financial_cases where order_id=p_order_id and status not in ('RESOLVED','CLOSED','CANCELLED')) into v_dispute;
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

create or replace function public.sync_settlement_evidence_from_order() returns trigger language plpgsql security definer set search_path=public,extensions as $$
begin
  if new.commercial_policy_version='commercial-2026-07-31-v1' and new.customer_handoff_confirmed_at is not null and old.customer_handoff_confirmed_at is null then
    perform public.initialize_order_settlement_plan(new.id);
    if new.delivery_method='LOCAL_COLLECTION' and new.collection_code_used=true then perform public.record_order_settlement_evidence(new.id,'AUTHENTICATED_LOCAL_HANDOFF','COLLECTION_CODE',new.customer_handoff_confirmed_at,new.collection_code,null,jsonb_build_object('confirmation_source',new.handoff_confirmation_source));
    elsif new.delivery_method<>'LOCAL_COLLECTION' then perform public.record_order_settlement_evidence(new.id,'VERIFIED_DELIVERY','CUSTOMER_CONFIRMATION',new.customer_handoff_confirmed_at,null,new.customer_id,jsonb_build_object('confirmation_source',new.handoff_confirmation_source)); end if;
  end if;
  return new;
end $$;
create trigger orders_sync_settlement_evidence after update of customer_handoff_confirmed_at on public.orders for each row execute function public.sync_settlement_evidence_from_order();

alter table public.order_settlement_plans enable row level security;
alter table public.order_settlement_tranches enable row level security;
alter table public.order_settlement_evidence enable row level security;
alter table public.order_settlement_events enable row level security;
create policy settlement_plans_parties_read on public.order_settlement_plans for select to authenticated using (auth.uid()=customer_id or auth.uid()=tailor_id);
create policy settlement_tranches_parties_read on public.order_settlement_tranches for select to authenticated using (exists(select 1 from public.order_settlement_plans p where p.id=plan_id and (p.customer_id=auth.uid() or p.tailor_id=auth.uid())));
create policy settlement_evidence_parties_read on public.order_settlement_evidence for select to authenticated using (exists(select 1 from public.order_settlement_plans p where p.id=plan_id and (p.customer_id=auth.uid() or p.tailor_id=auth.uid())));
create policy settlement_events_parties_read on public.order_settlement_events for select to authenticated using (exists(select 1 from public.order_settlement_plans p where p.id=plan_id and (p.customer_id=auth.uid() or p.tailor_id=auth.uid())));
revoke all on public.order_settlement_plans,public.order_settlement_tranches,public.order_settlement_evidence,public.order_settlement_events from anon,authenticated;
grant select on public.order_settlement_plans,public.order_settlement_tranches,public.order_settlement_evidence,public.order_settlement_events to authenticated;
grant all on public.order_settlement_plans,public.order_settlement_tranches,public.order_settlement_evidence,public.order_settlement_events to service_role;
revoke all on function public.initialize_order_settlement_plan(text),public.record_order_settlement_evidence(text,text,text,timestamptz,text,uuid,jsonb),public.refresh_order_settlement(text) from public,anon,authenticated;
grant execute on function public.initialize_order_settlement_plan(text),public.record_order_settlement_evidence(text,text,text,timestamptz,text,uuid,jsonb),public.refresh_order_settlement(text) to service_role;

comment on table public.order_settlement_plans is 'Versioned settlement plan over only the tailor entitlement; legacy orders never enter this table.';
comment on table public.order_settlement_evidence is 'Append-only verified custody, delivery, and authenticated handoff evidence. Labels and ready claims are intentionally insufficient.';
