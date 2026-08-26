-- Rollback-only proof for Implementation 11A reviewed tax controls.

do $verification$
declare
  v_registration_id uuid;
  v_control_id uuid;
  v_result jsonb;
  v_failed boolean;
begin
  begin
    insert into public.tax_policy_versions (
      policy_version,status,effective_from,reviewed_at,review_due_at,
      legal_reviewer,finance_approver,engineering_approver,source_urls,change_reason
    ) values (
      'tax-fulfillment-2026-08-15-v1','ACTIVE',now() - interval '1 day',now() - interval '1 day',now() + interval '365 days',
      'tax-reviewer@drapeon.co','finance-approver@drapeon.co','engineering-approver@drapeon.co',
      array['https://gra.gov.gh/'],'Verify the dormant reviewed-control foundation in development.'
    );

    insert into public.tax_registration_controls (
      control_key,policy_version,status,jurisdiction_country_code,tax_transaction_type,
      responsible_party,registration_subject,rule_type,decision_evidence_requirements,
      effective_from,reviewed_at,review_due_at,legal_reviewer,finance_approver,
      engineering_approver,source_urls,change_reason
    ) values (
      'GH:CUSTOM_ORDER:DRAPEON','tax-fulfillment-2026-08-15-v1','ACTIVE','GH','CUSTOM_ORDER',
      'DRAPEON_MARKETPLACE_FACILITATOR','DRAPEON','MANDATORY','["registration_record"]'::jsonb,
      now() - interval '1 day',now() - interval '1 day',now() + interval '365 days',
      'tax-reviewer@drapeon.co','finance-approver@drapeon.co','engineering-approver@drapeon.co',
      array['https://gra.gov.gh/'],'Verify a sourced registration control for the dry run.'
    ) returning id into v_registration_id;

    insert into public.tax_responsibility_controls (
      control_key,policy_version,status,jurisdiction_country_code,tax_transaction_type,
      fulfillment_classification,tax_supply_characterization,liability_granularity,
      responsible_party,statutory_role,registration_subject,registration_control_id,
      marketplace_facilitator_applies,collection_mode,calculation_strategy,invoice_treatment,
      filing_liability_account,effective_from,reviewed_at,review_due_at,legal_reviewer,
      finance_approver,engineering_approver,source_urls,change_reason
    ) values (
      'GH:CUSTOM_ORDER:LOCAL_DELIVERY','tax-fulfillment-2026-08-15-v1','ACTIVE','GH','CUSTOM_ORDER',
      'LOCAL_DELIVERY','COMPOSITE','ORDER','DRAPEON_MARKETPLACE_FACILITATOR',
      'Marketplace facilitator and remitter','DRAPEON',v_registration_id,true,
      'COLLECTED_AT_CHECKOUT','REVIEWED_STATIC_OR_PROVIDER','Drapeon records collected tax separately.',
      'TAX_LIABILITY:GH',now() - interval '1 day',now() - interval '1 day',now() + interval '365 days',
      'tax-reviewer@drapeon.co','finance-approver@drapeon.co','engineering-approver@drapeon.co',
      array['https://gra.gov.gh/'],'Verify one order-level responsibility control for the dry run.'
    ) returning id into v_control_id;

    v_result := public.resolve_reviewed_tax_responsibility_control(
      'tax-fulfillment-2026-08-15-v1',null,'GH',null,'CUSTOM_ORDER','LOCAL_DELIVERY',now()
    );
    if v_result->>'status' <> 'RESOLVED' or v_result->>'controlId' <> v_control_id::text then
      raise exception 'Reviewed responsibility control did not resolve exactly once: %', v_result;
    end if;

    v_result := public.resolve_reviewed_tax_responsibility_control(
      'tax-fulfillment-2026-08-15-v1',null,'GH',null,'UNKNOWN','LOCAL_DELIVERY',now()
    );
    if v_result->>'reason' <> 'UNSUPPORTED_TRANSACTION_TYPE' then raise exception 'Unknown transaction type did not fail closed.'; end if;

    v_result := public.resolve_reviewed_tax_responsibility_control(
      'tax-fulfillment-2026-08-15-v1',null,'GH',null,'CUSTOM_ORDER','LOCAL_DELIVERY',now() + interval '366 days'
    );
    if v_result->>'reason' <> 'CONTROL_REVIEW_EXPIRED' then raise exception 'Expired review did not fail closed.'; end if;

    v_failed := false;
    begin
      insert into public.tax_responsibility_controls (
        control_key,policy_version,status,jurisdiction_country_code,tax_transaction_type,
        fulfillment_classification,tax_supply_characterization,liability_granularity,
        responsible_party,statutory_role,registration_subject,registration_control_id,
        marketplace_facilitator_applies,collection_mode,calculation_strategy,invoice_treatment,
        filing_liability_account,effective_from,reviewed_at,review_due_at,legal_reviewer,
        finance_approver,engineering_approver,source_urls,change_reason
      ) values (
        'GH:LINE_GROUP:BLOCKED','tax-fulfillment-2026-08-15-v1','ACTIVE','GH','CUSTOM_ORDER',
        'LOCAL_COLLECTION','GOODS','LINE_GROUP','DRAPEON_MARKETPLACE_FACILITATOR',
        'Marketplace facilitator and remitter','DRAPEON',v_registration_id,false,
        'COLLECTED_AT_CHECKOUT','BLOCKED','Blocked until per-line liability exists.','TAX_LIABILITY:GH',
        now(),now(),now() + interval '365 days','tax-reviewer@drapeon.co','finance-approver@drapeon.co',
        'engineering-approver@drapeon.co',array['https://gra.gov.gh/'],'Prove line-group liability remains blocked for launch.'
      );
    exception when check_violation then v_failed := true; end;
    if not v_failed then raise exception 'Launch policy accepted LINE_GROUP liability.'; end if;

    v_failed := false;
    begin
      insert into public.tax_responsibility_controls (
        control_key,policy_version,status,jurisdiction_country_code,tax_transaction_type,
        fulfillment_classification,tax_supply_characterization,liability_granularity,
        responsible_party,statutory_role,registration_subject,registration_control_id,
        marketplace_facilitator_applies,collection_mode,calculation_strategy,invoice_treatment,
        filing_liability_account,effective_from,reviewed_at,review_due_at,legal_reviewer,
        finance_approver,engineering_approver,source_urls,change_reason
      ) select
        'GH:CUSTOM_ORDER:LOCAL_DELIVERY:DUPLICATE',policy_version,status,jurisdiction_country_code,
        tax_transaction_type,fulfillment_classification,tax_supply_characterization,
        liability_granularity,responsible_party,statutory_role,registration_subject,
        registration_control_id,marketplace_facilitator_applies,collection_mode,
        calculation_strategy,invoice_treatment,filing_liability_account,effective_from,
        reviewed_at,review_due_at,legal_reviewer,finance_approver,engineering_approver,
        source_urls,'Prove duplicate responsibility scopes are rejected.'
      from public.tax_responsibility_controls where id = v_control_id;
    exception when unique_violation then v_failed := true; end;
    if not v_failed then raise exception 'Conflicting responsibility control was inserted.'; end if;

    v_failed := false;
    begin update public.tax_responsibility_controls set change_reason = 'Mutation must fail.' where id = v_control_id;
    exception when others then v_failed := true; end;
    if not v_failed then raise exception 'Immutable tax responsibility control was updated.'; end if;

    if has_table_privilege('authenticated','public.tax_responsibility_controls','SELECT')
      or has_table_privilege('anon','public.tax_responsibility_controls','SELECT') then
      raise exception 'Client role can read internal tax responsibility controls.';
    end if;
    if not has_table_privilege('service_role','public.tax_responsibility_controls','SELECT') then
      raise exception 'Service role cannot read tax responsibility controls.';
    end if;

    raise exception 'TAX_DECISION_CONTROLS_VERIFICATION_ROLLBACK';
  exception when others then
    if sqlerrm <> 'TAX_DECISION_CONTROLS_VERIFICATION_ROLLBACK' then raise; end if;
  end;
  raise notice 'Tax decision controls verification passed; synthetic rows rolled back.';
end;
$verification$;
