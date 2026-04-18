alter table orders
  add column if not exists collection_code_last_attempt_at timestamptz;

comment on column orders.collection_code_last_attempt_at is
  'Timestamp of the most recent incorrect collection code entry. Used to auto-reset lockouts after 24 hours.';

update orders
set collection_code_last_attempt_at = updated_at
where collection_code_attempts > 0
  and collection_code_last_attempt_at is null;
