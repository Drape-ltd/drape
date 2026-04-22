-- Drape V1 — ensure current seller capability + fulfillment fee columns on
-- tailor_profiles are readable anywhere the app queries them.
--
-- Earlier grant migrations covered the seller capability flags, but
-- delivery_fee and shipping_fee were added later and are not included
-- automatically in column-level privileges. PostgREST returns 403 for the
-- whole SELECT when even one requested column lacks permission.

GRANT SELECT (
  seller_type,
  supports_custom_orders,
  supports_ready_made,
  pickup_available,
  delivery_available,
  shipping_available,
  delivery_fee,
  shipping_fee
) ON TABLE tailor_profiles TO anon, authenticated;

GRANT UPDATE (
  seller_type,
  supports_custom_orders,
  supports_ready_made,
  pickup_available,
  delivery_available,
  shipping_available,
  delivery_fee,
  shipping_fee
) ON TABLE tailor_profiles TO authenticated;
