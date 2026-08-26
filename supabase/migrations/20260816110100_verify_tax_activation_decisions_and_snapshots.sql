-- Rollback-only verification for Implementations 11C-11E.
begin;

do $$
declare
  v_policy text := 'tax-fulfillment-verify-11c-e';
  v_registration uuid;
  v_responsibility uuid;
  v_activation uuid;
  v_disabled uuid;
  v_result jsonb;
begin
  insert into public.tax_policy_versions (
    policy_version,status,effective_from,reviewed_at,review_due_at,
    legal_reviewer,finance_approver,engineering_approver,source_urls,change_reason
  ) values (
    v_policy,'ACTIVE',now() - interval '1 day',now() - interval '1 day',now() + interval '90 days',
    'tax-legal@drapeon.co','finance@drapeon.co','engineering@drapeon.co',
    array['https://example.gov/tax'], 'Rollback-only Implementation 11 verification policy.'
  );

  insert into public.tax_registration_controls (
    control_key,policy_version,status,jurisdiction_country_code,tax_transaction_type,
    responsible_party,registration_subject,rule_type,effective_from,reviewed_at,review_due_at,
    legal_reviewer,finance_approver,engineering_approver,source_urls,change_reason
  ) values (
    'VERIFY:GH:CUSTOM_ORDER',v_policy,'ACTIVE','GH','CUSTOM_ORDER',
    'DRAPEON_MARKETPLACE_FACILITATOR','DRAPEON','MANDATORY',now() - interval '1 day',
    now() - interval '1 day',now() + interval '90 days','tax-legal@drapeon.co',
    'finance@drapeon.co','engineering@drapeon.co',array['https://example.gov/tax'],
    'Rollback-only reviewed registration control.'
  ) returning id into v_registration;

  insert into public.tax_responsibility_controls (
    control_key,policy_version,status,jurisdiction_country_code,tax_transaction_type,
    fulfillment_classification,tax_supply_characterization,liability_granularity,
    responsible_party,statutory_role,registration_subject,registration_control_id,
    marketplace_facilitator_applies,collection_mode,calculation_strategy,invoice_treatment,
    filing_liability_account,effective_from,reviewed_at,review_due_at,legal_reviewer,
    finance_approver,engineering_approver,source_urls,change_reason
  ) values (
    'VERIFY:GH:CUSTOM_ORDER:LOCAL_DELIVERY',v_policy,'ACTIVE','GH','CUSTOM_ORDER',
    'LOCAL_DELIVERY','COMPOSITE','ORDER','DRAPEON_MARKETPLACE_FACILITATOR',
    'Rollback-only marketplace facilitator','DRAPEON',v_registration,true,
    'COLLECTED_AT_CHECKOUT','REVIEWED_STATIC','Drapeon records tax separately.',
    'TAX_LIABILITY:GH',now() - interval '1 day',now() - interval '1 day',now() + interval '90 days',
    'tax-legal@drapeon.co','finance@drapeon.co','engineering@drapeon.co',
    array['https://example.gov/tax'],'Rollback-only reviewed responsibility control.'
  ) returning id into v_responsibility;

  insert into public.tax_line_classification_controls (
    responsibility_control_id,line_key,line_class,taxable,calculation_strategy,
    source_urls,reviewed_at,review_due_at
  ) values
    (v_responsibility,'TAILORING','STANDARD',true,'STANDARD_RATE',array['https://example.gov/tax'],now() - interval '1 day',now() + interval '90 days'),
    (v_responsibility,'FABRIC_ALLOWANCE','EXEMPT',false,'EXEMPT',array['https://example.gov/tax'],now() - interval '1 day',now() + interval '90 days'),
    (v_responsibility,'FULFILLMENT','STANDARD',true,'STANDARD_RATE',array['https://example.gov/tax'],now() - interval '1 day',now() + interval '90 days');

  insert into public.tax_registration_facts (
    registration_subject,subject_id,jurisdiction_country_code,tax_transaction_type,
    decision,evidence_references,effective_from,reviewed_at,review_due_at
  ) values (
    'DRAPEON','DRAPEON','GH','CUSTOM_ORDER','REGISTERED',array['ops://tax/verify'],
    now() - interval '1 day',now() - interval '1 day',now() + interval '90 days'
  );

  insert into public.tax_policy_activations (
    environment,policy_version,status,jurisdiction_country_code,tax_transaction_type,
    fulfillment_classification,effective_from,reviewed_at,review_due_at,legal_reviewer,
    finance_approver,engineering_approver,source_urls,change_reason
  ) values (
    'DEVELOPMENT',v_policy,'ACTIVE','GH','CUSTOM_ORDER','LOCAL_DELIVERY',
    now() - interval '1 minute',now() - interval '1 day',now() + interval '90 days',
    'tax-legal@drapeon.co','finance@drapeon.co','engineering@drapeon.co',
    array['https://example.gov/tax'],'Rollback-only exact development activation.'
  ) returning id into v_activation;

  v_result := public.resolve_tax_policy_activation(
    'DEVELOPMENT',v_policy,'GH',null,null,null,'CUSTOM_ORDER','LOCAL_DELIVERY',now()
  );
  if v_result->>'status' <> 'RESOLVED' then
    raise exception 'Expected development activation to resolve, got %', v_result;
  end if;
  v_result := public.resolve_tax_policy_activation(
    'PRODUCTION',v_policy,'GH',null,null,null,'CUSTOM_ORDER','LOCAL_DELIVERY',now()
  );
  if v_result->>'status' <> 'NOT_ACTIVATED' then
    raise exception 'Development activation leaked into production: %', v_result;
  end if;

  insert into public.tax_policy_activations (
    environment,policy_version,status,jurisdiction_country_code,tax_transaction_type,
    fulfillment_classification,effective_from,reviewed_at,review_due_at,legal_reviewer,
    finance_approver,engineering_approver,source_urls,change_reason,supersedes_activation_id
  ) values (
    'DEVELOPMENT',v_policy,'DISABLED','GH','CUSTOM_ORDER','LOCAL_DELIVERY',
    now(),now() - interval '1 day',now() + interval '90 days','tax-legal@drapeon.co',
    'finance@drapeon.co','engineering@drapeon.co',array['https://example.gov/tax'],
    'Rollback-only safe activation disable decision.',v_activation
  ) returning id into v_disabled;
  v_result := public.resolve_tax_policy_activation(
    'DEVELOPMENT',v_policy,'GH',null,null,null,'CUSTOM_ORDER','LOCAL_DELIVERY',now() + interval '1 second'
  );
  if v_result->>'reason' <> 'CONTROL_NOT_ACTIVE' then
    raise exception 'Expected append-only rollback to block new pricing, got %', v_result;
  end if;

  begin
    update public.tax_policy_activations set change_reason = 'mutation' where id = v_disabled;
    raise exception 'Expected activation immutability failure.';
  exception when raise_exception then
    if sqlerrm = 'Expected activation immutability failure.' then raise; end if;
  end;

  if (select count(*) from public.tax_control_health where activation_id in (v_activation,v_disabled)) <> 2 then
    raise exception 'Expected both activation decisions in health reporting.';
  end if;
end;
$$;

rollback;
