-- Transactional verification for implementation 3. Synthetic case records
-- are always rolled back after multi-case, immutability, and evidence checks.

do $verification$
declare
  v_order_id text;
  v_case_one uuid;
  v_case_two uuid;
  v_event_id uuid;
  v_failed boolean;
begin
  begin
    select id into v_order_id from public.orders order by created_at limit 1;
    if v_order_id is null then raise exception 'Financial-case verification requires one development order.'; end if;

    insert into public.financial_cases (
      idempotency_key, request_hash, order_id, case_type, opened_by_role,
      reason_code, summary, policy_version
    ) values (
      'migration-dry-run:case-one', repeat('a', 64), v_order_id,
      'QUALITY_CONCERN', 'SYSTEM', 'OTHER',
      'Synthetic financial case used to verify implementation three.',
      'commercial-2026-07-31-v1'
    ) returning id into v_case_one;

    insert into public.financial_cases (
      idempotency_key, request_hash, order_id, case_type, opened_by_role,
      reason_code, summary, policy_version
    ) values (
      'migration-dry-run:case-two', repeat('b', 64), v_order_id,
      'FULFILLMENT_RECONCILIATION', 'SYSTEM', 'NOT_RECEIVED',
      'Second synthetic case proving multiple cases may relate to one order.',
      'commercial-2026-07-31-v1'
    ) returning id into v_case_two;

    if v_case_one = v_case_two then raise exception 'Multi-case insertion returned the same identifier.'; end if;

    insert into public.financial_case_events (
      case_id, event_type, actor_role, payload, correlation_id
    ) values (
      v_case_one, 'CASE_OPENED', 'SYSTEM', '{"verification":true}'::jsonb, gen_random_uuid()
    ) returning id into v_event_id;

    insert into public.financial_case_evidence (
      case_id, evidence_type, source, verification_status, source_table,
      source_record_id, submitted_by_role
    ) values (
      v_case_one, 'ORDER_REFERENCE', 'PLATFORM_ORDER', 'CORROBORATED',
      'orders', v_order_id::text, 'SYSTEM'
    );

    v_failed := false;
    begin
      update public.financial_cases set summary = 'Mutated claim text is forbidden.' where id = v_case_one;
    exception when others then
      v_failed := true;
    end;
    if not v_failed then raise exception 'Immutable financial-case claim was updated.'; end if;

    v_failed := false;
    begin
      update public.financial_case_events set payload = '{}'::jsonb where id = v_event_id;
    exception when others then
      v_failed := true;
    end;
    if not v_failed then raise exception 'Append-only financial-case event was updated.'; end if;

    v_failed := false;
    begin
      insert into public.financial_case_evidence (
        case_id, evidence_type, source, submitted_by_role
      ) values (v_case_two, 'PUBLIC_URL_WITHOUT_SOURCE', 'USER_UPLOAD', 'SYSTEM');
    exception when others then
      v_failed := true;
    end;
    if not v_failed then raise exception 'Evidence without a secure object or source reference was accepted.'; end if;

    raise exception 'FINANCIAL_CASE_FOUNDATION_VERIFICATION_ROLLBACK';
  exception when others then
    if sqlerrm <> 'FINANCIAL_CASE_FOUNDATION_VERIFICATION_ROLLBACK' then raise; end if;
  end;

  raise notice 'Financial-case and evidence foundation verification passed; synthetic rows rolled back.';
end;
$verification$;
