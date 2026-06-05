-- Fix grants for the launch real-life-cycle tables.
-- RLS policies existed, but PostgREST still needs table privileges before
-- those policies can be evaluated. Without these grants, order detail screens
-- spam 403s on group-order reads and add avoidable DB/log pressure.

grant select, insert, update, delete on table public.customer_measurement_profiles to authenticated;
grant select, insert, update, delete on table public.order_group_members to authenticated;
grant select, insert on table public.referrals to authenticated;
grant select on table public.tailor_data_exports to authenticated;

grant select, insert, update, delete on table public.customer_measurement_profiles to service_role;
grant select, insert, update, delete on table public.order_group_members to service_role;
grant select, insert, update, delete on table public.referrals to service_role;
grant select, insert, update, delete on table public.tailor_data_exports to service_role;
