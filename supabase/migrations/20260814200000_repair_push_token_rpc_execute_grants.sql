-- Restore the authenticated mobile contract after environments that replaced
-- the RPC without preserving its execute grants. The functions remain
-- security-definer and continue to bind every write to auth.uid().

grant usage on schema public to authenticated, service_role;

revoke all on function public.register_push_token(text, text, text) from public, anon;
grant execute on function public.register_push_token(text, text, text) to authenticated, service_role;

revoke all on function public.unregister_push_token(text) from public, anon;
grant execute on function public.unregister_push_token(text) to authenticated, service_role;
