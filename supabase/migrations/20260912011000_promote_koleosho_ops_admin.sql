-- Promote the trusted workforce member to full production Ops administration.

do $$
begin
  update public.ops_workforce_principals
  set
    roles = array['admin']::text[],
    updated_at = now()
  where email = 'koleosho530@gmail.com'
    and status = 'ACTIVE';

  if not found then
    raise exception 'Active workforce principal koleosho530@gmail.com was not found';
  end if;
end
$$;
