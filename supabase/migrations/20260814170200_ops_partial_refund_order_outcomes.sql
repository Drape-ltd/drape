-- A reviewed partial refund must declare what happens to the order after the
-- provider reaches a successful terminal outcome. Money movement and order
-- movement remain independent until that point.

alter table public.order_refund_resolutions
  add column if not exists order_outcome text not null default 'KEEP_UNDER_REVIEW',
  add column if not exists resume_stage public.order_stage,
  add column if not exists outcome_applied_at timestamptz;

alter table public.order_refund_resolutions
  drop constraint if exists order_refund_resolutions_order_outcome_check;
alter table public.order_refund_resolutions
  add constraint order_refund_resolutions_order_outcome_check
  check (order_outcome in ('CONTINUE_ORDER','CLOSE_ORDER','KEEP_UNDER_REVIEW'));

create or replace function public.set_ops_partial_refund_order_outcome(
  p_resolution_id uuid,
  p_order_outcome text
) returns jsonb
language plpgsql security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_resolution public.order_refund_resolutions%rowtype;
  v_resume public.order_stage;
begin
  if p_order_outcome not in ('CONTINUE_ORDER','CLOSE_ORDER','KEEP_UNDER_REVIEW') then
    raise exception 'Choose what happens to the order after the refund.';
  end if;
  select * into v_resolution from public.order_refund_resolutions where id=p_resolution_id for update;
  if v_resolution.id is null then raise exception 'Refund resolution was not found.'; end if;
  if v_resolution.status not in ('MONEY_DESK_REQUIRED','APPROVAL_PENDING') then
    raise exception 'The order outcome cannot change after approval begins.';
  end if;
  if p_order_outcome='CONTINUE_ORDER' then
    select osu.stage into v_resume
    from public.order_stage_updates osu
    where osu.order_id::text=v_resolution.order_id
      and osu.stage::text not in ('IN_DISPUTE','COMPLETE','DECLINED','EXPIRED','REFUNDED','CANCELLED')
    order by osu.created_at desc limit 1;
    if v_resume is null then raise exception 'Drapeon could not determine a safe production stage to resume.'; end if;
  end if;
  update public.order_refund_resolutions
  set order_outcome=p_order_outcome,resume_stage=v_resume,updated_at=now()
  where id=p_resolution_id;
  return jsonb_build_object('resolutionId',p_resolution_id,'orderOutcome',p_order_outcome,'resumeStage',v_resume);
end $$;

create or replace function public.apply_ops_partial_refund_order_outcome(
  p_resolution_id uuid,
  p_provider_reference text default null
) returns jsonb
language plpgsql security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_resolution public.order_refund_resolutions%rowtype;
  v_order public.orders%rowtype;
begin
  select * into v_resolution from public.order_refund_resolutions where id=p_resolution_id for update;
  if v_resolution.id is null then raise exception 'Refund resolution was not found.'; end if;
  if v_resolution.status <> 'SUCCEEDED' then raise exception 'The refund provider has not completed successfully.'; end if;
  if v_resolution.outcome_applied_at is not null then
    return jsonb_build_object('duplicate',true,'orderOutcome',v_resolution.order_outcome,'orderId',v_resolution.order_id);
  end if;
  select * into v_order from public.orders where id::text=v_resolution.order_id for update;
  if v_order.id is null then raise exception 'Order was not found.'; end if;

  if v_resolution.order_outcome='CONTINUE_ORDER' then
    if v_resolution.resume_stage is null then raise exception 'A safe resume stage was not recorded.'; end if;
    if v_order.stage::text='IN_DISPUTE' then
      update public.orders set stage=v_resolution.resume_stage,stage_updated_at=now(),updated_at=now() where id::text=v_resolution.order_id;
      insert into public.order_stage_updates(order_id,stage,note)
      values(v_order.id::uuid,v_resolution.resume_stage,'Partial refund completed; production resumed after Drapeon review.');
    end if;
    update public.disputes set status='RESOLVED_RELEASED',resolved_at=coalesce(resolved_at,now()),updated_at=now()
      where order_id::text=v_resolution.order_id and status in ('OPEN','UNDER_REVIEW');
  elsif v_resolution.order_outcome='CLOSE_ORDER' then
    if v_order.stage::text='IN_DISPUTE' then
      perform public.finalize_order_terminal(
        v_order.id::uuid,'COMPLETE',null,'OPS','ops.partial_refund_order_closed',
        'Order closed after the approved partial refund completed.',
        jsonb_build_object('refundResolutionId',v_resolution.id,'providerReference',p_provider_reference),
        array['IN_DISPUTE'],null,false,false,false,false
      );
    end if;
    update public.disputes set status='RESOLVED_REFUNDED',resolved_at=coalesce(resolved_at,now()),updated_at=now()
      where order_id::text=v_resolution.order_id and status in ('OPEN','UNDER_REVIEW');
  end if;

  update public.order_refund_resolutions set outcome_applied_at=now(),updated_at=now() where id=p_resolution_id;
  insert into public.financial_case_events(case_id,event_type,actor_id,actor_role,visibility,payload,correlation_id)
  values(v_resolution.financial_case_id,'STATUS_CHANGED',null,'SYSTEM','PARTIES',jsonb_build_object(
    'orderOutcome',v_resolution.order_outcome,'resumeStage',v_resolution.resume_stage,
    'providerReference',p_provider_reference,'appliedAt',now()
  ),v_resolution.correlation_id);
  perform public.refresh_order_settlement(v_resolution.order_id);
  return jsonb_build_object('duplicate',false,'orderOutcome',v_resolution.order_outcome,'orderId',v_resolution.order_id,'resumeStage',v_resolution.resume_stage);
end $$;

revoke all on function public.set_ops_partial_refund_order_outcome(uuid,text),public.apply_ops_partial_refund_order_outcome(uuid,text) from public,anon,authenticated;
grant execute on function public.set_ops_partial_refund_order_outcome(uuid,text),public.apply_ops_partial_refund_order_outcome(uuid,text) to service_role;

do $$ begin
  alter publication supabase_realtime add table public.order_refund_resolutions;
exception when duplicate_object then null;
end $$;
