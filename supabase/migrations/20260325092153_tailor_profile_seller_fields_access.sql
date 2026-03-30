-- Drape V1 — ensure newer seller capability fields on tailor_profiles
-- are readable and writable by the authenticated owner in older/dev projects.

GRANT SELECT (
  seller_type,
  supports_custom_orders,
  supports_ready_made,
  pickup_available,
  delivery_available,
  shipping_available
) ON TABLE tailor_profiles TO authenticated;

GRANT UPDATE (
  seller_type,
  supports_custom_orders,
  supports_ready_made,
  pickup_available,
  delivery_available,
  shipping_available
) ON TABLE tailor_profiles TO authenticated;
