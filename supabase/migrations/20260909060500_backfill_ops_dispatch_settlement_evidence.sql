-- Keep Ops-recorded dispatch custody and delivery proof in the same staged
-- settlement contract as signed provider webhooks. The live Ops dispatch
-- surface already requires image evidence for these transitions; older rows
-- were persisted without forwarding that proof to the settlement ledger.

do $$
declare
  v_event record;
begin
  for v_event in
    select distinct on (
      event.order_id,
      case
        when event.event_type in ('CARRIER_ACCEPTED', 'COLLECTED') then 'CARRIER_ACCEPTED'
        else 'VERIFIED_DELIVERY'
      end
    )
      event.order_id::text as order_id,
      case
        when event.event_type in ('CARRIER_ACCEPTED', 'COLLECTED') then 'CARRIER_ACCEPTED'
        else 'VERIFIED_DELIVERY'
      end as evidence_kind,
      event.occurred_at,
      event.id::text as event_id,
      event.event_type,
      event.run_id
    from public.order_fulfillment_events as event
    join public.order_settlement_plans as plan
      on plan.order_id = event.order_id::text
    where event.source = 'OPS'
      and event.event_type in ('CARRIER_ACCEPTED', 'COLLECTED', 'DELIVERED')
      and jsonb_typeof(coalesce(event.evidence_media, '[]'::jsonb)) = 'array'
      and jsonb_array_length(coalesce(event.evidence_media, '[]'::jsonb)) > 0
      and not exists (
        select 1
        from public.order_settlement_evidence as evidence
        where evidence.plan_id = plan.id
          and evidence.evidence_kind = case
            when event.event_type in ('CARRIER_ACCEPTED', 'COLLECTED') then 'CARRIER_ACCEPTED'
            else 'VERIFIED_DELIVERY'
          end
      )
    order by
      event.order_id,
      case
        when event.event_type in ('CARRIER_ACCEPTED', 'COLLECTED') then 'CARRIER_ACCEPTED'
        else 'VERIFIED_DELIVERY'
      end,
      event.occurred_at asc
  loop
    perform public.record_order_settlement_evidence(
      v_event.order_id,
      v_event.evidence_kind,
      'DRAPEON_OPS',
      v_event.occurred_at,
      v_event.event_id,
      null,
      jsonb_build_object(
        'backfilled_from', 'order_fulfillment_events',
        'dispatch_event_id', v_event.event_id,
        'dispatch_event_type', v_event.event_type,
        'run_id', v_event.run_id
      )
    );
  end loop;
end $$;
