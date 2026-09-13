-- Public-media review is a Trust & Safety responsibility. Older publish-review
-- issues were created without a canonical queue, so the SLA policy trigger had
-- no queue policy from which to derive ownership or due times.

update public.ops_issues
set queue_key = 'trust-safety'
where issue_type = 'CONTENT_FLAG'
  and (
    queue_key is null
    or queue_key = 'operations'
  );

comment on column public.ops_issues.queue_key is
  'Canonical queue policy key. Public media CONTENT_FLAG work is routed to trust-safety.';
