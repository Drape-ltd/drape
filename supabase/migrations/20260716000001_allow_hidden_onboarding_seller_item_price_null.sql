alter table public.seller_items
  alter column price_amount drop not null;

alter table public.seller_items
  drop constraint if exists seller_items_price_amount_check;

alter table public.seller_items
  add constraint seller_items_price_amount_positive_or_null
  check (price_amount is null or price_amount > 0);
