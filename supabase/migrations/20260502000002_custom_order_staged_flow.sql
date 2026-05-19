do $$
declare
  v_order_id_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
    into v_order_id_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'orders'
    and a.attname = 'id'
    and a.attnum > 0
    and not a.attisdropped;

  if v_order_id_type is null then
    raise exception 'Could not resolve public.orders.id type for custom order staged flow migration.';
  end if;

  execute format($sql$
    create table if not exists public.custom_order_details (
      id uuid primary key default gen_random_uuid(),
      order_id %s not null unique references public.orders(id) on delete cascade,
      garment_type_other text,
      gender_presentation text,
      social_reference_links text[] not null default '{}',
      style_notes text,
      body_note text,
      fabric_description text,
      fabric_budget_amount integer,
      fabric_budget_currency currency,
      fabric_sourcing_deadline_days integer,
      fabric_sourcing_deadline_at timestamptz,
      fabric_approval_required boolean not null default false,
      fabric_approval_status text not null default 'NOT_REQUIRED',
      fabric_approval_requested_at timestamptz,
      fabric_approved_at timestamptz,
      fabric_changes_requested_at timestamptz,
      fabric_marked_unsuitable_at timestamptz,
      shipping_preference text,
      delivery_instructions text,
      target_delivery_date timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint custom_order_details_gender_presentation_check check (
        gender_presentation is null
        or gender_presentation in ('Menswear', 'Womenswear', 'Unisex')
      ),
      constraint custom_order_details_social_links_limit_check check (
        cardinality(social_reference_links) <= 3
      ),
      constraint custom_order_details_budget_check check (
        fabric_budget_amount is null or fabric_budget_amount >= 0
      ),
      constraint custom_order_details_sourcing_deadline_check check (
        fabric_sourcing_deadline_days is null
        or fabric_sourcing_deadline_days in (3, 5, 7, 10)
      ),
      constraint custom_order_details_fabric_approval_status_check check (
        fabric_approval_status in (
          'NOT_REQUIRED',
          'PENDING_TAILOR_UPLOAD',
          'PENDING_CUSTOMER_APPROVAL',
          'APPROVED',
          'CHANGES_REQUESTED',
          'UNSUITABLE',
          'OPS_REVIEW'
        )
      ),
      constraint custom_order_details_shipping_preference_check check (
        shipping_preference is null or shipping_preference in ('STANDARD', 'EXPRESS')
      )
    )
  $sql$, v_order_id_type);

  execute format($sql$
    create table if not exists public.order_production_evidence (
      id uuid primary key default gen_random_uuid(),
      order_id %s not null references public.orders(id) on delete cascade,
      stage_key text not null,
      note text,
      photo_urls text[] not null default '{}',
      actor_id uuid,
      actor_role text,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      constraint order_production_evidence_stage_key_check check (
        stage_key in (
          'ORDER_ACCEPTED',
          'FABRIC',
          'PRE_CUTTING',
          'CUTTING',
          'SEWING',
          'FINISHING',
          'QUALITY_CHECK',
          'DISPATCHED',
          'DELIVERED'
        )
      ),
      constraint order_production_evidence_actor_role_check check (
        actor_role is null or actor_role in ('CUSTOMER', 'TAILOR', 'OPS', 'SYSTEM')
      ),
      constraint order_production_evidence_photo_limit_check check (
        cardinality(photo_urls) <= 6
      )
    )
  $sql$, v_order_id_type);
end;
$$;

create index if not exists custom_order_details_fabric_approval_idx
  on public.custom_order_details (fabric_approval_status, fabric_sourcing_deadline_at)
  where fabric_approval_required = true;

create index if not exists order_production_evidence_order_stage_created_idx
  on public.order_production_evidence (order_id, stage_key, created_at desc);

alter table public.custom_order_details enable row level security;
alter table public.order_production_evidence enable row level security;

grant select on table public.custom_order_details to authenticated;
grant select on table public.order_production_evidence to authenticated;
grant select, insert, update, delete on table public.custom_order_details to service_role;
grant select, insert, update, delete on table public.order_production_evidence to service_role;

drop policy if exists "custom_order_details: participants can view" on public.custom_order_details;
create policy "custom_order_details: participants can view"
  on public.custom_order_details
  for select
  using (
    exists (
      select 1
      from public.orders o
      where o.id::text = custom_order_details.order_id::text
        and (
          o.customer_id::text = auth.uid()::text
          or o.tailor_id::text = auth.uid()::text
        )
    )
  );

drop policy if exists "order_production_evidence: participants can view" on public.order_production_evidence;
create policy "order_production_evidence: participants can view"
  on public.order_production_evidence
  for select
  using (
    exists (
      select 1
      from public.orders o
      where o.id::text = order_production_evidence.order_id::text
        and (
          o.customer_id::text = auth.uid()::text
          or o.tailor_id::text = auth.uid()::text
        )
    )
  );

create or replace function public.touch_custom_order_details_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_custom_order_details_updated_at on public.custom_order_details;
create trigger trg_custom_order_details_updated_at
before update on public.custom_order_details
for each row
execute function public.touch_custom_order_details_updated_at();

create or replace function public.enforce_custom_order_detail_rules()
returns trigger
language plpgsql
as $$
begin
  if new.target_delivery_date is not null
     and new.target_delivery_date::date < (coalesce(new.created_at, now())::date + 14) then
    raise exception 'CUSTOM_ORDER_TARGET_DATE_TOO_SOON';
  end if;

  if new.fabric_approval_required
     and new.fabric_approval_status = 'NOT_REQUIRED' then
    raise exception 'CUSTOM_ORDER_FABRIC_APPROVAL_STATUS_REQUIRED';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_custom_order_detail_rules on public.custom_order_details;
create trigger trg_custom_order_detail_rules
before insert or update on public.custom_order_details
for each row
execute function public.enforce_custom_order_detail_rules();

create or replace function public.safe_order_support_meta(value text)
returns jsonb
language plpgsql
stable
as $$
begin
  if value is null or btrim(value) = '' then
    return '{}'::jsonb;
  end if;

  return value::jsonb;
exception
  when others then
    return '{}'::jsonb;
end;
$$;

create or replace function public.enforce_custom_order_stage_rules()
returns trigger
language plpgsql
as $$
declare
  support_meta jsonb;
  material_status text;
  fabric_status text;
  fabric_required boolean;
begin
  if tg_op <> 'UPDATE' or old.stage is not distinct from new.stage then
    return new;
  end if;

  if exists (
    select 1
    from public.disputes d
    where d.order_id::text = new.id::text
      and d.status in ('OPEN', 'UNDER_REVIEW')
  )
  and new.stage::text not in ('IN_DISPUTE', 'REFUNDED', 'CANCELLED', 'COMPLETE') then
    raise exception 'ORDER_HAS_OPEN_DISPUTE';
  end if;

  if coalesce(new.order_kind::text, 'CUSTOM') = 'CUSTOM' then
    support_meta := public.safe_order_support_meta(new.special_note);
    material_status := support_meta #>> '{materialIssue,status}';

    if new.stage::text = 'CUTTING' then
      select cod.fabric_approval_status, cod.fabric_approval_required
      into fabric_status, fabric_required
      from public.custom_order_details cod
      where cod.order_id::text = new.id::text;

      if material_status in ('OPEN', 'CUSTOMER_REQUESTED_CANCEL') then
        raise exception 'ORDER_MATERIAL_ISSUE_OPEN';
      end if;

      if fabric_status in ('UNSUITABLE', 'OPS_REVIEW') then
        raise exception 'ORDER_FABRIC_UNSUITABLE';
      end if;

      if coalesce(fabric_required, false)
         and fabric_status is distinct from 'APPROVED' then
        raise exception 'ORDER_FABRIC_APPROVAL_REQUIRED';
      end if;
    end if;

    if new.stage::text = 'DELIVERED'
       and new.delivery_method::text = 'SHIPPING'
       and nullif(btrim(coalesce(new.tracking_number, '')), '') is null then
      raise exception 'ORDER_SHIPPING_TRACKING_REQUIRED';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_custom_order_stage_rules on public.orders;
create trigger trg_custom_order_stage_rules
before update of stage on public.orders
for each row
execute function public.enforce_custom_order_stage_rules();
