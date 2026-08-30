-- Terminal account-deletion lifecycle.
-- Ops may approve finalization, but only the deletion worker may complete it.

alter table public.account_deletion_requests
  drop constraint if exists account_deletion_requests_status_check;

alter table public.account_deletion_requests
  add constraint account_deletion_requests_status_check
  check (status in (
    'PENDING',
    'ACKNOWLEDGED',
    'BLOCKED',
    'READY_FOR_FINALIZATION',
    'COMPLETED',
    'REJECTED'
  ));

alter table public.account_deletion_requests
  add column if not exists finalization_approved_at timestamptz,
  add column if not exists completed_at timestamptz;

drop index if exists public.account_deletion_requests_one_pending_per_user;

create unique index if not exists account_deletion_requests_one_active_per_user
  on public.account_deletion_requests (user_id)
  where status in ('PENDING', 'ACKNOWLEDGED', 'BLOCKED', 'READY_FOR_FINALIZATION');

create or replace function public.anonymize_account_for_deletion(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tailor_profile_ids text[] := '{}'::text[];
  v_customer_profiles integer := 0;
  v_tailor_profiles integer := 0;
  v_hidden_items integer := 0;
  v_deleted_portfolio integer := 0;
begin
  if p_user_id is null then
    raise exception 'User ID is required.' using errcode = '22023';
  end if;

  perform set_config('drape.identity_verification_trusted_write', 'true', true);

  select coalesce(array_agg(id::text), '{}'::text[])
    into v_tailor_profile_ids
  from public.tailor_profiles
  where user_id::text = p_user_id::text;

  update public.users
  set email = 'deleted+' || replace(p_user_id::text, '-', '') || '@privacy.invalid',
      display_name = 'Deleted account',
      phone = null,
      updated_at = now()
  where id::text = p_user_id::text;

  update public.customer_profiles
  set measurements = null,
      garment_context = null,
      display_name = 'Deleted customer',
      phone = null,
      avatar_url = null,
      updated_at = now()
  where user_id::text = p_user_id::text;
  get diagnostics v_customer_profiles = row_count;

  update public.tailor_profiles
  set display_name = 'Deleted tailor',
      business_name = null,
      bio = null,
      avatar_url = null,
      legal_name = null,
      location = 'Private',
      languages = '{}'::text[],
      specialty_tags = '{}'::text[],
      price_range_min = null,
      price_range_max = null,
      availability = 'FULLY_BOOKED',
      is_verified = false,
      is_live = false,
      ships_internationally = false,
      payout_provider = null,
      payout_reverification_required = true,
      payout_account_type = null,
      payout_account_verified = false,
      payout_account_verified_at = null,
      payout_bank_name = null,
      payout_bank_code = null,
      payout_account_name = null,
      payout_account_masked = null,
      payout_country_code = null,
      paystack_recipient_code = null,
      stripe_connect_account_id = null,
      stripe_account_id = null,
      paystack_account_id = null,
      payout_destination_hold_until = null,
      manual_bank_entry = false,
      manual_bank_name = null,
      manual_bank_country_code = null,
      manual_bank_country_name = null,
      manual_bank_swift_bic = null,
      manual_bank_account_number = null,
      manual_bank_account_name = null,
      manual_bank_verification_status = 'NOT_SUBMITTED',
      manual_bank_submitted_at = null,
      manual_bank_verified_at = null,
      manual_bank_verified_by = null,
      payout_name_match_status = 'NOT_CHECKED',
      payout_name_match_checked_at = null,
      payout_name_match_metadata = '{}'::jsonb,
      id_document_url = null,
      id_selfie_document_url = null,
      id_verification_status = 'NOT_SUBMITTED',
      id_verification_handoff_id = null,
      id_verification_submitted_at = null,
      id_verified_at = null,
      id_verification_rejection_reason = null,
      id_verification_rejected_at = null,
      id_verification_metadata = '{}'::jsonb,
      trust_verification_video_path = null,
      trust_verification_challenge_id = null,
      trust_verification_challenge_text = null,
      portfolio_photo_urls = '{}'::text[],
      portfolio_video_urls = '{}'::text[],
      consultation_mode = 'UNAVAILABLE',
      consultation_requirement = 'OPTIONAL',
      consultation_fee_amount = null,
      consultation_fee_creditable = false,
      updated_at = now()
  where user_id::text = p_user_id::text;
  get diagnostics v_tailor_profiles = row_count;

  -- Some upgraded projects briefly retained both the legacy path column and
  -- its current URL replacement. Clear the compatibility field when present
  -- without making fresh schemas depend on a retired column.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tailor_profiles'
      and column_name = 'id_document_path'
  ) then
    execute 'update public.tailor_profiles set id_document_path = null where user_id::text = $1'
      using p_user_id::text;
  end if;

  update public.seller_items
  set is_live = false,
      stock_status = 'HIDDEN',
      photo_urls = '{}'::text[],
      updated_at = now()
  where tailor_profile_id::text = any(v_tailor_profile_ids);
  get diagnostics v_hidden_items = row_count;

  delete from public.portfolio_photos
  where tailor_profile_id::text = any(v_tailor_profile_ids);
  get diagnostics v_deleted_portfolio = row_count;

  delete from public.push_tokens where user_id::text = p_user_id::text;
  delete from public.web_push_subscriptions where user_id::text = p_user_id::text;
  delete from public.saved_tailors where user_id::text = p_user_id::text;
  delete from public.wishlist_collections where customer_id::text = p_user_id::text;
  delete from public.conversation_translation_preferences where user_id::text = p_user_id::text;

  update public.reviews review
  set reviewer_name = 'Deleted customer'
  from public.orders order_record
  where review.order_id = order_record.id
    and order_record.customer_id::text = p_user_id::text;

  return jsonb_build_object(
    'customerProfilesAnonymized', v_customer_profiles,
    'tailorProfilesAnonymized', v_tailor_profiles,
    'sellerItemsHidden', v_hidden_items,
    'portfolioRowsDeleted', v_deleted_portfolio
  );
end;
$$;

revoke all on function public.anonymize_account_for_deletion(uuid) from public;
revoke all on function public.anonymize_account_for_deletion(uuid) from anon;
revoke all on function public.anonymize_account_for_deletion(uuid) from authenticated;
grant execute on function public.anonymize_account_for_deletion(uuid) to service_role;
