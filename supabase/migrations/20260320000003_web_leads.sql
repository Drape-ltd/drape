-- Drape V1 — web waitlist + tailor application intake

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'user_role'
  ) then
    create type user_role as enum ('CUSTOMER', 'TAILOR');
  end if;
end
$$;

create table if not exists waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  role user_role not null,
  name text not null,
  email text not null,
  location text,
  specialty text,
  notes text,
  source text not null default 'WEB',
  created_at timestamptz not null default now()
);

create unique index if not exists waitlist_signups_role_email_idx
  on waitlist_signups (role, email);

create table if not exists tailor_applications (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  display_name text not null,
  email text not null,
  location text not null,
  specialty text not null,
  portfolio_url text,
  instagram_url text,
  notes text not null,
  source text not null default 'WEB',
  status text not null default 'PENDING',
  created_at timestamptz not null default now()
);

create unique index if not exists tailor_applications_email_idx
  on tailor_applications (email);

alter table waitlist_signups enable row level security;
alter table tailor_applications enable row level security;

grant usage on schema public to service_role;
grant all privileges on table waitlist_signups to service_role;
grant all privileges on table tailor_applications to service_role;
