-- Grant least-privilege production Ops access to the named workforce member.

insert into public.ops_workforce_principals (
  email,
  status,
  roles,
  permitted_environments,
  access_review_due_at,
  created_by
)
values (
  'koleosho530@gmail.com',
  'ACTIVE',
  array['ops']::text[],
  array['production']::text[],
  now() + interval '90 days',
  'migration:20260912010000'
)
on conflict ((lower(email))) do update
set
  status = 'ACTIVE',
  roles = array['ops']::text[],
  permitted_environments = array['production']::text[],
  session_revoked_before = null,
  access_review_due_at = now() + interval '90 days',
  revoked_by = null,
  revoked_at = null,
  revocation_reason = null,
  updated_at = now();
