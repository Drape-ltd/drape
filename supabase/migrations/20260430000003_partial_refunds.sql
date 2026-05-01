alter type public.order_payment_status add value if not exists 'PARTIAL_REFUND';

alter type public.order_stage add value if not exists 'PARTIALLY_REFUNDED' before 'REFUNDED';

alter table if exists public.order_payments
  add column if not exists refunded_amount integer not null default 0,
  add column if not exists partial_refund_count integer not null default 0,
  add column if not exists last_refund_amount integer,
  add column if not exists last_refund_at timestamptz;

alter table if exists public.order_payments
  drop constraint if exists order_payments_refunded_amount_check;

alter table if exists public.order_payments
  add constraint order_payments_refunded_amount_check
  check (refunded_amount >= 0 and refunded_amount <= amount);

alter table if exists public.order_payments
  drop constraint if exists order_payments_partial_refund_count_check;

alter table if exists public.order_payments
  add constraint order_payments_partial_refund_count_check
  check (partial_refund_count >= 0);

update public.order_payments
set refunded_amount = case
      when status = 'REFUNDED'::public.order_payment_status then amount
      else greatest(coalesce(refunded_amount, 0), 0)
    end,
    partial_refund_count = case
      when status = 'REFUNDED'::public.order_payment_status and coalesce(partial_refund_count, 0) = 0 then 1
      else greatest(coalesce(partial_refund_count, 0), 0)
    end,
    last_refund_amount = case
      when status = 'REFUNDED'::public.order_payment_status then coalesce(last_refund_amount, amount)
      else last_refund_amount
    end,
    last_refund_at = case
      when status = 'REFUNDED'::public.order_payment_status then coalesce(last_refund_at, refunded_at, updated_at, created_at)
      else last_refund_at
    end;
