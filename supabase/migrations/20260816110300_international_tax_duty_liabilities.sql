-- Implementation 11D: an international checkout may collect import tax or
-- duty only from an immutable reviewed corridor calculation. No corridor is
-- seeded or activated by this migration.

alter table public.tax_corridor_controls
  add column if not exists required_export_evidence text[] not null default '{}',
  add column if not exists required_customs_fields text[] not null default '{}',
  add column if not exists calculation_strategy text,
  add column if not exists calculation_provider text,
  add column if not exists import_tax_rate_bps integer,
  add column if not exists duty_rate_bps integer,
  add column if not exists import_tax_base text,
  add column if not exists duty_base text,
  add column if not exists import_tax_liability_account text,
  add column if not exists duty_liability_account text;

alter table public.tax_corridor_controls
  add constraint tax_corridor_controls_calculation_strategy_check
    check (calculation_strategy is null or calculation_strategy in ('REVIEWED_STATIC','PROVIDER','PAYABLE_ON_IMPORT','BLOCKED')),
  add constraint tax_corridor_controls_import_rate_check
    check (import_tax_rate_bps is null or import_tax_rate_bps between 0 and 10000),
  add constraint tax_corridor_controls_duty_rate_check
    check (duty_rate_bps is null or duty_rate_bps between 0 and 10000),
  add constraint tax_corridor_controls_import_base_check
    check (import_tax_base is null or import_tax_base in ('SUBTOTAL','SUBTOTAL_AND_SHIPPING','SUBTOTAL_SHIPPING_AND_DUTY')),
  add constraint tax_corridor_controls_duty_base_check
    check (duty_base is null or duty_base in ('SUBTOTAL','SUBTOTAL_AND_SHIPPING')),
  add constraint tax_corridor_controls_reviewed_collection_check check (
    status not in ('APPROVED','ACTIVE')
    or collection_mode <> 'COLLECTED_AT_CHECKOUT'
    or (
      calculation_strategy = 'REVIEWED_STATIC'
      and import_tax_rate_bps is not null
      and duty_rate_bps is not null
      and import_tax_base is not null
      and duty_base is not null
      and char_length(trim(import_tax_liability_account)) > 0
      and char_length(trim(duty_liability_account)) > 0
      and cardinality(required_export_evidence) > 0
      and cardinality(required_customs_fields) > 0
    )
  );

alter table public.commercial_ledger_entries
  drop constraint if exists commercial_ledger_entries_account_code_check;
alter table public.commercial_ledger_entries
  add constraint commercial_ledger_entries_account_code_check check (account_code in (
    'CUSTOMER_RECEIVABLE','PROVIDER_CLEARING','PROVIDER_FEE_EXPENSE',
    'TAILOR_ENTITLEMENT','TAILOR_ELIGIBLE','TAILOR_RELEASED',
    'CONSULTATION_ENTITLEMENT','MATERIAL_ADVANCE_LIABILITY',
    'FULFILLMENT_LIABILITY','TAX_LIABILITY','IMPORT_TAX_LIABILITY',
    'DUTY_LIABILITY','TIP_LIABILITY','DRAPEON_SUBSIDY_EXPENSE','DRAPEON_REVENUE'
  ));

alter table public.tax_decision_snapshots
  add column if not exists import_tax_liability_account text,
  add column if not exists duty_liability_account text,
  add column if not exists required_export_evidence text[] not null default '{}',
  add column if not exists required_customs_fields text[] not null default '{}';

alter table public.commercial_receipts
  add column if not exists import_tax_amount integer not null default 0 check (import_tax_amount >= 0),
  add column if not exists duty_amount integer not null default 0 check (duty_amount >= 0),
  add column if not exists tax_collection_mode text check (tax_collection_mode is null or tax_collection_mode in ('COLLECTED_AT_CHECKOUT','PAYABLE_ON_IMPORT','BLOCKED')),
  add column if not exists tax_responsible_party text check (tax_responsible_party is null or tax_responsible_party in ('TAILOR','DRAPEON_MARKETPLACE_FACILITATOR','CUSTOMER_IMPORTER')),
  add column if not exists import_treatment text;

alter table public.orders
  add column if not exists import_tax_amount integer not null default 0 check (import_tax_amount >= 0),
  add column if not exists duty_amount integer not null default 0 check (duty_amount >= 0),
  add column if not exists tax_collection_mode text check (tax_collection_mode is null or tax_collection_mode in ('COLLECTED_AT_CHECKOUT','PAYABLE_ON_IMPORT','BLOCKED')),
  add column if not exists tax_responsible_party text check (tax_responsible_party is null or tax_responsible_party in ('TAILOR','DRAPEON_MARKETPLACE_FACILITATOR','CUSTOMER_IMPORTER'));

create or replace function public.copy_receipt_tax_decision_snapshot()
returns trigger language plpgsql as $$
begin
  if new.tax_decision_snapshot_id is null then
    select r.tax_decision_snapshot_id into new.tax_decision_snapshot_id
    from public.commercial_pricing_reservations r where r.id = new.pricing_reservation_id;
  end if;
  if new.tax_decision_snapshot_id is not null then
    select s.import_tax_amount, s.duty_amount, s.collection_mode, s.responsible_party, s.import_treatment
      into new.import_tax_amount, new.duty_amount, new.tax_collection_mode, new.tax_responsible_party, new.import_treatment
    from public.tax_decision_snapshots s where s.id = new.tax_decision_snapshot_id;
  end if;
  return new;
end;
$$;

create or replace view public.tax_decision_ops as
select
  s.id as snapshot_id, s.environment, s.order_id, s.quote_id, s.payment_id,
  s.activation_id, s.policy_version, s.tax_transaction_type, s.fulfillment_classification,
  s.jurisdiction_country_code, s.jurisdiction_region_code, s.corridor_key,
  s.tax_supply_characterization, s.liability_granularity, s.responsible_party,
  s.registration_subject, s.registration_decision, s.line_classifications,
  s.collection_mode, s.export_treatment, s.import_treatment, s.shipping_taxable,
  s.carrier_constraints, s.subtotal_amount, s.shipping_amount, s.tax_amount,
  s.import_tax_amount, s.duty_amount, s.currency, s.calculation_provider,
  s.calculation_reference, s.filing_liability_account, s.source_urls,
  s.reviewed_at, s.review_due_at, s.decision_fingerprint, s.correlation_id, s.created_at,
  s.import_tax_liability_account, s.duty_liability_account,
  s.required_export_evidence, s.required_customs_fields
from public.tax_decision_snapshots s;

revoke all on public.tax_decision_ops from public, anon, authenticated;
grant select on public.tax_decision_ops to service_role;

comment on column public.tax_corridor_controls.import_tax_rate_bps is
  'Reviewed destination import-tax rate. Null never means zero for collected-at-checkout corridors.';
comment on column public.tax_corridor_controls.duty_rate_bps is
  'Reviewed duty rate. Null never means zero for collected-at-checkout corridors.';
