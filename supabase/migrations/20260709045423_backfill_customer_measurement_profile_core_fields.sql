-- Backfill named measurement profiles from the legacy customer fit passport.
--
-- A mobile helper previously treated canonical measurement keys as metadata,
-- so some default "Me" profiles kept specialist/custom fields but dropped core
-- values such as chest, waist, shoulderWidth, and sleeveLength. Preserve any
-- profile-specific values and fill only the missing default profile layer.

with legacy_measurements as (
  select
    cp.user_id::uuid as customer_id,
    jsonb_strip_nulls(jsonb_build_object(
      'height', cp.measurements->'height',
      'chest', cp.measurements->'chest',
      'waist', cp.measurements->'waist',
      'hips', cp.measurements->'hips',
      'shoulderWidth', coalesce(cp.measurements->'shoulderWidth', cp.measurements->'shoulder'),
      'inseam', cp.measurements->'inseam',
      'sleeveLength', coalesce(cp.measurements->'sleeveLength', cp.measurements->'sleeve'),
      'neckCircumference', cp.measurements->'neckCircumference',
      'underBust', cp.measurements->'underBust',
      'backLength', cp.measurements->'backLength',
      'outseam', cp.measurements->'outseam',
      'thighCircumference', cp.measurements->'thighCircumference',
      'kneeCircumference', cp.measurements->'kneeCircumference',
      'bicepCircumference', cp.measurements->'bicepCircumference',
      'wristCircumference', cp.measurements->'wristCircumference',
      'headCircumference', cp.measurements->'headCircumference',
      'hatBandLine', cp.measurements->'hatBandLine',
      'headLength', cp.measurements->'headLength',
      'headWidth', cp.measurements->'headWidth',
      'earToEarOverCrown', cp.measurements->'earToEarOverCrown',
      'frontToBackOverCrown', cp.measurements->'frontToBackOverCrown',
      'filaHeight', cp.measurements->'filaHeight',
      'torsoLength', cp.measurements->'torsoLength',
      'unit', cp.measurements->'unit',
      'measurementProfileLabel', cp.measurements->'measurementProfileLabel',
      'measurementProfileUpdatedAt', cp.measurements->'measurementProfileUpdatedAt',
      'wearerContext', cp.measurements->'wearerContext',
      'fitStyle', coalesce(cp.measurements->'fitStyle', cp.measurements->'fitPreference'),
      'measurementSource', cp.measurements->'measurementSource',
      'measurementSourceLabel', cp.measurements->'measurementSourceLabel',
      'fitConfidence', cp.measurements->'fitConfidence',
      'garmentContext', cp.measurements->'garmentContext',
      'bodyShape', cp.measurements->'bodyShape',
      'fitFlags', cp.measurements->'fitFlags',
      'bodyNote', cp.measurements->'bodyNote',
      'bodyFlags', cp.measurements->'bodyFlags',
      'symmetryFlags', cp.measurements->'symmetryFlags',
      'requiresTailorReview', cp.measurements->'requiresTailorReview'
    )) as measurements,
    coalesce(nullif(cp.measurements->>'unit', ''), cp.unit_preference, 'cm') as unit_preference,
    coalesce(cp.updated_at, now()) as measured_at
  from public.customer_profiles cp
  where cp.measurements is not null
    and jsonb_typeof(cp.measurements) = 'object'
    and (
      cp.measurements ? 'height'
      or cp.measurements ? 'chest'
      or cp.measurements ? 'waist'
      or cp.measurements ? 'hips'
      or cp.measurements ? 'shoulderWidth'
      or cp.measurements ? 'shoulder'
      or cp.measurements ? 'sleeveLength'
      or cp.measurements ? 'sleeve'
      or cp.measurements ? 'inseam'
    )
)
update public.customer_measurement_profiles p
set
  measurements = lm.measurements || p.measurements,
  unit_preference = coalesce(nullif(lm.unit_preference, ''), p.unit_preference),
  last_measured_at = coalesce(p.last_measured_at, lm.measured_at),
  updated_at = greatest(p.updated_at, lm.measured_at)
from legacy_measurements lm
where p.customer_id = lm.customer_id
  and p.is_default = true
  and p.relationship = 'SELF'
  and lm.measurements <> '{}'::jsonb
  and (
    not (p.measurements ? 'height')
    or not (p.measurements ? 'chest')
    or not (p.measurements ? 'waist')
    or not (p.measurements ? 'hips')
    or not (p.measurements ? 'shoulderWidth')
    or not (p.measurements ? 'sleeveLength')
    or not (p.measurements ? 'inseam')
  );

with legacy_measurements as (
  select
    cp.user_id::uuid as customer_id,
    left(coalesce(nullif(trim(cp.measurements->>'measurementProfileLabel'), ''), 'Me'), 80) as label,
    jsonb_strip_nulls(jsonb_build_object(
      'height', cp.measurements->'height',
      'chest', cp.measurements->'chest',
      'waist', cp.measurements->'waist',
      'hips', cp.measurements->'hips',
      'shoulderWidth', coalesce(cp.measurements->'shoulderWidth', cp.measurements->'shoulder'),
      'inseam', cp.measurements->'inseam',
      'sleeveLength', coalesce(cp.measurements->'sleeveLength', cp.measurements->'sleeve'),
      'neckCircumference', cp.measurements->'neckCircumference',
      'underBust', cp.measurements->'underBust',
      'backLength', cp.measurements->'backLength',
      'outseam', cp.measurements->'outseam',
      'thighCircumference', cp.measurements->'thighCircumference',
      'kneeCircumference', cp.measurements->'kneeCircumference',
      'bicepCircumference', cp.measurements->'bicepCircumference',
      'wristCircumference', cp.measurements->'wristCircumference',
      'headCircumference', cp.measurements->'headCircumference',
      'hatBandLine', cp.measurements->'hatBandLine',
      'headLength', cp.measurements->'headLength',
      'headWidth', cp.measurements->'headWidth',
      'earToEarOverCrown', cp.measurements->'earToEarOverCrown',
      'frontToBackOverCrown', cp.measurements->'frontToBackOverCrown',
      'filaHeight', cp.measurements->'filaHeight',
      'torsoLength', cp.measurements->'torsoLength',
      'unit', cp.measurements->'unit',
      'measurementProfileLabel', cp.measurements->'measurementProfileLabel',
      'measurementProfileUpdatedAt', cp.measurements->'measurementProfileUpdatedAt',
      'wearerContext', cp.measurements->'wearerContext',
      'fitStyle', coalesce(cp.measurements->'fitStyle', cp.measurements->'fitPreference'),
      'measurementSource', cp.measurements->'measurementSource',
      'measurementSourceLabel', cp.measurements->'measurementSourceLabel',
      'fitConfidence', cp.measurements->'fitConfidence',
      'garmentContext', cp.measurements->'garmentContext',
      'bodyShape', cp.measurements->'bodyShape',
      'fitFlags', cp.measurements->'fitFlags',
      'bodyNote', cp.measurements->'bodyNote',
      'bodyFlags', cp.measurements->'bodyFlags',
      'symmetryFlags', cp.measurements->'symmetryFlags',
      'requiresTailorReview', cp.measurements->'requiresTailorReview'
    )) as measurements,
    coalesce(nullif(cp.measurements->>'unit', ''), cp.unit_preference, 'cm') as unit_preference,
    case upper(coalesce(cp.measurements->>'measurementSource', ''))
      when 'DRAPE_VISION' then 'DRAPE_VISION'
      when 'TAILOR_ASSISTED' then 'TAILOR_ASSISTED'
      when 'PASSPORT_CLAIM' then 'PASSPORT_CLAIM'
      when 'IMPORT' then 'IMPORT'
      else 'MANUAL'
    end as source,
    coalesce(cp.updated_at, now()) as measured_at
  from public.customer_profiles cp
  where cp.measurements is not null
    and jsonb_typeof(cp.measurements) = 'object'
    and (
      cp.measurements ? 'height'
      or cp.measurements ? 'chest'
      or cp.measurements ? 'waist'
      or cp.measurements ? 'hips'
      or cp.measurements ? 'shoulderWidth'
      or cp.measurements ? 'shoulder'
      or cp.measurements ? 'sleeveLength'
      or cp.measurements ? 'sleeve'
      or cp.measurements ? 'inseam'
    )
)
insert into public.customer_measurement_profiles (
  customer_id,
  label,
  relationship,
  measurements,
  unit_preference,
  source,
  is_default,
  last_measured_at,
  created_at,
  updated_at
)
select
  lm.customer_id,
  lm.label,
  'SELF',
  lm.measurements,
  lm.unit_preference,
  lm.source,
  true,
  lm.measured_at,
  lm.measured_at,
  lm.measured_at
from legacy_measurements lm
where lm.measurements <> '{}'::jsonb
  and not exists (
    select 1
    from public.customer_measurement_profiles p
    where p.customer_id = lm.customer_id
  );
