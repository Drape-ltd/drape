alter type delivery_method add value if not exists 'LOCAL_DELIVERY';

alter type order_stage add value if not exists 'OUT_FOR_DELIVERY' before 'SHIPPED';

alter table public.orders
  add column if not exists delivery_address text,
  add column if not exists recipient_name text,
  add column if not exists recipient_phone text,
  add column if not exists fulfillment_provider text,
  add column if not exists fulfillment_reference text,
  add column if not exists fulfillment_contact_name text,
  add column if not exists fulfillment_contact_phone text;
