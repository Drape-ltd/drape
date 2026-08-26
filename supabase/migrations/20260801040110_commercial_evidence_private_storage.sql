-- Private evidence storage for material estimates and final receipts.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('commercial-evidence', 'commercial-evidence', false, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Order parties read commercial evidence" on storage.objects;
create policy "Order parties read commercial evidence"
on storage.objects for select to authenticated
using (
  bucket_id = 'commercial-evidence'
  and exists (
    select 1 from public.orders o
    where o.id::text = (storage.foldername(name))[1]
      and (o.customer_id::text = auth.uid()::text or o.tailor_id::text = auth.uid()::text)
  )
);

drop policy if exists "Assigned tailor uploads commercial evidence" on storage.objects;
create policy "Assigned tailor uploads commercial evidence"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'commercial-evidence'
  and exists (
    select 1 from public.orders o
    where o.id::text = (storage.foldername(name))[1]
      and o.tailor_id::text = auth.uid()::text
  )
);

drop policy if exists "Assigned tailor updates commercial evidence" on storage.objects;
create policy "Assigned tailor updates commercial evidence"
on storage.objects for update to authenticated
using (
  bucket_id = 'commercial-evidence'
  and exists (
    select 1 from public.orders o
    where o.id::text = (storage.foldername(name))[1]
      and o.tailor_id::text = auth.uid()::text
  )
)
with check (
  bucket_id = 'commercial-evidence'
  and exists (
    select 1 from public.orders o
    where o.id::text = (storage.foldername(name))[1]
      and o.tailor_id::text = auth.uid()::text
  )
);

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'commercial-evidence' and public = false) then
    raise exception 'Implementation 7 commercial evidence bucket must remain private.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in (
    'Order parties read commercial evidence',
    'Assigned tailor uploads commercial evidence',
    'Assigned tailor updates commercial evidence'
  )) <> 3 then
    raise exception 'Implementation 7 commercial evidence RLS policies are incomplete.';
  end if;
  raise notice 'Implementation 7 private evidence bucket and party-scoped RLS verification passed.';
end;
$$;
