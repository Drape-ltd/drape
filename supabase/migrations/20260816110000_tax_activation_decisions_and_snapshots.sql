-- Drapeon tax and fulfillment architecture, Implementations 11C-11E.
-- This migration installs the activation, decision, snapshot, monitoring, and
-- rollback boundary. It deliberately seeds no jurisdiction or corridor.

create table if not exists public.tax_policy_activations (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('DEVELOPMENT','PRODUCTION')),
  policy_version text not null references public.tax_policy_versions(policy_version) on delete restrict,
  status text not null check (status in ('DRAFT','ACTIVE','DISABLED','EXPIRED')),
  jurisdiction_country_code text not null check (jurisdiction_country_code ~ '^[A-Z]{2}$'),
  jurisdiction_region_code text,
  origin_country_code text check (origin_country_code is null or origin_country_code ~ '^[A-Z]{2}$'),
  destination_country_code text check (destination_country_code is null or destination_country_code ~ '^[A-Z]{2}$'),
  tax_transaction_type text not null check (tax_transaction_type in (
    'CUSTOM_ORDER','READY_MADE_ORDER','CONSULTATION','MATERIAL_ADVANCE',
    'ORDER_AMENDMENT','FULFILLMENT_CHARGE','TIP_OR_GRATUITY'
  )),
  fulfillment_classification text not null check (fulfillment_classification in (
    'LOCAL_COLLECTION','LOCAL_DELIVERY','INTERNATIONAL_SHIPPING'
  )),
  effective_from timestamptz not null,
  effective_to timestamptz,
  reviewed_at timestamptz not null,
  review_due_at timestamptz not null,
  legal_reviewer text not null check (char_length(trim(legal_reviewer)) > 0),
  finance_approver text not null check (char_length(trim(finance_approver)) > 0),
  engineering_approver text not null check (char_length(trim(engineering_approver)) > 0),
  source_urls text[] not null check (cardinality(source_urls) > 0),
  change_reason text not null check (char_length(trim(change_reason)) between 12 and 1000),
  supersedes_activation_id uuid references public.tax_policy_activations(id) on delete restrict,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  check (review_due_at > reviewed_at),
  check (
    fulfillment_classification = 'INTERNATIONAL_SHIPPING'
    or (origin_country_code is null and destination_country_code is null)
  ),
  check (
    fulfillment_classification <> 'INTERNATIONAL_SHIPPING'
    or (origin_country_code is not null and destination_country_code is not null and origin_country_code <> destination_country_code)
  )
);

create index if not exists tax_policy_activations_scope_idx on public.tax_policy_activations (
  environment, policy_version, jurisdiction_country_code, jurisdiction_region_code,
  origin_country_code, destination_country_code, tax_transaction_type,
  fulfillment_classification, effective_from desc, created_at desc
);

create table if not exists public.tax_registration_facts (
  id uuid primary key default gen_random_uuid(),
  registration_subject text not null check (registration_subject in ('TAILOR','DRAPEON','CUSTOMER_IMPORTER')),
  subject_id text not null check (char_length(trim(subject_id)) > 0),
  jurisdiction_country_code text not null check (jurisdiction_country_code ~ '^[A-Z]{2}$'),
  jurisdiction_region_code text,
  tax_transaction_type text not null check (tax_transaction_type in (
    'CUSTOM_ORDER','READY_MADE_ORDER','CONSULTATION','MATERIAL_ADVANCE',
    'ORDER_AMENDMENT','FULFILLMENT_CHARGE','TIP_OR_GRATUITY'
  )),
  decision text not null check (decision in ('REGISTERED','NOT_REGISTERED','NOT_REQUIRED','CUSTOMER_IMPORTER','BLOCKED')),
  taxable_turnover_minor bigint check (taxable_turnover_minor is null or taxable_turnover_minor >= 0),
  turnover_currency text check (turnover_currency is null or turnover_currency ~ '^[A-Z]{3}$'),
  measurement_period text,
  evidence_references text[] not null check (cardinality(evidence_references) > 0),
  effective_from timestamptz not null,
  effective_to timestamptz,
  reviewed_at timestamptz not null,
  review_due_at timestamptz not null,
  supersedes_fact_id uuid references public.tax_registration_facts(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  check (review_due_at > reviewed_at)
);

create index if not exists tax_registration_facts_scope_idx on public.tax_registration_facts (
  registration_subject, subject_id, jurisdiction_country_code,
  jurisdiction_region_code, tax_transaction_type, effective_from desc
);

create table if not exists public.tax_line_classification_controls (
  id uuid primary key default gen_random_uuid(),
  responsibility_control_id uuid not null references public.tax_responsibility_controls(id) on delete restrict,
  line_key text not null check (line_key in (
    'TAILORING','FABRIC_ALLOWANCE','READY_MADE_ITEM','CONSULTATION',
    'MATERIAL_ADVANCE','ORDER_AMENDMENT','FULFILLMENT','TIP'
  )),
  line_class text not null check (line_class in ('STANDARD','ZERO_RATED','EXEMPT','JURISDICTION_SPECIFIC')),
  taxable boolean not null,
  calculation_strategy text not null check (char_length(trim(calculation_strategy)) > 0),
  source_urls text[] not null check (cardinality(source_urls) > 0),
  reviewed_at timestamptz not null,
  review_due_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (responsibility_control_id, line_key),
  check (review_due_at > reviewed_at)
);

create table if not exists public.tax_decision_snapshots (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('DEVELOPMENT','PRODUCTION')),
  order_id text references public.orders(id) on delete restrict,
  quote_id uuid references public.order_quotes(id) on delete restrict,
  payment_id uuid references public.order_payments(id) on delete restrict,
  activation_id uuid not null references public.tax_policy_activations(id) on delete restrict,
  policy_version text not null,
  responsibility_control_id uuid not null references public.tax_responsibility_controls(id) on delete restrict,
  registration_control_id uuid not null references public.tax_registration_controls(id) on delete restrict,
  registration_fact_id uuid references public.tax_registration_facts(id) on delete restrict,
  corridor_control_id uuid references public.tax_corridor_controls(id) on delete restrict,
  tax_transaction_type text not null,
  fulfillment_classification text not null,
  origin_snapshot jsonb,
  destination_snapshot jsonb,
  jurisdiction_country_code text not null,
  jurisdiction_region_code text,
  corridor_key text,
  tax_supply_characterization text not null,
  liability_granularity text not null,
  responsible_party text not null,
  registration_subject text not null,
  registration_decision text not null,
  line_classifications jsonb not null,
  collection_mode text not null,
  export_treatment text,
  import_treatment text,
  shipping_taxable boolean not null,
  carrier_constraints jsonb not null default '[]'::jsonb,
  subtotal_amount bigint not null check (subtotal_amount >= 0),
  shipping_amount bigint not null check (shipping_amount >= 0),
  tax_amount bigint not null check (tax_amount >= 0),
  import_tax_amount bigint not null default 0 check (import_tax_amount >= 0),
  duty_amount bigint not null default 0 check (duty_amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  calculation_provider text not null,
  calculation_reference text,
  filing_liability_account text not null,
  source_urls text[] not null check (cardinality(source_urls) > 0),
  reviewed_at timestamptz not null,
  review_due_at timestamptz not null,
  decision_fingerprint text not null check (char_length(decision_fingerprint) >= 32),
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(line_classifications) = 'array'),
  check (tax_transaction_type in (
    'CUSTOM_ORDER','READY_MADE_ORDER','CONSULTATION','MATERIAL_ADVANCE',
    'ORDER_AMENDMENT','FULFILLMENT_CHARGE','TIP_OR_GRATUITY'
  )),
  check (fulfillment_classification in ('LOCAL_COLLECTION','LOCAL_DELIVERY','INTERNATIONAL_SHIPPING')),
  check (tax_supply_characterization in ('GOODS','SERVICES','COMPOSITE','ANCILLARY','GRATUITY','OUT_OF_SCOPE','JURISDICTION_SPECIFIC')),
  check (liability_granularity = 'ORDER'),
  check (responsible_party in ('TAILOR','DRAPEON_MARKETPLACE_FACILITATOR','CUSTOMER_IMPORTER')),
  check (registration_subject in ('TAILOR','DRAPEON','CUSTOMER_IMPORTER')),
  check (registration_decision in ('REGISTERED','NOT_REGISTERED','NOT_REQUIRED','CUSTOMER_IMPORTER','BLOCKED')),
  check (collection_mode in ('COLLECTED_AT_CHECKOUT','PAYABLE_ON_IMPORT','BLOCKED'))
);

alter table public.tax_policy_activations
  add constraint tax_policy_activations_valid_sources check (public.valid_reviewed_tax_source_urls(source_urls));
alter table public.tax_line_classification_controls
  add constraint tax_line_classification_controls_valid_sources check (public.valid_reviewed_tax_source_urls(source_urls));
alter table public.tax_decision_snapshots
  add constraint tax_decision_snapshots_valid_sources check (public.valid_reviewed_tax_source_urls(source_urls));

create unique index if not exists tax_decision_snapshots_fingerprint_idx
  on public.tax_decision_snapshots (decision_fingerprint);
create index if not exists tax_decision_snapshots_order_idx
  on public.tax_decision_snapshots (order_id, created_at desc);
create index if not exists tax_decision_snapshots_correlation_idx
  on public.tax_decision_snapshots (correlation_id);

alter table public.orders add column if not exists tax_decision_snapshot_id uuid
  references public.tax_decision_snapshots(id) on delete restrict;
alter table public.commercial_pricing_reservations add column if not exists tax_decision_snapshot_id uuid
  references public.tax_decision_snapshots(id) on delete restrict;
alter table public.order_payments add column if not exists tax_decision_snapshot_id uuid
  references public.tax_decision_snapshots(id) on delete restrict;
alter table public.commercial_receipts add column if not exists tax_decision_snapshot_id uuid
  references public.tax_decision_snapshots(id) on delete restrict;

create or replace function public.copy_receipt_tax_decision_snapshot()
returns trigger language plpgsql as $$
begin
  if new.tax_decision_snapshot_id is null then
    select r.tax_decision_snapshot_id into new.tax_decision_snapshot_id
    from public.commercial_pricing_reservations r where r.id = new.pricing_reservation_id;
  end if;
  return new;
end;
$$;
drop trigger if exists commercial_receipt_tax_decision_snapshot on public.commercial_receipts;
create trigger commercial_receipt_tax_decision_snapshot
before insert on public.commercial_receipts
for each row execute function public.copy_receipt_tax_decision_snapshot();

create or replace function public.copy_payment_tax_decision_snapshot()
returns trigger language plpgsql as $$
begin
  if new.tax_decision_snapshot_id is null and new.pricing_reservation_id is not null then
    select r.tax_decision_snapshot_id into new.tax_decision_snapshot_id
    from public.commercial_pricing_reservations r where r.id = new.pricing_reservation_id;
  end if;
  return new;
end;
$$;
drop trigger if exists order_payment_tax_decision_snapshot on public.order_payments;
create trigger order_payment_tax_decision_snapshot
before insert or update of pricing_reservation_id on public.order_payments
for each row execute function public.copy_payment_tax_decision_snapshot();

create or replace function public.prevent_tax_decision_artifact_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Tax activation, fact, classification, and decision artifacts are append-only.';
end;
$$;

drop trigger if exists tax_policy_activations_immutable on public.tax_policy_activations;
create trigger tax_policy_activations_immutable before update or delete on public.tax_policy_activations
  for each row execute function public.prevent_tax_decision_artifact_mutation();
drop trigger if exists tax_registration_facts_immutable on public.tax_registration_facts;
create trigger tax_registration_facts_immutable before update or delete on public.tax_registration_facts
  for each row execute function public.prevent_tax_decision_artifact_mutation();
drop trigger if exists tax_line_classification_controls_immutable on public.tax_line_classification_controls;
create trigger tax_line_classification_controls_immutable before update or delete on public.tax_line_classification_controls
  for each row execute function public.prevent_tax_decision_artifact_mutation();
drop trigger if exists tax_decision_snapshots_immutable on public.tax_decision_snapshots;
create trigger tax_decision_snapshots_immutable before update or delete on public.tax_decision_snapshots
  for each row execute function public.prevent_tax_decision_artifact_mutation();

create or replace function public.resolve_tax_policy_activation(
  p_environment text,
  p_policy_version text,
  p_jurisdiction_country_code text,
  p_jurisdiction_region_code text,
  p_origin_country_code text,
  p_destination_country_code text,
  p_tax_transaction_type text,
  p_fulfillment_classification text,
  p_at timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_activation public.tax_policy_activations%rowtype;
declare v_count integer;
begin
  if p_environment not in ('DEVELOPMENT','PRODUCTION') then
    return jsonb_build_object('status','BLOCKED','reason','CONTROL_POLICY_MISMATCH');
  end if;
  select count(*) into v_count from public.tax_policy_activations a
  where a.environment = p_environment
    and a.policy_version = p_policy_version
    and a.jurisdiction_country_code = upper(trim(p_jurisdiction_country_code))
    and coalesce(a.jurisdiction_region_code, '') = coalesce(nullif(upper(trim(p_jurisdiction_region_code)), ''), '')
    and coalesce(a.origin_country_code, '') = coalesce(nullif(upper(trim(p_origin_country_code)), ''), '')
    and coalesce(a.destination_country_code, '') = coalesce(nullif(upper(trim(p_destination_country_code)), ''), '')
    and a.tax_transaction_type = p_tax_transaction_type
    and a.fulfillment_classification = p_fulfillment_classification
    and a.effective_from <= p_at
    and (a.effective_to is null or p_at < a.effective_to)
    and not exists (
      select 1 from public.tax_policy_activations newer
      where newer.environment = a.environment and newer.policy_version = a.policy_version
        and newer.jurisdiction_country_code = a.jurisdiction_country_code
        and coalesce(newer.jurisdiction_region_code, '') = coalesce(a.jurisdiction_region_code, '')
        and coalesce(newer.origin_country_code, '') = coalesce(a.origin_country_code, '')
        and coalesce(newer.destination_country_code, '') = coalesce(a.destination_country_code, '')
        and newer.tax_transaction_type = a.tax_transaction_type
        and newer.fulfillment_classification = a.fulfillment_classification
        and newer.effective_from <= p_at
        and (newer.effective_from, newer.created_at, newer.id) > (a.effective_from, a.created_at, a.id)
    );
  if v_count = 0 then return jsonb_build_object('status','NOT_ACTIVATED'); end if;
  if v_count > 1 then return jsonb_build_object('status','BLOCKED','reason','CONTROL_CONFLICT'); end if;

  select a.* into v_activation from public.tax_policy_activations a
  where a.environment = p_environment and a.policy_version = p_policy_version
    and a.jurisdiction_country_code = upper(trim(p_jurisdiction_country_code))
    and coalesce(a.jurisdiction_region_code, '') = coalesce(nullif(upper(trim(p_jurisdiction_region_code)), ''), '')
    and coalesce(a.origin_country_code, '') = coalesce(nullif(upper(trim(p_origin_country_code)), ''), '')
    and coalesce(a.destination_country_code, '') = coalesce(nullif(upper(trim(p_destination_country_code)), ''), '')
    and a.tax_transaction_type = p_tax_transaction_type
    and a.fulfillment_classification = p_fulfillment_classification
    and a.effective_from <= p_at and (a.effective_to is null or p_at < a.effective_to)
  order by a.effective_from desc, a.created_at desc, a.id desc limit 1;

  if v_activation.status <> 'ACTIVE' then
    return jsonb_build_object('status','BLOCKED','reason','CONTROL_NOT_ACTIVE');
  end if;
  if p_at >= v_activation.review_due_at then
    return jsonb_build_object('status','BLOCKED','reason','CONTROL_REVIEW_EXPIRED');
  end if;
  return jsonb_build_object(
    'status','RESOLVED','activationId',v_activation.id,'environment',v_activation.environment,
    'policyVersion',v_activation.policy_version,'statusValue',v_activation.status,
    'jurisdictionCountryCode',v_activation.jurisdiction_country_code,
    'jurisdictionRegionCode',v_activation.jurisdiction_region_code,
    'originCountryCode',v_activation.origin_country_code,'destinationCountryCode',v_activation.destination_country_code,
    'transactionType',v_activation.tax_transaction_type,
    'fulfillmentClassification',v_activation.fulfillment_classification,
    'effectiveFrom',v_activation.effective_from,'effectiveTo',v_activation.effective_to,
    'reviewedAt',v_activation.reviewed_at,'reviewDueAt',v_activation.review_due_at,
    'legalReviewer',v_activation.legal_reviewer,'financeApprover',v_activation.finance_approver,
    'engineeringApprover',v_activation.engineering_approver,'sourceUrls',v_activation.source_urls,
    'correlationId',v_activation.correlation_id
  );
end;
$$;

create or replace view public.tax_control_health as
select
  a.id as activation_id, a.environment, a.policy_version, a.status,
  a.jurisdiction_country_code, a.jurisdiction_region_code,
  a.origin_country_code, a.destination_country_code,
  a.tax_transaction_type, a.fulfillment_classification,
  a.reviewed_at, a.review_due_at, a.correlation_id,
  a.source_urls,
  case
    when a.status <> 'ACTIVE' then 'DISABLED'
    when a.review_due_at <= now() then 'EXPIRED'
    when a.review_due_at <= now() + interval '30 days' then 'REVIEW_DUE'
    else 'HEALTHY'
  end as health_status,
  (select count(*) from public.commercial_pricing_reservations r where r.tax_decision_snapshot_id in (
    select s.id from public.tax_decision_snapshots s where s.activation_id = a.id
  ) and r.consumed_at is null) as affected_open_reservations,
  (select count(*) from public.tax_decision_snapshots s where s.activation_id = a.id) as snapshot_count
from public.tax_policy_activations a;

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
  s.reviewed_at, s.review_due_at, s.decision_fingerprint, s.correlation_id, s.created_at
from public.tax_decision_snapshots s;

alter table public.tax_policy_activations enable row level security;
alter table public.tax_registration_facts enable row level security;
alter table public.tax_line_classification_controls enable row level security;
alter table public.tax_decision_snapshots enable row level security;

revoke all on public.tax_policy_activations, public.tax_registration_facts,
  public.tax_line_classification_controls, public.tax_decision_snapshots from public, anon, authenticated;
grant select, insert on public.tax_policy_activations, public.tax_registration_facts,
  public.tax_line_classification_controls, public.tax_decision_snapshots to service_role;
revoke all on public.tax_control_health from public, anon, authenticated;
grant select on public.tax_control_health to service_role;
revoke all on public.tax_decision_ops from public, anon, authenticated;
grant select on public.tax_decision_ops to service_role;
revoke all on function public.resolve_tax_policy_activation(text,text,text,text,text,text,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.resolve_tax_policy_activation(text,text,text,text,text,text,text,text,timestamptz)
  to service_role;

comment on table public.tax_policy_activations is
  'Append-only exact-scope activation decisions. A later DISABLED row is the safe rollback; prior snapshots remain immutable.';
comment on table public.tax_decision_snapshots is
  'Immutable tax and fulfillment decision chain captured before provider initialization for activated scopes.';
