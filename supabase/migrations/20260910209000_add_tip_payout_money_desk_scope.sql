-- Keep the database Money Desk contract aligned with the shared action catalog.
-- TIP_PAYOUT is a distinct provider action and must receive the same JIT,
-- maker-checker, idempotency, and execution controls as other money movement.

alter table public.money_desk_requests
  drop constraint if exists money_desk_requests_action_type_check;

alter table public.money_desk_requests
  add constraint money_desk_requests_action_type_check check (action_type in (
    'PAYOUT_RELEASE', 'TIP_PAYOUT', 'MATERIAL_ADVANCE_RELEASE', 'CUSTOMER_REFUND',
    'PAYOUT_DESTINATION_CHANGE', 'MANUAL_FX', 'POST_RELEASE_RECOVERY',
    'POLICY_OVERRIDE', 'OTHER_REVIEWED'
  ));

create or replace function public.issue_money_desk_jit_grant(
  p_actor_email text, p_actor_subject text, p_actor_role text, p_assurance_source text,
  p_authentication_methods text[], p_action_scopes text[], p_reason text,
  p_correlation_id uuid default gen_random_uuid()
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_grant public.money_desk_jit_grants%rowtype;
begin
  if nullif(trim(p_actor_email), '') is null or nullif(trim(p_actor_subject), '') is null then raise exception 'Named workforce identity is required.'; end if;
  if upper(trim(p_actor_role)) not in ('OPS', 'CUSTOMER_SUCCESS', 'FINANCE', 'ADMIN') then raise exception 'This role cannot request Money Desk elevation.'; end if;
  if p_assurance_source not in ('CLOUDFLARE_ACCESS', 'MIGRATION_DRY_RUN') then raise exception 'Unsupported identity assurance source.'; end if;
  if p_assurance_source = 'CLOUDFLARE_ACCESS' and not (p_authentication_methods && array['mfa','hwk','swk','otp','face','fpt','iris','retina','vbm']) then
    raise exception 'MFA-backed workforce access is required.';
  end if;
  if cardinality(p_action_scopes) is null or cardinality(p_action_scopes) = 0 then raise exception 'Choose at least one Money Desk action scope.'; end if;
  if exists (select 1 from unnest(p_action_scopes) s where s not in (
    'PAYOUT_RELEASE','TIP_PAYOUT','MATERIAL_ADVANCE_RELEASE','CUSTOMER_REFUND','PAYOUT_DESTINATION_CHANGE',
    'MANUAL_FX','POST_RELEASE_RECOVERY','POLICY_OVERRIDE','OTHER_REVIEWED')) then
    raise exception 'Invalid Money Desk action scope.';
  end if;
  if char_length(trim(p_reason)) not between 12 and 500 then raise exception 'Elevation reason must be 12 to 500 characters.'; end if;

  insert into public.money_desk_jit_grants (
    actor_email, actor_subject, actor_role, assurance_source, authentication_methods,
    action_scopes, reason, expires_at, correlation_id
  ) values (
    lower(trim(p_actor_email)), trim(p_actor_subject), upper(trim(p_actor_role)), p_assurance_source,
    p_authentication_methods, p_action_scopes, trim(p_reason), now() + interval '15 minutes', p_correlation_id
  ) returning * into v_grant;
  return jsonb_build_object('grantId', v_grant.id, 'expiresAt', v_grant.expires_at, 'correlationId', v_grant.correlation_id);
end;
$$;

create or replace function public.submit_money_desk_request(
  p_idempotency_key text, p_jit_grant_id uuid, p_actor_email text, p_actor_subject text,
  p_actor_role text, p_action_type text, p_target_type text, p_target_id text,
  p_order_id text, p_case_id uuid, p_amount integer, p_currency currency,
  p_amount_usd_equivalent integer, p_usd_equivalent_source text, p_reason text,
  p_action_payload jsonb, p_correlation_id uuid default gen_random_uuid()
)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_request public.money_desk_requests%rowtype;
  v_hash text;
  v_required integer;
  v_risk text;
  v_reasons text[] := array[]::text[];
begin
  perform public.assert_money_desk_jit(p_jit_grant_id, p_actor_email, p_actor_subject, p_actor_role, p_action_type);
  if p_action_type not in ('PAYOUT_RELEASE','TIP_PAYOUT','MATERIAL_ADVANCE_RELEASE','CUSTOMER_REFUND','PAYOUT_DESTINATION_CHANGE','MANUAL_FX','POST_RELEASE_RECOVERY','POLICY_OVERRIDE','OTHER_REVIEWED') then raise exception 'Invalid Money Desk action.'; end if;
  if char_length(trim(coalesce(p_reason,''))) not between 12 and 1000 then raise exception 'Money Desk reason must be 12 to 1000 characters.'; end if;
  if (p_amount is null) <> (p_currency is null) then raise exception 'Amount and currency must be supplied together.'; end if;

  if p_action_type in ('PAYOUT_DESTINATION_CHANGE','MANUAL_FX','POST_RELEASE_RECOVERY','POLICY_OVERRIDE','OTHER_REVIEWED') then
    v_reasons := array_append(v_reasons, 'ACTION_ALWAYS_REQUIRES_DUAL_APPROVAL');
  end if;
  if p_amount_usd_equivalent is null then
    v_reasons := array_append(v_reasons, 'USD_EQUIVALENT_UNRESOLVED');
  elsif p_amount_usd_equivalent >= 50000 then
    v_reasons := array_append(v_reasons, 'USD_500_EQUIVALENT_OR_MORE');
  end if;
  v_required := case when cardinality(v_reasons) > 0 then 2 else 1 end;
  v_risk := case when v_required = 2 then 'HIGH' else 'STANDARD' end;

  v_hash := encode(digest(concat_ws('|', p_action_type, p_target_type, p_target_id,
    coalesce(p_order_id,''), coalesce(p_case_id::text,''), coalesce(p_amount::text,''),
    coalesce(p_currency::text,''), coalesce(p_amount_usd_equivalent::text,''), trim(p_reason),
    coalesce(p_action_payload,'{}'::jsonb)::text), 'sha256'), 'hex');

  select * into v_request from public.money_desk_requests where idempotency_key = p_idempotency_key;
  if v_request.id is not null then
    if v_request.request_hash <> v_hash then raise exception 'Money Desk idempotency key was reused with different values.'; end if;
    return jsonb_build_object('requestId',v_request.id,'reference',v_request.reference,'status',v_request.status,
      'requiredApprovalCount',v_request.required_approval_count,'riskLevel',v_request.risk_level,'duplicate',true);
  end if;

  insert into public.money_desk_requests (
    idempotency_key, request_hash, action_type, target_type, target_id, order_id, case_id,
    amount, currency, amount_usd_equivalent, usd_equivalent_source, reason, action_payload,
    requester_email, requester_subject, requester_role, requester_jit_grant_id,
    risk_level, risk_reasons, required_approval_count, correlation_id
  ) values (
    p_idempotency_key, v_hash, p_action_type, trim(p_target_type), trim(p_target_id), p_order_id, p_case_id,
    p_amount, p_currency, p_amount_usd_equivalent, nullif(trim(coalesce(p_usd_equivalent_source,'')),'') ,
    trim(p_reason), coalesce(p_action_payload,'{}'::jsonb), lower(trim(p_actor_email)), trim(p_actor_subject),
    upper(trim(p_actor_role)), p_jit_grant_id, v_risk, v_reasons, v_required, p_correlation_id
  ) returning * into v_request;

  insert into public.money_desk_events (request_id,event_type,actor_email,actor_role,payload,correlation_id)
  values (v_request.id,'REQUEST_SUBMITTED',v_request.requester_email,v_request.requester_role,
    jsonb_build_object('actionType',v_request.action_type,'riskLevel',v_risk,'requiredApprovalCount',v_required),p_correlation_id);
  return jsonb_build_object('requestId',v_request.id,'reference',v_request.reference,'status',v_request.status,
    'requiredApprovalCount',v_required,'riskLevel',v_risk,'duplicate',false);
end;
$$;

revoke all on function public.issue_money_desk_jit_grant(text,text,text,text,text[],text[],text,uuid) from public, anon, authenticated;
revoke all on function public.submit_money_desk_request(text,uuid,text,text,text,text,text,text,text,uuid,integer,currency,integer,text,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.issue_money_desk_jit_grant(text,text,text,text,text[],text[],text,uuid) to service_role;
grant execute on function public.submit_money_desk_request(text,uuid,text,text,text,text,text,text,text,uuid,integer,currency,integer,text,text,jsonb,uuid) to service_role;

comment on constraint money_desk_requests_action_type_check on public.money_desk_requests is
  'Canonical shared Money Desk actions, including tailor tip payout.';
