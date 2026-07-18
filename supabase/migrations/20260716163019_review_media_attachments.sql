-- Customer review photo/video attachments.
-- Review media is public only when referenced by published, non-flagged reviews.

alter table if exists public.reviews
  add column if not exists media_urls text[] not null default '{}'::text[];

update public.reviews
set media_urls = '{}'::text[]
where media_urls is null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'review-media',
  'review-media',
  true,
  31457280,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/quicktime'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "review-media: public read" on storage.objects;
create policy "review-media: public read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'review-media');

drop policy if exists "review-media: customer can upload own order media" on storage.objects;
create policy "review-media: customer can upload own order media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'review-media'
    and split_part(name, '/', 1) = 'reviews'
    and split_part(name, '/', 3) = auth.uid()::text
    and exists (
      select 1
      from public.orders o
      where o.id::text = split_part(name, '/', 2)
        and o.customer_id::text = auth.uid()::text
        and o.stage in ('COMPLETE', 'DELIVERED', 'COLLECTED')
    )
  );

drop policy if exists "review-media: customer can delete own order media" on storage.objects;
create policy "review-media: customer can delete own order media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'review-media'
    and split_part(name, '/', 1) = 'reviews'
    and split_part(name, '/', 3) = auth.uid()::text
    and exists (
      select 1
      from public.orders o
      where o.id::text = split_part(name, '/', 2)
        and o.customer_id::text = auth.uid()::text
    )
  );
