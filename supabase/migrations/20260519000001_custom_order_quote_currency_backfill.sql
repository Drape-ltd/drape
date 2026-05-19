-- Keep unquoted custom orders aligned with the server-locked order/payment currency.
-- Older rows could retain the orders.quoted_currency default even after orders.currency
-- was correctly resolved from the tailor payout route.
UPDATE public.orders
SET quoted_currency = currency::text
WHERE order_kind = 'CUSTOM'
  AND currency IS NOT NULL
  AND quoted_currency IS DISTINCT FROM currency::text
  AND stage IN ('PENDING_QUOTE', 'CONSULTATION');
