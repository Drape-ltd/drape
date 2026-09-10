-- Released settlement milestones must remain visible in the durable in-app
-- inbox even when a user has no registered push endpoint. The unique inbox
-- key keeps this backfill aligned with the queued notification path.

insert into public.communication_inbox (
  recipient_id,
  category,
  purpose,
  severity,
  title,
  body,
  destination_key,
  destination_params,
  deduplication_key,
  created_at
)
select
  recipient.recipient_id,
  'PAYOUT',
  'TRANSACTIONAL',
  'NOTICE',
  recipient.title,
  recipient.body,
  'ORDER_DETAIL',
  jsonb_build_object('orderId', tranche.order_id),
  'settlement-released:' || recipient.audience || ':' || tranche.id::text,
  coalesce(tranche.released_at, now())
from public.order_settlement_tranches tranche
join public.order_settlement_plans plan on plan.id = tranche.plan_id
cross join lateral (
  values
    (plan.tailor_id, 'tailor', 'Earnings released', 'Drapeon released this verified earnings milestone to your payout account.'),
    (plan.customer_id, 'customer', 'Payment protection updated', 'A verified order milestone was released to the tailor. Remaining stages stay protected.')
) as recipient(recipient_id, audience, title, body)
where tranche.status = 'RELEASED'
  and tranche.released_at is not null
on conflict (recipient_id, deduplication_key) where deduplication_key is not null do nothing;
