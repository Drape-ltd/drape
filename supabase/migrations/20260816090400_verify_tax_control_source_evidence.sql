-- Rollback-only proof that placeholder source evidence fails closed.

do $verification$
declare v_failed boolean := false;
begin
  begin
    insert into public.tax_policy_versions (
      policy_version,status,effective_from,reviewed_at,review_due_at,
      legal_reviewer,finance_approver,engineering_approver,source_urls,change_reason
    ) values (
      'tax-invalid-source-fixture','ACTIVE',now(),now(),now() + interval '30 days',
      'tax@drapeon.co','finance@drapeon.co','engineering@drapeon.co',array[''],
      'Prove placeholder source evidence cannot activate a reviewed tax policy.'
    );
  exception when check_violation then v_failed := true; end;
  if not v_failed then raise exception 'Reviewed tax policy accepted placeholder source evidence.'; end if;
  raise notice 'Reviewed tax source evidence verification passed.';
end;
$verification$;
