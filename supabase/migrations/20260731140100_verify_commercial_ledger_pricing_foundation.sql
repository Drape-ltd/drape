-- Transactional verification for implementation 2. The inner block always
-- raises a sentinel exception so every synthetic commercial row is rolled back.

do $verification$
declare
  v_correlation_id uuid := gen_random_uuid();
  v_transaction_id uuid;
  v_duplicate_id uuid;
  v_reservation jsonb;
  v_failed boolean;
begin
  begin
    v_transaction_id := public.post_commercial_ledger_transaction(
      'migration-dry-run:balanced-capture', 'CAPTURE', 'INITIAL_ORDER', null, null,
      'commercial-2026-07-31-v1', 1, v_correlation_id, 'migration-dry-run',
      '[
        {"accountCode":"PROVIDER_CLEARING","accountScope":"STRIPE","direction":"DEBIT","amount":11750,"currency":"USD"},
        {"accountCode":"TAILOR_ENTITLEMENT","accountScope":"dry-run","direction":"CREDIT","amount":10000,"currency":"USD"},
        {"accountCode":"TAX_LIABILITY","accountScope":"Illinois","direction":"CREDIT","amount":750,"currency":"USD"},
        {"accountCode":"FULFILLMENT_LIABILITY","accountScope":"dry-run","direction":"CREDIT","amount":1000,"currency":"USD"}
      ]'::jsonb,
      '{"verification":true}'::jsonb,
      null
    );

    -- Force the deferred database invariant while the balanced journal exists.
    set constraints commercial_ledger_entries_balance_guard immediate;
    set constraints commercial_ledger_entries_balance_guard deferred;

    v_duplicate_id := public.post_commercial_ledger_transaction(
      'migration-dry-run:balanced-capture', 'CAPTURE', 'INITIAL_ORDER', null, null,
      'commercial-2026-07-31-v1', 1, v_correlation_id, 'migration-dry-run',
      '[
        {"accountCode":"PROVIDER_CLEARING","accountScope":"STRIPE","direction":"DEBIT","amount":11750,"currency":"USD"},
        {"accountCode":"TAILOR_ENTITLEMENT","accountScope":"dry-run","direction":"CREDIT","amount":10000,"currency":"USD"},
        {"accountCode":"TAX_LIABILITY","accountScope":"Illinois","direction":"CREDIT","amount":750,"currency":"USD"},
        {"accountCode":"FULFILLMENT_LIABILITY","accountScope":"dry-run","direction":"CREDIT","amount":1000,"currency":"USD"}
      ]'::jsonb,
      '{"verification":true}'::jsonb,
      null
    );
    if v_duplicate_id <> v_transaction_id then
      raise exception 'Idempotent ledger retry returned a different transaction.';
    end if;

    v_failed := false;
    begin
      perform public.post_commercial_ledger_transaction(
        'migration-dry-run:unbalanced', 'CAPTURE', 'INITIAL_ORDER', null, null,
        'commercial-2026-07-31-v1', 1, gen_random_uuid(), null,
        '[
          {"accountCode":"PROVIDER_CLEARING","accountScope":"STRIPE","direction":"DEBIT","amount":100,"currency":"USD"},
          {"accountCode":"TAILOR_ENTITLEMENT","accountScope":"dry-run","direction":"CREDIT","amount":99,"currency":"USD"}
        ]'::jsonb,
        '{}'::jsonb,
        null
      );
    exception when others then
      v_failed := true;
    end;
    if not v_failed then raise exception 'Unbalanced ledger transaction was accepted.'; end if;

    v_failed := false;
    begin
      perform public.post_commercial_ledger_transaction(
        'migration-dry-run:cross-currency', 'CAPTURE', 'INITIAL_ORDER', null, null,
        'commercial-2026-07-31-v1', 1, gen_random_uuid(), null,
        '[
          {"accountCode":"PROVIDER_CLEARING","accountScope":"STRIPE","direction":"DEBIT","amount":100,"currency":"USD"},
          {"accountCode":"TAILOR_ENTITLEMENT","accountScope":"dry-run","direction":"CREDIT","amount":100,"currency":"EUR"}
        ]'::jsonb,
        '{}'::jsonb,
        null
      );
      set constraints commercial_ledger_entries_balance_guard immediate;
    exception when others then
      v_failed := true;
    end;
    if not v_failed then raise exception 'Cross-currency imbalance was accepted.'; end if;

    v_failed := false;
    begin
      update public.commercial_ledger_entries
      set amount = amount + 1
      where transaction_id = v_transaction_id;
    exception when others then
      v_failed := true;
    end;
    if not v_failed then raise exception 'Immutable ledger entry was updated.'; end if;

    v_reservation := public.create_commercial_pricing_reservation(
      'migration-dry-run:pricing', null, null, null, 'INITIAL_ORDER', 'USD',
      10000, 0, 750, 1000, 11750, 'Illinois', 'ZIPTAX', false,
      '{"verification":true}'::jsonb, gen_random_uuid(), now() + interval '15 minutes'
    );
    perform public.consume_commercial_pricing_reservation(
      (v_reservation->>'reservationToken')::uuid, null, 'migration-dry-run-order'
    );
    perform public.consume_commercial_pricing_reservation(
      (v_reservation->>'reservationToken')::uuid, null, 'migration-dry-run-order'
    );

    v_failed := false;
    begin
      perform public.create_commercial_pricing_reservation(
        'migration-dry-run:fallback-tax', null, null, null, 'INITIAL_ORDER', 'USD',
        10000, 0, 0, 1000, 11000, 'Unknown', 'FALLBACK', true,
        '{}'::jsonb, gen_random_uuid(), now() + interval '15 minutes'
      );
    exception when others then
      v_failed := true;
    end;
    if not v_failed then raise exception 'Fallback tax reservation was accepted.'; end if;

    insert into public.commercial_pricing_reservations (
      idempotency_key, request_hash, purpose, currency, subtotal_amount,
      total_amount, tax_source, tax_fallback, expires_at
    ) values (
      'migration-dry-run:expired', 'dry-run', 'INITIAL_ORDER', 'USD', 100, 100,
      'NOT_APPLICABLE', false, now() - interval '1 minute'
    ) returning jsonb_build_object('reservationToken', reservation_token) into v_reservation;

    v_failed := false;
    begin
      perform public.consume_commercial_pricing_reservation(
        (v_reservation->>'reservationToken')::uuid, null, 'migration-dry-run-expired'
      );
    exception when others then
      v_failed := true;
    end;
    if not v_failed then raise exception 'Expired pricing reservation was consumed.'; end if;

    raise exception 'COMMERCIAL_FOUNDATION_VERIFICATION_ROLLBACK';
  exception when others then
    if sqlerrm <> 'COMMERCIAL_FOUNDATION_VERIFICATION_ROLLBACK' then
      raise;
    end if;
  end;

  raise notice 'Commercial ledger and pricing foundation verification passed; synthetic rows rolled back.';
end;
$verification$;
