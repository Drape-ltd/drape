-- Add tracking_number column to orders for webhook-based delivery confirmation
alter table orders add column if not exists tracking_number text;
alter table orders add column if not exists carrier text;

-- Index for fast webhook lookup
create index if not exists orders_tracking_number_idx on orders (tracking_number) where tracking_number is not null;
