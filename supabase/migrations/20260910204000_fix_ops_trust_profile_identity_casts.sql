-- Forward-only correction for legacy tailor_profiles identifiers, which are
-- text in the current schema. The previous migration already provides the
-- reviewed function body; replace only the exact typed comparison and fail
-- closed if that expected definition is not present.

do $migration$
declare
  v_signature regprocedure := 'public.prepare_ops_trust_verification_decision(uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text,boolean,uuid)'::regprocedure;
  v_definition text;
  v_expected text := 'where id = p_profile_id and user_id = p_tailor_user_id';
  v_replacement text := 'where id::text = p_profile_id::text and user_id::text = p_tailor_user_id::text';
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if v_definition is null or position(v_expected in v_definition) = 0 then
    raise exception 'Expected trust profile identity comparison is unavailable; refusing implicit rewrite.' using errcode = '55000';
  end if;
  v_definition := replace(v_definition, v_expected, v_replacement);
  execute v_definition;
end;
$migration$;
