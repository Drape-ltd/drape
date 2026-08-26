-- Fabric funding v2 also makes production/Cutting evidence private and preserves
-- the immutable capture separately from its 4:3 display derivative.

alter table public.order_stage_updates
  add column if not exists evidence_media jsonb not null default '[]'::jsonb;

alter table public.order_stage_updates
  drop constraint if exists order_stage_updates_evidence_media_shape_check;

alter table public.order_stage_updates
  add constraint order_stage_updates_evidence_media_shape_check check (
    jsonb_typeof(evidence_media) = 'array'
    and jsonb_array_length(evidence_media) <= 6
  );

update storage.buckets
set public = false,
    file_size_limit = greatest(coalesce(file_size_limit, 0), 52428800),
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp',
      'video/mp4', 'video/quicktime', 'video/webm'
    ]
where id = 'commercial-evidence';

-- Existing participant policies on commercial-evidence are order-prefix based.
-- Production evidence uses the same <order-id>/... namespace and therefore does
-- not broaden evidence access.

comment on column public.order_stage_updates.evidence_media is
  'Private production evidence assets. Each entry stores commercial-evidence paths for immutable original/display/poster plus crop metadata; legacy photo_url remains readable.';
