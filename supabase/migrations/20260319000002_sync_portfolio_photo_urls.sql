-- Keep tailor_profiles.portfolio_photo_urls aligned with portfolio_items.
-- This heals stale public portfolio URLs left behind by older profile/edit flows.

update tailor_profiles tp
set portfolio_photo_urls = coalesce((
  select array_agg(pi.image_url order by pi.sort_order)
  from portfolio_items pi
  where pi.tailor_profile_id = tp.id
    and pi.image_url is not null
    and length(trim(pi.image_url)) > 0
), '{}');
