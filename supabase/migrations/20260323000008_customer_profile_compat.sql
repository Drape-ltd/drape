-- Drape V1 — customer profile compatibility columns
-- Keeps older dev projects aligned with the current mobile app expectations.

alter table customer_profiles
  add column if not exists display_name text;

alter table customer_profiles
  add column if not exists phone text;

alter table customer_profiles
  add column if not exists unit_preference text default 'cm';

alter table customer_profiles
  add column if not exists garment_context garment_context;

alter table customer_profiles
  add column if not exists measurements jsonb;

alter table customer_profiles
  add column if not exists avatar_url text;
