-- Preserve legacy UUID payout primary keys while allowing newer provider-neutral
-- commercial contracts to reference payout identifiers as text.
alter table public.payouts
  add column if not exists id_text text generated always as (id::text) stored;

create unique index if not exists payouts_id_text_key
  on public.payouts (id_text);
