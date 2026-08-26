-- A ready-made reservation, its applied promotion, and its recovery copy share
-- one two-hour contract. A customer must never return to a saved checkout and
-- discover that the accepted benefit silently expired after fifteen minutes.

alter table public.commercial_benefit_reservations
  alter column expires_at set default (now() + interval '2 hours');
