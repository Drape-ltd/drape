-- Drape V1 — Customer avatar access compatibility
--
-- Conversation and client CRM surfaces show customer profile photos when an
-- order relationship exists. RLS still decides which customer rows a user may
-- see; these column grants make the display columns explicit in projects where
-- broad table grants have drifted.

grant select (
  display_name,
  avatar_url
) on table public.customer_profiles to authenticated;

grant update (
  avatar_url
) on table public.customer_profiles to authenticated;
