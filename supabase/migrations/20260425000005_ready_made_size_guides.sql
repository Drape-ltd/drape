alter table seller_items
  add column if not exists size_guide jsonb not null default '{}'::jsonb;
