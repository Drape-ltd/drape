do $$
begin
  if exists (
    select 1 from public.payouts
    where payout_purpose is null
       or payout_purpose not in (
         'ORDER_EARNING', 'SETTLEMENT_TRANCHE', 'FABRIC_RELEASE',
         'MATERIAL_ADVANCE', 'CONSULTATION_EARNING', 'TIP'
       )
  ) then
    raise exception 'payout purpose classification contains invalid rows';
  end if;

  if exists (
    select 1 from public.payouts
    where fabric_candidate_id is not null and payout_purpose <> 'FABRIC_RELEASE'
  ) then
    raise exception 'fabric candidate payouts must be classified as fabric releases';
  end if;

  if exists (
    select 1 from public.payouts
    where material_advance_id is not null and payout_purpose <> 'MATERIAL_ADVANCE'
  ) then
    raise exception 'material advance payouts must be classified as material advances';
  end if;

  if exists (
    select 1 from public.payouts
    where settlement_tranche_id is not null and payout_purpose <> 'SETTLEMENT_TRANCHE'
  ) then
    raise exception 'settlement tranche payouts must be classified as settlement tranches';
  end if;
end $$;
