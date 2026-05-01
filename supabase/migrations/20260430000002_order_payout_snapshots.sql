alter table public.orders
  add column if not exists tailor_payout_currency_locked currency,
  add column if not exists tailor_payout_provider_locked payment_provider,
  add column if not exists tailor_paystack_recipient_code_locked text,
  add column if not exists tailor_stripe_connect_account_id_locked text,
  add column if not exists ops_payout_resolution_mode text,
  add column if not exists ops_payout_override_currency currency,
  add column if not exists ops_payout_override_provider payment_provider,
  add column if not exists ops_payout_override_amount integer,
  add column if not exists ops_payout_override_fx_rate numeric(18, 8),
  add column if not exists ops_payout_override_fx_rate_timestamp timestamptz,
  add column if not exists ops_payout_override_note text,
  add column if not exists ops_payout_override_set_at timestamptz,
  add column if not exists ops_payout_override_set_by text;

alter table public.orders
  drop constraint if exists orders_ops_payout_resolution_mode_check;

alter table public.orders
  add constraint orders_ops_payout_resolution_mode_check
  check (
    ops_payout_resolution_mode is null
    or ops_payout_resolution_mode in ('ORIGINAL_CURRENCY', 'CONVERT_TO_CURRENT', 'REFUND_CUSTOMER')
  );

alter table public.orders
  drop constraint if exists orders_ops_payout_override_amount_check;

alter table public.orders
  add constraint orders_ops_payout_override_amount_check
  check (
    ops_payout_override_amount is null
    or ops_payout_override_amount >= 0
  );

alter table public.orders
  disable trigger orders_terminal_guard;

update public.orders as o
set
  tailor_payout_currency_locked = coalesce(
    o.tailor_payout_currency_locked,
    tp.payout_currency,
    o.source_currency,
    o.currency
  ),
  tailor_payout_provider_locked = coalesce(
    o.tailor_payout_provider_locked,
    public.resolve_payment_provider_for_currency(
      coalesce(tp.payout_currency, o.source_currency, o.currency, 'USD'::currency)
    )
  ),
  tailor_paystack_recipient_code_locked = coalesce(
    o.tailor_paystack_recipient_code_locked,
    tp.paystack_recipient_code
  ),
  tailor_stripe_connect_account_id_locked = coalesce(
    o.tailor_stripe_connect_account_id_locked,
    tp.stripe_connect_account_id
  )
from public.tailor_profiles as tp
where o.tailor_id::text = tp.user_id::text;

alter table public.orders
  enable trigger orders_terminal_guard;

create index if not exists orders_tailor_payout_currency_locked_idx
  on public.orders (tailor_payout_currency_locked);

create index if not exists orders_ops_payout_resolution_mode_idx
  on public.orders (ops_payout_resolution_mode)
  where ops_payout_resolution_mode is not null;
