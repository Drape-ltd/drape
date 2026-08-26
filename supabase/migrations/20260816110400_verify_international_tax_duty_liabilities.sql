-- Rollback-only 11D proof. A savepoint guarantees no synthetic corridor or
-- ledger state survives verification.
begin;
savepoint verify_11d;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'commercial_ledger_entries_account_code_check'
      and pg_get_constraintdef(oid) like '%IMPORT_TAX_LIABILITY%'
      and pg_get_constraintdef(oid) like '%DUTY_LIABILITY%'
  ) then raise exception '11D ledger liability accounts are unavailable'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='tax_corridor_controls'
      and column_name='import_tax_rate_bps'
  ) then raise exception '11D reviewed corridor calculation fields are unavailable'; end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tax_corridor_controls_reviewed_collection_check'
      and pg_get_constraintdef(oid) like '%REVIEWED_STATIC%'
      and pg_get_constraintdef(oid) like '%required_export_evidence%'
      and pg_get_constraintdef(oid) like '%required_customs_fields%'
  ) then raise exception '11D collected-at-checkout corridor guard is unavailable'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='commercial_receipts'
      and column_name='tax_collection_mode'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='orders'
      and column_name='duty_amount'
  ) then raise exception '11D party-safe order and receipt fields are unavailable'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='tax_decision_ops'
      and column_name='required_customs_fields'
  ) then raise exception '11D Ops decision-chain evidence is unavailable'; end if;
end $$;

rollback to savepoint verify_11d;
commit;
