-- Prelaunch Money Desk policy: one named founder can prepare and approve a
-- request after fresh MFA. The application and worker restrict decision and
-- execution authority to OPS_MONEY_APPROVER_EMAILS (founders@drapeon.co by
-- default). Risk remains visible and provider execution stays a separate step.

create or replace function public.apply_founder_money_desk_approval_policy()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.required_approval_count := 1;
  new.risk_reasons := array_replace(
    new.risk_reasons,
    'ACTION_ALWAYS_REQUIRES_DUAL_APPROVAL',
    'FOUNDER_APPROVAL_REQUIRED'
  );
  new.policy_version := 'commercial-prelaunch-founder-v1';
  return new;
end;
$$;

drop trigger if exists apply_founder_money_desk_approval_policy on public.money_desk_requests;
create trigger apply_founder_money_desk_approval_policy
before insert on public.money_desk_requests
for each row execute function public.apply_founder_money_desk_approval_policy();

create or replace function public.decide_money_desk_request(
  p_request_id uuid, p_jit_grant_id uuid, p_actor_email text, p_actor_subject text,
  p_actor_role text, p_decision text, p_reason text
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_request public.money_desk_requests%rowtype; v_count integer;
begin
  select * into v_request from public.money_desk_requests where id = p_request_id for update;
  if v_request.id is null then raise exception 'Money Desk request was not found.'; end if;
  perform public.assert_money_desk_jit(p_jit_grant_id,p_actor_email,p_actor_subject,p_actor_role,v_request.action_type);
  if upper(trim(p_actor_role)) not in ('FINANCE','ADMIN') then raise exception 'Founder admin approval is required.'; end if;
  if v_request.status <> 'PENDING_APPROVAL' then raise exception 'Money Desk request is no longer pending approval.'; end if;
  if p_decision not in ('APPROVE','REJECT') then raise exception 'Invalid Money Desk decision.'; end if;
  if char_length(trim(coalesce(p_reason,''))) not between 12 and 1000 then raise exception 'Decision reason must be 12 to 1000 characters.'; end if;

  insert into public.money_desk_decisions (request_id,decision,approver_email,approver_subject,approver_role,approver_jit_grant_id,reason,correlation_id)
  values (p_request_id,p_decision,lower(trim(p_actor_email)),trim(p_actor_subject),upper(trim(p_actor_role)),p_jit_grant_id,trim(p_reason),v_request.correlation_id);

  if p_decision = 'REJECT' then
    update public.money_desk_requests set status='REJECTED',rejected_at=now() where id=p_request_id;
    insert into public.money_desk_events (request_id,event_type,actor_email,actor_role,payload,correlation_id)
    values (p_request_id,'REQUEST_REJECTED',lower(trim(p_actor_email)),upper(trim(p_actor_role)),jsonb_build_object('reason',trim(p_reason),'approvalPolicy',v_request.policy_version),v_request.correlation_id);
    return jsonb_build_object('requestId',p_request_id,'status','REJECTED','approvalCount',v_request.approval_count);
  end if;

  select count(*) into v_count from public.money_desk_decisions where request_id=p_request_id and decision='APPROVE';
  update public.money_desk_requests set approval_count=v_count,
    status=case when v_count >= required_approval_count then 'APPROVED' else status end,
    approved_at=case when v_count >= required_approval_count then now() else approved_at end
  where id=p_request_id returning * into v_request;
  insert into public.money_desk_events (request_id,event_type,actor_email,actor_role,payload,correlation_id)
  values (p_request_id,'APPROVAL_RECORDED',lower(trim(p_actor_email)),upper(trim(p_actor_role)),
    jsonb_build_object('approvalCount',v_count,'requiredApprovalCount',v_request.required_approval_count,'reason',trim(p_reason),'approvalPolicy',v_request.policy_version),v_request.correlation_id);
  if v_request.status='APPROVED' then
    insert into public.money_desk_events (request_id,event_type,actor_email,actor_role,payload,correlation_id)
    values (p_request_id,'REQUEST_APPROVED',lower(trim(p_actor_email)),upper(trim(p_actor_role)),jsonb_build_object('approvalPolicy',v_request.policy_version),v_request.correlation_id);
  end if;
  return jsonb_build_object('requestId',p_request_id,'status',v_request.status,'approvalCount',v_count,'requiredApprovalCount',v_request.required_approval_count);
end;
$$;

revoke all on function public.apply_founder_money_desk_approval_policy() from public, anon, authenticated;
revoke all on function public.decide_money_desk_request(uuid,uuid,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.decide_money_desk_request(uuid,uuid,text,text,text,text,text) to service_role;

comment on table public.money_desk_requests is
  'JIT-gated prelaunch Money Desk requests; decisions and execution are restricted to the configured founder identity.';
comment on table public.money_desk_decisions is
  'Append-only named founder decisions during the prelaunch single-approver operating phase.';
