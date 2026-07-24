-- Some environments created the old one-device-per-user rule as a standalone
-- unique index rather than a named table constraint.

drop index if exists public.push_tokens_user_id_key;
