do $$
begin
  if not has_function_privilege('authenticated', 'public.register_push_token(text,text,text)', 'EXECUTE') then
    raise exception 'authenticated cannot execute register_push_token';
  end if;

  if not has_function_privilege('authenticated', 'public.unregister_push_token(text)', 'EXECUTE') then
    raise exception 'authenticated cannot execute unregister_push_token';
  end if;

  if has_function_privilege('anon', 'public.register_push_token(text,text,text)', 'EXECUTE') then
    raise exception 'anon can execute register_push_token';
  end if;
end
$$;
