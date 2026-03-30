create table if not exists customer_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id text unique not null,
  customer_id uuid not null,
  tailor_id uuid not null,
  rating integer not null check (rating between 1 and 5),
  body text check (char_length(body) <= 300),
  tags text[] not null default '{}',
  reviewer_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_reviews_customer_id_idx on customer_reviews (customer_id);
create index if not exists customer_reviews_tailor_id_idx on customer_reviews (tailor_id);
create index if not exists customer_reviews_order_id_idx on customer_reviews (order_id);

alter table customer_reviews enable row level security;

grant select, insert, update on customer_reviews to authenticated;

drop policy if exists "Customers read their own received reviews" on customer_reviews;
create policy "Customers read their own received reviews"
  on customer_reviews for select
  to authenticated
  using (auth.uid() = customer_id);

drop policy if exists "Tailors read reviews for their clients" on customer_reviews;
create policy "Tailors read reviews for their clients"
  on customer_reviews for select
  to authenticated
  using (
    auth.uid() = tailor_id
    or exists (
      select 1 from public.orders o
      where o.customer_id::text = customer_reviews.customer_id::text
        and o.tailor_id::text = auth.uid()::text
    )
  );

drop policy if exists "Tailors create review for completed client order" on customer_reviews;
create policy "Tailors create review for completed client order"
  on customer_reviews for insert
  to authenticated
  with check (
    auth.uid() = tailor_id
    and exists (
      select 1 from public.orders o
      where o.id::text = customer_reviews.order_id
        and o.customer_id::text = customer_reviews.customer_id::text
        and o.tailor_id::text = auth.uid()::text
        and o.stage in ('DELIVERED', 'COLLECTED', 'COMPLETE')
    )
  );

drop policy if exists "Tailors update their own client review" on customer_reviews;
create policy "Tailors update their own client review"
  on customer_reviews for update
  to authenticated
  using (auth.uid() = tailor_id)
  with check (auth.uid() = tailor_id);
