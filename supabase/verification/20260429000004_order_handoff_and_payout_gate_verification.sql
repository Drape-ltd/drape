select
  count(*) filter (where handoff_completed_at is not null) as orders_with_handoff_completed_at,
  count(*) filter (where customer_handoff_confirmed_at is not null) as orders_with_customer_handoff_confirmed_at
from public.orders;

select
  stage,
  count(*) as rows
from public.orders
where handoff_completed_at is not null
group by stage
order by stage;

select
  order_id,
  status,
  blocked_reason,
  processed_at
from public.payouts
order by processed_at desc
limit 20;
