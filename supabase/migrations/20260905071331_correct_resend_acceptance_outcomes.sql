-- Historical Resend rows were written from the send API response, before any
-- delivery webhook existed. Relabel those provider acknowledgements honestly.

update public.notification_delivery_outcomes
set
  status = 'ACCEPTED',
  metadata = metadata || jsonb_build_object(
    'delivery_observation', 'PROVIDER_ACCEPTED_UNVERIFIED',
    'corrected_at', now()
  )
where channel = 'EMAIL'
  and provider = 'RESEND'
  and status = 'DELIVERED';
