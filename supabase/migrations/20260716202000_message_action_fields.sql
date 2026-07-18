-- Message unsend / edit / reply threading fields.
-- Keep FK columns aligned with the deployed messages.id type. Some environments
-- have legacy text message ids while newer schemas use uuid.
DO $$
DECLARE
  v_message_id_type text;
BEGIN
  SELECT format_type(attribute.atttypid, attribute.atttypmod)
    INTO v_message_id_type
  FROM pg_attribute attribute
  JOIN pg_class class ON class.oid = attribute.attrelid
  JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
  WHERE namespace.nspname = 'public'
    AND class.relname = 'messages'
    AND attribute.attname = 'id'
    AND NOT attribute.attisdropped;

  IF v_message_id_type IS NULL THEN
    RAISE EXCEPTION 'public.messages.id column was not found';
  END IF;

  ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;

  ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS edited_at timestamptz;

  EXECUTE format(
    'ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reply_to_id %s REFERENCES public.messages(id) ON DELETE SET NULL',
    v_message_id_type
  );

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.message_audit_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id %s NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
      original_body text,
      action text NOT NULL CHECK (action IN (''unsend'', ''edit'')),
      actor_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )',
    v_message_id_type
  );
END $$;

ALTER TABLE public.message_audit_log ENABLE ROW LEVEL SECURITY;
