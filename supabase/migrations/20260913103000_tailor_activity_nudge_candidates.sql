-- Real, privacy-safe storefront activity signals for bounded tailor nudges.
-- Profile views are intentionally omitted until Drapeon has trustworthy view
-- analytics. Test profiles never enter this lifecycle.

create or replace function public.tailor_activity_nudge_candidates(
  p_limit integer default 500
)
returns table (
  profile_id text,
  user_id uuid,
  display_name text,
  is_live boolean,
  availability text,
  supports_ready_made boolean,
  last_sign_in_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz,
  oldest_draft_created_at timestamptz,
  draft_item_count bigint,
  live_item_count bigint,
  saves_count bigint,
  orders_last_30_days bigint,
  total_orders bigint,
  total_reviews bigint,
  avg_rating numeric,
  last_activity_nudge_at timestamptz
)
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  select
    tp.id::text as profile_id,
    tp.user_id::text::uuid as user_id,
    coalesce(nullif(btrim(tp.display_name), ''), nullif(btrim(tp.business_name), ''), 'Your Drapeon profile') as display_name,
    coalesce(tp.is_live, false) as is_live,
    tp.availability::text,
    coalesce(tp.supports_ready_made, false) as supports_ready_made,
    au.last_sign_in_at,
    tp.id_verified_at as verified_at,
    tp.created_at,
    items.oldest_draft_created_at,
    coalesce(items.draft_item_count, 0) as draft_item_count,
    coalesce(items.live_item_count, 0) as live_item_count,
    coalesce(saves.saves_count, 0) as saves_count,
    coalesce(orders.orders_last_30_days, 0) as orders_last_30_days,
    coalesce(tp.total_orders, 0)::bigint as total_orders,
    coalesce(tp.total_reviews, 0)::bigint as total_reviews,
    coalesce(tp.avg_rating, 0)::numeric as avg_rating,
    activity.last_activity_nudge_at
  from public.tailor_profiles tp
  join auth.users au on au.id::text = tp.user_id::text
  left join lateral (
    select
      min(si.created_at) filter (where not coalesce(si.is_live, false)) as oldest_draft_created_at,
      count(*) filter (where not coalesce(si.is_live, false)) as draft_item_count,
      count(*) filter (where coalesce(si.is_live, false) and si.stock_status <> 'HIDDEN') as live_item_count
    from public.seller_items si
    where si.tailor_profile_id::text = tp.id::text
  ) items on true
  left join lateral (
    select count(*) as saves_count
    from public.saved_tailors st
    where st.tailor_profile_id::text = tp.id::text
  ) saves on true
  left join lateral (
    select count(*) as orders_last_30_days
    from public.orders o
    where o.tailor_profile_id::text = tp.id::text
      and o.created_at >= now() - interval '30 days'
      and o.stage::text <> 'DRAFT'
  ) orders on true
  left join lateral (
    select max(de.created_at) as last_activity_nudge_at
    from public.domain_events de
    where de.event_type = 'TAILOR_ACTIVITY_NUDGE'
      and de.aggregate_type = 'TAILOR_PROFILE'
      and de.aggregate_id = tp.id::text
  ) activity on true
  where coalesce(tp.is_test_profile, false) = false
    and coalesce(tp.is_live, false) = true
    and coalesce(tp.is_verified, false) = true
  order by coalesce(activity.last_activity_nudge_at, tp.id_verified_at, tp.created_at) asc
  limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$$;

revoke all on function public.tailor_activity_nudge_candidates(integer) from public;
revoke all on function public.tailor_activity_nudge_candidates(integer) from anon;
revoke all on function public.tailor_activity_nudge_candidates(integer) from authenticated;
grant execute on function public.tailor_activity_nudge_candidates(integer) to service_role;
