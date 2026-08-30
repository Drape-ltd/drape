begin;

-- Reporting views must evaluate the underlying table policies as the caller.
-- This is a metadata-only change: it does not rewrite the views or their data.
alter view public.commercial_benefit_reporting
  set (security_invoker = true);

alter view public.commercial_tip_reporting
  set (security_invoker = true);

alter view public.commercial_delivery_outcome_reporting
  set (security_invoker = true);

comment on view public.commercial_benefit_reporting is
  'Commercial benefit reporting. SECURITY INVOKER preserves the querying role and underlying RLS.';
comment on view public.commercial_tip_reporting is
  'Commercial tip reporting. SECURITY INVOKER preserves the querying role and underlying RLS.';
comment on view public.commercial_delivery_outcome_reporting is
  'Commercial delivery outcome reporting. SECURITY INVOKER preserves the querying role and underlying RLS.';

do $verify$
declare
  v_view text;
  v_options text[];
begin
  foreach v_view in array array[
    'commercial_benefit_reporting',
    'commercial_tip_reporting',
    'commercial_delivery_outcome_reporting'
  ]
  loop
    select c.reloptions
      into v_options
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = v_view
      and c.relkind = 'v';

    if v_options is null or not ('security_invoker=true' = any(v_options)) then
      raise exception 'reporting view %.% is not SECURITY INVOKER', 'public', v_view;
    end if;
  end loop;
end
$verify$;

commit;
