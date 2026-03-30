insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'seller-item-media',
  'seller-item-media',
  true,
  20971520,
  array[
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do nothing;

drop policy if exists "seller-item-media: public read" on storage.objects;
create policy "seller-item-media: public read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'seller-item-media');

drop policy if exists "seller-item-media: seller can upload own" on storage.objects;
create policy "seller-item-media: seller can upload own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'seller-item-media'
    and split_part(name, '/', 2) = auth.uid()::text
  );

drop policy if exists "seller-item-media: seller can delete own" on storage.objects;
create policy "seller-item-media: seller can delete own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'seller-item-media'
    and split_part(name, '/', 2) = auth.uid()::text
  );
