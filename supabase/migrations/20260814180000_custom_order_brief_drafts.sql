create table if not exists public.custom_order_brief_drafts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  tailor_profile_id text not null references public.tailor_profiles(id) on delete cascade,
  version text not null,
  current_step integer not null default 0 check (current_step between 0 and 8),
  fields jsonb not null default '{}'::jsonb,
  has_device_only_attachments boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, tailor_profile_id)
);

alter table public.custom_order_brief_drafts enable row level security;

drop policy if exists "customers read own custom order drafts" on public.custom_order_brief_drafts;
create policy "customers read own custom order drafts"
  on public.custom_order_brief_drafts for select to authenticated
  using (customer_id = auth.uid());

revoke all on public.custom_order_brief_drafts from anon, authenticated;
grant select on public.custom_order_brief_drafts to authenticated;
grant all on public.custom_order_brief_drafts to service_role;

create index if not exists custom_order_brief_drafts_customer_updated_idx
  on public.custom_order_brief_drafts (customer_id, updated_at desc);

comment on table public.custom_order_brief_drafts is
  'Private resumable custom-order intake state. Business submission still occurs only through custom-order-action.';
