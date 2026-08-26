alter table public.payouts
  add column if not exists payout_purpose text;

update public.payouts
set payout_purpose = case
  when fabric_candidate_id is not null then 'FABRIC_RELEASE'
  when material_advance_id is not null then 'MATERIAL_ADVANCE'
  when settlement_tranche_id is not null then 'SETTLEMENT_TRANCHE'
  when provider_response ? 'tip_id'
    or provider_response ->> 'function' = 'release-order-tip' then 'TIP'
  when provider_response ? 'consultation_booking_id'
    or provider_response ->> 'function' = 'release-consultation-earning' then 'CONSULTATION_EARNING'
  else 'ORDER_EARNING'
end
where payout_purpose is null;

alter table public.payouts
  alter column payout_purpose set default 'ORDER_EARNING',
  alter column payout_purpose set not null;

alter table public.payouts
  drop constraint if exists payouts_payout_purpose_check;

alter table public.payouts
  add constraint payouts_payout_purpose_check check (
    payout_purpose in (
      'ORDER_EARNING',
      'SETTLEMENT_TRANCHE',
      'FABRIC_RELEASE',
      'MATERIAL_ADVANCE',
      'CONSULTATION_EARNING',
      'TIP'
    )
  );

create index if not exists payouts_order_purpose_initiated_idx
  on public.payouts(order_id, payout_purpose, initiated_at desc)
  where order_id is not null;

create index if not exists payouts_active_order_earning_idx
  on public.payouts(order_id, processed_at desc)
  where payout_purpose in ('ORDER_EARNING', 'SETTLEMENT_TRANCHE')
    and status in ('PROCESSING', 'PAID', 'BLOCKED');

comment on column public.payouts.payout_purpose is
  'Authoritative classification that prevents scoped transfers such as tips and fabric releases from being treated as the whole order earning.';
