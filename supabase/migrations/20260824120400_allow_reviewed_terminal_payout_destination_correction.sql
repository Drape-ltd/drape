-- Permit the reviewed payout-destination recovery RPC to repair only the
-- provider-routing snapshot on an otherwise immutable terminal order.
--
-- The transaction-local marker prevents ordinary service-role updates from
-- inheriting this exception. The JSONB comparison keeps every order field
-- except the four payout-routing columns and updated_at immutable.

create or replace function public.guard_terminal_order_update()
returns trigger
language plpgsql
as $$
declare
  v_allowed_keys constant text[] := array[
    'tailor_paystack_recipient_code_locked',
    'tailor_stripe_connect_account_id_locked',
    'tailor_payout_provider_locked',
    'tailor_payout_currency_locked',
    'updated_at'
  ];
begin
  if old.stage = 'COMPLETE'::public.order_stage
    and new.stage in ('PARTIALLY_REFUNDED'::public.order_stage, 'REFUNDED'::public.order_stage) then
    return new;
  end if;

  if public.is_terminal_order_stage(old.stage) then
    if current_setting('app.reviewed_payout_destination_correction', true) = 'on'
      and (to_jsonb(new) - v_allowed_keys) = (to_jsonb(old) - v_allowed_keys) then
      return new;
    end if;

    raise exception 'Terminal order % at stage % cannot be mutated.', old.id, old.stage
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function public.apply_reviewed_payout_destination_correction(
  p_money_desk_request_id uuid,
  p_actor_email text,
  p_actor_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_request public.money_desk_requests%rowtype;
  v_order public.orders%rowtype;
  v_payout public.payouts%rowtype;
  v_profile public.tailor_profiles%rowtype;
  v_existing public.payout_destination_corrections%rowtype;
  v_provider text;
  v_previous text;
  v_replacement text;
  v_previous_fingerprint text;
  v_replacement_fingerprint text;
  v_correction_id uuid;
begin
  if coalesce(char_length(trim(p_actor_email)), 0) < 3 then
    raise exception 'A named workforce actor is required.';
  end if;
  if upper(trim(p_actor_role)) not in ('FINANCE', 'ADMIN') then
    raise exception 'Finance or Admin execution is required.';
  end if;

  select * into v_request from public.money_desk_requests
  where id = p_money_desk_request_id for update;
  if not found then raise exception 'Money Desk request was not found.'; end if;

  if v_request.action_type <> 'PAYOUT_DESTINATION_CHANGE'
    or v_request.target_type <> 'ORDER_PAYOUT_FAILURE'
    or v_request.status <> 'EXECUTING'
    or v_request.order_id is null then
    raise exception 'The approved Money Desk request is not executing a payout destination recovery.';
  end if;

  select * into v_existing from public.payout_destination_corrections
  where money_desk_request_id = v_request.id;
  if found then
    return jsonb_build_object(
      'correctionId', v_existing.id,
      'orderId', v_existing.order_id,
      'failedPayoutId', v_existing.failed_payout_id,
      'provider', v_existing.provider,
      'alreadyApplied', true
    );
  end if;

  select * into v_payout from public.payouts
  where id::text = v_request.target_id and order_id::text = v_request.order_id for update;
  if not found or v_payout.status <> 'FAILED' then
    raise exception 'The original failed payout no longer matches this approved recovery.';
  end if;

  select * into v_order from public.orders where id::text = v_request.order_id for update;
  if not found or v_order.escrow_released then
    raise exception 'The order is missing or its payout was already released.';
  end if;

  select * into v_profile from public.tailor_profiles
  where user_id::text = v_order.tailor_id::text for update;
  if not found
    or not v_profile.payout_account_verified
    or v_profile.payout_reverification_required then
    raise exception 'The tailor does not have a currently verified payout destination.';
  end if;
  if v_profile.payout_destination_hold_until is not null
    and v_profile.payout_destination_hold_until > now() then
    raise exception 'The replacement payout destination is still under its security hold.';
  end if;

  v_provider := v_payout.provider::text;
  if v_profile.payout_provider::text is distinct from v_provider
    or v_profile.payout_currency::text is distinct from v_payout.currency::text then
    raise exception 'The replacement payout provider or currency does not match the failed payout.';
  end if;

  if v_provider = 'PAYSTACK' then
    v_previous := nullif(trim(v_order.tailor_paystack_recipient_code_locked), '');
    v_replacement := nullif(trim(v_profile.paystack_recipient_code), '');
  elsif v_provider = 'STRIPE' then
    v_previous := nullif(trim(v_order.tailor_stripe_connect_account_id_locked), '');
    v_replacement := nullif(trim(v_profile.stripe_connect_account_id), '');
  else
    raise exception 'The failed payout provider is not supported for destination recovery.';
  end if;

  if v_replacement is null then raise exception 'The verified replacement destination is missing.'; end if;
  if v_previous is not distinct from v_replacement then
    raise exception 'The verified payout destination has not changed since the failed attempt.';
  end if;

  v_previous_fingerprint := encode(digest(v_provider || ':' || coalesce(v_previous, 'MISSING'), 'sha256'), 'hex');
  v_replacement_fingerprint := encode(digest(v_provider || ':' || v_replacement, 'sha256'), 'hex');
  if v_request.action_payload->>'previousDestinationFingerprint' is distinct from v_previous_fingerprint
    or v_request.action_payload->>'replacementDestinationFingerprint' is distinct from v_replacement_fingerprint
    or v_request.action_payload->>'provider' is distinct from v_provider
    or v_request.action_payload->>'failedPayoutId' is distinct from v_payout.id::text then
    raise exception 'The approved payout destination snapshot changed; prepare a new request.';
  end if;

  perform set_config('app.reviewed_payout_destination_correction', 'on', true);
  if v_provider = 'PAYSTACK' then
    update public.orders set
      tailor_paystack_recipient_code_locked = v_replacement,
      tailor_payout_provider_locked = 'PAYSTACK'::payment_provider,
      tailor_payout_currency_locked = v_payout.currency,
      updated_at = now()
    where id = v_order.id;
  else
    update public.orders set
      tailor_stripe_connect_account_id_locked = v_replacement,
      tailor_payout_provider_locked = 'STRIPE'::payment_provider,
      tailor_payout_currency_locked = v_payout.currency,
      updated_at = now()
    where id = v_order.id;
  end if;
  perform set_config('app.reviewed_payout_destination_correction', 'off', true);

  insert into public.payout_destination_corrections (
    money_desk_request_id, order_id, failed_payout_id, tailor_profile_id,
    provider, previous_destination_fingerprint, replacement_destination_fingerprint,
    applied_by, correlation_id
  ) values (
    v_request.id, v_order.id, v_payout.id, v_profile.id,
    v_payout.provider, v_previous_fingerprint, v_replacement_fingerprint,
    lower(trim(p_actor_email)), v_request.correlation_id
  ) returning id into v_correction_id;

  insert into public.money_desk_events (
    request_id, event_type, actor_email, actor_role, payload, correlation_id
  ) values (
    v_request.id, 'EXECUTION_STARTED', lower(trim(p_actor_email)), upper(trim(p_actor_role)),
    jsonb_build_object(
      'step', 'PAYOUT_DESTINATION_CORRECTED',
      'correction_id', v_correction_id,
      'failed_payout_id', v_payout.id,
      'provider', v_provider,
      'previous_destination_fingerprint', v_previous_fingerprint,
      'replacement_destination_fingerprint', v_replacement_fingerprint
    ), v_request.correlation_id
  );

  return jsonb_build_object(
    'correctionId', v_correction_id,
    'orderId', v_order.id,
    'failedPayoutId', v_payout.id,
    'provider', v_provider,
    'alreadyApplied', false
  );
end;
$$;

revoke all on function public.apply_reviewed_payout_destination_correction(uuid, text, text) from public, anon, authenticated;
grant execute on function public.apply_reviewed_payout_destination_correction(uuid, text, text) to service_role;
