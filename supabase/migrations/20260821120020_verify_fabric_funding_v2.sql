-- Deployment gate for fabric funding policy v2. This migration is deliberately
-- assertion-only: a partially installed contract must fail the DEV push.

do $$
declare
  v_definition text;
begin
  if to_regclass('public.order_fabric_candidates') is null
    or to_regclass('public.order_fabric_handoffs') is null
    or to_regclass('public.order_fabric_events') is null then
    raise exception 'FABRIC_V2_TABLES_MISSING';
  end if;

  if to_regprocedure('public.submit_fabric_candidate_v2(text,uuid,text,integer,currency,text,jsonb,text,text,text,text,uuid,text)') is null
    or to_regprocedure('public.decide_fabric_candidate_v2(uuid,uuid,text,text,text)') is null
    or to_regprocedure('public.mark_fabric_candidate_shortfall_paid_v2(uuid,uuid)') is null
    or to_regprocedure('public.record_fabric_candidate_release_outcome_v2(uuid,text,text,text,text,jsonb)') is null
    or to_regprocedure('public.reconcile_fabric_candidate_v2(uuid,uuid,text,jsonb,integer)') is null
    or to_regprocedure('public.save_fabric_handoff_v2(text,uuid,text,text,text,text,text,timestamptz,text,text)') is null
    or to_regprocedure('public.confirm_fabric_handoff_receipt_v2(text,uuid,text,jsonb,text)') is null
    or to_regprocedure('public.resolve_fabric_handoff_issue_v2(text,uuid,text,text)') is null
    or to_regprocedure('public.get_order_fabric_cutting_blockers_v2(text)') is null then
    raise exception 'FABRIC_V2_FUNCTION_CONTRACT_MISSING';
  end if;

  if has_function_privilege('authenticated', 'public.submit_fabric_candidate_v2(text,uuid,text,integer,currency,text,jsonb,text,text,text,text,uuid,text)', 'execute')
    or not has_function_privilege('service_role', 'public.submit_fabric_candidate_v2(text,uuid,text,integer,currency,text,jsonb,text,text,text,text,uuid,text)', 'execute') then
    raise exception 'FABRIC_V2_RPC_PRIVILEGE_BOUNDARY_INVALID';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'order_fabric_events_append_only' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgname = 'order_fabric_candidate_identity' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgname = 'orders_guard_funded_fabric_cutting' and not tgisinternal
  ) then
    raise exception 'FABRIC_V2_IMMUTABILITY_OR_CUTTING_TRIGGER_MISSING';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'order_fabric_candidates_one_active_component_idx'
  ) or not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'payouts_fabric_candidate_idx'
  ) or not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'order_payments_fabric_candidate_active_idx'
  ) then
    raise exception 'FABRIC_V2_IDEMPOTENCY_INDEX_MISSING';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'order_fabric_candidates' and c.relrowsecurity
  ) or not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'order_fabric_handoffs' and c.relrowsecurity
  ) then
    raise exception 'FABRIC_V2_RLS_MISSING';
  end if;

  select pg_get_functiondef('public.get_order_fabric_cutting_blockers_v2(text)'::regprocedure)
    into v_definition;
  if position('MEASUREMENTS_NOT_READY' in v_definition) = 0
    or position('STYLE_NOT_APPROVED' in v_definition) = 0
    or position('FABRIC_CUSTOMER_APPROVAL_REQUIRED' in v_definition) = 0
    or position('FABRIC_RELEASE_NOT_SUCCESSFUL' in v_definition) = 0
    or position('FABRIC_RECEIPT_REQUIRED' in v_definition) = 0
    or position('ACQUIRED_FABRIC_PROOF_REQUIRED' in v_definition) = 0
    or position('FABRIC_RECONCILIATION_REQUIRED' in v_definition) = 0
    or position('CUSTOMER_FABRIC_RECEIPT_PROOF_REQUIRED' in v_definition) = 0 then
    raise exception 'FABRIC_V2_CUTTING_BLOCKER_MATRIX_INCOMPLETE';
  end if;

  select pg_get_functiondef('public.record_fabric_candidate_release_outcome_v2(uuid,text,text,text,text,jsonb)'::regprocedure)
    into v_definition;
  if position('fabric-candidate-release:' in v_definition) = 0
    or position('MATERIAL_ADVANCE_LIABILITY' in v_definition) = 0
    or position('TAILOR_RELEASED' in v_definition) = 0
    or position('on conflict(idempotency_key) do nothing' in lower(v_definition)) = 0 then
    raise exception 'FABRIC_V2_RELEASE_LEDGER_IDEMPOTENCY_MISSING';
  end if;

  select pg_get_functiondef('public.initialize_order_settlement_plan(text)'::regprocedure)
    into v_definition;
  if position('fabric-funding-2026-08-21-v2' in v_definition) = 0
    or position('excluded_fabric_allowance_amount' in v_definition) = 0 then
    raise exception 'FABRIC_V2_SETTLEMENT_EXCLUSION_MISSING';
  end if;

  if exists (
    select 1 from public.order_fabric_candidates
    where estimate_storage_path ~* '^https?://'
      or receipt_storage_path ~* '^https?://'
  ) then
    raise exception 'FABRIC_V2_PUBLIC_EVIDENCE_URL_FOUND';
  end if;

  if (
    select count(*) from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public'
      and tablename in ('order_fabric_candidates','order_fabric_handoffs','order_fabric_events')
  ) <> 3 then
    raise exception 'FABRIC_V2_REALTIME_PUBLICATION_INCOMPLETE';
  end if;
end $$;
