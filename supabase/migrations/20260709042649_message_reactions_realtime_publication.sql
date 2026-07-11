-- Keep message reactions live across web and mobile message threads.
-- The table migration can land independently, so this is intentionally
-- idempotent for environments where the publication entry already exists.

do $$
begin
  if to_regclass('public.message_reactions') is null then
    raise exception 'public.message_reactions must exist before adding it to realtime publication.';
  end if;

  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end;
$$;
