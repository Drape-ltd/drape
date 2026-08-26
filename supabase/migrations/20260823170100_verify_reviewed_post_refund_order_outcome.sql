do $$ begin
  if to_regprocedure('public.apply_reviewed_post_refund_order_outcome(uuid,text,text,text,text)') is null then
    raise exception 'apply_reviewed_post_refund_order_outcome is missing';
  end if;
  if has_function_privilege('authenticated','public.apply_reviewed_post_refund_order_outcome(uuid,text,text,text,text)','EXECUTE') then
    raise exception 'authenticated must not execute reviewed post-refund outcomes';
  end if;
end $$;
