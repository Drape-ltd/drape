-- Return the signed-in tailor's setup projection without granting direct
-- PostgREST access to private verification columns.

create or replace function public.get_my_tailor_setup_profile()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', tp.id,
    'profile_completed', tp.profile_completed,
    'display_name', tp.display_name,
    'avatar_url', tp.avatar_url,
    'bio', tp.bio,
    'location', tp.location,
    'languages', tp.languages,
    'specialty_tags', tp.specialty_tags,
    'price_range_min', tp.price_range_min,
    'price_range_max', tp.price_range_max,
    'currency', tp.currency,
    'seller_type', tp.seller_type,
    'id_verification_status', tp.id_verification_status,
    'trust_verification_video_path', tp.trust_verification_video_path,
    'trust_verification_challenge_id', tp.trust_verification_challenge_id,
    'trust_verification_challenge_text', tp.trust_verification_challenge_text,
    'id_verification_rejection_reason', tp.id_verification_rejection_reason,
    'id_verification_rejected_at', tp.id_verification_rejected_at,
    'id_verification_metadata', tp.id_verification_metadata,
    'supports_custom_orders', tp.supports_custom_orders,
    'supports_ready_made', tp.supports_ready_made,
    'pickup_available', tp.pickup_available,
    'delivery_available', tp.delivery_available,
    'shipping_available', tp.shipping_available,
    'delivery_fee', tp.delivery_fee,
    'shipping_fee', tp.shipping_fee,
    'accepts_custom_orders_now', tp.accepts_custom_orders_now,
    'shop_paused', tp.shop_paused,
    'portfolio_photo_urls', tp.portfolio_photo_urls,
    'portfolio_video_urls', tp.portfolio_video_urls,
    'availability', tp.availability,
    'ready_made_item_count', (
      select count(*)::integer
      from public.seller_items as si
      where si.tailor_profile_id::text = tp.id::text
    )
  )
  from public.tailor_profiles as tp
  where tp.user_id::text = (select auth.uid())::text
  limit 1;
$$;

revoke all on function public.get_my_tailor_setup_profile() from public;
revoke all on function public.get_my_tailor_setup_profile() from anon;
grant execute on function public.get_my_tailor_setup_profile() to authenticated;
