-- Drape V1 — customer profile phone support

alter table customer_profiles
  add column if not exists phone text;
