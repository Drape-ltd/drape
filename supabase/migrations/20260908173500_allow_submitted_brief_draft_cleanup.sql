-- Fulfillment selection evidence is append-only, so its historical draft UUID
-- must not be rewritten when a successfully submitted brief draft is removed.
-- The previous ON DELETE SET NULL FK attempted that forbidden rewrite and made
-- every submitted draft cleanup fail.

alter table public.fulfillment_selection_events
  drop constraint if exists fulfillment_selection_events_draft_id_fkey;

comment on column public.fulfillment_selection_events.draft_id is
  'Immutable historical UUID of the brief draft that produced this eligibility decision. It intentionally has no delete action or live-row foreign key so submitted drafts can be removed without mutating append-only evidence.';
