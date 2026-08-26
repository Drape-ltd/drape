-- Prove that equal numeric amounts in different currencies cannot satisfy the
-- ledger balance invariant. The rejected statement rolls back its own rows.

do $verification$
declare
  v_rejected boolean := false;
begin
  begin
    perform public.post_commercial_ledger_transaction(
      'migration-dry-run:cross-currency-isolation',
      'CAPTURE',
      'INITIAL_ORDER',
      null,
      null,
      'commercial-2026-07-31-v1',
      1,
      gen_random_uuid(),
      null,
      '[
        {"accountCode":"PROVIDER_CLEARING","accountScope":"STRIPE","direction":"DEBIT","amount":100,"currency":"USD"},
        {"accountCode":"TAILOR_ENTITLEMENT","accountScope":"dry-run","direction":"CREDIT","amount":100,"currency":"EUR"}
      ]'::jsonb,
      '{"verification":true}'::jsonb,
      null
    );
    set constraints commercial_ledger_entries_balance_guard immediate;
  exception when others then
    if position('is not balanced' in sqlerrm) > 0 then
      v_rejected := true;
    else
      raise;
    end if;
  end;

  if not v_rejected then
    raise exception 'Cross-currency ledger imbalance was accepted.';
  end if;

  raise notice 'Commercial ledger currency-isolation verification passed; synthetic rows rolled back.';
end;
$verification$;
