-- Portfolio curation is an ordinary seller operation. Keep identity, public profile,
-- and payout destination locks, but do not require manual ops approval for media.

create or replace function public.prevent_locked_identity_field_edits()
returns trigger
language plpgsql
as $$
declare
  trusted boolean := coalesce(current_setting('drape.identity_verification_trusted_write', true), '') = 'true';
  status text := coalesce(old.id_verification_status, '');
begin
  if trusted then
    return new;
  end if;

  if status in ('PENDING', 'VERIFIED', 'APPROVED') and (
    new.avatar_url is distinct from old.avatar_url
    or new.id_document_url is distinct from old.id_document_url
    or new.id_selfie_document_url is distinct from old.id_selfie_document_url
    or new.id_verification_status is distinct from old.id_verification_status
    or new.id_verified_at is distinct from old.id_verified_at
    or new.id_verification_method is distinct from old.id_verification_method
    or new.id_verification_handoff_id is distinct from old.id_verification_handoff_id
    or new.id_verification_rejection_reason is distinct from old.id_verification_rejection_reason
    or new.id_verification_rejected_at is distinct from old.id_verification_rejected_at
    or new.id_verification_metadata is distinct from old.id_verification_metadata
  ) then
    raise exception 'Identity verification fields are locked while verification is pending or approved.' using errcode = '42501';
  end if;

  if status in ('VERIFIED', 'APPROVED') and (
    new.display_name is distinct from old.display_name
    or new.bio is distinct from old.bio
    or new.location is distinct from old.location
    or new.languages is distinct from old.languages
    or new.specialty_tags is distinct from old.specialty_tags
    or new.currency is distinct from old.currency
  ) then
    raise exception 'Approved public profile fields must go through profile change review.' using errcode = '42501';
  end if;

  if status in ('VERIFIED', 'APPROVED') and (
    new.payout_currency is distinct from old.payout_currency
    or new.payout_provider is distinct from old.payout_provider
    or new.payout_account_type is distinct from old.payout_account_type
    or new.payout_account_verified is distinct from old.payout_account_verified
    or new.payout_account_verified_at is distinct from old.payout_account_verified_at
    or new.payout_reverification_required is distinct from old.payout_reverification_required
    or new.payout_bank_name is distinct from old.payout_bank_name
    or new.payout_bank_code is distinct from old.payout_bank_code
    or new.payout_account_name is distinct from old.payout_account_name
    or new.payout_account_masked is distinct from old.payout_account_masked
    or new.payout_country_code is distinct from old.payout_country_code
    or new.paystack_recipient_code is distinct from old.paystack_recipient_code
    or new.paystack_account_id is distinct from old.paystack_account_id
    or new.stripe_connect_account_id is distinct from old.stripe_connect_account_id
    or new.stripe_account_id is distinct from old.stripe_account_id
    or new.manual_bank_entry is distinct from old.manual_bank_entry
    or new.manual_bank_name is distinct from old.manual_bank_name
    or new.manual_bank_country_code is distinct from old.manual_bank_country_code
    or new.manual_bank_country_name is distinct from old.manual_bank_country_name
    or new.manual_bank_swift_bic is distinct from old.manual_bank_swift_bic
    or new.manual_bank_account_number is distinct from old.manual_bank_account_number
    or new.manual_bank_account_name is distinct from old.manual_bank_account_name
    or new.manual_bank_verification_status is distinct from old.manual_bank_verification_status
  ) then
    raise exception 'Approved payout destination fields must go through payout change review.' using errcode = '42501';
  end if;

  return new;
end $$;

-- Publish portfolio-only parts of already-pending requests so sellers do not need
-- to repeat uploads. Mixed requests retain their trust-sensitive fields for ops.
do $$
declare
  req record;
  changes jsonb;
  remaining_changes jsonb;
  fully_reconciled boolean;
  v_tailor_profile_id public.tailor_profiles.id%type;
begin
  for req in
    select id, tailor_user_id, tailor_profile_id, requested_changes
    from public.profile_change_requests
    where status = 'PENDING'
      and requested_changes ?| array[
        'portfolio_photo_urls',
        'portfolio_video_urls',
        'portfolio_item_upserts'
      ]
    for update
  loop
    changes := coalesce(req.requested_changes, '{}'::jsonb);
    v_tailor_profile_id := null;

    select id into v_tailor_profile_id
    from public.tailor_profiles
    where id::text = req.tailor_profile_id;

    if v_tailor_profile_id is null then
      continue;
    end if;

    if changes ? 'portfolio_photo_urls' then
      update public.tailor_profiles
      set portfolio_photo_urls = array(
            select jsonb_array_elements_text(coalesce(changes -> 'portfolio_photo_urls', '[]'::jsonb))
          ),
          updated_at = now()
      where id = v_tailor_profile_id;
    end if;

    if changes ? 'portfolio_video_urls' then
      update public.tailor_profiles
      set portfolio_video_urls = array(
            select jsonb_array_elements_text(coalesce(changes -> 'portfolio_video_urls', '[]'::jsonb))
          ),
          updated_at = now()
      where id = v_tailor_profile_id;
    end if;

    if changes ? 'portfolio_item_upserts' then
      insert into public.portfolio_items (
        id,
        tailor_profile_id,
        image_url,
        title,
        description,
        category,
        sort_order
      )
      select
        coalesce(nullif(item ->> 'id', '')::uuid, gen_random_uuid()),
        v_tailor_profile_id,
        nullif(item ->> 'image_url', ''),
        nullif(item ->> 'title', ''),
        nullif(item ->> 'description', ''),
        nullif(item ->> 'category', ''),
        coalesce(nullif(item ->> 'sort_order', '')::integer, 0)
      from jsonb_array_elements(coalesce(changes -> 'portfolio_item_upserts', '[]'::jsonb)) as item
      where nullif(item ->> 'image_url', '') is not null
        and nullif(item ->> 'title', '') is not null
      on conflict on constraint portfolio_items_pkey do update
        set image_url = excluded.image_url,
            title = excluded.title,
            description = excluded.description,
            category = excluded.category
        where public.portfolio_items.tailor_profile_id = v_tailor_profile_id;

      update public.tailor_profiles
      set portfolio_photo_urls = coalesce((
            select array_agg(image_url order by sort_order asc, created_at asc)
            from public.portfolio_items
            where public.portfolio_items.tailor_profile_id = v_tailor_profile_id
          ), '{}'::text[]),
          updated_at = now()
      where id = v_tailor_profile_id;
    end if;

    remaining_changes := changes
      - 'portfolio_photo_urls'
      - 'portfolio_video_urls'
      - 'portfolio_item_upserts';
    fully_reconciled := remaining_changes = '{}'::jsonb;

    update public.profile_change_requests
    set requested_changes = remaining_changes,
        field_statuses = coalesce(field_statuses, '{}'::jsonb)
          - 'portfolio_photo_urls'
          - 'portfolio_video_urls'
          - 'portfolio_item_upserts',
        metadata = (coalesce(metadata, '{}'::jsonb) - 'surface' - 'item_id')
          || jsonb_build_object('portfolio_curation_reconciled_at', now()),
        status = case when fully_reconciled then 'APPROVED' else status end,
        reviewed_at = case when fully_reconciled then now() else reviewed_at end,
        reviewed_by = case when fully_reconciled then 'system:portfolio-direct-publish' else reviewed_by end,
        updated_at = now()
    where id = req.id;

    if fully_reconciled then
      update public.ops_issues
      set status = 'RESOLVED',
          resolved_at = now(),
          metadata = coalesce(metadata, '{}'::jsonb)
            || jsonb_build_object('resolution', 'Portfolio curation no longer requires manual review')
      where related_entity_type = 'profile_change_request'
        and related_entity_id = req.id::text
        and status <> 'RESOLVED';
    end if;

    insert into public.audit_logs (actor_id, actor_role, event, severity, payload)
    values (
      req.tailor_user_id::text,
      'SYSTEM',
      'tailor_portfolio.pending_change_published',
      'info',
      jsonb_build_object(
        'request_id', req.id,
        'tailor_profile_id', req.tailor_profile_id,
        'request_fully_reconciled', fully_reconciled
      )
    );
  end loop;
end $$;
