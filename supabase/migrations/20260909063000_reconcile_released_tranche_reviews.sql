-- Repair released tranches created before the release adapter persisted its
-- approved Money Desk request, then close the matching eligible-review issue.
with ranked_requests as (
  select
    tranche.id as tranche_id,
    request.id as request_id,
    row_number() over (
      partition by tranche.id
      order by request.terminal_at desc nulls last, request.created_at desc, request.id
    ) as request_rank
  from public.order_settlement_tranches tranche
  join public.money_desk_requests request
    on request.target_type = 'SETTLEMENT_TRANCHE'
   and request.target_id = tranche.id::text
   and request.action_type = 'PAYOUT_RELEASE'
   and request.status = 'SUCCEEDED'
  where tranche.status = 'RELEASED'
    and tranche.money_desk_request_id is null
)
update public.order_settlement_tranches tranche
set money_desk_request_id = ranked.request_id,
    updated_at = now()
from ranked_requests ranked
where tranche.id = ranked.tranche_id
  and ranked.request_rank = 1;

with resolution_candidates as (
  select
    issue.id,
    issue.status as previous_status,
    issue.metadata as previous_metadata,
    tranche.id as tranche_id,
    tranche.payout_id,
    tranche.money_desk_request_id,
    tranche.provider_reference
  from public.ops_issues issue
  join public.order_settlement_tranches tranche
    on issue.dedupe_key = 'settlement-eligible:' || tranche.id::text
  where issue.status in ('OPEN', 'IN_REVIEW', 'ESCALATED')
    and tranche.status = 'RELEASED'
    and tranche.money_desk_request_id is not null
), resolved as (
  update public.ops_issues issue
  set status = 'RESOLVED',
      resolved_at = now(),
      last_seen_at = now(),
      metadata = coalesce(issue.metadata, '{}'::jsonb) || jsonb_build_object(
        'outcome', 'RELEASED',
        'moneyDeskRequestId', candidate.money_desk_request_id,
        'payoutId', candidate.payout_id,
        'providerReference', candidate.provider_reference,
        'recoveredAt', now(),
        'reconciledBy', '20260909063000_reconcile_released_tranche_reviews'
      )
  from resolution_candidates candidate
  where issue.id = candidate.id
  returning issue.id
)
insert into public.ops_audit_logs (
  issue_id,
  action_taken,
  performed_by,
  performed_role,
  reason,
  before_state,
  after_state
)
select
  candidate.id,
  'ISSUE_AUTO_RESOLVED',
  null,
  'SYSTEM',
  'The approved settlement tranche reached a terminal provider release outcome.',
  jsonb_build_object('status', candidate.previous_status, 'metadata', coalesce(candidate.previous_metadata, '{}'::jsonb)),
  jsonb_build_object(
    'status', 'RESOLVED',
    'settlementTrancheId', candidate.tranche_id,
    'moneyDeskRequestId', candidate.money_desk_request_id,
    'payoutId', candidate.payout_id,
    'providerReference', candidate.provider_reference
  )
from resolution_candidates candidate
join resolved on resolved.id = candidate.id;
