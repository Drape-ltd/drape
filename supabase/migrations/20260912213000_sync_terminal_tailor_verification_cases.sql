-- Keep the canonical Ops case envelope synchronized with the authoritative
-- tailor trust decision. The legacy status column alone is not sufficient:
-- My Work and queue metrics intentionally read canonical_status.

create or replace function public.sync_terminal_tailor_verification_ops_cases()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_resolved_at timestamptz := coalesce(
    new.id_verified_at,
    new.id_verification_rejected_at,
    now()
  );
begin
  if new.id_verification_status not in ('VERIFIED', 'APPROVED', 'REJECTED') then
    return new;
  end if;

  update public.ops_issues
  set status = 'RESOLVED',
      canonical_status = 'RESOLVED',
      recommended_action = 'No action. The tailor trust review is complete.',
      resolved_at = coalesce(resolved_at, v_resolved_at),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'verificationStatus', new.id_verification_status,
        'verificationDecidedAt', v_resolved_at
      )
  where issue_type = 'TAILOR_VERIFICATION'
    and environment = public.current_ops_environment()
    and coalesce(user_id, actor_id) = new.user_id::text
    and (tailor_profile_id is null or tailor_profile_id = new.id::text)
    and canonical_status not in ('RESOLVED', 'CLOSED', 'CANCELLED');

  return new;
end;
$$;

drop trigger if exists trg_sync_terminal_tailor_verification_ops_cases
  on public.tailor_profiles;
create trigger trg_sync_terminal_tailor_verification_ops_cases
after update of id_verification_status on public.tailor_profiles
for each row
when (
  new.id_verification_status is distinct from old.id_verification_status
  and new.id_verification_status in ('VERIFIED', 'APPROVED', 'REJECTED')
)
execute function public.sync_terminal_tailor_verification_ops_cases();

revoke all on function public.sync_terminal_tailor_verification_ops_cases()
  from public, anon, authenticated;

comment on function public.sync_terminal_tailor_verification_ops_cases() is
  'Atomically resolves the canonical Ops work item when a tailor trust decision becomes terminal.';
