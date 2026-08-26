do $$ begin
  if to_regprocedure('public.reconcile_material_advance_v2(uuid,uuid,integer,text,text,text,text,text,text,uuid)') is null then raise exception 'v2 material reconciliation missing'; end if;
  if to_regprocedure('public.resolve_material_overage_as_tailor_absorbed(uuid,text,text)') is null then raise exception 'overage resolution missing'; end if;
  if to_regprocedure('public.prepare_material_unused_value_refund(uuid,uuid,text)') is null then raise exception 'unused-value refund preparation missing'; end if;
  if to_regprocedure('public.finalize_material_unused_value_refund(uuid,uuid,text)') is null then raise exception 'unused-value refund finalization missing'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='order_settlement_plans' and column_name='excluded_fabric_allowance_amount') then raise exception 'settlement fabric exclusion missing'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='order_fabric_funding_allocations' and column_name='recovered_amount') then raise exception 'fabric recovery accounting missing'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='order_material_advances' and column_name='protected_allowance_refund_amount') then raise exception 'protected allowance refund accounting missing'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='order_material_advances' and column_name='settlement_recovery_amount') then raise exception 'settlement recovery accounting missing'; end if;
end $$;
