do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payouts' and column_name = 'bank_settlement_status'
  ) then
    raise exception 'payouts.bank_settlement_status is missing';
  end if;

  if to_regclass('public.provider_payout_events') is null then
    raise exception 'provider_payout_events is missing';
  end if;
end $$;
