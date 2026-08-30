-- Customer measurements are canonical in the measurements JSON contract.
-- Older development projects no longer expose the deprecated scalar fields,
-- so terminal deletion must clear only the shared current columns.

do $$
declare
  v_definition text;
  v_old_block text := $old$
  update public.customer_profiles
  set chest_cm = null,
      waist_cm = null,
      hips_cm = null,
      shoulder_width_cm = null,
      inseam_cm = null,
      sleeve_length_cm = null,
      neck_circumference_cm = null,
      height_cm = null,
      fit_style = null,
      garment_context = null,
      body_shape = null,
      fit_flags = '{}'::text[],
      body_note = null,
      measurements = null,
      display_name = 'Deleted customer',
      phone = null,
      avatar_url = null,
      updated_at = now()
  where user_id::text = p_user_id::text;
$old$;
  v_new_block text := $new$
  update public.customer_profiles
  set measurements = null,
      garment_context = null,
      display_name = 'Deleted customer',
      phone = null,
      avatar_url = null,
      updated_at = now()
  where user_id::text = p_user_id::text;
$new$;
begin
  select pg_get_functiondef('public.anonymize_account_for_deletion(uuid)'::regprocedure)
    into v_definition;

  if v_definition is null then
    raise exception 'anonymize_account_for_deletion(uuid) is missing';
  end if;

  v_definition := replace(v_definition, v_old_block, v_new_block);

  if position('chest_cm = null' in v_definition) > 0 then
    raise exception 'Could not update the account-deletion customer profile contract';
  end if;

  execute v_definition;
end;
$$;
