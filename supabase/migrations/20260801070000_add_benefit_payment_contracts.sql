-- Implementation 10 payment vocabulary. COVERAGE is an internal proof for a
-- fully Drapeon-funded physical order; it is never an external payment rail.
alter type public.payment_provider add value if not exists 'COVERAGE';
alter type public.order_payment_phase add value if not exists 'TIP';
