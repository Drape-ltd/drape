-- HOLD_FEATURE: Do not apply to production until Drape Vision ships.
alter table public.measurement_scans
  drop constraint if exists measurement_scans_capture_method_check;

alter table public.measurement_scans
  add constraint measurement_scans_capture_method_check
  check (
    capture_method in (
      'GUIDED_MANUAL_BASELINE',
      'GUIDED_HELPER_BASELINE',
      'TAILOR_REVIEWED_BASELINE',
      'DRAPE_VISION_ROTATION',
      'TAILOR_ASSISTED_DRAPE_VISION_ROTATION',
      'GARMENT_QC_VISION_FLAT_LAY'
    )
  );
