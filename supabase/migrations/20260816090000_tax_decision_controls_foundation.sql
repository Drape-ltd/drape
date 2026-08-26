-- Drapeon tax and fulfillment architecture, Implementation 11A.
-- Dormant reviewed-control foundation. Nothing in this migration activates
-- these controls for checkout, pricing, receipts, or ledger posting.

create table public.tax_policy_versions (
  policy_version text primary key,
  status text not null check (status in ('DRAFT','REVIEW_PENDING','APPROVED','ACTIVE','SUPERSEDED','EXPIRED','BLOCKED')),
  effective_from timestamptz not null,
  effective_to timestamptz,
  reviewed_at timestamptz not null,
  review_due_at timestamptz not null,
  legal_reviewer text not null check (char_length(trim(legal_reviewer)) > 0),
  finance_approver text not null check (char_length(trim(finance_approver)) > 0),
  engineering_approver text not null check (char_length(trim(engineering_approver)) > 0),
  source_urls text[] not null check (cardinality(source_urls) > 0),
  change_reason text not null check (char_length(trim(change_reason)) between 12 and 1000),
  supersedes_policy_version text references public.tax_policy_versions(policy_version) on delete restrict,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  check (review_due_at > reviewed_at),
  check (supersedes_policy_version is null or supersedes_policy_version <> policy_version)
);

create table public.tax_registration_controls (
  id uuid primary key default gen_random_uuid(),
  control_key text not null,
  policy_version text not null references public.tax_policy_versions(policy_version) on delete restrict,
  status text not null check (status in ('DRAFT','REVIEW_PENDING','APPROVED','ACTIVE','SUPERSEDED','EXPIRED','BLOCKED')),
  jurisdiction_country_code text not null check (jurisdiction_country_code ~ '^[A-Z]{2}$'),
  jurisdiction_region_code text,
  tax_transaction_type text not null check (tax_transaction_type in (
    'CUSTOM_ORDER','READY_MADE_ORDER','CONSULTATION','MATERIAL_ADVANCE',
    'ORDER_AMENDMENT','FULFILLMENT_CHARGE','TIP_OR_GRATUITY'
  )),
  responsible_party text not null check (responsible_party in ('TAILOR','DRAPEON_MARKETPLACE_FACILITATOR','CUSTOMER_IMPORTER')),
  registration_subject text not null check (registration_subject in ('TAILOR','DRAPEON','CUSTOMER_IMPORTER')),
  rule_type text not null check (rule_type in ('MANDATORY','THRESHOLD','NOT_REQUIRED','BLOCKED')),
  threshold_amount_minor bigint check (threshold_amount_minor is null or threshold_amount_minor >= 0),
  threshold_currency text check (threshold_currency is null or threshold_currency ~ '^[A-Z]{3}$'),
  measurement_period text,
  decision_evidence_requirements jsonb not null default '[]'::jsonb,
  effective_from timestamptz not null,
  effective_to timestamptz,
  reviewed_at timestamptz not null,
  review_due_at timestamptz not null,
  legal_reviewer text not null check (char_length(trim(legal_reviewer)) > 0),
  finance_approver text not null check (char_length(trim(finance_approver)) > 0),
  engineering_approver text not null check (char_length(trim(engineering_approver)) > 0),
  source_urls text[] not null check (cardinality(source_urls) > 0),
  change_reason text not null check (char_length(trim(change_reason)) between 12 and 1000),
  supersedes_control_id uuid references public.tax_registration_controls(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (policy_version, control_key),
  check (effective_to is null or effective_to > effective_from),
  check (review_due_at > reviewed_at),
  check (
    (rule_type = 'THRESHOLD' and threshold_amount_minor is not null and threshold_currency is not null and nullif(trim(measurement_period),'') is not null)
    or (rule_type <> 'THRESHOLD' and threshold_amount_minor is null and threshold_currency is null)
  )
);

create unique index tax_registration_controls_scope_unique
  on public.tax_registration_controls (
    policy_version,
    jurisdiction_country_code,
    coalesce(jurisdiction_region_code, ''),
    tax_transaction_type,
    responsible_party,
    registration_subject
  );

create table public.tax_responsibility_controls (
  id uuid primary key default gen_random_uuid(),
  control_key text not null,
  policy_version text not null references public.tax_policy_versions(policy_version) on delete restrict,
  status text not null check (status in ('DRAFT','REVIEW_PENDING','APPROVED','ACTIVE','SUPERSEDED','EXPIRED','BLOCKED')),
  jurisdiction_country_code text not null check (jurisdiction_country_code ~ '^[A-Z]{2}$'),
  jurisdiction_region_code text,
  tax_transaction_type text not null check (tax_transaction_type in (
    'CUSTOM_ORDER','READY_MADE_ORDER','CONSULTATION','MATERIAL_ADVANCE',
    'ORDER_AMENDMENT','FULFILLMENT_CHARGE','TIP_OR_GRATUITY'
  )),
  fulfillment_classification text not null check (fulfillment_classification in ('LOCAL_COLLECTION','LOCAL_DELIVERY','INTERNATIONAL_SHIPPING')),
  tax_supply_characterization text not null check (tax_supply_characterization in (
    'GOODS','SERVICES','COMPOSITE','ANCILLARY','GRATUITY','OUT_OF_SCOPE','JURISDICTION_SPECIFIC'
  )),
  liability_granularity text not null check (liability_granularity in ('ORDER','LINE_GROUP')),
  responsible_party text not null check (responsible_party in ('TAILOR','DRAPEON_MARKETPLACE_FACILITATOR','CUSTOMER_IMPORTER')),
  statutory_role text not null check (char_length(trim(statutory_role)) > 0),
  registration_subject text not null check (registration_subject in ('TAILOR','DRAPEON','CUSTOMER_IMPORTER')),
  registration_control_id uuid not null references public.tax_registration_controls(id) on delete restrict,
  marketplace_facilitator_applies boolean not null,
  collection_mode text not null check (collection_mode in ('COLLECTED_AT_CHECKOUT','PAYABLE_ON_IMPORT','BLOCKED')),
  calculation_strategy text not null check (char_length(trim(calculation_strategy)) > 0),
  provider_reference text,
  invoice_treatment text not null check (char_length(trim(invoice_treatment)) > 0),
  filing_liability_account text not null check (char_length(trim(filing_liability_account)) > 0),
  amendment_may_inherit boolean not null default false,
  effective_from timestamptz not null,
  effective_to timestamptz,
  reviewed_at timestamptz not null,
  review_due_at timestamptz not null,
  legal_reviewer text not null check (char_length(trim(legal_reviewer)) > 0),
  finance_approver text not null check (char_length(trim(finance_approver)) > 0),
  engineering_approver text not null check (char_length(trim(engineering_approver)) > 0),
  source_urls text[] not null check (cardinality(source_urls) > 0),
  change_reason text not null check (char_length(trim(change_reason)) between 12 and 1000),
  supersedes_control_id uuid references public.tax_responsibility_controls(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (policy_version, control_key),
  check (effective_to is null or effective_to > effective_from),
  check (review_due_at > reviewed_at),
  check (policy_version <> 'tax-fulfillment-2026-08-15-v1' or liability_granularity = 'ORDER')
);

create unique index tax_responsibility_controls_scope_unique
  on public.tax_responsibility_controls (
    policy_version,
    jurisdiction_country_code,
    coalesce(jurisdiction_region_code, ''),
    tax_transaction_type,
    fulfillment_classification
  );

create table public.tax_corridor_controls (
  id uuid primary key default gen_random_uuid(),
  control_key text not null,
  policy_version text not null references public.tax_policy_versions(policy_version) on delete restrict,
  status text not null check (status in ('DRAFT','REVIEW_PENDING','APPROVED','ACTIVE','SUPERSEDED','EXPIRED','BLOCKED')),
  origin_country_code text not null check (origin_country_code ~ '^[A-Z]{2}$'),
  destination_country_code text not null check (destination_country_code ~ '^[A-Z]{2}$'),
  tax_transaction_type text not null check (tax_transaction_type in (
    'CUSTOM_ORDER','READY_MADE_ORDER','CONSULTATION','MATERIAL_ADVANCE',
    'ORDER_AMENDMENT','FULFILLMENT_CHARGE','TIP_OR_GRATUITY'
  )),
  fulfillment_classification text not null check (fulfillment_classification = 'INTERNATIONAL_SHIPPING'),
  collection_mode text not null check (collection_mode in ('COLLECTED_AT_CHECKOUT','PAYABLE_ON_IMPORT','BLOCKED')),
  responsible_importer text not null check (responsible_importer in ('TAILOR','DRAPEON_MARKETPLACE_FACILITATOR','CUSTOMER_IMPORTER')),
  export_treatment text not null check (char_length(trim(export_treatment)) > 0),
  import_treatment text not null check (char_length(trim(import_treatment)) > 0),
  shipping_taxability text not null check (char_length(trim(shipping_taxability)) > 0),
  carrier_constraints jsonb not null default '[]'::jsonb,
  effective_from timestamptz not null,
  effective_to timestamptz,
  reviewed_at timestamptz not null,
  review_due_at timestamptz not null,
  legal_reviewer text not null check (char_length(trim(legal_reviewer)) > 0),
  finance_approver text not null check (char_length(trim(finance_approver)) > 0),
  engineering_approver text not null check (char_length(trim(engineering_approver)) > 0),
  source_urls text[] not null check (cardinality(source_urls) > 0),
  change_reason text not null check (char_length(trim(change_reason)) between 12 and 1000),
  supersedes_control_id uuid references public.tax_corridor_controls(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (policy_version, control_key),
  unique (policy_version, origin_country_code, destination_country_code, tax_transaction_type),
  check (origin_country_code <> destination_country_code),
  check (effective_to is null or effective_to > effective_from),
  check (review_due_at > reviewed_at)
);

create table public.tax_policy_control_events (
  id uuid primary key default gen_random_uuid(),
  policy_version text not null references public.tax_policy_versions(policy_version) on delete restrict,
  control_type text not null check (control_type in ('POLICY','REGISTRATION','RESPONSIBILITY','CORRIDOR')),
  control_id text not null,
  event_type text not null check (event_type in ('CREATED','REVIEWED','APPROVED','ACTIVATED','SUPERSEDED','BLOCKED')),
  actor_email text not null check (char_length(trim(actor_email)) > 0),
  actor_role text not null check (actor_role in ('TAX_LEGAL','FINANCE','ENGINEERING','ADMIN','SYSTEM')),
  reason text not null check (char_length(trim(reason)) between 12 and 1000),
  source_urls text[] not null default '{}',
  correlation_id uuid not null default gen_random_uuid(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index tax_registration_controls_lookup_idx on public.tax_registration_controls (
  policy_version, jurisdiction_country_code, jurisdiction_region_code, tax_transaction_type, status
);
create index tax_responsibility_controls_lookup_idx on public.tax_responsibility_controls (
  policy_version, jurisdiction_country_code, jurisdiction_region_code, tax_transaction_type,
  fulfillment_classification, status
);
create index tax_corridor_controls_lookup_idx on public.tax_corridor_controls (
  policy_version, origin_country_code, destination_country_code, tax_transaction_type, status
);
create index tax_policy_control_events_lookup_idx on public.tax_policy_control_events (
  policy_version, control_type, control_id, created_at
);

create or replace function public.validate_tax_responsibility_dependency()
returns trigger language plpgsql as $$
declare v_registration public.tax_registration_controls%rowtype;
begin
  select * into v_registration from public.tax_registration_controls where id = new.registration_control_id;
  if v_registration.id is null
    or v_registration.policy_version <> new.policy_version
    or v_registration.jurisdiction_country_code <> new.jurisdiction_country_code
    or coalesce(v_registration.jurisdiction_region_code, '') <> coalesce(new.jurisdiction_region_code, '')
    or v_registration.tax_transaction_type <> new.tax_transaction_type
    or v_registration.responsible_party <> new.responsible_party
    or v_registration.registration_subject <> new.registration_subject then
    raise exception 'Responsibility control registration dependency does not match its reviewed scope.';
  end if;
  return new;
end;
$$;

create trigger tax_responsibility_dependency_guard before insert on public.tax_responsibility_controls
  for each row execute function public.validate_tax_responsibility_dependency();

create or replace function public.prevent_tax_policy_control_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Reviewed tax policy controls are immutable; create a superseding version.';
end;
$$;

create trigger tax_policy_versions_immutable before update or delete on public.tax_policy_versions
  for each row execute function public.prevent_tax_policy_control_mutation();
create trigger tax_registration_controls_immutable before update or delete on public.tax_registration_controls
  for each row execute function public.prevent_tax_policy_control_mutation();
create trigger tax_responsibility_controls_immutable before update or delete on public.tax_responsibility_controls
  for each row execute function public.prevent_tax_policy_control_mutation();
create trigger tax_corridor_controls_immutable before update or delete on public.tax_corridor_controls
  for each row execute function public.prevent_tax_policy_control_mutation();
create trigger tax_policy_control_events_append_only before update or delete on public.tax_policy_control_events
  for each row execute function public.prevent_tax_policy_control_mutation();

create or replace function public.resolve_reviewed_tax_responsibility_control(
  p_policy_version text,
  p_origin_country_code text,
  p_jurisdiction_country_code text,
  p_jurisdiction_region_code text,
  p_tax_transaction_type text,
  p_fulfillment_classification text,
  p_at timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_policy public.tax_policy_versions%rowtype;
  v_control public.tax_responsibility_controls%rowtype;
  v_registration public.tax_registration_controls%rowtype;
  v_corridor_count integer;
  v_match_count integer;
  v_country text := upper(trim(coalesce(p_jurisdiction_country_code, '')));
  v_origin_country text := nullif(upper(trim(coalesce(p_origin_country_code, ''))), '');
  v_region text := nullif(upper(trim(coalesce(p_jurisdiction_region_code, ''))), '');
begin
  if p_tax_transaction_type not in (
    'CUSTOM_ORDER','READY_MADE_ORDER','CONSULTATION','MATERIAL_ADVANCE',
    'ORDER_AMENDMENT','FULFILLMENT_CHARGE','TIP_OR_GRATUITY'
  ) then return jsonb_build_object('status','BLOCKED','reason','UNSUPPORTED_TRANSACTION_TYPE'); end if;
  if p_fulfillment_classification not in ('LOCAL_COLLECTION','LOCAL_DELIVERY','INTERNATIONAL_SHIPPING') then
    return jsonb_build_object('status','BLOCKED','reason','MISSING_CORRIDOR_CONTROL');
  end if;
  if v_country !~ '^[A-Z]{2}$' then return jsonb_build_object('status','BLOCKED','reason','MISSING_JURISDICTION_CONTROL'); end if;

  select * into v_policy from public.tax_policy_versions where policy_version = p_policy_version;
  if v_policy.policy_version is null then return jsonb_build_object('status','BLOCKED','reason','CONTROL_POLICY_MISMATCH'); end if;
  if v_policy.status <> 'ACTIVE' then return jsonb_build_object('status','BLOCKED','reason','CONTROL_NOT_ACTIVE'); end if;
  if p_at < v_policy.effective_from or (v_policy.effective_to is not null and p_at >= v_policy.effective_to) then
    return jsonb_build_object('status','BLOCKED','reason','CONTROL_NOT_EFFECTIVE');
  end if;
  if p_at >= v_policy.review_due_at then return jsonb_build_object('status','BLOCKED','reason','CONTROL_REVIEW_EXPIRED'); end if;

  select count(*) into v_match_count
  from public.tax_responsibility_controls c
  where c.policy_version = p_policy_version
    and c.status = 'ACTIVE'
    and c.jurisdiction_country_code = v_country
    and c.tax_transaction_type = p_tax_transaction_type
    and c.fulfillment_classification = p_fulfillment_classification
    and c.effective_from <= p_at
    and (c.effective_to is null or p_at < c.effective_to)
    and (
      (v_region is not null and c.jurisdiction_region_code = v_region)
      or (not exists (
        select 1 from public.tax_responsibility_controls exact_control
        where exact_control.policy_version = p_policy_version
          and exact_control.status = 'ACTIVE'
          and exact_control.jurisdiction_country_code = v_country
          and exact_control.jurisdiction_region_code = v_region
          and exact_control.tax_transaction_type = p_tax_transaction_type
          and exact_control.fulfillment_classification = p_fulfillment_classification
          and exact_control.effective_from <= p_at
          and (exact_control.effective_to is null or p_at < exact_control.effective_to)
      ) and c.jurisdiction_region_code is null)
    );
  if v_match_count = 0 then return jsonb_build_object('status','BLOCKED','reason','MISSING_JURISDICTION_CONTROL'); end if;
  if v_match_count > 1 then return jsonb_build_object('status','BLOCKED','reason','CONTROL_CONFLICT'); end if;

  select c.* into v_control
  from public.tax_responsibility_controls c
  where c.policy_version = p_policy_version
    and c.status = 'ACTIVE'
    and c.jurisdiction_country_code = v_country
    and c.tax_transaction_type = p_tax_transaction_type
    and c.fulfillment_classification = p_fulfillment_classification
    and c.effective_from <= p_at
    and (c.effective_to is null or p_at < c.effective_to)
    and (c.jurisdiction_region_code = v_region or c.jurisdiction_region_code is null)
  order by (c.jurisdiction_region_code is not null) desc
  limit 1;

  if p_at >= v_control.review_due_at then return jsonb_build_object('status','BLOCKED','reason','CONTROL_REVIEW_EXPIRED'); end if;
  if v_control.liability_granularity <> 'ORDER' then
    return jsonb_build_object('status','BLOCKED','reason','UNSUPPORTED_LIABILITY_GRANULARITY');
  end if;
  select * into v_registration from public.tax_registration_controls where id = v_control.registration_control_id;
  if v_registration.id is null or v_registration.status <> 'ACTIVE' then
    return jsonb_build_object('status','BLOCKED','reason','MISSING_REGISTRATION_RULE');
  end if;
  if p_at < v_registration.effective_from or (v_registration.effective_to is not null and p_at >= v_registration.effective_to) then
    return jsonb_build_object('status','BLOCKED','reason','CONTROL_NOT_EFFECTIVE');
  end if;
  if p_at >= v_registration.review_due_at then return jsonb_build_object('status','BLOCKED','reason','CONTROL_REVIEW_EXPIRED'); end if;

  if p_fulfillment_classification = 'INTERNATIONAL_SHIPPING' then
    if v_origin_country is null or v_origin_country !~ '^[A-Z]{2}$' then
      return jsonb_build_object('status','BLOCKED','reason','MISSING_CORRIDOR_CONTROL');
    end if;
    select count(*) into v_corridor_count from public.tax_corridor_controls corridor
    where corridor.policy_version = p_policy_version and corridor.status = 'ACTIVE'
      and corridor.origin_country_code = v_origin_country
      and corridor.destination_country_code = v_country
      and corridor.tax_transaction_type = p_tax_transaction_type
      and corridor.effective_from <= p_at and (corridor.effective_to is null or p_at < corridor.effective_to);
    if v_corridor_count <> 1 then return jsonb_build_object('status','BLOCKED','reason','MISSING_CORRIDOR_CONTROL'); end if;
  end if;

  return jsonb_build_object(
    'status','RESOLVED',
    'controlId',v_control.id,
    'controlKey',v_control.control_key,
    'policyVersion',v_control.policy_version,
    'jurisdictionCountryCode',v_control.jurisdiction_country_code,
    'jurisdictionRegionCode',v_control.jurisdiction_region_code,
    'transactionType',v_control.tax_transaction_type,
    'fulfillmentClassification',v_control.fulfillment_classification,
    'supplyCharacterization',v_control.tax_supply_characterization,
    'liabilityGranularity',v_control.liability_granularity,
    'responsibleParty',v_control.responsible_party,
    'statutoryRole',v_control.statutory_role,
    'registrationSubject',v_control.registration_subject,
    'registrationRuleId',v_control.registration_control_id,
    'registrationRuleType',v_registration.rule_type,
    'marketplaceFacilitatorApplies',v_control.marketplace_facilitator_applies,
    'collectionMode',v_control.collection_mode,
    'calculationStrategy',v_control.calculation_strategy,
    'providerReference',v_control.provider_reference,
    'invoiceTreatment',v_control.invoice_treatment,
    'filingLiabilityAccount',v_control.filing_liability_account,
    'amendmentMayInherit',v_control.amendment_may_inherit,
    'sourceUrls',v_control.source_urls,
    'legalReviewer',v_control.legal_reviewer,
    'financeApprover',v_control.finance_approver,
    'engineeringApprover',v_control.engineering_approver,
    'reviewedAt',v_control.reviewed_at,
    'reviewDueAt',v_control.review_due_at,
    'effectiveFrom',v_control.effective_from,
    'effectiveTo',v_control.effective_to,
    'supersedesControlId',v_control.supersedes_control_id,
    'changeReason',v_control.change_reason
  );
end;
$$;

alter table public.tax_policy_versions enable row level security;
alter table public.tax_registration_controls enable row level security;
alter table public.tax_responsibility_controls enable row level security;
alter table public.tax_corridor_controls enable row level security;
alter table public.tax_policy_control_events enable row level security;

revoke all on public.tax_policy_versions, public.tax_registration_controls,
  public.tax_responsibility_controls, public.tax_corridor_controls,
  public.tax_policy_control_events from public, anon, authenticated;
grant select, insert on public.tax_policy_versions, public.tax_registration_controls,
  public.tax_responsibility_controls, public.tax_corridor_controls,
  public.tax_policy_control_events to service_role;

revoke all on function public.resolve_reviewed_tax_responsibility_control(text,text,text,text,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.resolve_reviewed_tax_responsibility_control(text,text,text,text,text,text,timestamptz)
  to service_role;
