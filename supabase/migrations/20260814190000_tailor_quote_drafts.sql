create table if not exists public.tailor_quote_drafts (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id_text) on delete cascade,
  tailor_id uuid not null references auth.users(id) on delete cascade,
  version text not null,
  mode text not null check (mode in ('send', 'revise')),
  fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, tailor_id)
);

alter table public.tailor_quote_drafts enable row level security;

drop policy if exists "tailors read own quote drafts" on public.tailor_quote_drafts;
create policy "tailors read own quote drafts"
  on public.tailor_quote_drafts for select to authenticated
  using (tailor_id = auth.uid());

revoke all on public.tailor_quote_drafts from anon, authenticated;
grant select on public.tailor_quote_drafts to authenticated;
grant all on public.tailor_quote_drafts to service_role;

create index if not exists tailor_quote_drafts_tailor_updated_idx
  on public.tailor_quote_drafts (tailor_id, updated_at desc);

comment on table public.tailor_quote_drafts is
  'Private cross-platform tailor quote composition state. Sending remains authoritative through tailor-order-action.';
