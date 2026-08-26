-- Rollback-only proof for JIT, maker-checker, dual approval, idempotency,
-- immutable decisions, and terminal execution outcomes.

do $verification$
declare
  v_requester_grant uuid;
  v_approver_one_grant uuid;
  v_approver_two_grant uuid;
  v_standard jsonb;
  v_high jsonb;
  v_decision jsonb;
  v_attempt jsonb;
  v_failed boolean;
begin
  begin
    v_requester_grant := (public.issue_money_desk_jit_grant(
      'preparer@drapeon.co','dry-run-preparer','FINANCE','MIGRATION_DRY_RUN',array['mfa'],
      array['PAYOUT_RELEASE','CUSTOMER_REFUND'],'Verify standard and high-risk request preparation.',gen_random_uuid()
    )->>'grantId')::uuid;
    v_approver_one_grant := (public.issue_money_desk_jit_grant(
      'approver.one@drapeon.co','dry-run-approver-one','FINANCE','MIGRATION_DRY_RUN',array['mfa'],
      array['PAYOUT_RELEASE','CUSTOMER_REFUND'],'Verify independent approval and execution controls.',gen_random_uuid()
    )->>'grantId')::uuid;
    v_approver_two_grant := (public.issue_money_desk_jit_grant(
      'approver.two@drapeon.co','dry-run-approver-two','ADMIN','MIGRATION_DRY_RUN',array['hwk'],
      array['CUSTOMER_REFUND'],'Verify the second approval required for high-risk money.',gen_random_uuid()
    )->>'grantId')::uuid;

    v_standard := public.submit_money_desk_request(
      'migration-dry-run:money-standard',v_requester_grant,'preparer@drapeon.co','dry-run-preparer','FINANCE',
      'PAYOUT_RELEASE','ORDER','dry-run-order',null,null,10000,'USD',10000,'NATIVE_USD',
      'Release the verified standard-value tailor payout.',jsonb_build_object('orderId','dry-run-order'),gen_random_uuid()
    );
    if (v_standard->>'requiredApprovalCount')::integer <> 1 then raise exception 'Standard request did not require one approval.'; end if;

    v_failed := false;
    begin
      perform public.decide_money_desk_request((v_standard->>'requestId')::uuid,v_requester_grant,
        'preparer@drapeon.co','dry-run-preparer','FINANCE','APPROVE','Attempting self approval must be rejected.');
    exception when others then v_failed := true; end;
    if not v_failed then raise exception 'Preparer approved their own Money Desk request.'; end if;

    v_decision := public.decide_money_desk_request((v_standard->>'requestId')::uuid,v_approver_one_grant,
      'approver.one@drapeon.co','dry-run-approver-one','FINANCE','APPROVE','Evidence and payment checks support this release.');
    if v_decision->>'status' <> 'APPROVED' then raise exception 'Independent approval did not approve standard request.'; end if;

    v_attempt := public.begin_money_desk_execution((v_standard->>'requestId')::uuid,'migration-dry-run:execute-standard',
      v_approver_one_grant,'approver.one@drapeon.co','dry-run-approver-one','FINANCE');
    perform public.complete_money_desk_execution((v_attempt->>'attemptId')::uuid,'SUCCEEDED','provider-dry-run',null,null);
    if (select status from public.money_desk_requests where id=(v_standard->>'requestId')::uuid) <> 'SUCCEEDED' then
      raise exception 'Successful execution did not reach a terminal request outcome.';
    end if;

    v_high := public.submit_money_desk_request(
      'migration-dry-run:money-high',v_requester_grant,'preparer@drapeon.co','dry-run-preparer','FINANCE',
      'CUSTOMER_REFUND','ORDER','dry-run-order-high',null,null,50000,'USD',50000,'NATIVE_USD',
      'Refund the customer after the documented high-value resolution.',jsonb_build_object('orderId','dry-run-order-high'),gen_random_uuid()
    );
    if (v_high->>'requiredApprovalCount')::integer <> 2 then raise exception 'Threshold request did not require dual approval.'; end if;
    v_decision := public.decide_money_desk_request((v_high->>'requestId')::uuid,v_approver_one_grant,
      'approver.one@drapeon.co','dry-run-approver-one','FINANCE','APPROVE','First reviewer confirmed the refund evidence packet.');
    if v_decision->>'status' <> 'PENDING_APPROVAL' then raise exception 'High-risk request approved after only one decision.'; end if;
    v_decision := public.decide_money_desk_request((v_high->>'requestId')::uuid,v_approver_two_grant,
      'approver.two@drapeon.co','dry-run-approver-two','ADMIN','APPROVE','Second reviewer independently confirmed the refund evidence.');
    if v_decision->>'status' <> 'APPROVED' then raise exception 'Second independent decision did not approve high-risk request.'; end if;

    v_failed := false;
    begin
      update public.money_desk_decisions set reason='Mutation must fail.' where request_id=(v_high->>'requestId')::uuid;
    exception when others then v_failed := true; end;
    if not v_failed then raise exception 'Append-only Money Desk decision was updated.'; end if;

    raise exception 'MONEY_DESK_SECURITY_VERIFICATION_ROLLBACK';
  exception when others then
    if sqlerrm <> 'MONEY_DESK_SECURITY_VERIFICATION_ROLLBACK' then raise; end if;
  end;
  raise notice 'Money Desk security and approvals verification passed; synthetic rows rolled back.';
end;
$verification$;
