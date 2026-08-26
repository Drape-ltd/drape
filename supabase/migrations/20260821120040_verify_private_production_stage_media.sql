do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='order_stage_updates' and column_name='evidence_media'
  ) then
    raise exception 'order_stage_updates.evidence_media is required';
  end if;

  if not exists (
    select 1 from storage.buckets
    where id='commercial-evidence'
      and public=false
      and file_size_limit >= 52428800
      and allowed_mime_types @> array['image/jpeg','video/mp4','video/quicktime']::text[]
  ) then
    raise exception 'commercial-evidence must remain private and accept production images/videos';
  end if;
end $$;
