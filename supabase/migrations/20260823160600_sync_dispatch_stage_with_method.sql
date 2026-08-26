-- Keep fulfillment method and terminal handoff stage atomic. A pickup-ready
-- order that switches to Drape-managed delivery/shipping must enter the Ops
-- dispatch queue immediately. A pre-booking return to pickup must restore the
-- pickup-ready stage so a fresh collection credential can be issued.

create or replace function public.sync_order_dispatch_stage_with_method()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.delivery_method is not distinct from old.delivery_method then
    return new;
  end if;

  if old.delivery_method = 'LOCAL_COLLECTION'
    and new.delivery_method in ('LOCAL_DELIVERY', 'SHIPPING')
    and old.stage = 'READY_FOR_COLLECTION' then
    new.stage := 'READY_FOR_DRAPE_DISPATCH';
    new.stage_updated_at := now();
  elsif old.delivery_method in ('LOCAL_DELIVERY', 'SHIPPING')
    and new.delivery_method = 'LOCAL_COLLECTION'
    and old.stage = 'READY_FOR_DRAPE_DISPATCH' then
    new.stage := 'READY_FOR_COLLECTION';
    new.stage_updated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists sync_order_dispatch_stage_with_method on public.orders;
create trigger sync_order_dispatch_stage_with_method
before update of delivery_method on public.orders
for each row execute function public.sync_order_dispatch_stage_with_method();

create or replace function public.record_dispatch_method_stage_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.delivery_method is distinct from old.delivery_method
    and new.stage is distinct from old.stage
    and (
      (old.stage = 'READY_FOR_COLLECTION' and new.stage = 'READY_FOR_DRAPE_DISPATCH')
      or
      (old.stage = 'READY_FOR_DRAPE_DISPATCH' and new.stage = 'READY_FOR_COLLECTION')
    ) then
    insert into public.order_stage_updates(order_id, stage, note, created_at)
    values (
      new.id,
      new.stage,
      case
        when new.stage = 'READY_FOR_DRAPE_DISPATCH'
          then 'Pickup was replaced by Drapeon-managed delivery or shipping.'
        else 'Drapeon-managed dispatch was cancelled before booking and pickup was restored.'
      end,
      coalesce(new.stage_updated_at, now())
    );
  end if;

  return new;
end;
$$;

drop trigger if exists record_dispatch_method_stage_transition on public.orders;
create trigger record_dispatch_method_stage_transition
after update of delivery_method on public.orders
for each row execute function public.record_dispatch_method_stage_transition();

-- Repair orders already left in the pickup-only stage by an earlier method
-- replacement. The fulfillment run remains authoritative for active dispatch.
with repaired as (
  update public.orders o
  set
    stage = 'READY_FOR_DRAPE_DISPATCH',
    stage_updated_at = now(),
    updated_at = now(),
    collection_code = null,
    collection_code_expiry = null,
    collection_code_used = false,
    collection_code_attempts = 0,
    collection_code_last_attempt_at = null
  from public.order_fulfillment_runs r
  where r.order_id = o.id
    and o.delivery_method in ('LOCAL_DELIVERY', 'SHIPPING')
    and r.method = o.delivery_method
    and r.status not in ('CANCELLED', 'RECONCILED')
    and o.stage = 'READY_FOR_COLLECTION'
  returning o.id, o.stage_updated_at
)
insert into public.order_stage_updates(order_id, stage, note, created_at)
select
  repaired.id,
  'READY_FOR_DRAPE_DISPATCH',
  'Pickup was replaced by Drapeon-managed delivery or shipping.',
  repaired.stage_updated_at
from repaired
where not exists (
  select 1
  from public.order_stage_updates u
  where u.order_id = repaired.id
    and u.stage = 'READY_FOR_DRAPE_DISPATCH'
    and u.created_at = repaired.stage_updated_at
);
