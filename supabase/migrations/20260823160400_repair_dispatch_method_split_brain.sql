-- Older pickup -> delivery requests could create an active dispatch run while
-- leaving the order on LOCAL_COLLECTION. The active run is authoritative.
-- Repair those rows and retire every stale pickup credential. A later,
-- explicit SWITCH_TO_PICKUP decision remains reversible through the v2 RPC.

update public.orders o
set
  delivery_method = r.method,
  collection_code = null,
  collection_code_expiry = null,
  collection_code_used = false,
  collection_code_attempts = 0,
  collection_code_last_attempt_at = null,
  updated_at = now()
from public.order_fulfillment_runs r
where r.order_id = o.id
  and r.method in ('LOCAL_DELIVERY', 'SHIPPING')
  and r.status not in ('CANCELLED', 'RECONCILED')
  and (
    o.delivery_method is distinct from r.method
    or o.collection_code is not null
    or o.collection_code_expiry is not null
  );
