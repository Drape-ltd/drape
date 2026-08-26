do $$
begin
  if to_regclass('public.delivery_webhook_events') is null then raise exception 'delivery webhook inbox missing'; end if;
  if not exists(select 1 from pg_proc where proname='enqueue_verified_delivery_webhook') then raise exception 'delivery webhook enqueue RPC missing'; end if;
  if has_table_privilege('authenticated','public.delivery_webhook_events','select') then raise exception 'delivery webhook payload leaked to authenticated'; end if;
end $$;
