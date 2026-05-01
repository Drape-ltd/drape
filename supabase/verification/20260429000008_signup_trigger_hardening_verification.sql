-- Verification for 20260429000008_signup_trigger_hardening.sql

select
  proname,
  prosecdef as security_definer,
  proconfig
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname = 'handle_new_user';

select
  tgname,
  tgrelid::regclass as table_name,
  tgenabled
from pg_trigger
where tgname = 'on_auth_user_created';
