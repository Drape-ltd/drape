-- The legacy orders table stores ids as text while finalize_order_terminal
-- intentionally exposes a uuid RPC contract. Cast the locked order id and all
-- nullable literals explicitly so PostgreSQL resolves the intended overload.

create or replace function public.apply_reviewed_post_refund_order_outcome(
  p_resolution_id uuid,
  p_order_outcome text,
  p_reason text,
  p_actor_email text,
  p_provider_reference text default null
) returns jsonb
language plpgsql security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_resolution public.order_refund_resolutions%rowtype;
  v_order public.orders%rowtype;
  v_resume public.order_stage;
begin
  if p_order_outcome not in ('CONTINUE_ORDER','CLOSE_ORDER') then
    raise exception 'Choose whether to resume or close the order.';
  end if;
  if length(trim(coalesce(p_reason,''))) < 12 then
    raise exception 'Add a clear reviewed reason before changing the order outcome.';
  end if;
  if length(trim(coalesce(p_actor_email,''))) < 5 then
    raise exception 'A named Ops reviewer is required.';
  end if;

  select * into v_resolution from public.order_refund_resolutions where id=p_resolution_id for update;
  if v_resolution.id is null then raise exception 'Refund resolution was not found.'; end if;
  if v_resolution.status <> 'SUCCEEDED' then raise exception 'The provider refund has not completed successfully.'; end if;
  if v_resolution.order_outcome <> 'KEEP_UNDER_REVIEW' or v_resolution.outcome_applied_at is null then
    raise exception 'This refund is not waiting for a reviewed post-refund order outcome.';
  end if;
  if v_resolution.reviewed_outcome_applied_at is not null then
    if v_resolution.reviewed_order_outcome = p_order_outcome then
      return jsonb_build_object('duplicate',true,'orderId',v_resolution.order_id,'orderOutcome',p_order_outcome);
    end if;
    raise exception 'A terminal post-refund order outcome has already been recorded.';
  end if;

  select * into v_order from public.orders where id::text=v_resolution.order_id for update;
  if v_order.id is null then raise exception 'Order was not found.'; end if;

  if p_order_outcome='CONTINUE_ORDER' then
    select osu.stage into v_resume
      from public.order_stage_updates osu
      where osu.order_id::text=v_resolution.order_id
        and osu.stage::text not in ('IN_DISPUTE','COMPLETE','DECLINED','EXPIRED','REFUNDED','CANCELLED')
      order by osu.created_at desc limit 1;
    if v_resume is null then raise exception 'Drapeon could not determine a safe production stage to resume.'; end if;
    if v_order.stage::text='IN_DISPUTE' then
      update public.orders set stage=v_resume,stage_updated_at=now(),updated_at=now() where id=v_order.id;
      insert into public.order_stage_updates(order_id,stage,note)
      values(v_order.id::uuid,v_resume,'Production resumed after the completed partial refund and Ops review.');
    end if;
    update public.disputes set status='RESOLVED_RELEASED',resolved_at=coalesce(resolved_at,now()),updated_at=now()
      where order_id=v_order.id and status in ('OPEN','UNDER_REVIEW');
  else
    if v_order.stage::text='IN_DISPUTE' then
      perform public.finalize_order_terminal(
        v_order.id::uuid,
        'COMPLETE'::text,
        null::text,
        'OPS'::text,
        'ops.partial_refund_order_closed_after_review'::text,
        'Order closed after a completed partial refund and reviewed terminal decision.'::text,
        jsonb_build_object('refundResolutionId',v_resolution.id,'providerReference',coalesce(p_provider_reference,v_resolution.provider_reference),'reviewedBy',p_actor_email,'reason',trim(p_reason)),
        array['IN_DISPUTE']::text[],
        null::text,
        false,
        false,
        false,
        false
      );
    elsif v_order.stage::text <> 'COMPLETE' then
      raise exception 'Only an order under review can be closed through this outcome.';
    end if;
    update public.disputes set status='RESOLVED_REFUNDED',resolved_at=coalesce(resolved_at,now()),updated_at=now()
      where order_id=v_order.id and status in ('OPEN','UNDER_REVIEW');
  end if;

  update public.order_refund_resolutions set
    reviewed_order_outcome=p_order_outcome,
    reviewed_resume_stage=v_resume,
    reviewed_outcome_reason=trim(p_reason),
    reviewed_outcome_actor_email=lower(trim(p_actor_email)),
    reviewed_outcome_applied_at=now(),
    provider_reference=coalesce(provider_reference,p_provider_reference),
    updated_at=now()
  where id=p_resolution_id;

  insert into public.financial_case_events(case_id,event_type,actor_id,actor_role,visibility,payload,correlation_id)
  values(v_resolution.financial_case_id,'STATUS_CHANGED',null,'OPS','PARTIES',jsonb_build_object(
    'originalOrderOutcome',v_resolution.order_outcome,'reviewedOrderOutcome',p_order_outcome,
    'resumeStage',v_resume,'reason',trim(p_reason),'reviewedBy',lower(trim(p_actor_email)),
    'providerReference',coalesce(p_provider_reference,v_resolution.provider_reference),'appliedAt',now()
  ),v_resolution.correlation_id);
  perform public.refresh_order_settlement(v_resolution.order_id);
  return jsonb_build_object('duplicate',false,'orderId',v_resolution.order_id,'orderOutcome',p_order_outcome,'resumeStage',v_resume);
end $$;

revoke all on function public.apply_reviewed_post_refund_order_outcome(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.apply_reviewed_post_refund_order_outcome(uuid,text,text,text,text) to service_role;
