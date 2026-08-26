-- Rollback-only proof for JIT expiry/scope and request idempotency.
do $verification$
declare
  v_grant uuid;
  v_request jsonb;
  v_duplicate jsonb;
  v_failed boolean;
begin
  begin
    v_grant := (public.issue_money_desk_jit_grant(
      'scope.preparer@drapeon.co','dry-run-scope-preparer','OPS','MIGRATION_DRY_RUN',array['mfa'],
      array['PAYOUT_RELEASE'],'Verify scoped elevation and idempotent preparation.',gen_random_uuid()
    )->>'grantId')::uuid;

    v_failed := false;
    begin
      perform public.submit_money_desk_request(
        'migration-dry-run:wrong-scope',v_grant,'scope.preparer@drapeon.co','dry-run-scope-preparer','OPS',
        'CUSTOMER_REFUND','ORDER','wrong-scope-order',null,null,1000,'USD',1000,'NATIVE_USD',
        'This request must fail because the grant has the wrong scope.','{}'::jsonb,gen_random_uuid()
      );
    exception when others then v_failed := true; end;
    if not v_failed then raise exception 'A grant authorized an action outside its scope.'; end if;

    v_request := public.submit_money_desk_request(
      'migration-dry-run:idempotent',v_grant,'scope.preparer@drapeon.co','dry-run-scope-preparer','OPS',
      'PAYOUT_RELEASE','ORDER','idempotent-order',null,null,1000,'USD',1000,'NATIVE_USD',
      'Release this verified payout exactly once after approval.','{}'::jsonb,gen_random_uuid()
    );
    v_duplicate := public.submit_money_desk_request(
      'migration-dry-run:idempotent',v_grant,'scope.preparer@drapeon.co','dry-run-scope-preparer','OPS',
      'PAYOUT_RELEASE','ORDER','idempotent-order',null,null,1000,'USD',1000,'NATIVE_USD',
      'Release this verified payout exactly once after approval.','{}'::jsonb,gen_random_uuid()
    );
    if coalesce((v_duplicate->>'duplicate')::boolean,false) is not true
      or v_duplicate->>'requestId' <> v_request->>'requestId' then
      raise exception 'Identical Money Desk retry was not idempotent.';
    end if;

    v_failed := false;
    begin
      perform public.submit_money_desk_request(
        'migration-dry-run:idempotent',v_grant,'scope.preparer@drapeon.co','dry-run-scope-preparer','OPS',
        'PAYOUT_RELEASE','ORDER','changed-order',null,null,1000,'USD',1000,'NATIVE_USD',
        'This changed request must not reuse the existing idempotency key.','{}'::jsonb,gen_random_uuid()
      );
    exception when others then v_failed := true; end;
    if not v_failed then raise exception 'Changed request reused an idempotency key.'; end if;

    update public.money_desk_jit_grants
      set issued_at=now()-interval '2 minutes',expires_at=now()-interval '1 minute'
      where id=v_grant;
    v_failed := false;
    begin
      perform public.assert_money_desk_jit(v_grant,'scope.preparer@drapeon.co','dry-run-scope-preparer','OPS','PAYOUT_RELEASE');
    exception when others then v_failed := true; end;
    if not v_failed then raise exception 'Expired Money Desk elevation remained usable.'; end if;

    raise exception 'MONEY_DESK_JIT_VERIFICATION_ROLLBACK';
  exception when others then
    if sqlerrm <> 'MONEY_DESK_JIT_VERIFICATION_ROLLBACK' then raise; end if;
  end;
  raise notice 'Money Desk JIT scope, expiry, and idempotency verification passed; synthetic rows rolled back.';
end;
$verification$;
