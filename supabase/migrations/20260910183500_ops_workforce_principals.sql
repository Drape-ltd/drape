-- Named workforce authority and immediate revocation for Drapeon Ops.
-- Cloudflare Access proves authentication; this table remains authoritative for
-- active status, role scope, environment scope, and emergency session cutoff.

create table if not exists public.ops_workforce_principals (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  access_subject text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  roles text[] not null default '{}'::text[],
  permitted_environments text[] not null default array['production']::text[],
  session_revoked_before timestamptz,
  access_review_due_at timestamptz,
  last_seen_at timestamptz,
  created_by text,
  revoked_by text,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_workforce_principals_email_normalized check (
    email = lower(trim(email)) and position('@' in email) > 1
  ),
  constraint ops_workforce_principals_roles_valid check (
    roles <@ array['ops','customer_success','trust','finance','engineering','admin']::text[]
    and cardinality(roles) > 0
  ),
  constraint ops_workforce_principals_environments_valid check (
    permitted_environments <@ array['development','production']::text[]
    and cardinality(permitted_environments) > 0
  ),
  constraint ops_workforce_principals_revocation_complete check (
    status <> 'REVOKED' or (revoked_at is not null and revocation_reason is not null)
  )
);

create unique index if not exists ops_workforce_principals_email_unique
  on public.ops_workforce_principals (lower(email));

create unique index if not exists ops_workforce_principals_access_subject_unique
  on public.ops_workforce_principals (access_subject)
  where access_subject is not null;

create index if not exists ops_workforce_principals_status_review_idx
  on public.ops_workforce_principals (status, access_review_due_at);

drop trigger if exists trg_ops_workforce_principals_updated_at on public.ops_workforce_principals;
create trigger trg_ops_workforce_principals_updated_at
before update on public.ops_workforce_principals
for each row execute function public.set_updated_at();

alter table public.ops_workforce_principals enable row level security;
revoke all on public.ops_workforce_principals from public, anon, authenticated;
grant select, insert, update on public.ops_workforce_principals to service_role;

insert into public.ops_workforce_principals (
  email,
  status,
  roles,
  permitted_environments,
  access_review_due_at,
  created_by
)
values
  (
    'founders@drapeon.co',
    'ACTIVE',
    array['admin']::text[],
    array['development','production']::text[],
    now() + interval '90 days',
    'migration:20260910183500'
  ),
  (
    'dimowoope@gmail.com',
    'ACTIVE',
    array['admin']::text[],
    array['development','production']::text[],
    now() + interval '90 days',
    'migration:20260910183500'
  )
on conflict ((lower(email))) do update
set
  permitted_environments = (
    select array_agg(distinct environment_name order by environment_name)
    from unnest(
      public.ops_workforce_principals.permitted_environments || excluded.permitted_environments
    ) environment_name
  ),
  updated_at = now();

comment on table public.ops_workforce_principals is
  'Authoritative named Drapeon Ops workforce principals. Cloudflare Access authenticates; this table authorizes and revokes.';
