-- Drape V1 — Restore service_role access to public schema objects
--
-- Edge Functions in this codebase use the service_role JWT to call PostgREST
-- and RPCs such as check_rate_limit. If schema/table/function grants drift,
-- those calls fail with "permission denied for schema public".

grant usage on schema public to service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
