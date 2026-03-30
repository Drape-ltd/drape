do $$
begin
  create type order_kind as enum ('CUSTOM', 'READY_MADE');
exception
  when duplicate_object then null;
end $$;

alter table orders
  add column if not exists order_kind order_kind not null default 'CUSTOM',
  add column if not exists seller_item_id text,
  add column if not exists item_title text,
  add column if not exists item_size text,
  add column if not exists item_quantity integer not null default 1,
  add column if not exists item_unit_price integer,
  add column if not exists item_subtotal integer;

create index if not exists orders_order_kind_idx on orders(order_kind);
create index if not exists orders_seller_item_id_idx on orders(seller_item_id);

comment on column orders.order_kind is 'CUSTOM for bespoke workflow, READY_MADE for shop purchases.';
comment on column orders.seller_item_id is 'Optional seller_items.id for ready-made purchases.';
comment on column orders.item_title is 'Snapshot of the ready-made item title at purchase time.';
comment on column orders.item_size is 'Chosen size for ready-made purchase.';
comment on column orders.item_quantity is 'Quantity for ready-made purchase.';
comment on column orders.item_unit_price is 'Unit price snapshot in minor currency units.';
comment on column orders.item_subtotal is 'Subtotal before delivery or fees in minor currency units.';
