do $$
begin
  if not exists (
    select 1 from cron.job where jobname = 'monitor-material-reconciliation'
  ) then
    raise exception 'material reconciliation monitor schedule is missing';
  end if;

  if to_regclass('public.notification_delivery_outcomes') is null then
    raise exception 'terminal notification delivery outcomes are missing';
  end if;

  if to_regclass('public.ops_issues') is null or to_regclass('public.ops_audit_logs') is null then
    raise exception 'Ops alert and audit contracts are missing';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'finalize_material_unused_value_refund'
  ) then
    raise exception 'idempotent material refund finalization is missing';
  end if;

  raise notice 'Section 6 material notification, Ops alert, terminal delivery, and recovery contracts passed.';
end $$;
