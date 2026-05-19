-- Drape V1 - keep tailor-to-customer review text limits aligned with API validation.
--
-- review-action accepts 10-1000 characters for both public tailor reviews and
-- private customer reviews. Older customer_reviews rows had a 300 character
-- check, which could make a valid server-side request fail after preflight.

alter table public.customer_reviews
  drop constraint if exists customer_reviews_body_check;

alter table public.customer_reviews
  add constraint customer_reviews_body_check
  check (body is null or char_length(body) <= 1000);
