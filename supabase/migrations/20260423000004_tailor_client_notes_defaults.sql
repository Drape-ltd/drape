alter table public.tailor_client_notes
  alter column id set default gen_random_uuid();

alter table public.tailor_client_notes
  alter column created_at set default now();

alter table public.tailor_client_notes
  alter column updated_at set default now();
