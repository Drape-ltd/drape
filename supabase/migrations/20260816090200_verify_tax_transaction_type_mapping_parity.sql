-- Rollback-only parity proof for every launch TaxTransactionType.
-- XZ is a synthetic dry-run jurisdiction and never becomes a live control.

do $verification$
declare
  v_registration_id uuid;
  v_result jsonb;
  v_fixture record;
begin
  begin
    insert into public.tax_policy_versions (
      policy_version,status,effective_from,reviewed_at,review_due_at,
      legal_reviewer,finance_approver,engineering_approver,source_urls,change_reason
    ) values (
      'tax-fulfillment-11a-parity-fixture','ACTIVE',now() - interval '1 day',now() - interval '1 day',now() + interval '30 days',
      'migration-tax-reviewer@drapeon.co','migration-finance@drapeon.co','migration-engineering@drapeon.co',
      array['https://example.invalid/drapeon-tax-11a-fixture'],
      'Exercise every launch tax transaction type without activating a real jurisdiction.'
    );

    for v_fixture in
      select * from (values
        ('CUSTOM_ORDER','COMPOSITE'),
        ('READY_MADE_ORDER','GOODS'),
        ('CONSULTATION','SERVICES'),
        ('MATERIAL_ADVANCE','JURISDICTION_SPECIFIC'),
        ('ORDER_AMENDMENT','JURISDICTION_SPECIFIC'),
        ('FULFILLMENT_CHARGE','ANCILLARY'),
        ('TIP_OR_GRATUITY','GRATUITY')
      ) as fixture(transaction_type, supply_characterization)
    loop
      insert into public.tax_registration_controls (
        control_key,policy_version,status,jurisdiction_country_code,tax_transaction_type,
        responsible_party,registration_subject,rule_type,decision_evidence_requirements,
        effective_from,reviewed_at,review_due_at,legal_reviewer,finance_approver,
        engineering_approver,source_urls,change_reason
      ) values (
        'XZ:' || v_fixture.transaction_type || ':DRAPEON','tax-fulfillment-11a-parity-fixture','ACTIVE','XZ',
        v_fixture.transaction_type,'DRAPEON_MARKETPLACE_FACILITATOR','DRAPEON','MANDATORY','["synthetic_fixture"]'::jsonb,
        now() - interval '1 day',now() - interval '1 day',now() + interval '30 days',
        'migration-tax-reviewer@drapeon.co','migration-finance@drapeon.co','migration-engineering@drapeon.co',
        array['https://example.invalid/drapeon-tax-11a-fixture'],
        'Exercise the registration dependency for a synthetic transaction type.'
      ) returning id into v_registration_id;

      insert into public.tax_responsibility_controls (
        control_key,policy_version,status,jurisdiction_country_code,tax_transaction_type,
        fulfillment_classification,tax_supply_characterization,liability_granularity,
        responsible_party,statutory_role,registration_subject,registration_control_id,
        marketplace_facilitator_applies,collection_mode,calculation_strategy,invoice_treatment,
        filing_liability_account,effective_from,reviewed_at,review_due_at,legal_reviewer,
        finance_approver,engineering_approver,source_urls,change_reason
      ) values (
        'XZ:' || v_fixture.transaction_type || ':LOCAL_COLLECTION','tax-fulfillment-11a-parity-fixture','ACTIVE','XZ',
        v_fixture.transaction_type,'LOCAL_COLLECTION',v_fixture.supply_characterization,'ORDER',
        'DRAPEON_MARKETPLACE_FACILITATOR','Synthetic dry-run remitter','DRAPEON',v_registration_id,true,
        'COLLECTED_AT_CHECKOUT','SYNTHETIC_DRY_RUN','Synthetic receipt treatment.','TAX_LIABILITY:XZ',
        now() - interval '1 day',now() - interval '1 day',now() + interval '30 days',
        'migration-tax-reviewer@drapeon.co','migration-finance@drapeon.co','migration-engineering@drapeon.co',
        array['https://example.invalid/drapeon-tax-11a-fixture'],
        'Exercise the responsibility mapping for a synthetic transaction type.'
      );

      v_result := public.resolve_reviewed_tax_responsibility_control(
        'tax-fulfillment-11a-parity-fixture',null,'XZ',null,v_fixture.transaction_type,'LOCAL_COLLECTION',now()
      );
      if v_result->>'status' <> 'RESOLVED'
        or v_result->>'transactionType' <> v_fixture.transaction_type
        or v_result->>'supplyCharacterization' <> v_fixture.supply_characterization then
        raise exception 'Tax transaction fixture did not resolve: % => %', v_fixture.transaction_type, v_result;
      end if;
    end loop;

    raise exception 'TAX_TRANSACTION_TYPE_PARITY_VERIFICATION_ROLLBACK';
  exception when others then
    if sqlerrm <> 'TAX_TRANSACTION_TYPE_PARITY_VERIFICATION_ROLLBACK' then raise; end if;
  end;
  raise notice 'All launch TaxTransactionType fixtures resolved; synthetic rows rolled back.';
end;
$verification$;
