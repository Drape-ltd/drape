import type { Metadata } from 'next'
import {
  CONTACTS,
  DRAPE_EXCEPTION_BUCKETS,
  DRAPE_EXCEPTION_RUNBOOK_ENTRIES,
  formatDatabaseEnumLabel,
  OPS_ISSUE_SEVERITIES,
  OPS_ISSUE_TYPES,
  MONEY_DESK_ACTION_LABELS,
  MONEY_DESK_ACTION_TYPES,
  OPS_PARTIAL_REFUND_DECISION_BASIS_LABELS,
  OPS_PARTIAL_REFUND_EVIDENCE_SOURCE_LABELS,
  OPS_PARTIAL_REFUND_REASON_LABELS,
  OPS_PARTIAL_REFUND_ORDER_OUTCOME_COPY,
  normalizeAccountCurrency,
  derivePayoutDeliveryState,
  payoutDeliveryExplanation,
  payoutDeliveryLabel,
} from '@drape/shared'
import { isVideoMediaUrl, videoPosterFrameUrl } from '@drape/shared/media-policy'
import type { JSX, ReactNode } from 'react'
import {
  getOpsAccessMode,
  getOpsBootstrapRole,
  getOpsDashboardTokenStatus,
  getOpsSession,
  hasOpsWorkforceAccessConfig,
  hasFreshOpsMfa,
  isNamedOpsWorkforceSession,
  type OpsSession,
} from '../../lib/ops-auth'
import {
  buildOpsHref,
  buildOpsRedirectTarget,
  canAccessOpsSection,
  getOpsSection,
  getOpsRoleActions,
  getOpsRoleSections,
  getVisibleOpsSections,
  parseOpsView,
  type OpsRole,
  type OpsTeam,
  type OpsView,
} from '../../lib/ops-console'
import {
  type OpsAccountDeletionRequest,
  type OpsDashboardData,
  loadOpsDashboardData,
  type OpsBypassLog,
  type OpsDispatchItem,
  type OpsDispute,
  type OpsOrderReviewItem,
  type OpsMoneyDeskRequest,
  type OpsReturnResolution,
  type OpsPayout,
  type OpsReviewQueueItem,
  type OpsShopItem,
  type OpsTailorApplication,
  type OpsVerification,
  type OpsIssueHistoryEntry,
  type OpsSupportThread,
  type OpsWorkflowIssue,
} from '../../lib/ops-data'
import { OpsPulseAlerts } from '../../components/ops-pulse-alerts'
import { OpsActionBridge } from '../../components/ops-action-bridge'
import { StatusChip } from '../../components/ui/status-chip'
import { FormMoneyInput } from '../../components/money-input'
import { DispatchContextFields } from '../../components/dispatch-context-fields'

export const dynamic = 'force-dynamic'

type OpsRenderContext = {
  accessMode: ReturnType<typeof getOpsAccessMode>
  session: OpsSession
  query: string
  filter: string
  rawData: OpsDashboardData
  noticeKey: string | null
  focusIssueId: string | null
  returnTo: string | null
}

type OpsProviderHealth = OpsDashboardData['systemHealth']['providers'][number]
type OpsJobQueueHealth = OpsDashboardData['systemHealth']['jobQueue']
type OpsVisibleSection = ReturnType<typeof getVisibleOpsSections>[number]

type OpsQueueItem = {
  view: OpsView
  label: string
  count: number
  description: string
  team: string
  urgency: 'critical' | 'watch' | 'normal'
}

export const metadata: Metadata = {
  title: 'Ops | Drapeon',
  description: 'Protected Drapeon operations surface.',
  robots: {
    index: false,
    follow: false,
  },
}

const NOTICE_COPY: Record<string, string> = {
  'ops-unlocked': 'Ops session opened.',
  'ops-signed-out': 'Ops session cleared.',
  'dispute-saved': 'Dispute status updated.',
  'dispute-resolved': 'Dispute resolved and order state updated.',
  'bypass-saved': 'Contact bypass log updated.',
  'application-saved': 'Application status updated.',
  'verification-approved': 'Verification approved and the tailor is now live.',
  'verification-rejected': 'Verification rejected.',
  'profile-change-approved': 'Profile change approved and merged.',
  'profile-change-rejected': 'Profile change rejected.',
  'payout-change-approved': 'Payout destination change approved.',
  'payout-change-rejected': 'Payout destination change rejected.',
  'payout-change-already-decided': 'This payout destination request was already decided. Its review card has been closed.',
  'deletion-saved': 'Deletion request status updated.',
  'dispatch-saved': 'Dispatch stage updated.',
  'dispatch-quote-saved': 'Provider quote saved. Funding, refund, and customer-decision jobs are now being tracked.',
  'dispatch-event-saved': 'Drapeon Dispatch update saved and sent to both order participants.',
  'review-published': 'Review is public now.',
  'review-held': 'Review is held from public view.',
  'conversation-blocked': 'Conversation paused for safety review.',
  'conversation-unblocked': 'Conversation reopened.',
  'order-review-refunded': 'Order review approved and refund resolution recorded.',
  'order-review-continued': 'Order review closed and the order was returned to its live stage.',
  'payout-release-triggered': 'Payout release was triggered for that order.',
  'material-advance-release-triggered': 'Material advance release was triggered.',
  'material-overage-resolved': 'The unapproved overage was recorded as the tailor’s responsibility.',
  'payout-resolution-applied': 'Payout resolution was saved and payout release was retried.',
  'payout-resolution-refunded': 'Customer refund completed for that payout-blocked order.',
  'partial-refund-review-prepared': 'Evidence saved and the partial refund was sent to Money Desk for independent approval.',
  'partial-refund-order-closed': 'Order closed after the completed partial refund. The refund remains final and this action did not move any additional money.',
  'partial-refund-order-resumed': 'Order resumed after the completed partial refund. The refund remains final and production can continue.',
  'workflow-issue-saved': 'Workflow issue status updated.',
  'workflow-issues-bulk-resolved': 'All visible workflow issues resolved.',
  'support-threads-read': 'Support threads marked as read.',
  'payouts-bulk-released': 'Payout release triggered for all visible orders.',
  'bypass-bulk-reviewed': 'All visible bypass logs marked as reviewed.',
  'manual-issue-created': 'Manual ops issue created.',
  'seller-item-hidden': 'Ready-made item is hidden from buyers.',
  'seller-item-restored': 'Ready-made item is live again.',
  'money-desk-elevated': 'Money Desk elevation is active for 15 minutes.',
  'money-desk-requested': 'Money action submitted for independent approval.',
  'money-desk-approved': 'Money action approval recorded.',
  'money-desk-rejected': 'Money action rejected and closed.',
  'money-desk-executed': 'Money action reached a successful terminal outcome.',
  'money-desk-processing': 'The provider accepted the release. Money Desk stays visibly processing until its webhook confirms success or failure.',
  'consultation-reschedule-recorded': 'Rescheduling is now the recorded outcome. Both people were notified and the fee remains protected.',
  'consultation-money-decision-prepared': 'The attendance outcome is recorded and its money action is waiting in Money Desk for independent approval.',
}

const ERROR_COPY: Record<string, string> = {
  locked: 'Unlock the ops dashboard to continue.',
  forbidden: 'This bootstrap role does not have access to that control-plane surface.',
  'setup-needed': 'Add OPS_DASHBOARD_TOKEN before using the ops surface.',
  'weak-token': 'OPS_DASHBOARD_TOKEN must be at least 32 characters and must not use a placeholder value.',
  'invalid-token': 'That token did not match the configured ops access token.',
  'too-many-attempts': 'Too many unlock attempts. Wait a few minutes, then try again.',
  'rate-limited': 'Too many high-impact ops actions in a short window. Wait a moment, then try again.',
  'rate-limit-unavailable': 'The ops rate limiter could not verify this action. Try again in a moment.',
  'workforce-login-required': 'This control plane is protected by workforce access. Sign in through the Drapeon Access gate with your @drapeon.co account.',
  'workforce-unassigned': 'Your workforce identity is valid, but no control-plane role is assigned to it yet.',
  'service-role-missing': 'Add the server-side Supabase service role env vars to load ops data.',
  'invalid-action': 'That ops action was not recognized.',
  conflict: 'That record changed since the page loaded. Refresh the dashboard and try again.',
  'save-failed': 'That update could not be saved right now.',
  'refund-failed': 'The provider refund did not complete, so the order was not marked refunded.',
  'partial-refund-invalid': 'Complete the reviewed reason, evidence reference, and refund-source fields. Protected tailor entitlement, service fee, refundable tax, fulfillment, and consultation must add up to the customer refund exactly.',
  'reviewed-partial-refund-outcome-invalid': 'Choose whether to close or resume the order and add a clear reviewed reason.',
  'payout-release-failed': 'The payout release could not be triggered right now.',
  'material-advance-release-failed': 'The material advance could not be released right now.',
  'workflow-issue-save-failed': 'That workflow issue could not be updated right now.',
  'manual-issue-create-failed': 'That manual issue could not be created right now.',
  'seller-item-save-failed': 'That ready-made item could not be updated right now.',
  'dispatch-custody-proof-required': 'Record provider acceptance or parcel collection with photo proof before marking this order delivered.',
  'dispatch-photo-proof-required': 'A clear handoff or delivery photo is required for this update.',
  'dispatch-funding-not-ready': 'Complete the provider quote and any required customer payment before booking dispatch.',
  'dispatch-method-mismatch': 'This update does not match the order’s current pickup or delivery method.',
  'dispatch-location-invalid': 'The delivery location is incomplete. Enter a location name or a complete coordinate pair.',
  'dispatch-eta-invalid': 'Choose a valid estimated arrival date and time.',
  'dispatch-proof-invalid': 'Use a JPG, PNG, or WebP delivery-proof image smaller than 8 MB.',
  'dispatch-event-save-failed': 'The delivery update was not saved. Review the current step and required proof, then try again.',
  'verification-rejection-reason-required': 'Add a rejection reason before rejecting verification.',
  'money-desk-required': 'Direct money movement is disabled. Prepare this action in Money Desk for independent approval.',
  'refund-resolution-prepared': 'Exact refund restoration is locked and ready for Money Desk approval.',
  'money-desk-elevation-required': 'Start a fresh 15-minute Money Desk elevation before continuing.',
  'money-desk-request-invalid': 'Add a valid target and keep amount and currency together.',
  'money-desk-action-failed': 'The protected Money Desk action did not complete.',
  'money-desk-execution-failed': 'Execution was blocked or failed and the terminal outcome was recorded.',
  'payout-destination-recovery-unavailable': 'Recovery is not ready. The tailor needs a different verified destination on the same provider and currency.',
  'payout-change-review-unavailable': 'This payout destination request is no longer pending review. Refresh to see its current outcome.',
  'consultation-attendance-decision-invalid': 'Choose one attendance outcome and add an evidence-based note of at least 12 characters.',
  'consultation-attendance-decision-conflict': 'This attendance review changed or could not be resolved. Refresh and review its current state.',
  'consultation-attendance-money-unavailable': 'This consultation has no captured paid fee available for refund or payout.',
}

const OPS_ROLE_ORDER: OpsRole[] = ['admin', 'ops', 'customer_success', 'trust', 'finance', 'engineering']

const OPS_ROLE_DESCRIPTIONS: Record<OpsRole, string> = {
  admin: 'Full launch control across every internal surface and every mutation.',
  ops: 'Dispatch, ready-made inventory, intake, payout blockers, and operational follow-up.',
  customer_success: 'Customer-facing order help, disputes, conversation safety, and refund review.',
  trust: 'Identity, privacy, review moderation, contact bypass, and safety enforcement.',
  finance: 'Payout review, refund exposure, and payment-linked release checks.',
  engineering: 'Incidents, provider circuits, dead jobs, workflow issues, and system recovery.',
}

type OpsRunbookEntry = {
  title: string
  owner: OpsTeam
  severity: 'Critical' | 'High' | 'Medium' | 'Standard'
  bucket?: string
  keywords: string[]
  useWhen: string
  firstMove: string
  customerCopy: string
  tailorCopy: string
  opsActions: string[]
}

const OPS_RUNBOOK_ENTRIES: OpsRunbookEntry[] = DRAPE_EXCEPTION_RUNBOOK_ENTRIES
const OPS_RUNBOOK_BUCKET_LABELS = Object.fromEntries(
  DRAPE_EXCEPTION_BUCKETS.map((bucket) => [bucket.id, bucket.title]),
) as Record<string, string>

function readParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = params[key]
  if (Array.isArray(value)) return value[0] ?? null
  return typeof value === 'string' && value.length > 0 ? value : null
}

function formatDateTime(value: string | null) {
  if (!value) return '—'

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatMoney(amount: number | null, currency: string | null) {
  if (amount == null || !currency) return '—'

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount / 100)
  } catch {
    return `${currency} ${(amount / 100).toFixed(2)}`
  }
}

function formatRelativeTime(value: string | null) {
  if (!value) return '—'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return formatDateTime(value)

  const diffMs = timestamp - Date.now()
  const absMs = Math.abs(diffMs)
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 24 * 60 * 60 * 1000],
    ['hour', 60 * 60 * 1000],
    ['minute', 60 * 1000],
  ]
  const formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })
  for (const [unit, size] of units) {
    if (absMs >= size || unit === 'minute') {
      return formatter.format(Math.round(diffMs / size), unit)
    }
  }

  return formatter.format(0, 'minute')
}

function releaseWindowLabel(payout: OpsPayout) {
  if (payout.escrowReleased) return `Released ${formatRelativeTime(payout.escrowReleasedAt)}`
  if (!payout.customerHandoffConfirmedAt) return 'Waiting for customer handoff confirmation'
  if (!payout.payoutReadyAt) return 'Release timing unavailable'
  return Date.parse(payout.payoutReadyAt) <= Date.now()
    ? '72-hour window closed'
    : `Release window closes ${formatRelativeTime(payout.payoutReadyAt)}`
}

function isClosedConversationStage(stage: string | null) {
  return ['CANCELLED', 'DECLINED', 'REFUNDED', 'COMPLETE', 'COMPLETED'].includes((stage ?? '').toUpperCase())
}

function statusPillClass(status: string) {
  const normalized = status.toUpperCase()

  if (normalized === 'OPEN' || normalized === 'PENDING') {
    return 'border-rust/20 bg-rust/10 text-rust-700'
  }
  if (normalized === 'CRITICAL' || normalized === 'HIGH' || normalized === 'FAILED' || normalized === 'DEAD') {
    return 'border-rust/20 bg-rust/10 text-rust-700'
  }
  if (normalized === 'ESCALATED') {
    return 'border-rust/20 bg-rust/10 text-rust-700'
  }
  if (normalized === 'UNDER_REVIEW' || normalized === 'REVIEWING' || normalized === 'CONTACTED') {
    return 'border-needle/20 bg-needle/10 text-needle-700'
  }
  if (normalized === 'IN_REVIEW') {
    return 'border-needle/20 bg-needle/10 text-needle-700'
  }
  if (normalized === 'ACKNOWLEDGED') {
    return 'border-needle/20 bg-needle/10 text-needle-700'
  }
  if (normalized === 'APPROVED' || normalized === 'VERIFIED' || normalized === 'REVIEWED' || normalized === 'RESOLVED_RELEASED' || normalized === 'COMPLETED') {
    return 'border-needle/20 bg-needle/10 text-needle-800'
  }
  if (normalized === 'REJECTED' || normalized === 'RESOLVED_REFUNDED') {
    return 'border-ink/10 bg-ink/10 text-ink'
  }

  return 'border-ink/10 bg-bone text-ink/78'
}

function severityPillClass(severity: string) {
  const normalized = severity.toUpperCase()

  if (normalized === 'CRITICAL' || normalized === 'ERROR') {
    return 'border-rust/20 bg-rust/10 text-rust-700'
  }

  if (normalized === 'HIGH' || normalized === 'WARN') {
    return 'border-rust/16 bg-rust/8 text-rust-700'
  }

  if (normalized === 'MEDIUM' || normalized === 'INFO') {
    return 'border-needle/20 bg-needle/10 text-needle-700'
  }

  if (normalized === 'LOW') {
    return 'border-ink/10 bg-bone text-ink/70'
  }

  return 'border-needle/20 bg-needle/10 text-needle-700'
}

function workflowIssueLabel(event: string) {
  switch (event) {
    case 'CONVERSATION_SAFETY':
    case 'conversation.safety_reported':
      return 'Safety report'
    case 'conversation.blocked':
      return 'Conversation paused'
    case 'PAYMENT_BLOCKED':
    case 'payment.blocked':
      return 'Payment blocked'
    case 'PAYOUT_BLOCKED':
      return 'Payout blocked'
    case 'PAYOUT_FAILED':
      return 'Payout failed'
    case 'privacy.data_access_requested':
      return 'Data access request'
    case 'SELLER_ACCESS_REVIEW':
    case 'seller.access_review_requested':
      return 'Seller access review'
    case 'ORDER_REVIEW':
      return 'Cancellation review'
    case 'DELIVERY_REVIEW':
      return 'Delivery review'
    case 'FABRIC_APPROVAL':
      return 'Fabric approval'
    case 'PRODUCTION_STALL':
      return 'Production stall'
    case 'AFTERCARE_REQUEST':
      return 'Aftercare request'
    case 'shipping.handoff_blocked':
      return 'Shipping handoff blocked'
    case 'shipping.webhook_skipped':
      return 'Webhook skipped'
    case 'shipping.delivery_order_missing':
      return 'Delivery missing order'
    case 'shipping.delivery_skipped_wrong_stage':
      return 'Delivery wrong stage'
    case 'shipping.delivery_update_failed':
      return 'Delivery update failed'
    default:
      return event.replace(/[._]/g, ' ')
  }
}

function formatIssueTypeLabel(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatHistoryAction(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function sectionMailto(subject: string) {
  return `mailto:${CONTACTS.ops}?subject=${encodeURIComponent(subject)}`
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string
  value: number
  hint: string
}): React.JSX.Element {
  return (
    <div className="rounded-[8px] border border-ink/8 bg-white/88 p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{label}</p>
      <div className="mt-4 text-4xl text-ink">{value}</div>
      <p className="mt-2 text-sm leading-7 text-ink/62">{hint}</p>
    </div>
  )
}

type OpsPulseSnapshot = {
  openCount: number
  criticalCount: number
  latestKey: string
  latestTitle: string | null
}

function buildOpsPulseSnapshot(data: OpsDashboardData): OpsPulseSnapshot {
  const activeIssues = data.workflowIssues.filter((issue) => issue.status.toUpperCase() !== 'RESOLVED')
  const criticalIssues = activeIssues
    .filter((issue) => issue.severity.toUpperCase() === 'CRITICAL')
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  const latest = criticalIssues[0] ?? null

  return {
    openCount: activeIssues.length,
    criticalCount: criticalIssues.length,
    latestKey: latest ? `${latest.id}:${latest.createdAt}` : '',
    latestTitle: latest?.summary ?? null,
  }
}

function OpsPulsePanel({
  enabled,
  snapshot,
}: {
  enabled: boolean
  snapshot: OpsPulseSnapshot
}): React.JSX.Element | null {
  if (!enabled) return null

  return (
    <OpsPulseAlerts
      initialOpenCount={snapshot.openCount}
      initialCriticalCount={snapshot.criticalCount}
      initialLatestKey={snapshot.latestKey}
      initialLatestTitle={snapshot.latestTitle}
      workflowHref={buildOpsHref('workflow-issues')}
    />
  )
}

function CompactMetric({
  label,
  value,
  tone = 'normal',
}: {
  label: string
  value: number | string
  tone?: 'normal' | 'attention' | 'good'
}): React.JSX.Element {
  const toneClass =
    tone === 'attention'
      ? 'border-rust/16 bg-rust/8 text-rust-700'
      : tone === 'good'
        ? 'border-needle/16 bg-needle/8 text-needle-700'
        : 'border-ink/8 bg-white text-ink/72'

  return (
    <div className={`rounded-[8px] border px-4 py-3 ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">{label}</p>
      <p className="mt-1 text-2xl text-ink">{value}</p>
    </div>
  )
}

function buildPriorityQueueItems(
  data: OpsDashboardData,
  visibleSections: OpsVisibleSection[],
): OpsQueueItem[] {
  const allowed = new Set(visibleSections.map((section) => section.key))
  const maybeItems: OpsQueueItem[] = [
    {
      view: 'support',
      label: 'Unread order conversations',
      count: data.summary.activeSupportThreads,
      description: 'Customer or tailor messages that support can inspect before escalation.',
      team: 'Customer success',
      urgency: data.summary.activeSupportThreads > 0 ? 'watch' : 'normal',
    },
    {
      view: 'payouts',
      label: 'Payouts needing review',
      count: data.summary.pendingPayoutCount,
      description: 'Pending or blocked release checks tied back to customer handoff and escrow.',
      team: 'Finance',
      urgency: data.summary.pendingPayoutCount > 0 ? 'critical' : 'normal',
    },
    {
      view: 'dispatch',
      label: 'Dispatch handoffs',
      count: data.summary.pendingDispatch,
      description: 'Delivery and shipping orders ready for Drapeon-managed handoff.',
      team: 'Ops',
      urgency: data.summary.pendingDispatch > 0 ? 'watch' : 'normal',
    },
    {
      view: 'shop',
      label: 'Shop listing alerts',
      count: data.summary.shopInventoryAlerts,
      description: 'Ready-made stock, media, visibility, or fulfillment issues.',
      team: 'Ops',
      urgency: data.summary.shopInventoryAlerts > 0 ? 'watch' : 'normal',
    },
    {
      view: 'workflow-issues',
      label: 'Workflow issues',
      count: data.summary.openWorkflowIssues,
      description: 'Open safety, payment, payout, privacy, shipping, and aftercare exceptions.',
      team: 'Engineering',
      urgency: data.summary.openWorkflowIssues > 0 ? 'critical' : 'normal',
    },
    {
      view: 'incidents',
      label: 'Provider and queue health',
      count: data.summary.providersDegraded + data.summary.deadJobs + data.summary.retryableJobs,
      description: 'Provider circuits, dead-lettered jobs, and retry pressure.',
      team: 'Engineering',
      urgency: data.summary.providersDegraded + data.summary.deadJobs > 0 ? 'critical' : data.summary.retryableJobs > 0 ? 'watch' : 'normal',
    },
    {
      view: 'disputes',
      label: 'Open disputes',
      count: data.summary.openDisputes,
      description: 'Customer or tailor conflicts that need human resolution.',
      team: 'Customer success',
      urgency: data.summary.openDisputes > 0 ? 'critical' : 'normal',
    },
    {
      view: 'order-reviews',
      label: 'Order reviews',
      count: data.summary.pendingOrderReviews,
      description: 'Cancellation and delivery reviews before they become disputes.',
      team: 'Customer success',
      urgency: data.summary.pendingOrderReviews > 0 ? 'watch' : 'normal',
    },
  ]

  return maybeItems
    .filter((item) => allowed.has(item.view))
    .sort((left, right) => {
      const rank = { critical: 0, watch: 1, normal: 2 }
      return rank[left.urgency] - rank[right.urgency] || right.count - left.count
    })
}

function QueueRow({ item }: { item: OpsQueueItem }): React.JSX.Element {
  const toneClass =
    item.urgency === 'critical'
      ? 'border-rust/18 bg-rust/8'
      : item.urgency === 'watch'
        ? 'border-needle/18 bg-needle/8'
        : 'border-ink/8 bg-white'

  return (
    <a
      href={buildOpsHref(item.view)}
      className={`grid gap-3 rounded-[8px] border px-4 py-4 transition hover:-translate-y-0.5 hover:bg-white sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center ${toneClass}`}
    >
      <div className="flex size-11 items-center justify-center rounded-full border border-white/70 bg-white text-lg text-ink shadow-sm">
        {item.count}
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-ink">{item.label}</p>
          <span className="rounded-full border border-ink/8 bg-white/72 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/50">
            {item.team}
          </span>
        </div>
        <p className="mt-1 text-sm leading-6 text-ink/60">{item.description}</p>
      </div>
      <span className="text-sm font-semibold text-needle">Open</span>
    </a>
  )
}

function SectionFrame({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <section id={id} className="grid min-w-0 gap-5">
      <div className="min-w-0 border-b border-ink/8 pb-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-needle/72">{eyebrow}</p>
        <h2 className="mt-2 text-2xl text-ink sm:text-3xl">{title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-ink/60">{description}</p>
      </div>
      <div className="grid min-w-0 gap-5">{children}</div>
    </section>
  )
}

function CardCollapseChevron(): React.JSX.Element {
  return (
    <span className="ml-auto inline-flex size-5 shrink-0 items-center justify-center text-[13px] text-ink/28 transition-transform duration-200 group-open:rotate-180">
      ▾
    </span>
  )
}

function CardCollapse({
  id,
  background,
  summary,
  children,
  defaultOpen = false,
}: {
  id?: string
  background: string
  summary: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}): React.JSX.Element {
  return (
    <article id={id} className={`min-w-0 scroll-mt-6 rounded-[8px] border border-ink/8 ${background} shadow-sm`}>
      <details className="group min-w-0" open={defaultOpen}>
        <summary className="flex min-w-0 cursor-pointer list-none flex-wrap items-center gap-3 p-5 [&::-webkit-details-marker]:hidden sm:flex-nowrap">
          {summary}
          <CardCollapseChevron />
        </summary>
        <div className="min-w-0 border-t border-ink/8 px-5 pb-5 pt-5">
          {children}
        </div>
      </details>
    </article>
  )
}

function EmptyState({
  title,
  body,
}: {
  title: string
  body: string
}): React.JSX.Element {
  return (
    <div className="rounded-[8px] border border-dashed border-ink/12 bg-bone/60 p-6">
      <h3 className="text-xl text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-7 text-ink/64">{body}</p>
    </div>
  )
}

function DetailList({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>
}): React.JSX.Element {
  return (
    <dl className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item, index) => (
        <div key={`${item.label}:${index}`} className="min-w-0 rounded-[8px] border border-ink/6 bg-bone/56 px-4 py-3">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/42">{item.label}</dt>
          <dd className="mt-1 break-words text-sm leading-6 text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function JobQueueCard({ queue }: { queue: OpsJobQueueHealth }): React.JSX.Element {
  const queueRisk = queue.dead > 0 ? 'CRITICAL' : queue.retryable > 0 ? 'ESCALATED' : queue.pending > 25 ? 'IN_REVIEW' : 'RESOLVED'

  return (
    <article className="rounded-[8px] border border-ink/8 bg-white/86 p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/78">Background queue</p>
          <h3 className="mt-2 text-2xl text-ink">Async work health</h3>
        </div>
        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusPillClass(queueRisk)}`}>
          {queueRisk === 'RESOLVED' ? 'Healthy' : queueRisk.toLowerCase()}
        </span>
      </div>
      <div className="mt-5">
        <DetailList
          items={[
            { label: 'Pending', value: String(queue.pending) },
            { label: 'Processing', value: String(queue.processing) },
            { label: 'Retrying', value: String(queue.retryable) },
            { label: 'Dead', value: String(queue.dead) },
            { label: 'Oldest pending', value: formatDateTime(queue.oldestPendingAt) },
            { label: 'Oldest processing', value: formatDateTime(queue.oldestProcessingAt) },
          ]}
        />
      </div>
    </article>
  )
}

function ProviderCircuitCard({ provider }: { provider: OpsProviderHealth }): React.JSX.Element {
  const normalizedStatus = provider.status.toUpperCase()
  const status = normalizedStatus === 'OK' ? 'RESOLVED' : normalizedStatus === 'OPEN' ? 'ESCALATED' : normalizedStatus

  return (
    <article className="rounded-[8px] border border-ink/8 bg-white/86 p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg text-ink">{provider.provider}</span>
            <StatusChip status={provider.status} className={statusPillClass(status)} />
          </div>
          <p className="mt-2 text-sm leading-7 text-ink/66">{formatDatabaseEnumLabel(provider.operation)}</p>
        </div>
        <a
          href={sectionMailto(`Provider circuit review: ${provider.provider} ${provider.operation}`)}
          className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone"
        >
          Email incident note
        </a>
      </div>
      <div className="mt-5">
        <DetailList
          items={[
            { label: 'Failures', value: String(provider.failureCount) },
            { label: 'Circuit open until', value: formatDateTime(provider.circuitOpenUntil) },
            { label: 'Updated', value: formatDateTime(provider.updatedAt) },
          ]}
        />
      </div>
      {provider.lastError ? (
        <div className="mt-5 rounded-[8px] border border-rust/14 bg-rust/8 p-4 text-sm leading-7 text-rust-700">
          {provider.lastError}
        </div>
      ) : null}
    </article>
  )
}

function RoleAccessCard({ role }: { role: OpsRole }): React.JSX.Element {
  const sections = getOpsRoleSections(role)
  const actions = getOpsRoleActions(role)

  return (
    <article className="rounded-[8px] border border-ink/8 bg-white/86 p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/78">Role</p>
          <h3 className="mt-2 text-2xl text-ink">{formatDatabaseEnumLabel(role)}</h3>
          <p className="mt-2 text-sm leading-7 text-ink/64">{OPS_ROLE_DESCRIPTIONS[role]}</p>
        </div>
        <span className="rounded-full border border-ink/8 bg-bone px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-ink/56">
          {sections.length} sections
        </span>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-[8px] border border-ink/6 bg-bone/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Visible sections</p>
          <p className="mt-2 text-sm leading-7 text-ink/72">
            {sections.map((section) => getOpsSection(section).label).join(', ')}
          </p>
        </div>
        <div className="rounded-[8px] border border-ink/6 bg-bone/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Allowed actions</p>
          <p className="mt-2 text-sm leading-7 text-ink/72">
            {actions.length > 0 ? actions.map((action) => action.replace(/-/g, ' ')).join(', ') : 'Read only'}
          </p>
        </div>
      </div>
    </article>
  )
}

function IssueHistoryBlock({
  history,
}: {
  history: OpsIssueHistoryEntry[]
}): React.JSX.Element | null {
  if (history.length === 0) return null

  return (
    <div className="mt-5 rounded-[8px] border border-ink/6 bg-white/82 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Audit trail</p>
      <div className="mt-3 grid gap-3">
        {history.slice(0, 4).map((entry) => (
          <div key={entry.id} className="rounded-lg border border-ink/6 bg-bone/52 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink">{formatHistoryAction(entry.actionTaken)}</p>
              <p className="text-xs uppercase tracking-[0.14em] text-ink/46">{formatDateTime(entry.createdAt)}</p>
            </div>
            <p className="mt-1 text-sm leading-6 text-ink/62">
              {(entry.performedBy ?? 'System')}{entry.performedRole ? ` · ${entry.performedRole}` : ''}
            </p>
            {entry.reason ? (
              <p className="mt-2 text-sm leading-6 text-ink/72">{entry.reason}</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function ManualIssueCreateCard({
  redirectTo,
}: {
  redirectTo: string
}): React.JSX.Element {
  return (
    <article className="rounded-[8px] border border-needle/12 bg-[linear-gradient(180deg,#ffffff_0%,#eef8f4_100%)] p-5 shadow-sm">
      <form action="/ops/action" method="post" className="grid gap-3">
        <input type="hidden" name="kind" value="manual-issue-create" />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm text-ink/70">
            Issue type
            <select
              name="issueType"
              defaultValue="SYSTEM_ALERT"
              className="rounded-2xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-needle/40"
            >
              {OPS_ISSUE_TYPES.map((issueType) => (
                <option key={issueType} value={issueType}>
                  {formatIssueTypeLabel(issueType)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm text-ink/70">
            Severity
            <select
              name="severity"
              defaultValue="MEDIUM"
              className="rounded-2xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-needle/40"
            >
              {OPS_ISSUE_SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {formatIssueTypeLabel(severity)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="grid gap-1.5 text-sm text-ink/70">
          Title
          <input
            name="title"
            required
            placeholder="Short case title"
            className="rounded-2xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
          />
        </label>
        <label className="grid gap-1.5 text-sm text-ink/70">
          Description
          <textarea
            name="description"
            required
            rows={3}
            placeholder="What is wrong, who is affected, and why this needs a case."
            className="rounded-[8px] border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
          />
        </label>
        <label className="grid gap-1.5 text-sm text-ink/70">
          Recommended action
          <textarea
            name="recommendedAction"
            required
            rows={2}
            placeholder="Tell the next teammate exactly what should happen next."
            className="rounded-[8px] border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
          />
        </label>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 py-0.5 text-xs font-semibold text-ink/45 transition hover:text-ink/65 [&::-webkit-details-marker]:hidden">
            <span className="inline-block transition-transform group-open:rotate-90 text-[9px]">▶</span>
            Optional context
          </summary>
          <div className="mt-3 grid gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1.5 text-sm text-ink/70">
                Order ID
                <input name="orderId" placeholder="Optional UUID" className="rounded-2xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40" />
              </label>
              <label className="grid gap-1.5 text-sm text-ink/70">
                User ID
                <input name="userId" placeholder="Optional UUID" className="rounded-2xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40" />
              </label>
              <label className="grid gap-1.5 text-sm text-ink/70">
                Tailor profile ID
                <input name="tailorProfileId" placeholder="Optional UUID" className="rounded-2xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40" />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="grid gap-1.5 text-sm text-ink/70">
                Entity type
                <input name="relatedEntityType" placeholder="review, payout…" className="rounded-2xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40" />
              </label>
              <label className="grid gap-1.5 text-sm text-ink/70">
                Entity ID
                <input name="relatedEntityId" placeholder="Optional ID" className="rounded-2xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40" />
              </label>
              <label className="grid gap-1.5 text-sm text-ink/70">
                Provider
                <input name="provider" placeholder="PAYSTACK, STRIPE…" className="rounded-2xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40" />
              </label>
              <label className="grid gap-1.5 text-sm text-ink/70">
                Stage
                <input name="stage" placeholder="PAYMENT_PENDING…" className="rounded-2xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40" />
              </label>
            </div>
            <label className="grid gap-1.5 text-sm text-ink/70">
              Internal note
              <textarea name="note" rows={2} placeholder="Optional audit trail context." className="rounded-[8px] border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40" />
            </label>
          </div>
        </details>
        <div className="flex justify-end pt-1">
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-needle/90"
          >
            Create case
          </button>
        </div>
      </form>
    </article>
  )
}

function DisputeCard({
  dispute,
  redirectTo,
  context,
}: {
  dispute: OpsDispute
  redirectTo: string
  context: OpsRenderContext
}): React.JSX.Element {
  const editable = dispute.status === 'OPEN' || dispute.status === 'UNDER_REVIEW'
  const activeDispute = editable && dispute.orderStage === 'IN_DISPUTE'
  const namedMfaSession = isNamedOpsWorkforceSession(context.session)
    && Boolean(context.session.email)
    && hasFreshOpsMfa(context.session)
  const canPrepareCancellation = activeDispute
    && dispute.refundablePaymentCount > 0
    && namedMfaSession
    && getOpsRoleActions(context.session.role).includes('order-cancellation-refund-request')

  return (
    <CardCollapse
      background="bg-[linear-gradient(180deg,#fffdf9_0%,#f6efe5_100%)]"
      summary={
        <>
          <StatusChip status={dispute.status} className={`shrink-0 ${statusPillClass(dispute.status)}`} />
          <span className="font-semibold text-ink">Order {dispute.orderReference ? `#${dispute.orderReference}` : dispute.orderId.slice(0, 8)}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink/48">{dispute.reason}</span>
          <span className="shrink-0 text-sm font-semibold text-ink/60">{formatMoney(dispute.amount, dispute.currency)}</span>
          <span className="shrink-0 text-xs text-ink/38">{formatRelativeTime(dispute.createdAt)}</span>
        </>
      }
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg text-ink">Order {dispute.orderReference ? `#${dispute.orderReference}` : dispute.orderId.slice(0, 8)}</span>
            <StatusChip status={dispute.status} className={statusPillClass(dispute.status)} />
          </div>
          <p className="mt-2 text-sm leading-7 text-ink/66">{dispute.reason}</p>
        </div>
        <a
          href={sectionMailto(`Dispute review: ${dispute.orderReference ?? dispute.orderId}`)}
          className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone"
        >
          Email ops
        </a>
      </div>

      <div className="mt-5 grid min-w-0 gap-5">
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Parties</p>
          <DetailList
            items={[
              { label: 'Customer', value: dispute.customerEmail ? `${dispute.customerName} · ${dispute.customerEmail}` : dispute.customerName },
              { label: 'Tailor', value: dispute.tailorEmail ? `${dispute.tailorName} · ${dispute.tailorEmail}` : dispute.tailorName },
            ]}
          />
        </div>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Order and refund exposure</p>
          <DetailList
            items={[
              { label: 'Stage', value: dispute.orderStage ?? '—' },
              { label: 'Quoted order amount', value: formatMoney(dispute.amount, dispute.currency) },
              { label: 'Captured', value: formatMoney(dispute.capturedAmount, dispute.currency) },
              { label: 'Already refunded', value: formatMoney(dispute.alreadyRefundedAmount, dispute.currency) },
              { label: 'Refundable now', value: formatMoney(dispute.refundableAmount, dispute.currency) },
              { label: 'Refundable payments', value: String(dispute.refundablePaymentCount) },
              ...(dispute.unreleasedMaterialAmount > 0
                ? [{ label: 'Unreleased material payment', value: formatMoney(dispute.unreleasedMaterialAmount, dispute.currency) }]
                : []),
              { label: 'Delivery', value: dispute.deliveryMethod ?? dispute.fulfillmentOption ?? '—' },
              { label: 'Opened', value: formatDateTime(dispute.createdAt) },
              ...(dispute.resolvedAt ? [{ label: 'Resolved', value: formatDateTime(dispute.resolvedAt) }] : []),
            ]}
          />
        </div>
      </div>

      <div className="mt-5 rounded-[8px] border border-ink/6 bg-white/82 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Customer description</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink/78">{dispute.description}</p>
        {dispute.resolution ? (
          <>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Resolution note</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink/78">{dispute.resolution}</p>
          </>
        ) : null}
      </div>

      {dispute.evidenceUrls.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-3">
          {dispute.evidenceUrls.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-full border border-needle/12 bg-needle/8 px-4 py-2 text-sm font-semibold text-needle hover:bg-needle/12"
            >
              Open evidence
            </a>
          ))}
        </div>
      ) : null}

      {editable ? (
        <div className="mt-5 border-t border-ink/8 pt-5">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/38">Actions</p>
          <div className="grid gap-4">
            <form action="/ops/action" method="post" className="flex flex-col gap-3 rounded-[8px] border border-ink/6 bg-white/82 p-4 sm:flex-row sm:items-end">
              <input type="hidden" name="kind" value="dispute-status" />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <input type="hidden" name="disputeId" value={dispute.id} />
              <label className="grid gap-2 text-sm text-ink/70">
                Review status
                <select
                  name="status"
                  defaultValue={dispute.status}
                  className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40"
                >
                  <option value="OPEN">Open</option>
                  <option value="UNDER_REVIEW">Under review</option>
                </select>
              </label>
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90"
              >
                Save dispute state
              </button>
            </form>

            {activeDispute ? (
              <div className="grid gap-3 rounded-[8px] border border-rust/16 bg-rust/6 p-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rust-700">Protected cancellation refund</p>
                  <p className="mt-2 text-sm leading-7 text-ink/72">
                    Preparation snapshots all {dispute.refundablePaymentCount} refundable payment{dispute.refundablePaymentCount === 1 ? '' : 's'} for {formatMoney(dispute.refundableAmount, dispute.currency)}. It does not move money. A different named operator must approve before an MFA-backed execution refunds the provider payments and closes the order.
                  </p>
                  {dispute.unreleasedMaterialAmount > 0 ? (
                    <p className="mt-2 text-sm font-semibold leading-6 text-rust-700">
                      This includes {formatMoney(dispute.unreleasedMaterialAmount, dispute.currency)} of paid, unreleased material funding. The advance will be cancelled only after its provider refund succeeds.
                    </p>
                  ) : null}
                </div>
                {canPrepareCancellation ? (
                  <form action="/ops/action" method="post" className="grid gap-3">
                    <input type="hidden" name="kind" value="order-cancellation-refund-request" />
                    <input type="hidden" name="redirectTo" value={redirectTo} />
                    <input type="hidden" name="orderId" value={dispute.orderId} />
                    <label className="grid gap-2 text-sm text-ink/70">
                      Evidence-based cancellation reason
                      <textarea
                        name="reason"
                        required
                        minLength={12}
                        maxLength={1000}
                        rows={3}
                        defaultValue={`Reviewed dispute ${dispute.id} and confirmed cancellation refund exposure before independent approval.`}
                        className="rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40"
                      />
                    </label>
                    <button type="submit" className="inline-flex items-center justify-center rounded-lg bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90">
                      Prepare cancellation refund
                    </button>
                  </form>
                ) : (
                  <div className="rounded-[8px] border border-dashed border-rust/20 bg-white/72 px-4 py-3 text-sm leading-7 text-ink/64">
                    {dispute.refundablePaymentCount === 0
                      ? 'No refundable captured payment is available. Do not close the dispute until Finance reconciles the payment records.'
                      : 'Money movement is locked in this session. Sign in through Cloudflare Access with a named MFA-backed Customer Success or Finance role to prepare the request.'}
                  </div>
                )}
                <a href="/ops?view=money-desk#money-desk" className="text-sm font-semibold text-needle underline decoration-needle/30 underline-offset-4">
                  Open Money Desk
                </a>
              </div>
            ) : (
              <div className="rounded-[8px] border border-dashed border-ink/10 bg-white/68 px-4 py-3 text-sm leading-7 text-ink/62">
                The cancellation control is available only while the order and dispute are both active. Resolved records remain read-only.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </CardCollapse>
  )
}

function BypassLogCard({
  log,
  redirectTo,
}: {
  log: OpsBypassLog
  redirectTo: string
}): React.JSX.Element {
  return (
    <CardCollapse
      background="bg-white/86"
      summary={
        <>
          <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${statusPillClass(log.reviewed ? 'REVIEWED' : 'PENDING')}`}>
            {log.reviewed ? 'Reviewed' : 'Needs review'}
          </span>
          <span className="font-semibold text-ink">{log.userName}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink/48">{log.content}</span>
          <span className="shrink-0 text-xs text-ink/38">{formatRelativeTime(log.createdAt)}</span>
        </>
      }
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-ink/8 bg-bone px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/55">
              {log.displayId}
            </span>
            <span className="text-lg text-ink">{log.userName}</span>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusPillClass(log.reviewed ? 'REVIEWED' : 'PENDING')}`}>
              {log.reviewed ? 'Reviewed' : 'Needs review'}
            </span>
          </div>
          <p className="mt-2 text-sm leading-7 text-ink/66">
            {log.userEmail ?? 'No email on file'}{log.userRole ? ` · ${log.userRole}` : ''} · attempt {log.attempt}
          </p>
        </div>
        <form action="/ops/action" method="post">
          <input type="hidden" name="kind" value="bypass-review" />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="logId" value={log.id} />
          <input type="hidden" name="reviewed" value={log.reviewed ? 'false' : 'true'} />
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone"
          >
            {log.reviewed ? 'Reopen' : 'Mark reviewed'}
          </button>
        </form>
      </div>

      <div className="mt-5">
        <DetailList
          items={[
            { label: 'Surface', value: log.surface },
            { label: 'Created', value: formatDateTime(log.createdAt) },
            { label: 'Reviewed at', value: formatDateTime(log.reviewedAt) },
          ]}
        />
      </div>

      <div className="mt-5 rounded-[8px] border border-ink/6 bg-bone/56 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Blocked content</p>
        <p className="mt-2 whitespace-pre-wrap break-words font-mono text-sm leading-7 text-ink/78">{log.content}</p>
      </div>

      <IssueHistoryBlock history={log.history} />
    </CardCollapse>
  )
}

function ApplicationCard({
  application,
  redirectTo,
}: {
  application: OpsTailorApplication
  redirectTo: string
}): React.JSX.Element {
  return (
    <CardCollapse
      background="bg-white/86"
      summary={
        <>
          <StatusChip status={application.status} className={`shrink-0 ${statusPillClass(application.status)}`} />
          <span className="font-semibold text-ink">{application.businessName}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink/48">{application.displayName} · {application.location}</span>
          <span className="shrink-0 text-xs text-ink/38">{formatRelativeTime(application.createdAt)}</span>
        </>
      }
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-ink/8 bg-bone px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/55">
              {application.displayId}
            </span>
            <span className="text-lg text-ink">{application.businessName}</span>
            <StatusChip status={application.status} className={statusPillClass(application.status)} />
          </div>
          <p className="mt-2 text-sm leading-7 text-ink/66">
            {application.displayName} · {application.email}
          </p>
        </div>
        <a
          href={`mailto:${application.email}?subject=${encodeURIComponent(`Drapeon tailor application: ${application.businessName}`)}`}
          className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone"
        >
          Email applicant
        </a>
      </div>

      <div className="mt-5">
        <DetailList
          items={[
            { label: 'Location', value: application.location },
            { label: 'Specialty', value: application.specialty },
            { label: 'Source', value: application.source },
            { label: 'Submitted', value: formatDateTime(application.createdAt) },
          ]}
        />
      </div>

      <div className="mt-5 rounded-[8px] border border-ink/6 bg-white/82 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Notes</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink/78">{application.notes}</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        {application.portfolioUrl ? (
          <a
            href={application.portfolioUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-full border border-needle/12 bg-needle/8 px-4 py-2 text-sm font-semibold text-needle hover:bg-needle/12"
          >
            Portfolio
          </a>
        ) : null}
        {application.instagramUrl ? (
          <a
            href={application.instagramUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-full border border-needle/12 bg-needle/8 px-4 py-2 text-sm font-semibold text-needle hover:bg-needle/12"
          >
            Social proof
          </a>
        ) : null}
      </div>

      <div className="mt-5 border-t border-ink/8 pt-5">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/38">Actions</p>
        <form action="/ops/action" method="post" className="flex flex-col gap-3 rounded-[8px] border border-ink/6 bg-white/82 p-4 sm:flex-row sm:items-end">
          <input type="hidden" name="kind" value="application-status" />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="applicationId" value={application.id} />
          <label className="grid gap-2 text-sm text-ink/70">
            Application status
            <select
              name="status"
              defaultValue={application.status}
              className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40"
            >
              <option value="PENDING">Pending</option>
              <option value="REVIEWING">Reviewing</option>
              <option value="CONTACTED">Contacted</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </label>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90"
          >
            Save application
          </button>
        </form>
      </div>

      <IssueHistoryBlock history={application.history} />
    </CardCollapse>
  )
}

function EvidenceMediaTile({
  url,
  label,
}: {
  url: string
  label: string
}): React.JSX.Element {
  const video = isVideoMediaUrl(url)

  if (video) {
    return (
      <div className="overflow-hidden rounded-lg border border-ink/8 bg-white transition hover:border-needle/28 hover:bg-bone/55">
        <div className="relative aspect-[4/3] bg-ink">
          <video
            src={videoPosterFrameUrl(url)}
            controls
            muted
            playsInline
            preload="metadata"
            aria-label={label}
            className="h-full w-full bg-ink object-cover"
          />
          <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-ink/72 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
            Video
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="min-w-0 truncate text-xs font-semibold text-ink/56">{label}</span>
          <a href={url} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-semibold text-needle hover:text-needle/80">
            Open
          </a>
        </div>
      </div>
    )
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group block overflow-hidden rounded-lg border border-ink/8 bg-white transition hover:border-needle/28 hover:bg-bone/55"
    >
      <div className="relative aspect-[4/3] bg-bone">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={label} className="h-full w-full object-cover" />
        <span className="absolute left-2 top-2 rounded-full bg-ink/72 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
          Photo
        </span>
      </div>
      <span className="block truncate px-3 py-2 text-xs font-semibold text-ink/56 group-hover:text-needle">{label}</span>
    </a>
  )
}

function VerificationProofItemEvidence({
  item,
}: {
  item: OpsVerification['proofItems'][number]
}): React.JSX.Element {
  const mediaUrls = item.mediaUrls.slice(0, 6)

  return (
    <div className="border-t border-ink/8 py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-base font-semibold text-ink">{item.title}</p>
          <p className="mt-1 text-sm text-ink/56">{item.category ?? 'Uncategorized'} / {item.isLive ? 'Live listing' : 'Hidden proof item'}</p>
        </div>
        <span className="inline-flex w-fit rounded-full border border-needle/14 bg-needle/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-needle">
          {item.stockStatus ?? 'Hidden'}
        </span>
      </div>
      {item.description ? <p className="mt-3 text-sm leading-7 text-ink/66">{item.description}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-ink/52">
        <span className="rounded-full bg-bone px-3 py-1">Sizes: {item.sizes.length > 0 ? item.sizes.join(', ') : 'None'}</span>
        <span className="rounded-full bg-bone px-3 py-1">Stock units: {item.inventoryQuantity}</span>
        <span className="rounded-full bg-bone px-3 py-1">Updated {formatRelativeTime(item.updatedAt)}</span>
      </div>
      {mediaUrls.length > 0 ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {mediaUrls.map((url, index) => (
            <EvidenceMediaTile key={item.id + '-' + url + '-' + index} url={url} label={'Proof media ' + (index + 1)} />
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-lg border border-rust/14 bg-rust/8 px-4 py-3 text-sm font-semibold text-rust-700">No proof item media attached.</p>
      )}
    </div>
  )
}

function VerificationEvidencePanel({
  profile,
}: {
  profile: OpsVerification
}): React.JSX.Element {
  const portfolioMedia = [
    ...profile.portfolioPhotoUrls.map((url, index) => ({ url, label: 'Portfolio photo ' + (index + 1) })),
    ...profile.portfolioVideoUrls.map((url, index) => ({ url, label: 'Portfolio video ' + (index + 1) })),
  ]
  const evidence = profile.evidenceSummary

  return (
    <div className="mt-5 border-t border-ink/8 pt-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/38">Review evidence</p>
          <p className="mt-1 text-sm leading-6 text-ink/58">
            {evidence.readyCount}/4 evidence checks ready. Use this as the approval checklist before moving the tailor live.
          </p>
        </div>
        {evidence.missingLabels.length > 0 ? (
          <span className="inline-flex w-fit rounded-full border border-rust/14 bg-rust/8 px-3 py-1 text-xs font-semibold text-rust-700">
            Missing: {evidence.missingLabels.join(', ')}
          </span>
        ) : (
          <span className="inline-flex w-fit rounded-full border border-needle/14 bg-needle/8 px-3 py-1 text-xs font-semibold text-needle">Evidence complete</span>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {evidence.checklist.map((item) => (
          <div key={item.key} className="rounded-lg border border-ink/8 bg-bone/48 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink">{item.label}</p>
              <span className={item.ready ? 'rounded-full bg-needle/12 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-needle' : 'rounded-full bg-rust/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-rust-700'}>
                {item.ready ? 'Ready' : 'Missing'}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-ink/50">{item.detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Portfolio media</p>
          <span className="text-xs font-semibold text-ink/42">{evidence.portfolioMediaCount} items</span>
        </div>
        {portfolioMedia.length > 0 ? (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {portfolioMedia.map((media, index) => (
              <EvidenceMediaTile key={media.url + '-' + index} url={media.url} label={media.label} />
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-rust/14 bg-rust/8 px-4 py-3 text-sm font-semibold text-rust-700">No portfolio media available for review.</p>
        )}
      </div>

      <div className="mt-5 rounded-[8px] border border-ink/8 bg-white/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Onboarding proof item</p>
          <span className="text-xs font-semibold text-ink/42">{evidence.proofItemCount} items / {evidence.proofItemMediaCount} media</span>
        </div>
        {profile.proofItems.length > 0 ? (
          <div className="mt-4">
            {profile.proofItems.map((item) => (
              <VerificationProofItemEvidence key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-rust/14 bg-rust/8 px-4 py-3 text-sm font-semibold text-rust-700">No hidden proof item has been captured yet.</p>
        )}
      </div>
    </div>
  )
}

function VerificationCard({
  profile,
  redirectTo,
}: {
  profile: OpsVerification
  redirectTo: string
}): React.JSX.Element {
  return (
    <CardCollapse
      background="bg-white/86"
      summary={
        <>
          <StatusChip status={profile.status} className={`shrink-0 ${statusPillClass(profile.status)}`} />
          <span className="font-semibold text-ink">{profile.displayName}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink/48">{profile.email ?? 'No email'}{profile.location ? ` · ${profile.location}` : ''}</span>
          <span className="shrink-0 text-xs text-ink/38">{formatRelativeTime(profile.createdAt)}</span>
        </>
      }
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-ink/8 bg-bone px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/55">
              {profile.displayId}
            </span>
            <span className="text-lg text-ink">{profile.displayName}</span>
            <StatusChip status={profile.status} className={statusPillClass(profile.status)} />
          </div>
          <p className="mt-2 text-sm leading-7 text-ink/66">{profile.email ?? 'No email on file'}</p>
        </div>
        <a
          href={`mailto:${CONTACTS.verify}?subject=${encodeURIComponent(`Verification review: ${profile.displayName}`)}`}
          className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone"
        >
          Email verification
        </a>
      </div>

      <div className="mt-5 grid gap-5">
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Profile</p>
          <DetailList
            items={[
              { label: 'Location', value: profile.location },
              { label: 'Specialties', value: profile.specialtyTags.length > 0 ? profile.specialtyTags.join(', ') : '—' },
              { label: 'Challenge', value: profile.trustChallengeText ?? 'Not captured' },
            ]}
          />
        </div>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Payout &amp; timeline</p>
          <DetailList
            items={[
              { label: 'Payout path', value: profile.payoutProvider ? `${profile.payoutProvider} · ${profile.payoutCurrency ?? '—'}` : 'Not set up yet' },
              { label: 'Payout verified', value: profile.payoutAccountVerified ? 'Yes' : 'No' },
              { label: 'Submitted', value: formatDateTime(profile.idVerificationSubmittedAt ?? profile.createdAt) },
              { label: 'Last updated', value: formatDateTime(profile.updatedAt) },
            ]}
          />
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-[8px] border border-ink/6 bg-bone/56 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Public avatar</p>
          {profile.avatarUrl ? (
            <a href={profile.avatarUrl} target="_blank" rel="noreferrer" className="mt-3 block overflow-hidden rounded-lg border border-ink/8 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={profile.avatarUrl} alt="Public avatar" className="aspect-square w-full object-cover" />
            </a>
          ) : (
            <div className="mt-3 flex aspect-square items-center justify-center rounded-lg border border-ink/8 bg-white px-4 text-center text-sm font-semibold text-ink/42">
              No public avatar
            </div>
          )}
          {profile.avatarUrl ? (
            <a href={profile.avatarUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-semibold text-needle">
              Open public avatar
            </a>
          ) : null}
        </div>
        <div className="rounded-[8px] border border-ink/6 bg-bone/56 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Private challenge video</p>
          <p className="mt-3 text-sm leading-7 text-ink/66">
            Private evidence remains behind a short-lived signed Supabase Storage URL. Drapeon does not collect a government ID.
          </p>
          {profile.trustVideoUrl ? (
            <a
              href={profile.trustVideoUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center rounded-full bg-needle px-4 py-2 text-sm font-semibold text-white transition hover:bg-needle/90"
            >
              Open challenge video
            </a>
          ) : (
            <p className="mt-3 text-sm font-semibold text-rust-700">Signed challenge-video link unavailable</p>
          )}
        </div>
      </div>

      <VerificationEvidencePanel profile={profile} />

      <div className="mt-5 border-t border-ink/8 pt-5">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/38">Actions</p>
        <form action="/ops/action" method="post" className="flex flex-col gap-3 rounded-[8px] border border-ink/6 bg-white/82 p-4">
        <input type="hidden" name="kind" value="verification-decision" />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <input type="hidden" name="tailorUserId" value={profile.userId} />
        <div className="grid gap-3 md:grid-cols-[0.85fr_1.15fr]">
          <label className="grid gap-2 text-sm text-ink/72">
            Rejection code
            <select
              name="rejectionCode"
              defaultValue=""
              className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40"
            >
              <option value="">General trust-video issue</option>
              <option value="INVALID_PROFILE_IMAGE">Invalid profile image</option>
            </select>
            <span className="text-xs leading-5 text-ink/46">Use profile-image only when the challenge video is usable but the public avatar is not.</span>
          </label>
          <label className="grid gap-2 text-sm text-ink/72">
            Trust note / rejection reason
            <textarea
              name="reason"
              rows={3}
              placeholder="Add what you verified, or explain exactly what needs resubmission before rejecting."
              className="min-h-[104px] rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40"
            />
          </label>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="submit"
            name="decision"
            value="APPROVE"
            formNoValidate
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90"
          >
            Approve and go live
          </button>
          <button
            type="submit"
            name="decision"
            value="REJECT"
            className="inline-flex items-center justify-center rounded-full border border-rust/18 bg-rust/8 px-5 py-3 text-sm font-semibold text-rust-700 transition hover:bg-rust/12"
          >
            Reject verification
          </button>
        </div>
        </form>
      </div>

      <IssueHistoryBlock history={profile.history} />
    </CardCollapse>
  )
}

function DeletionRequestCard({
  request,
  redirectTo,
}: {
  request: OpsAccountDeletionRequest
  redirectTo: string
}): React.JSX.Element {
  return (
    <CardCollapse
      background="bg-white/86"
      summary={
        <>
          <StatusChip status={request.status} className={`shrink-0 ${statusPillClass(request.status)}`} />
          <span className="font-semibold text-ink">{request.displayName}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink/48">{request.role}</span>
          <span className="shrink-0 text-xs text-ink/38">{formatRelativeTime(request.requestedAt)}</span>
        </>
      }
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-ink/8 bg-bone px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/55">
              {request.displayId}
            </span>
            <span className="text-lg text-ink">{request.displayName}</span>
            <StatusChip status={request.status} className={statusPillClass(request.status)} />
          </div>
          <p className="mt-2 text-sm leading-7 text-ink/66">
            {request.email ?? 'No email on file'} · {request.role}
          </p>
        </div>
        <a
          href={`mailto:${CONTACTS.privacy}?subject=${encodeURIComponent(`Account deletion request: ${request.displayName}`)}`}
          className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone"
        >
          Email privacy
        </a>
      </div>

      <div className="mt-5">
        <DetailList
          items={[
            { label: 'Requested', value: formatDateTime(request.requestedAt) },
            { label: 'Acknowledged', value: formatDateTime(request.acknowledgedAt) },
            { label: 'Processed', value: formatDateTime(request.processedAt) },
            { label: 'Source', value: request.source ?? '—' },
          ]}
        />
      </div>

      <div className="mt-5 rounded-[8px] border border-ink/6 bg-white/82 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Reason</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink/78">
          {request.reason?.trim() ? request.reason : 'No deletion note was provided in-app.'}
        </p>
      </div>

      <div className="mt-5 border-t border-ink/8 pt-5">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/38">Actions</p>
        <form action="/ops/action" method="post" className="flex flex-col gap-3 rounded-[8px] border border-ink/6 bg-white/82 p-4 sm:flex-row sm:items-end">
          <input type="hidden" name="kind" value="deletion-status" />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="deletionRequestId" value={request.id} />
          <label className="grid gap-2 text-sm text-ink/70">
            Deletion status
            <select
              name="status"
              defaultValue={request.status}
              className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40"
            >
              <option value="PENDING">Pending</option>
              <option value="ACKNOWLEDGED">Acknowledged</option>
              <option value="COMPLETED">Completed</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </label>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90"
          >
            Save deletion status
          </button>
        </form>
      </div>

      <IssueHistoryBlock history={request.history} />
    </CardCollapse>
  )
}

function PayoutCard({ payout }: { payout: OpsPayout }): React.JSX.Element {
  const deliveryState = derivePayoutDeliveryState({
    provider: payout.provider,
    status: payout.status,
    providerTransferStatus: payout.providerTransferStatus,
    bankSettlementStatus: payout.bankSettlementStatus,
  })
  const deliveryLabel = payoutDeliveryLabel(deliveryState)
  const deliveryExplanation = payoutDeliveryExplanation(deliveryState, payout.provider)
  const canRetryRelease =
    !!payout.orderId && ['BLOCKED', 'FAILED', 'PENDING'].includes(payout.status.toUpperCase())
  const releaseLabel = releaseWindowLabel(payout)
  const isBlockedOrFailed = ['BLOCKED', 'FAILED'].includes(payout.status.toUpperCase())
  const isTestPayout = !!(
    payout.providerPayoutId?.startsWith('py_test_') ||
    payout.providerPayoutId?.startsWith('po_test_') ||
    payout.orderReference?.startsWith('test-') ||
    (payout.paymentProvider === 'STRIPE' && payout.providerPayoutId?.includes('test'))
  )

  return (
    <CardCollapse
      background="bg-white/86"
      summary={
        <>
          <StatusChip status={deliveryLabel} className={`shrink-0 ${statusPillClass(payout.status)}`} />
          <span className="font-semibold text-ink">{payout.tailorDisplayName}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink/48">{formatMoney(payout.amount, payout.currency)}{payout.provider ? ` · ${payout.provider}` : ''}</span>
          {isBlockedOrFailed ? <span className="shrink-0 text-xs font-semibold text-rust-700">Blocked</span> : null}
          <span className="shrink-0 text-xs text-ink/38">{formatRelativeTime(payout.initiatedAt)}</span>
        </>
      }
    >
      {isTestPayout ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-ink/8 bg-bone px-3 py-2 text-xs font-semibold text-ink/50">
          <span className="inline-block size-2 rounded-full bg-ink/20" />
          Test / QA payout — not a live transaction
        </div>
      ) : null}

      {isBlockedOrFailed ? (
        <div className="mb-5 rounded-[8px] border border-rust/16 bg-rust/7 p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rust-700/72">What</p>
              <p className="mt-1 text-sm font-semibold text-ink">Payout {formatDatabaseEnumLabel(payout.status).toLowerCase()}</p>
              <p className="mt-0.5 text-xs text-ink/56">{formatMoney(payout.amount, payout.currency)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rust-700/72">Why blocked</p>
              <p className="mt-1 text-sm text-ink">{payout.blockedReasonMessage ?? formatDatabaseEnumLabel(payout.blockedReason, 'No reason on record')}</p>
            </div>
          </div>
          <div className="mt-3 grid gap-3 border-t border-rust/14 pt-3 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rust-700/72">Who is waiting</p>
              <p className="mt-1 text-sm text-ink">{payout.tailorDisplayName}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rust-700/72">Next action</p>
              <p className="mt-1 text-sm text-ink">{canRetryRelease ? 'Verify escrow, confirmation, and dispute state — then retry in Actions below.' : 'Contact payouts team — retry conditions not yet met.'}</p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg text-ink">{payout.tailorDisplayName}</span>
            <StatusChip status={deliveryLabel} className={statusPillClass(payout.status)} />
            <span className="inline-flex rounded-full border border-ink/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-ink/70">
              {payout.provider}
            </span>
          </div>
          <p className="mt-2 text-sm leading-7 text-ink/66">
            {payout.tailorEmail ?? 'No email on file'}
          </p>
          <p className="mt-1 text-sm leading-7 text-ink/62">
            {payout.orderReference ? `Order #${payout.orderReference}` : payout.orderId ?? 'No linked order'} · {releaseLabel}
          </p>
        </div>
        <a
          href={`mailto:${CONTACTS.payouts}?subject=${encodeURIComponent(`Payout review: ${payout.orderReference ?? payout.id}`)}`}
          className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone"
        >
          Email payouts
        </a>
      </div>

      <div className="mt-5 grid gap-5">
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Money breakdown</p>
          <DetailList
            items={[
              { label: 'Payout amount', value: formatMoney(payout.amount, payout.currency) },
              { label: 'Order total', value: formatMoney(payout.orderTotalAmount, payout.orderCurrency) },
              { label: 'Tailor earning', value: formatMoney(payout.sourceAmount, payout.sourceCurrency) },
              { label: 'Platform fee', value: formatMoney(payout.platformFeeAmount, payout.orderCurrency) },
              { label: 'Tax collected', value: formatMoney(payout.taxAmount, payout.orderCurrency) },
              { label: 'Fulfillment fee', value: formatMoney(payout.shippingAmount, payout.orderCurrency) },
              { label: 'Captured', value: formatMoney(payout.capturedAmount, payout.orderCurrency) },
              { label: 'Already refunded', value: formatMoney(payout.alreadyRefundedAmount, payout.orderCurrency) },
              { label: 'Refundable remaining', value: formatMoney(payout.maxRefundableAmount, payout.orderCurrency) },
            ]}
          />
        </div>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Order &amp; payment</p>
          <DetailList
            items={[
              { label: 'Order', value: payout.orderReference ? `#${payout.orderReference}` : payout.orderId ?? '—' },
              { label: 'Stage', value: formatDatabaseEnumLabel(payout.orderStage, '—') },
              { label: 'Kind', value: formatDatabaseEnumLabel(payout.orderKind, '—') },
              { label: 'Payment', value: payout.paymentProvider ? `${payout.paymentProvider} · ${payout.paymentStatus ?? '—'}` : payout.paymentStatus ?? '—' },
              { label: 'Delivery status', value: deliveryLabel },
              { label: 'What this means', value: deliveryExplanation },
              { label: 'Provider transfer', value: formatDatabaseEnumLabel(payout.providerTransferStatus, '—') },
              { label: 'Bank settlement', value: formatDatabaseEnumLabel(payout.bankSettlementStatus, '—') },
              { label: 'Escrow released', value: payout.escrowReleased ? 'Yes' : 'No' },
              { label: 'Provider ID', value: payout.providerPayoutId ?? '—' },
              { label: 'Bank payout ID', value: payout.providerBankPayoutId ?? '—' },
              { label: 'Blocked reason', value: payout.blockedReasonMessage ?? formatDatabaseEnumLabel(payout.blockedReason, '—') },
            ]}
          />
        </div>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Release timeline</p>
          <DetailList
            items={[
              { label: 'Handoff complete', value: formatDateTime(payout.handoffCompletedAt) },
              { label: 'Customer confirmed', value: formatDateTime(payout.customerHandoffConfirmedAt) },
              { label: 'Confirmation source', value: formatDatabaseEnumLabel(payout.handoffConfirmationSource, '—') },
              { label: 'Release window', value: payout.payoutReadyAt ? `${formatDateTime(payout.payoutReadyAt)} · ${releaseLabel}` : releaseLabel },
              { label: 'Initiated', value: formatDateTime(payout.initiatedAt) },
              { label: 'Expected at bank', value: formatDateTime(payout.bankSettlementExpectedAt) },
              { label: 'Confirmed at bank', value: formatDateTime(payout.bankSettlementCompletedAt) },
              { label: 'Processed', value: formatDateTime(payout.processedAt) },
              { label: 'Completed', value: formatDateTime(payout.completedAt) },
              { label: 'Failed', value: formatDateTime(payout.failedAt) },
            ]}
          />
        </div>
      </div>

      {canRetryRelease ? (
        <div className="mt-5 border-t border-ink/8 pt-5">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/38">Actions</p>
          <form action="/ops/action" method="post" className="flex flex-col gap-3 rounded-[8px] border border-rust/12 bg-rust/6 p-4 sm:flex-row sm:items-center">
            <input type="hidden" name="kind" value="payout-release" />
            <input type="hidden" name="redirectTo" value={buildOpsRedirectTarget('payouts', 'payouts')} />
            <input type="hidden" name="orderId" value={payout.orderId ?? ''} />
            <div className="flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rust-700">Retry payout release</p>
              <p className="mt-2 text-sm leading-7 text-ink/68">
                Irreversible once triggered. Verify escrow release, customer handoff confirmation, 72-hour window, dispute state, payment capture, and payout account before proceeding.
              </p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-rust-700/62">
                Order {payout.orderReference ? `#${payout.orderReference}` : payout.orderId} · {formatMoney(payout.amount, payout.currency)} · {payout.tailorDisplayName}
              </p>
            </div>
            <button
              type="submit"
              className="inline-flex shrink-0 items-center justify-center rounded-full bg-rust px-5 py-3 text-sm font-semibold text-white transition hover:bg-rust/90"
            >
              Retry payout release
            </button>
          </form>
        </div>
      ) : null}
    </CardCollapse>
  )
}

function ShopItemCard({
  item,
  redirectTo,
}: {
  item: OpsShopItem
  redirectTo: string
}): React.JSX.Element {
  const canRestore = !item.isLive || item.stockStatus === 'HIDDEN'
  const imageUrl = item.photoUrls.find((url) => !isVideoMediaUrl(url)) ?? null

  return (
    <CardCollapse
      background="bg-white/86"
      summary={
        <>
          <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${statusPillClass(item.isLive ? item.stockStatus : 'REJECTED')}`}>
            {item.isLive ? formatDatabaseEnumLabel(item.stockStatus) : 'Hidden'}
          </span>
          <span className="font-semibold text-ink">{item.title}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink/48">{item.tailorDisplayName} · {formatMoney(item.priceAmount, item.currency)}</span>
          {item.riskLabels.length > 0 ? <span className="shrink-0 rounded-full border border-rust/14 bg-rust/8 px-2 py-0.5 text-[11px] font-semibold text-rust-700">{item.riskLabels.length} risk</span> : null}
          <span className="shrink-0 text-xs text-ink/38">{formatRelativeTime(item.createdAt)}</span>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-[8px] border border-ink/8 bg-bone">
          {imageUrl ? (
            <a href={imageUrl} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="" className="aspect-[4/3] w-full object-cover" />
            </a>
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center px-4 text-center text-sm font-semibold text-ink/42">
              No product photo
            </div>
          )}
        </div>

        <div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg text-ink">{item.title}</span>
                <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusPillClass(item.isLive ? item.stockStatus : 'REJECTED')}`}>
                  {item.isLive ? formatDatabaseEnumLabel(item.stockStatus) : 'Hidden'}
                </span>
              </div>
              <p className="mt-2 text-sm leading-7 text-ink/66">
                {item.tailorDisplayName}{item.tailorEmail ? ` · ${item.tailorEmail}` : ''} · {formatMoney(item.priceAmount, item.currency)}
              </p>
            </div>
            <a
              href={sectionMailto(`Ready-made listing review: ${item.title}`)}
              className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone"
            >
              Email ops
            </a>
          </div>

          <div className="mt-5">
            <DetailList
              items={[
                { label: 'Category', value: item.category ?? '—' },
                { label: 'Inventory', value: String(item.inventoryQuantity) },
                { label: 'Sizes', value: item.sizes.length > 0 ? item.sizes.join(', ') : '—' },
                { label: 'Size stock', value: item.sizeInventoryLabel },
                { label: 'Fulfillment', value: item.fulfillment.length > 0 ? item.fulfillment.join(', ') : '—' },
                { label: 'Photos', value: String(item.photoUrls.length) },
                { label: 'Created', value: formatDateTime(item.createdAt) },
                { label: 'Updated', value: formatDateTime(item.updatedAt) },
              ]}
            />
          </div>

          {item.riskLabels.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {item.riskLabels.map((risk) => (
                <span
                  key={risk}
                  className="rounded-full border border-rust/14 bg-rust/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-rust-700"
                >
                  {risk}
                </span>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-needle/12 bg-needle/8 px-4 py-3 text-sm leading-6 text-needle-700">
              This listing has photos, stock, and at least one fulfillment path.
            </div>
          )}

          <form action="/ops/action" method="post" className="mt-5 grid gap-3 rounded-[8px] border border-ink/6 bg-white/82 p-4">
            <input type="hidden" name="kind" value="seller-item-visibility" />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input type="hidden" name="itemId" value={item.id} />
            <label className="grid gap-2 text-sm text-ink/70">
              Ops note
              <input
                name="note"
                placeholder="Why this listing is being changed"
                className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                name="visibilityAction"
                value="HIDE"
                className="inline-flex items-center justify-center rounded-full border border-rust/18 bg-rust/8 px-5 py-3 text-sm font-semibold text-rust-700 transition hover:bg-rust/12"
              >
                Hide from buyers
              </button>
              {canRestore ? (
                <button
                  type="submit"
                  name="visibilityAction"
                  value="RESTORE"
                  className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90"
                >
                  Restore listing
                </button>
              ) : null}
            </div>
          </form>
        </div>
      </div>
    </CardCollapse>
  )
}

function SupportThreadCard({
  thread,
  redirectTo,
}: {
  thread: OpsSupportThread
  redirectTo: string
}): React.JSX.Element {
  const closedThread = isClosedConversationStage(thread.orderStage)

  return (
    <CardCollapse
      background="bg-white/86"
      summary={
        <>
          <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${statusPillClass(thread.conversationBlocked ? 'ESCALATED' : thread.orderStage ?? 'OPEN')}`}>
            {thread.conversationBlocked ? 'Paused' : formatDatabaseEnumLabel(thread.orderStage, 'Open')}
          </span>
          {thread.unreadCount > 0 ? <span className="shrink-0 rounded-full border border-rust/16 bg-rust/8 px-2 py-0.5 text-[11px] font-semibold text-rust-700">{thread.unreadCount} unread</span> : null}
          <span className="font-semibold text-ink">{thread.orderReference ? `Order #${thread.orderReference}` : `Order ${thread.orderId.slice(0, 8)}`}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink/48">from {thread.latestSenderName}</span>
          <span className="shrink-0 text-xs text-ink/38">{formatRelativeTime(thread.latestMessageAt)}</span>
        </>
      }
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg text-ink">{thread.orderReference ? `Order #${thread.orderReference}` : `Order ${thread.orderId.slice(0, 8)}`}</span>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusPillClass(thread.conversationBlocked ? 'ESCALATED' : thread.orderStage ?? 'OPEN')}`}>
              {thread.conversationBlocked ? 'Paused' : formatDatabaseEnumLabel(thread.orderStage, 'Open')}
            </span>
            {thread.unreadCount > 0 ? (
              <span className="inline-flex rounded-full border border-rust/16 bg-rust/8 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-rust-700">
                {thread.unreadCount} unread
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm leading-7 text-ink/66">
            Latest from {thread.latestSenderName} · {thread.latestSenderRole} · {formatRelativeTime(thread.latestMessageAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {thread.customerEmail ? (
            <a
              href={`mailto:${thread.customerEmail}?subject=${encodeURIComponent(`Drapeon order ${thread.orderReference ?? thread.orderId} support`)}`}
              className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone"
            >
              Email customer
            </a>
          ) : null}
          {thread.tailorEmail ? (
            <a
              href={`mailto:${thread.tailorEmail}?subject=${encodeURIComponent(`Drapeon order ${thread.orderReference ?? thread.orderId} support`)}`}
              className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone"
            >
              Email tailor
            </a>
          ) : null}
        </div>
      </div>

      <div className="mt-5 rounded-[8px] border border-ink/6 bg-bone/56 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Latest message</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-ink/78">{thread.latestMessagePreview}</p>
      </div>

      <div className="mt-5 grid gap-5">
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Parties</p>
          <DetailList
            items={[
              { label: 'Customer', value: thread.customerEmail ? `${thread.customerName} · ${thread.customerEmail}` : thread.customerName },
              { label: 'Tailor', value: thread.tailorEmail ? `${thread.tailorName} · ${thread.tailorEmail}` : thread.tailorName },
            ]}
          />
        </div>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Order</p>
          <DetailList
            items={[
              { label: 'Kind', value: formatDatabaseEnumLabel(thread.orderKind, '—') },
              { label: 'Stage', value: formatDatabaseEnumLabel(thread.orderStage, '—') },
              { label: 'Delivery', value: formatDatabaseEnumLabel(thread.deliveryMethod, '—') },
              { label: 'Payment', value: thread.paymentProvider ? `${thread.paymentStatus ?? '—'} · ${thread.paymentProvider}` : thread.paymentStatus ?? '—' },
            ]}
          />
        </div>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Conversation</p>
          <DetailList
            items={[
              { label: 'Messages', value: String(thread.messageCount) },
              { label: 'Media', value: String(thread.mediaCount) },
              { label: 'Last message', value: formatDateTime(thread.latestMessageAt) },
              { label: 'Paused', value: thread.conversationBlocked ? `Yes · ${formatDateTime(thread.blockedAt)}` : 'No' },
              { label: 'Paused by', value: thread.blockedByRole ?? '—' },
            ]}
          />
        </div>
      </div>

      {closedThread ? (
        <div className="mt-5 rounded-[8px] border border-ink/6 bg-bone/56 p-4 text-sm leading-7 text-ink/64">
          This order thread is closed in the app. Use the email links above for aftercare or account support instead of changing conversation access.
        </div>
      ) : (
        <form action="/ops/action" method="post" className="mt-5 grid gap-3 rounded-[8px] border border-ink/6 bg-white/82 p-4">
          <input type="hidden" name="kind" value="conversation-access" />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="orderId" value={thread.orderId} />
          <label className="grid gap-2 text-sm text-ink/70">
            Safety note
            <input
              name="reason"
              placeholder={thread.conversationBlocked ? 'Why this conversation can reopen safely' : 'Why support is pausing this conversation'}
              className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              name="accessAction"
              value={thread.conversationBlocked ? 'UNBLOCK' : 'BLOCK'}
              className={
                thread.conversationBlocked
                  ? 'inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90'
                  : 'inline-flex items-center justify-center rounded-full border border-rust/18 bg-rust/8 px-5 py-3 text-sm font-semibold text-rust-700 transition hover:bg-rust/12'
              }
            >
              {thread.conversationBlocked ? 'Reopen conversation' : 'Pause conversation'}
            </button>
          </div>
        </form>
      )}
    </CardCollapse>
  )
}

function WorkflowIssueCard({
  issue,
  redirectTo,
  role,
  defaultOpen = false,
  returnTo = null,
}: {
  issue: OpsWorkflowIssue
  redirectTo: string
  role: OpsRole
  defaultOpen?: boolean
  returnTo?: string | null
}): React.JSX.Element {
  const issueOpen = issue.status !== 'RESOLVED'
  const issueLabel = issue.consultationAttendance
    ? 'Consultation attendance review'
    : workflowIssueLabel(issue.event)
  const recommendedAction = issue.consultationAttendance
    ? 'Compare both accounts with the call activity record, then choose reschedule, customer refund, or verified tailor earning.'
    : issue.recommendedAction
  const canManageConversation =
    issueOpen
    &&
    (issue.issueType === 'CONVERSATION_SAFETY' || issue.event === 'conversation.safety_reported')
    && !!issue.orderId
  const canUpdateIssueStatus = issue.source !== 'audit_logs' && !issue.materialReconciliationOutcome && !issue.consultationAttendance
  const canResolveConsultationAttendance =
    issueOpen
    && issue.consultationAttendance?.reviewStatus === 'OPS_REVIEW'
    && getOpsRoleActions(role).includes('consultation-attendance-resolution')
  const canResolveBlockedPayout = issueOpen && issue.issueType === 'PAYOUT_BLOCKED' && !!issue.orderId && issue.orderStage !== 'IN_DISPUTE'
  const canPartialRefund =
    issueOpen
    &&
    !!issue.orderId
    && issue.orderStage === 'IN_DISPUTE'
    && issue.maxRefundableAmount > 0
    && !issue.financialCaseId
    && getOpsRoleActions(role).includes('order-partial-refund')
    && ['AFTERCARE_REQUEST', 'ORDER_REVIEW', 'DELIVERY_REVIEW', 'PAYMENT_BLOCKED', 'PAYOUT_BLOCKED', 'PRODUCTION_STALL'].includes(issue.issueType)
  const canReviewCompletedPartialRefund =
    !!issue.orderId
    && issue.refundResolution?.status === 'SUCCEEDED'
    && issue.refundResolution.orderOutcome === 'KEEP_UNDER_REVIEW'
    && !!issue.refundResolution.outcomeAppliedAt
    && !issue.refundResolution.reviewedOutcomeAppliedAt
    && getOpsRoleActions(role).includes('reviewed-partial-refund-outcome')
  const canReleaseMaterialAdvance =
    issueOpen
    && !!issue.materialAdvanceId
    && !issue.materialReconciliationOutcome
    && getOpsRoleActions(role).includes('material-advance-release')
  const canPrepareUnusedMaterialRefund =
    issueOpen
    && issue.materialReconciliationOutcome === 'UNUSED_VALUE'
    && !!issue.materialAdvanceId
    && !!issue.orderId
    && issue.orderStage !== 'IN_DISPUTE'
    && issue.materialCustomerRefundAmount > 0
    && getOpsRoleActions(role).includes('money-desk-request')
  const canResolveMaterialOverage =
    issueOpen
    && issue.materialReconciliationOutcome === 'OVERAGE'
    && !!issue.materialAdvanceId
    && issue.materialUnapprovedOverageAmount > 0
    && getOpsRoleActions(role).includes('material-overage-resolution')
  const canDecideProfileChange =
    issueOpen
    && issue.relatedEntityType === 'profile_change_request'
    && !!issue.relatedEntityId
    && getOpsRoleActions(role).includes('profile-change-decision')
  const canDecidePayoutChange =
    issueOpen
    && issue.relatedEntityType === 'payout_change_request'
    && !!issue.relatedEntityId
    && issue.payoutChangeReview?.confirmationStatus === 'CONFIRMED'
    && issue.payoutChangeReview?.lifecycleState === 'OPS_REVIEW'
    && getOpsRoleActions(role).includes('payout-change-decision')
  const canPreparePayoutDestinationRecovery =
    issueOpen
    && issue.issueType === 'PAYOUT_FAILED'
    && !!issue.orderId
    && !!issue.payoutId
    && getOpsRoleActions(role).includes('money-desk-request')

  return (
    <CardCollapse
      id={`workflow-issue-${issue.id}`}
      background="bg-[linear-gradient(180deg,#fffdf9_0%,#f4eee3_100%)]"
      defaultOpen={defaultOpen}
      summary={
        <>
          <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${severityPillClass(issue.severity)}`}>
            {issue.severity}
          </span>
          <span className="font-semibold text-ink">{issueLabel}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink/48">{issue.summary}</span>
          {issue.consultationAttendance?.feeAmount != null && issue.consultationAttendance.feeCurrency ? (
            <span className="shrink-0 text-sm font-semibold text-rust-700/80">
              Fee {formatMoney(issue.consultationAttendance.feeAmount, issue.consultationAttendance.feeCurrency)}
            </span>
          ) : issue.maxRefundableAmount > 0 ? (
            <span className="shrink-0 text-sm font-semibold text-rust-700/80">{formatMoney(issue.maxRefundableAmount, issue.orderCurrency)}</span>
          ) : null}
          <span className="shrink-0 text-xs text-ink/38">{formatRelativeTime(issue.createdAt)}</span>
        </>
      }
    >
      {returnTo ? (
        <a href={returnTo} className="mb-4 inline-flex cursor-pointer items-center gap-2 rounded-full border border-needle/18 bg-white px-4 py-2.5 text-sm font-semibold text-needle-700 transition-colors duration-200 hover:bg-mint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle/60">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          Back to Money Desk review
        </a>
      ) : null}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-ink/8 bg-bone px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/55">
              {issue.displayId}
            </span>
            <span className="text-lg text-ink">{issueLabel}</span>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${severityPillClass(issue.severity)}`}>
              {formatDatabaseEnumLabel(issue.severity)}
            </span>
            <StatusChip status={issue.status} className={statusPillClass(issue.status)} />
          </div>
          <p className="mt-2 text-sm font-medium leading-7 text-ink/80">{issue.summary}</p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
            <span className="text-xs text-ink/52">
              <span className="font-semibold uppercase tracking-[0.14em] text-ink/34">Who</span>
              {'  '}{issue.actorName}{issue.actorRole ? ` · ${formatDatabaseEnumLabel(issue.actorRole).toLowerCase()}` : ''}
            </span>
            {issue.blockedReasonCode ? (
              <span className="text-xs text-rust-700/80">
                <span className="font-semibold uppercase tracking-[0.14em] text-rust-700/50">Blocked</span>
                {'  '}{formatDatabaseEnumLabel(issue.blockedReasonCode)}
              </span>
            ) : null}
            {issue.maxRefundableAmount > 0 ? (
              <span className="text-xs text-rust-700/80">
                <span className="font-semibold uppercase tracking-[0.14em] text-rust-700/50">At risk</span>
                {'  '}{formatMoney(issue.maxRefundableAmount, issue.orderCurrency)}
              </span>
            ) : null}
          </div>
        </div>
        <a
          href={sectionMailto(`Workflow issue: ${issue.orderReference ?? issue.orderId ?? issue.id}`)}
          className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone"
        >
          Email ops
        </a>
      </div>

      <div className="mt-4 rounded-[8px] border border-needle/14 bg-needle/7 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-needle/70">Next action</p>
        <p className="mt-1 text-sm leading-7 text-ink/76">{recommendedAction}</p>
      </div>

      <div className="mt-5 grid gap-5">
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Context</p>
          <DetailList
            items={[
              { label: 'Actor', value: issue.actorEmail ? `${issue.actorName} · ${issue.actorEmail}` : issue.actorName },
              { label: 'Role', value: issue.actorRole ?? 'SYSTEM' },
              { label: 'Created', value: formatDateTime(issue.createdAt) },
              { label: 'Source', value: issue.source ?? 'ops-issues' },
              { label: 'Order', value: issue.orderReference ? `#${issue.orderReference}` : issue.orderId ?? '—' },
              { label: 'Stage', value: issue.orderStage ?? '—' },
              { label: 'Provider', value: issue.provider ?? '—' },
            ]}
          />
        </div>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Money exposure</p>
          <DetailList
            items={[
              { label: 'Order total', value: formatMoney(issue.orderTotalAmount, issue.orderCurrency) },
              { label: 'Already refunded', value: formatMoney(issue.alreadyRefundedAmount, issue.orderCurrency) },
              { label: 'Refundable now', value: formatMoney(issue.maxRefundableAmount, issue.orderCurrency) },
            ]}
          />
        </div>
      </div>

      {issue.reason || issue.trackingNumber || issue.paymentStatus ? (
        <div className="mt-5">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Details</p>
          <DetailList
            items={[
              { label: 'Reason', value: formatDatabaseEnumLabel(issue.reason, '—') },
              {
                label: 'Currency conflict',
                value:
                  issue.blockedReasonCode === 'PAYOUT_CURRENCY_MISMATCH'
                    ? `${issue.lockedPayoutCurrency ?? '—'} locked on the order vs ${issue.payoutCurrency ?? '—'} on the current payout setup`
                    : '—',
              },
              { label: 'Tracking', value: issue.trackingNumber ?? '—' },
              { label: 'Payment status', value: issue.paymentStatus ?? '—' },
            ]}
          />
        </div>
      ) : null}

      {issue.fabricReview ? (
        <div className="mt-5 rounded-[8px] border border-needle/16 bg-white/92 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-needle/70">Fabric exception context</p>
              <h3 className="mt-1 text-lg font-semibold text-ink">{formatDatabaseEnumLabel(issue.fabricReview.componentCode)} · {formatMoney(issue.fabricReview.supplierCostAmount, issue.fabricReview.currency)}</h3>
              <p className="mt-1 text-sm text-ink/58">Candidate {issue.fabricReview.candidateId} · correlation {issue.fabricReview.correlationId}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {issue.fabricReview.estimateUrl ? <a href={issue.fabricReview.estimateUrl} target="_blank" rel="noreferrer" className="rounded-full border border-ink/10 px-3 py-2 text-xs font-semibold text-needle">Supplier estimate</a> : null}
              {issue.fabricReview.receiptUrl ? <a href={issue.fabricReview.receiptUrl} target="_blank" rel="noreferrer" className="rounded-full border border-ink/10 px-3 py-2 text-xs font-semibold text-needle">Final receipt</a> : null}
              {[...issue.fabricReview.customerMediaUrls, ...issue.fabricReview.acquiredMediaUrls].map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="rounded-full border border-ink/10 px-3 py-2 text-xs font-semibold text-needle">Evidence {index + 1}</a>)}
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <DetailList items={[
              { label: 'Candidate state', value: formatDatabaseEnumLabel(issue.fabricReview.status) },
              { label: 'Provider state', value: formatDatabaseEnumLabel(issue.fabricReview.providerStatus, 'Not started') },
            ]} />
            <DetailList items={[
              { label: 'Provider reference', value: issue.fabricReview.providerReference ?? '—' },
              { label: 'Reconciliation', value: formatDatabaseEnumLabel(issue.fabricReview.reconciliationStatus, 'Not started') },
            ]} />
            <div className="rounded-[8px] bg-mint/45 p-3 text-xs leading-5 text-ink/66">Use the recommended recovery above. Routine approvals never appear here; this card exists only because the provider, evidence, or reconciliation path needs intervention.</div>
          </div>
          {issue.fabricReview.ledgerEntries.length > 0 ? <div className="mt-4 border-t border-ink/8 pt-3"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Balanced ledger entries</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{issue.fabricReview.ledgerEntries.map((entry, index) => <div key={`${entry.accountCode}:${entry.direction}:${index}`} className="flex justify-between gap-4 rounded-[8px] bg-bone/60 px-3 py-2 text-xs"><span>{formatDatabaseEnumLabel(entry.accountCode)} · {formatDatabaseEnumLabel(entry.direction)}</span><strong>{formatMoney(entry.amount, entry.currency)}</strong></div>)}</div></div> : null}
        </div>
      ) : null}

      <IssueHistoryBlock history={issue.history} />

      {issue.financialCaseId && issue.refundResolutionId && issue.refundResolution?.status !== 'SUCCEEDED' ? (
        <div className="mt-5 flex flex-col gap-3 rounded-[8px] border border-needle/18 bg-mint/48 p-4 sm:flex-row sm:items-center sm:justify-between" role="status" aria-live="polite">
          <div>
            <p className="text-sm font-semibold text-needle-700">Partial refund sent to Money Desk</p>
            <p className="mt-1 text-xs leading-5 text-ink/58">The evidence packet and exact refund source are locked. This issue stays in review while an independent approver checks the request.</p>
          </div>
          <a href="/ops?view=money-desk" className="inline-flex shrink-0 items-center justify-center rounded-full border border-needle/18 bg-white px-4 py-2.5 text-sm font-semibold text-needle-700 transition hover:bg-mint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle/60">Review in Money Desk</a>
        </div>
      ) : null}

      {canReviewCompletedPartialRefund && issue.refundResolution ? (
        <div className="mt-5 rounded-[8px] border border-needle/20 bg-mint/42 p-4" role="region" aria-label="Post-refund order outcome">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle-700">Refund completed · order decision needed</p>
          <p className="mt-2 text-sm leading-6 text-ink/70">
            {formatMoney(issue.refundResolution.amount, issue.refundResolution.currency)} was returned successfully
            {issue.refundResolution.providerReference ? ` · provider ${issue.refundResolution.providerReference}` : ''}.
          </p>
          <p className="mt-1 text-xs leading-5 text-ink/58">
            Closing or resuming does not create another refund. The completed refund remains final; the remaining protected balance follows the existing settlement rules.
          </p>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <form action="/ops/action" method="post" className="grid gap-3 rounded-[8px] border border-ink/10 bg-white/90 p-3">
              <input type="hidden" name="kind" value="reviewed-partial-refund-outcome" />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <input type="hidden" name="resolutionId" value={issue.refundResolution.id} />
              <input type="hidden" name="issueId" value={issue.id} />
              <input type="hidden" name="orderId" value={issue.orderId ?? ''} />
              <input type="hidden" name="outcome" value="CLOSE_ORDER" />
              <label className="grid gap-1.5 text-xs font-semibold text-ink/64">
                Why should this order close?
                <textarea name="reason" required minLength={12} maxLength={1000} rows={2} defaultValue="The reviewed partial refund is complete and this order should not continue." className="rounded-lg border border-ink/12 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
              <button type="submit" className="rounded-lg bg-needle px-4 py-3 text-sm font-semibold text-white">Close order</button>
            </form>
            <form action="/ops/action" method="post" className="grid gap-3 rounded-[8px] border border-ink/10 bg-white/90 p-3">
              <input type="hidden" name="kind" value="reviewed-partial-refund-outcome" />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <input type="hidden" name="resolutionId" value={issue.refundResolution.id} />
              <input type="hidden" name="issueId" value={issue.id} />
              <input type="hidden" name="orderId" value={issue.orderId ?? ''} />
              <input type="hidden" name="outcome" value="CONTINUE_ORDER" />
              <label className="grid gap-1.5 text-xs font-semibold text-ink/64">
                Why is it safe to continue?
                <textarea name="reason" required minLength={12} maxLength={1000} rows={2} defaultValue="The reviewed partial refund is complete and both parties can continue this order." className="rounded-lg border border-ink/12 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
              <button type="submit" className="rounded-lg border border-needle/20 bg-white px-4 py-3 text-sm font-semibold text-needle-700">Resume order</button>
            </form>
          </div>
        </div>
      ) : null}

      {issue.refundResolution?.reviewedOutcomeAppliedAt ? (
        <div className="mt-5 rounded-[8px] border border-ink/10 bg-bone/65 p-4" role="status">
          <p className="text-sm font-semibold text-ink">{issue.refundResolution.reviewedOrderOutcome === 'CLOSE_ORDER' ? 'Order closed after refund' : 'Order resumed after refund'}</p>
          <p className="mt-1 text-xs leading-5 text-ink/58">{issue.refundResolution.reviewedOutcomeReason ?? 'The reviewed order outcome has been recorded.'}</p>
        </div>
      ) : null}

      {(canUpdateIssueStatus || canResolveConsultationAttendance || canResolveBlockedPayout || canReleaseMaterialAdvance || canPrepareUnusedMaterialRefund || canResolveMaterialOverage || canPartialRefund || canManageConversation || canDecideProfileChange || canDecidePayoutChange || canPreparePayoutDestinationRecovery) ? (
        <div className="mt-5 border-t border-ink/8 pt-5">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/38">Actions</p>
          <div className="grid gap-4">
      {canPreparePayoutDestinationRecovery ? (
        <form action="/ops/action" method="post" className="grid gap-4 rounded-[8px] border border-rust/18 bg-white/92 p-4">
          <input type="hidden" name="kind" value="money-desk-request" />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="actionType" value="PAYOUT_DESTINATION_CHANGE" />
          <input type="hidden" name="targetType" value="ORDER_PAYOUT_FAILURE" />
          <input type="hidden" name="targetId" value={issue.payoutId ?? ''} />
          <input type="hidden" name="orderId" value={issue.orderId ?? ''} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rust-700">Reviewed payout recovery</p>
            <h3 className="mt-2 text-lg font-semibold text-ink">Replace the failed destination and retry</h3>
            <p className="mt-1 text-sm leading-6 text-ink/62">
              Drapeon will use only the tailor&apos;s current verified {issue.provider ? formatDatabaseEnumLabel(issue.provider) : 'provider'} destination. The original failed attempt remains in the audit trail, and two independent approvals are required.
            </p>
            {issue.payoutError ? <p className="mt-2 rounded-[8px] bg-rust/6 px-3 py-2 text-xs leading-5 text-rust-700">Provider response: {issue.payoutError}</p> : null}
          </div>
          <label className="grid gap-1.5 text-xs font-semibold text-ink/64">
            Why is this retry safe now?
            <input name="reason" required minLength={12} maxLength={1000} defaultValue="Verified a new payout destination after reviewing the failed provider response." className="h-11 rounded-lg border border-ink/12 bg-white px-3 text-sm text-ink outline-none focus:border-needle/50" />
          </label>
          <button type="submit" className="rounded-lg bg-needle px-4 py-3 text-sm font-semibold text-white">Prepare destination recovery</button>
          <p className="text-xs leading-5 text-ink/52">If the destination is unchanged or unverified, preparation stops with a specific reason.</p>
        </form>
      ) : null}
      {canResolveConsultationAttendance && issue.consultationAttendance ? (
        <form action="/ops/action" method="post" className="grid gap-4 rounded-[8px] border border-needle/18 bg-white/92 p-4">
          <input type="hidden" name="kind" value="consultation-attendance-resolution" />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="issueId" value={issue.id} />
          <input type="hidden" name="reviewId" value={issue.consultationAttendance.reviewId} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/78">Terminal attendance decision</p>
            <h3 className="mt-2 text-lg font-semibold text-ink">Resolve the call and its protected fee</h3>
            <p className="mt-1 text-sm leading-6 text-ink/62">Choose one outcome. Refunds and earnings are prepared in Money Desk for independent approval; this screen never moves money directly.</p>
            <a href="/ops?view=money-desk" className="mt-2 inline-flex text-xs font-semibold text-needle underline decoration-needle/30 underline-offset-4">Start or check 15-minute Money Desk access</a>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[8px] border border-ink/8 bg-bone/58 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/42">Customer activity</p>
              <p className="mt-2 text-sm font-semibold text-ink">{Math.floor(issue.consultationAttendance.customerVerifiedSeconds / 60)}m {issue.consultationAttendance.customerVerifiedSeconds % 60}s</p>
            </div>
            <div className="rounded-[8px] border border-ink/8 bg-bone/58 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/42">Tailor activity</p>
              <p className="mt-2 text-sm font-semibold text-ink">{Math.floor(issue.consultationAttendance.tailorVerifiedSeconds / 60)}m {issue.consultationAttendance.tailorVerifiedSeconds % 60}s</p>
            </div>
            <div className="rounded-[8px] border border-ink/8 bg-bone/58 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/42">Shared time</p>
              <p className="mt-2 text-sm font-semibold text-ink">{Math.floor(issue.consultationAttendance.verifiedOverlapSeconds / 60)}m {issue.consultationAttendance.verifiedOverlapSeconds % 60}s</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[8px] border border-ink/8 bg-bone/42 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/46">{formatDatabaseEnumLabel(issue.consultationAttendance.reportedByRole)} report</p>
              <p className="mt-2 text-sm leading-6 text-ink/76">{issue.consultationAttendance.reportedReason}</p>
            </div>
            <div className="rounded-[8px] border border-ink/8 bg-bone/42 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/46">Counterparty response</p>
              <p className="mt-2 text-sm font-semibold text-ink">{formatDatabaseEnumLabel(issue.consultationAttendance.counterpartyResponseCode, 'No structured response')}</p>
              {issue.consultationAttendance.counterpartyResponse ? <p className="mt-1 text-sm leading-6 text-ink/68">{issue.consultationAttendance.counterpartyResponse}</p> : null}
            </div>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold text-ink">Decision</legend>
            {[
              ['RESCHEDULE', 'Reschedule', 'Keep the fee protected and return both people to time selection.'],
              ['CUSTOMER_REFUND', 'Refund customer', `Prepare ${formatMoney(issue.consultationAttendance.feeAmount, issue.consultationAttendance.feeCurrency)} for consultation-only refund approval.`],
              ['TAILOR_EARNING', 'Verify tailor earning', `Prepare ${formatMoney(issue.consultationAttendance.feeAmount, issue.consultationAttendance.feeCurrency)} for independent payout approval.`],
            ].map(([value, title, detail], index) => (
              <label key={value} className="flex cursor-pointer gap-3 rounded-[8px] border border-ink/10 bg-white p-3 transition has-[:checked]:border-needle has-[:checked]:bg-needle/7">
                <input type="radio" name="decision" value={value} required defaultChecked={index === 0} className="mt-1 accent-needle" />
                <span><span className="block text-sm font-semibold text-ink">{title}</span><span className="mt-1 block text-xs leading-5 text-ink/55">{detail}</span></span>
              </label>
            ))}
          </fieldset>
          <label className="grid gap-2 text-sm text-ink/70">
            Evidence-based decision note
            <textarea name="note" required minLength={12} maxLength={1000} rows={3} placeholder="Explain which account and call activity support this outcome." className="rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40" />
          </label>
          <button type="submit" className="inline-flex items-center justify-center rounded-[8px] bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle/60">Record decision</button>
        </form>
      ) : null}
      {canUpdateIssueStatus ? (
        <form action="/ops/action" method="post" className="flex flex-col gap-3 rounded-[8px] border border-ink/6 bg-white/82 p-4">
          <input type="hidden" name="kind" value="ops-issue-status" />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="issueId" value={issue.id} />
          <label className="grid gap-2 text-sm text-ink/70">
            Internal note
            <input
              name="note"
              placeholder="Add context for the ops trail"
              className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              name="status"
              value="IN_REVIEW"
              className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:bg-bone"
            >
              Mark in review
            </button>
            <button
              type="submit"
              name="status"
              value="ESCALATED"
              className="inline-flex items-center justify-center rounded-full border border-rust/18 bg-rust/8 px-5 py-3 text-sm font-semibold text-rust-700 transition hover:bg-rust/12"
            >
              Escalate
            </button>
            <button
              type="submit"
              name="status"
              value="RESOLVED"
              className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90"
            >
              Mark resolved
            </button>
          </div>
        </form>
      ) : null}

      {canDecideProfileChange ? (
        <form action="/ops/action" method="post" className="flex flex-col gap-3 rounded-[8px] border border-needle/14 bg-needle/6 p-4">
          <input type="hidden" name="kind" value="profile-change-decision" />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="requestId" value={issue.relatedEntityId ?? ''} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/78">Profile change review</p>
            <p className="mt-2 text-sm leading-7 text-ink/72">Approve to merge the staged public profile changes into the live storefront. Reject to keep the previously vetted profile visible.</p>
          </div>
          <label className="grid gap-2 text-sm text-ink/70">
            Reason or ops note
            <textarea name="reason" rows={2} placeholder="Required for rejection; useful for approval notes" className="rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40" />
          </label>
          <label className="grid gap-2 text-sm text-ink/70">
            Rejection code
            <select name="rejectionCode" defaultValue="GENERAL_TRUST_REVIEW" className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40">
              <option value="INVALID_PROFILE_IMAGE">Invalid profile image</option>
              <option value="INVALID_PORTFOLIO_MEDIA">Invalid portfolio media</option>
              <option value="OFF_PLATFORM_CONTACT">Off-platform contact</option>
              <option value="BUSINESS_IDENTITY_MISMATCH">Business identity mismatch</option>
              <option value="LOCATION_MISMATCH">Location mismatch</option>
              <option value="GENERAL_TRUST_REVIEW">General trust review</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="submit" name="decision" value="APPROVE" className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90">Approve staged profile change</button>
            <button type="submit" name="decision" value="REJECT" className="inline-flex items-center justify-center rounded-full border border-rust/18 bg-rust/10 px-5 py-3 text-sm font-semibold text-rust-700 transition hover:bg-rust/14">Reject change</button>
          </div>
        </form>
      ) : null}

      {canDecidePayoutChange ? (
        <div className="grid gap-3 rounded-[8px] border border-rust/12 bg-rust/6 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rust-700">Payout destination review</p>
            <p className="mt-2 text-sm leading-7 text-ink/72">Compare the active account with the requested replacement below. The current destination remains active until two independent approvals are recorded; the approved replacement then activates immediately.</p>
          </div>
          {issue.payoutChangeReview ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                {([
                  ['Current active destination', issue.payoutChangeReview.currentDestination],
                  ['Requested replacement', issue.payoutChangeReview.requestedDestination],
                ] as const).map(([title, destination]) => (
                  <div key={title} className="rounded-[8px] border border-ink/8 bg-white/88 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-ink/46">{title}</p>
                    <dl className="mt-3 grid gap-2 text-sm">
                      <div className="flex justify-between gap-4"><dt className="text-ink/48">Provider</dt><dd className="text-right font-semibold text-ink">{destination?.provider ?? 'Not recorded'}</dd></div>
                      <div className="flex justify-between gap-4"><dt className="text-ink/48">Currency</dt><dd className="text-right font-semibold text-ink">{destination?.currency ?? 'Not recorded'}</dd></div>
                      <div className="flex justify-between gap-4"><dt className="text-ink/48">Bank</dt><dd className="text-right font-semibold text-ink">{destination?.bankName ?? 'Not recorded'}</dd></div>
                      <div className="flex justify-between gap-4"><dt className="text-ink/48">Account holder</dt><dd className="text-right font-semibold text-ink">{destination?.accountName ?? 'Not recorded'}</dd></div>
                      <div className="flex justify-between gap-4"><dt className="text-ink/48">Account</dt><dd className="text-right font-semibold text-ink">{destination?.accountMasked ?? 'Not recorded'}</dd></div>
                      <div className="flex justify-between gap-4"><dt className="text-ink/48">Provider check</dt><dd className={`text-right font-semibold ${destination?.accountVerified ? 'text-needle' : 'text-rust-700'}`}>{destination?.accountVerified ? 'Verified' : 'Incomplete'}</dd></div>
                    </dl>
                  </div>
                ))}
              </div>
              <div className="rounded-[8px] border border-ink/8 bg-bone/72 p-4 text-sm text-ink/70">
                <div className="grid gap-2 sm:grid-cols-2">
                  <p><span className="font-semibold text-ink">Submitted:</span> {formatDateTime(issue.payoutChangeReview.submittedAt)}</p>
                  <p><span className="font-semibold text-ink">Tailor confirmed:</span> {issue.payoutChangeReview.confirmedAt ? formatDateTime(issue.payoutChangeReview.confirmedAt) : 'Not confirmed'}</p>
                  <p><span className="font-semibold text-ink">Account holder:</span> {issue.payoutChangeReview.accountHolderMatch === true ? 'Same normalized name' : issue.payoutChangeReview.accountHolderMatch === false ? 'Name changed — review carefully' : 'Could not compare'}</p>
                </div>
                <p className="mt-3 font-semibold text-ink">Why this reached Ops</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(issue.payoutChangeReview.riskSignals.length > 0 ? issue.payoutChangeReview.riskSignals : ['No destination differences detected']).map((signal) => (
                    <span key={signal} className="rounded-full border border-ink/8 bg-white px-3 py-1 text-xs font-semibold text-ink/62">{signal}</span>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-[8px] border border-rust/20 bg-white p-4 text-sm font-semibold leading-6 text-rust-700">
              The payout comparison could not be loaded. Do not approve this request until the current and requested destinations are both visible.
            </div>
          )}
          {issue.payoutChangeReview?.requestedDestination?.accountVerified ? (
            <div className="grid gap-3">
              <div className="flex flex-col gap-3 rounded-[8px] border border-needle/14 bg-white/82 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-ink">Independent approval requires active Money Desk access</p>
                  <p className="mt-1 text-xs leading-5 text-ink/58">Start or renew the 15-minute elevation before preparing this protected change.</p>
                </div>
                <a href="/ops?view=money-desk#money-desk" className="inline-flex shrink-0 items-center justify-center rounded-full border border-needle/18 bg-white px-4 py-2.5 text-sm font-semibold text-needle-700 transition hover:bg-mint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle/60">
                  Open Money Desk
                </a>
              </div>
              <form action="/ops/action" method="post" className="grid gap-3">
                <input type="hidden" name="kind" value="money-desk-request" />
                <input type="hidden" name="redirectTo" value={redirectTo} />
                <input type="hidden" name="actionType" value="PAYOUT_DESTINATION_CHANGE" />
                <input type="hidden" name="targetType" value="PAYOUT_CHANGE_REQUEST" />
                <input type="hidden" name="targetId" value={issue.relatedEntityId ?? ''} />
                <label className="grid gap-2 text-sm text-ink/70">
                  Why is this replacement safe to activate?
                  <textarea name="reason" required minLength={12} maxLength={1000} rows={2} defaultValue="Reviewed the verified replacement payout destination and account ownership evidence." className="rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40" />
                </label>
                <button type="submit" className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90">Prepare independent approval</button>
              </form>
            </div>
          ) : null}
          <form action="/ops/action" method="post" className="grid gap-3 border-t border-ink/8 pt-3">
            <input type="hidden" name="kind" value="payout-change-decision" />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input type="hidden" name="requestId" value={issue.relatedEntityId ?? ''} />
            <input type="hidden" name="decision" value="REJECT" />
            <label className="grid gap-2 text-sm text-ink/70">
              Rejection reason
              <textarea name="reason" required minLength={12} maxLength={1000} rows={2} placeholder="Explain what must be corrected before resubmission." className="rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40" />
            </label>
            <label className="grid gap-2 text-sm text-ink/70">
              Rejection code
              <select name="rejectionCode" defaultValue="PAYOUT_DESTINATION_MISMATCH" className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40">
                <option value="PAYOUT_DESTINATION_MISMATCH">Payout destination mismatch</option>
                <option value="BUSINESS_IDENTITY_MISMATCH">Business identity mismatch</option>
                <option value="NEEDS_LIVE_SELFIE_RETAKE">Needs challenge-video retake</option>
                <option value="GENERAL_TRUST_REVIEW">General trust review</option>
              </select>
            </label>
            <button type="submit" className="inline-flex items-center justify-center rounded-full border border-rust/18 bg-rust/10 px-5 py-3 text-sm font-semibold text-rust-700 transition hover:bg-rust/14">Reject destination</button>
          </form>
        </div>
      ) : null}

      {canResolveBlockedPayout ? (
        <form action="/ops/action" method="post" className="flex flex-col gap-3 rounded-[8px] border border-rust/12 bg-rust/6 p-4">
          <input type="hidden" name="kind" value="payout-block-resolution" />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="issueId" value={issue.id} />
          <input type="hidden" name="orderId" value={issue.orderId ?? ''} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rust-700">Payout resolution</p>
            <p className="mt-2 text-sm leading-7 text-ink/72">
              Retry the payout in the order currency or convert it to the tailor&apos;s current payout currency. Customer refunds must be prepared from the dispute through Money Desk.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-ink/8 bg-white/82 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/46">Order total</p>
              <p className="mt-2 text-sm text-ink">{formatMoney(issue.orderTotalAmount, issue.lockedPayoutCurrency ?? issue.orderCurrency)}</p>
            </div>
            <div className="rounded-lg border border-ink/8 bg-white/82 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/46">Current setup</p>
              <p className="mt-2 text-sm text-ink">{issue.payoutCurrency ?? 'No payout currency'}</p>
            </div>
            <div className="rounded-lg border border-ink/8 bg-white/82 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/46">Refundable</p>
              <p className="mt-2 text-sm text-ink">{formatMoney(issue.maxRefundableAmount, issue.orderCurrency)}</p>
            </div>
          </div>
          <label className="grid gap-2 text-sm text-ink/70">
            Resolution note
            <textarea
              name="note"
              required
              rows={3}
              placeholder="Explain why this resolution is safe and what ops approved."
              className="rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              name="resolutionMode"
              value="ORIGINAL_CURRENCY"
              className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:bg-bone"
            >
              Retry payout in order currency
            </button>
            <button
              type="submit"
              name="resolutionMode"
              value="CONVERT_TO_CURRENT"
              className="inline-flex items-center justify-center rounded-full border border-needle/18 bg-needle/8 px-5 py-3 text-sm font-semibold text-needle-700 transition hover:bg-needle/12"
            >
              Convert, then retry payout
            </button>
          </div>
        </form>
      ) : null}

      {canReleaseMaterialAdvance ? (
        <form action="/ops/action" method="post" className="flex flex-col gap-3 rounded-[8px] border border-needle/14 bg-needle/6 p-4">
          <input type="hidden" name="kind" value="money-desk-request" />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="actionType" value="MATERIAL_ADVANCE_RELEASE" />
          <input type="hidden" name="targetType" value="ORDER_MATERIAL_ADVANCE" />
          <input type="hidden" name="targetId" value={issue.materialAdvanceId ?? ''} />
          <input type="hidden" name="advanceId" value={issue.materialAdvanceId ?? ''} />
          <input type="hidden" name="orderId" value={issue.orderId ?? ''} />
          <input type="hidden" name="amountMinor" value={issue.materialAdvanceAmount ?? ''} />
          <input type="hidden" name="currency" value={issue.materialAdvanceCurrency ?? issue.orderCurrency ?? ''} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/78">Material advance release</p>
            <p className="mt-2 text-sm leading-7 text-ink/72">
              Prepare the exact customer-approved claim for independent Money Desk approval. A funded-fabric claim uses the allowance already captured at checkout and cannot charge the customer again.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-ink/8 bg-white/82 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/46">Advance</p>
              <p className="mt-2 text-sm text-ink">
                {issue.materialAdvanceAmount && issue.materialAdvanceAmount > 0
                  ? formatMoney(issue.materialAdvanceAmount, issue.materialAdvanceCurrency ?? issue.orderCurrency)
                  : 'Customer-approved amount'}
              </p>
            </div>
            <div className="rounded-lg border border-ink/8 bg-white/82 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/46">Order</p>
              <p className="mt-2 text-sm text-ink">{issue.orderReference ? `#${issue.orderReference}` : issue.orderId ?? '—'}</p>
            </div>
            <div className="rounded-lg border border-ink/8 bg-white/82 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/46">Record</p>
              <p className="mt-2 break-all text-sm text-ink">{issue.materialAdvanceId}</p>
            </div>
          </div>
          <label className="grid gap-2 text-sm text-ink/70">
            Review record
            <textarea
              name="note"
              required
              rows={3}
              placeholder="Confirm the accepted allocation, exact fabric approval, private supplier estimate, remaining balance, duplicate risk, and payout readiness."
              className="rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40"
            />
          </label>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90"
          >
            Prepare Money Desk release
          </button>
        </form>
      ) : null}

      {canPrepareUnusedMaterialRefund ? (
        <form action="/ops/action" method="post" className="flex flex-col gap-3 rounded-[8px] border border-rust/18 bg-rust/6 p-4">
          <input type="hidden" name="kind" value="money-desk-request" />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="actionType" value="CUSTOMER_REFUND" />
          <input type="hidden" name="targetType" value="ORDER_MATERIAL_ADVANCE" />
          <input type="hidden" name="targetId" value={issue.materialAdvanceId ?? ''} />
          <input type="hidden" name="advanceId" value={issue.materialAdvanceId ?? ''} />
          <input type="hidden" name="orderId" value={issue.orderId ?? ''} />
          <input type="hidden" name="amountMinor" value={issue.materialCustomerRefundAmount} />
          <input type="hidden" name="currency" value={issue.materialAdvanceCurrency ?? issue.orderCurrency ?? ''} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rust-700">Unused fabric value</p>
            <p className="mt-2 text-sm leading-7 text-ink/72">
              {formatMoney(issue.materialCustomerRefundAmount, issue.materialAdvanceCurrency ?? issue.orderCurrency)} must return to the customer. Execution reduces the still-locked tailor settlement by the same amount before the provider refund runs.
            </p>
          </div>
          <label className="grid gap-2 text-sm text-ink/70">
            Refund control note
            <textarea name="reason" required minLength={12} rows={3} defaultValue="Verified the final supplier receipt and unused approved fabric value before customer refund." className="rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40" />
          </label>
          <button type="submit" className="inline-flex items-center justify-center rounded-full bg-rust-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rust-700/90">Prepare reviewed customer refund</button>
        </form>
      ) : null}

      {canResolveMaterialOverage ? (
        <form action="/ops/action" method="post" className="flex flex-col gap-3 rounded-[8px] border border-ink/10 bg-white/82 p-4">
          <input type="hidden" name="kind" value="material-overage-resolution" />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="advanceId" value={issue.materialAdvanceId ?? ''} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/55">Unapproved supplier overage</p>
            <p className="mt-2 text-sm leading-7 text-ink/72">
              The receipt is {formatMoney(issue.materialUnapprovedOverageAmount, issue.materialAdvanceCurrency ?? issue.orderCurrency)} above approval. The customer is not charged. Confirm the tailor absorbs it; any new customer-funded scope must use a separate proposed change.
            </p>
          </div>
          <label className="grid gap-2 text-sm text-ink/70">
            Resolution note
            <textarea name="note" required minLength={10} rows={3} placeholder="Record the receipt review and why no customer charge is authorized." className="rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40" />
          </label>
          <button type="submit" className="inline-flex items-center justify-center rounded-full border border-ink/12 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:bg-bone">Record tailor absorbs overage</button>
        </form>
      ) : null}

      {canPartialRefund ? (
        <details className="group rounded-[8px] border border-rust/18 bg-white/92 open:shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle/60">
            <span>Prepare reviewed partial refund</span>
            <span aria-hidden="true" className="text-ink/44 transition group-open:rotate-180">⌄</span>
          </summary>
          <form action="/ops/action" method="post" encType="multipart/form-data" className="flex flex-col gap-5 border-t border-ink/10 p-4">
            <input type="hidden" name="kind" value="order-partial-refund" />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input type="hidden" name="issueId" value={issue.id} />
            <input type="hidden" name="orderId" value={issue.orderId ?? ''} />
            <input type="hidden" name="idempotencyKey" value={`ops-partial-refund:${issue.id}:${issue.createdAt}`} />

            <div className="rounded-[8px] border border-needle/18 bg-mint/45 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">Evidence before money</p>
              <p className="mt-2 text-sm leading-7 text-ink/72">
                This saves an immutable financial case and exact restoration plan, then sends it to Money Desk for an independent approval. No provider refund runs here, and the order stays in dispute until Ops separately resolves the order.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[8px] border border-ink/8 bg-bone px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/46">Order total</p>
                <p className="mt-2 text-sm text-ink">{formatMoney(issue.orderTotalAmount, issue.orderCurrency)}</p>
              </div>
              <div className="rounded-[8px] border border-ink/8 bg-bone px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/46">Already refunded</p>
                <p className="mt-2 text-sm text-ink">{formatMoney(issue.alreadyRefundedAmount, issue.orderCurrency)}</p>
              </div>
              <div className="rounded-[8px] border border-ink/8 bg-bone px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/46">Maximum partial</p>
                <p className="mt-2 text-sm text-ink">{formatMoney(issue.maxRefundableAmount - 1, issue.orderCurrency)}</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormMoneyInput
                id={`partial-refund-amount-${issue.id}`}
                name="amount"
                label="Refund amount"
                currency={normalizeAccountCurrency(issue.orderCurrency) ?? 'USD'}
                required
                maximumMinorUnits={Math.max(0, issue.maxRefundableAmount - 1)}
              />
              <label className="grid gap-2 text-sm font-medium text-ink/76">
                Reviewed reason
                <select name="reasonCode" required defaultValue="" className="rounded-[8px] border border-ink/14 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/50 focus:ring-2 focus:ring-needle/15">
                  <option value="" disabled>Choose a reason</option>
                  {Object.entries(OPS_PARTIAL_REFUND_REASON_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="grid gap-2 text-sm font-medium text-ink/76">
                Decision basis
                <select name="decisionBasis" required defaultValue="" className="rounded-[8px] border border-ink/14 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/50 focus:ring-2 focus:ring-needle/15">
                  <option value="" disabled>Choose the authority</option>
                  {Object.entries(OPS_PARTIAL_REFUND_DECISION_BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="grid gap-2 text-sm font-medium text-ink/76">
                Evidence source
                <select name="evidenceSource" required defaultValue="" className="rounded-[8px] border border-ink/14 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/50 focus:ring-2 focus:ring-needle/15">
                  <option value="" disabled>Choose where it came from</option>
                  {Object.entries(OPS_PARTIAL_REFUND_EVIDENCE_SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>

            <label className="grid gap-2 text-sm font-medium text-ink/76">
              Party-safe decision summary
              <textarea name="summary" required minLength={12} maxLength={2000} rows={4} placeholder="Record what happened, why this amount is fair, and what was agreed or authorized. Do not paste private contact details here." className="rounded-[8px] border border-ink/14 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/50 focus:ring-2 focus:ring-needle/15" />
              <span className="text-xs font-normal leading-5 text-ink/52">This is the authoritative reason visible in the case history and terminal notifications.</span>
            </label>

            <fieldset className="grid gap-3 rounded-[8px] border border-ink/12 bg-bone/70 p-4">
              <legend className="px-2 text-sm font-semibold text-ink">After the refund succeeds <span className="text-rust-700">*</span></legend>
              <p className="text-xs leading-5 text-ink/58">Required. This does not change the order while the refund is awaiting approval or provider processing.</p>
              <div className="grid gap-3 lg:grid-cols-3">
                {Object.entries(OPS_PARTIAL_REFUND_ORDER_OUTCOME_COPY).map(([value, copy]) => (
                  <label key={value} className="group grid cursor-pointer grid-cols-[auto_1fr] gap-3 rounded-[8px] border border-ink/12 bg-white p-4 transition has-[:checked]:border-needle/55 has-[:checked]:bg-mint/55 focus-within:ring-2 focus-within:ring-needle/25">
                    <input type="radio" name="orderOutcome" value={value} required className="mt-1 size-4 accent-needle" />
                    <span>
                      <span className="block text-sm font-semibold text-ink">{copy.label}</span>
                      <span className="mt-1 block text-xs leading-5 text-ink/58">{copy.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium text-ink/76">
                Source reference
                <input name="externalReference" required minLength={3} maxLength={500} placeholder="Email thread subject + date, WhatsApp contact/date, Drapeon message, or call ID" className="rounded-[8px] border border-ink/14 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/50 focus:ring-2 focus:ring-needle/15" />
              </label>
              <div className="rounded-[8px] border border-needle/14 bg-mint/38 px-4 py-3" role="note">
                <p className="text-sm font-medium text-ink/76">Evidence timestamp</p>
                <p className="mt-2 text-xs leading-5 text-ink/56">Recorded automatically by Drapeon when this evidence packet is submitted. Put an older email or WhatsApp message date in the source reference.</p>
              </div>
              <label className="grid gap-2 text-sm font-medium text-ink/76">
                Source visibility
                <select name="evidenceVisibility" defaultValue="OPS_ONLY" className="rounded-[8px] border border-ink/14 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/50 focus:ring-2 focus:ring-needle/15">
                  <option value="OPS_ONLY">Ops only — raw external evidence</option>
                  <option value="PARTIES">Customer and tailor may view</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm font-medium text-ink/76">
                Screenshot or image (optional)
                <input name="evidenceFile" type="file" accept="image/jpeg,image/png,image/webp" className="rounded-[8px] border border-ink/14 bg-white px-4 py-3 text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-mint file:px-3 file:py-2 file:font-semibold file:text-needle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle/60" />
                <span className="text-xs font-normal leading-5 text-ink/52">Private commercial evidence, up to 8 MB. Never upload passwords, payment credentials, or unrelated chat history.</span>
              </label>
            </div>

            <fieldset className="grid gap-4 rounded-[8px] border border-ink/12 bg-bone/70 p-4">
              <legend className="px-2 text-sm font-semibold text-ink">Where the customer refund comes from</legend>
              <div className="rounded-[8px] border border-needle/16 bg-white p-4">
                <p className="text-sm font-semibold text-needle-700">The customer receives the full refund amount entered above.</p>
                <p className="mt-2 text-xs leading-5 text-ink/60">These fields do not pay the tailor. They identify which protected part of the original charge is reduced to fund the customer refund. The first five cash-source fields must add up to the refund amount exactly.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['tailorWorkAmount', 'Reduce protected tailor entitlement', 'Use when the adjustment is for tailoring work that has not been released.'],
                  ['platformFeeAmount', 'Return Drapeon service fee', 'Use when Drapeon is refunding its own service-fee allocation.'],
                  ['taxAmount', 'Return refundable tax', 'Use only for tax that must be reversed under the locked jurisdiction.'],
                  ['fulfillmentAmount', 'Return shipping or fulfillment value', 'Use for a delivery, shipping, customs, or fulfillment adjustment.'],
                  ['consultationAmount', 'Return consultation value', 'Use only when the original order charge included refundable consultation value.'],
                  ['promotionAmount', 'Restore customer promotion credit', 'Non-cash value restored separately; it does not fund the provider refund.'],
                  ['drapeonFundedAmount', 'Drapeon funds already-released value', 'Use when protected money is no longer available and Drapeon must fund the customer now.'],
                  ['releasedTailorRecoveryAmount', 'Record separate tailor recovery', 'Never a silent debit. This requires equal Drapeon funding and a separate reviewed recovery.'],
                ].map(([name, label, help]) => (
                  <label key={name} className="grid gap-2 text-xs font-medium text-ink/68">
                    {label}
                    <input name={name} type="number" min="0" step="0.01" required defaultValue="0" className="rounded-[8px] border border-ink/12 bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-needle/50 focus:ring-2 focus:ring-needle/15" />
                    <span className="font-normal leading-5 text-ink/50">{help}</span>
                  </label>
                ))}
              </div>
              <div className="rounded-[8px] border border-rust/14 bg-rust/5 px-4 py-3 text-xs leading-5 text-ink/64">
                Example: a ₦50,000 tailor-inactivity adjustment with unreleased payout uses <strong>₦50,000 under “Reduce protected tailor entitlement”</strong> and ₦0 everywhere else. The customer receives ₦50,000; the tailor’s protected balance falls by ₦50,000; the rest of the original order allocation remains unchanged.
              </div>
            </fieldset>

            <button type="submit" className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle">
              Save evidence and send for approval
            </button>
          </form>
        </details>
      ) : null}

      {canManageConversation ? (
        <form action="/ops/action" method="post" className="flex flex-col gap-3 rounded-[8px] border border-ink/6 bg-white/82 p-4 sm:flex-row sm:items-center">
          <input type="hidden" name="kind" value="conversation-access" />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="orderId" value={issue.orderId ?? ''} />
          <input type="hidden" name="reason" value={issue.reason ?? 'SAFETY_REVIEW'} />
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Conversation safety control</p>
            <p className="mt-2 text-sm leading-7 text-ink/68">
              Pause the chat while ops reviews the report, or reopen it if the thread can continue safely in Drapeon.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="submit"
              name="accessAction"
              value="BLOCK"
              className="inline-flex items-center justify-center rounded-full border border-rust/18 bg-rust/8 px-5 py-3 text-sm font-semibold text-rust-700 transition hover:bg-rust/12"
            >
              Pause chat
            </button>
            <button
              type="submit"
              name="accessAction"
              value="UNBLOCK"
              className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90"
            >
              Reopen chat
            </button>
          </div>
        </form>
      ) : null}
          </div>
        </div>
      ) : null}
    </CardCollapse>
  )
}

function ReviewQueueCard({
  review,
  redirectTo,
}: {
  review: OpsReviewQueueItem
  redirectTo: string
}): React.JSX.Element {
  const visibilityLabel = review.publishedAt ? 'Public' : review.flagged ? 'Held for review' : 'Not public yet'
  const visibilityTone = review.publishedAt ? 'APPROVED' : review.flagged ? 'PENDING' : 'UNDER_REVIEW'

  return (
    <CardCollapse
      background="bg-[linear-gradient(180deg,#fffdf9_0%,#f5eee3_100%)]"
      summary={
        <>
          <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${statusPillClass(visibilityTone)}`}>
            {visibilityLabel}
          </span>
          <span className="font-semibold text-ink">Order {review.orderReference ? `#${review.orderReference}` : review.orderId.slice(0, 8)}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink/48">{review.reviewerName} · {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span>
          <span className="shrink-0 text-xs text-ink/38">{formatRelativeTime(review.createdAt)}</span>
        </>
      }
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-ink/8 bg-bone px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/55">
              {review.displayId}
            </span>
            <span className="text-lg text-ink">Order {review.orderReference ? `#${review.orderReference}` : review.orderId.slice(0, 8)}</span>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusPillClass(visibilityTone)}`}>
              {visibilityLabel}
            </span>
          </div>
          <p className="mt-2 text-sm leading-7 text-ink/66">
            {review.reviewerName} · {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}
          </p>
        </div>
        <a
          href={sectionMailto(`Review moderation: ${review.orderReference ?? review.orderId}`)}
          className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone"
        >
          Email ops
        </a>
      </div>

      <div className="mt-5 grid gap-5">
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Parties</p>
          <DetailList
            items={[
              { label: 'Customer', value: review.customerEmail ? `${review.customerName} · ${review.customerEmail}` : review.customerName },
              { label: 'Tailor', value: review.tailorEmail ? `${review.tailorName} · ${review.tailorEmail}` : review.tailorName },
            ]}
          />
        </div>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Review</p>
          <DetailList
            items={[
              { label: 'Order stage', value: review.orderStage ?? '—' },
              { label: 'Submitted', value: formatDateTime(review.createdAt) },
              { label: 'Tags', value: review.tags.length > 0 ? review.tags.join(', ') : '—' },
              { label: 'Public since', value: formatDateTime(review.publishedAt) },
            ]}
          />
        </div>
      </div>

      <div className="mt-5 rounded-[8px] border border-ink/6 bg-white/82 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Review body</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink/78">
          {review.body?.trim() ? review.body : 'No written review was included.'}
        </p>
        {review.response?.trim() ? (
          <>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Tailor response</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink/78">{review.response}</p>
          </>
        ) : null}
      </div>

      <div className="mt-5 border-t border-ink/8 pt-5">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/38">Actions</p>
        <form action="/ops/action" method="post" className="flex flex-wrap gap-3 rounded-[8px] border border-ink/6 bg-white/82 p-4">
          <input type="hidden" name="kind" value="review-visibility" />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="reviewId" value={review.id} />
          <button
            type="submit"
            name="visibility"
            value="PUBLISH"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90"
          >
            Publish review
          </button>
          <button
            type="submit"
            name="visibility"
            value="HOLD"
            className="inline-flex items-center justify-center rounded-full border border-rust/18 bg-rust/8 px-5 py-3 text-sm font-semibold text-rust-700 transition hover:bg-rust/12"
          >
            Hold from public view
          </button>
        </form>
      </div>

      <IssueHistoryBlock history={review.history} />
    </CardCollapse>
  )
}

function DispatchCard({
  item,
  redirectTo,
}: {
  item: OpsDispatchItem
  redirectTo: string
}): React.JSX.Element {
  const isLocalDelivery = item.deliveryMethod === 'LOCAL_DELIVERY'
  const run = item.fulfillmentRun
  const parcel = item.parcels[0] ?? null
  const needsQuote = !run || ['QUOTE_REQUIRED', 'EXCEPTION'].includes(run.status)
  const awaitingCustomer = run?.status === 'AWAITING_CUSTOMER_DECISION'
  const eventOptions: Array<{ value: string; label: string }> = run?.status === 'READY_TO_BOOK'
    ? [{ value: 'BOOKED', label: 'Provider booked' }]
    : run?.status === 'BOOKED'
      ? [
          { value: 'CARRIER_ACCEPTED', label: 'Provider accepted parcel' },
          { value: 'COLLECTED', label: 'Parcel collected' },
        ]
      : run?.status === 'IN_TRANSIT' && !run.custodyAcceptedAt
        ? [
            { value: 'CARRIER_ACCEPTED', label: 'Add provider acceptance proof' },
            { value: 'COLLECTED', label: 'Add parcel collection proof' },
          ]
        : run?.status === 'IN_TRANSIT'
        ? [
            { value: 'AT_HUB', label: 'At provider hub' },
            { value: 'IN_TRANSIT', label: 'In transit' },
            { value: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
            { value: 'DELIVERY_ATTEMPTED', label: 'Delivery attempted' },
            { value: 'DELIVERED', label: 'Delivered' },
            { value: 'RETURNING', label: 'Returning' },
            { value: 'RETURNED', label: 'Returned' },
          ]
        : run?.status === 'PICKUP_READY'
          ? [{ value: 'PICKED_UP', label: 'Picked up' }]
          : []
  if (run && ['READY_TO_BOOK', 'BOOKED', 'IN_TRANSIT', 'PICKUP_READY'].includes(run.status)) {
    eventOptions.push(
      { value: 'EXCEPTION_RECORDED', label: 'Delivery issue' },
      { value: 'CANCELLED', label: 'Delivery cancelled' },
    )
  } else if (run?.status === 'DELIVERED') {
    eventOptions.push({ value: 'EXCEPTION_RECORDED', label: 'Delivery issue' })
  }
  const canRecordEvent = !!run && !needsQuote && !awaitingCustomer && eventOptions.length > 0
  const nextDispatchInstruction = run?.status === 'READY_TO_BOOK'
    ? 'Next: confirm the provider booking. Delivery cannot be closed before custody and delivery proof are recorded.'
    : run?.status === 'BOOKED'
      ? 'Next: record provider acceptance or parcel collection with a photo. This establishes custody before delivery.'
      : run?.status === 'IN_TRANSIT' && !run.custodyAcceptedAt
        ? 'Tracking stays “In transit.” Add the missing handoff photo to complete the custody record; this does not move the parcel backward. “Delivered” unlocks afterward.'
        : run?.status === 'IN_TRANSIT'
        ? 'Track the parcel as it moves. “Delivered” requires a fresh delivery photo.'
        : run?.status === 'PICKUP_READY'
          ? 'Next: confirm pickup with handoff proof.'
          : null
  const fundingSummary = run
    ? run.actualProviderCostAmount == null
      ? `${formatMoney(run.capturedAllowanceAmount, run.currency)} protected`
      : run.shortfallTotalAmount > 0
        ? `${formatMoney(run.shortfallTotalAmount, run.currency)} customer decision`
        : `${formatMoney(run.actualProviderCostAmount, run.currency)} confirmed`
    : 'Provider quote needed'

  return (
    <CardCollapse
      background="bg-[linear-gradient(180deg,#fffdf9_0%,#f5eee3_100%)]"
      summary={
        <>
          <StatusChip status={item.stage} className={`shrink-0 ${statusPillClass(item.stage)}`} />
          <span className="font-semibold text-ink">Order #{item.orderReference}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink/48">{item.itemTitle ?? item.garmentType} · {fundingSummary}</span>
          <span className="shrink-0 text-xs text-ink/38">{formatRelativeTime(item.stageUpdatedAt)}</span>
        </>
      }
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg text-ink">Order #{item.orderReference}</span>
            <StatusChip status={item.stage} className={statusPillClass(item.stage)} />
          </div>
          <p className="mt-2 text-sm leading-7 text-ink/66">
            {item.itemTitle ?? item.garmentType} · {formatMoney(item.amount, item.currency)}
          </p>
          <p className="mt-1 text-sm leading-7 text-ink/64">Drapeon Dispatch owns provider booking, tracked custody, customer updates, and final delivery proof.</p>
        </div>
        <a
          href={sectionMailto(`Dispatch help: ${item.orderReference}`)}
          className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone"
        >
          Email ops
        </a>
      </div>

      <div className="mt-5 grid gap-5">
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Parties</p>
          <DetailList
            items={[
              { label: 'Customer', value: item.customerEmail ? `${item.customerName} · ${item.customerEmail}` : item.customerName },
              { label: 'Tailor', value: item.tailorEmail ? `${item.tailorName} · ${item.tailorEmail}` : item.tailorName },
              { label: 'Tailor location', value: item.tailorLocation ?? '—' },
            ]}
          />
        </div>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Delivery</p>
          <DetailList
            items={[
              { label: 'Recipient', value: item.recipientName ?? '—' },
              { label: 'Recipient phone', value: item.recipientPhone ?? '—' },
              { label: 'Address', value: item.deliveryAddress ?? '—' },
              { label: 'Method', value: formatDatabaseEnumLabel(item.deliveryMethod, '—') },
              { label: 'Ready since', value: formatDateTime(item.stageUpdatedAt) },
            ]}
          />
        </div>
      </div>

      <div className="mt-5 border-t border-ink/8 pt-5">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/38">Dispatch funding</p>
        <div className="grid min-w-0 gap-3 rounded-[10px] border border-ink/8 bg-white/82 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><p className="text-xs text-ink/45">Paid at checkout</p><p className="mt-1 font-semibold text-ink">{formatMoney(run?.capturedAllowanceAmount ?? item.checkoutFulfillmentAmount, run?.currency ?? item.currency)}</p></div>
          <div><p className="text-xs text-ink/45">Provider quote</p><p className="mt-1 font-semibold text-ink">{run?.actualProviderCostAmount == null ? 'Not entered' : formatMoney(run.actualProviderCostAmount, run.currency)}</p></div>
          <div><p className="text-xs text-ink/45">Customer amount due</p><p className="mt-1 font-semibold text-ink">{formatMoney(run?.shortfallTotalAmount ?? 0, run?.currency ?? item.currency)}</p></div>
          <div><p className="text-xs text-ink/45">Customer refund</p><p className="mt-1 font-semibold text-ink">{formatMoney((run?.customerRefundAmount ?? 0) + (run?.customerRefundTaxAmount ?? 0), run?.currency ?? item.currency)}</p></div>
        </div>

        {needsQuote ? (
          <form action="/ops/action" method="post" encType="multipart/form-data" className="mt-4 grid min-w-0 gap-4 rounded-[10px] border border-needle/16 bg-mint/30 p-4">
            <input type="hidden" name="kind" value="dispatch-quote" />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input type="hidden" name="orderId" value={item.orderId} />
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm text-ink/72">Provider<input required name="providerName" defaultValue={run?.providerName ?? item.provider ?? item.carrier ?? ''} className="rounded-2xl border border-ink/10 bg-white px-4 py-3" placeholder={isLocalDelivery ? 'Rider or delivery provider' : 'Courier or shipping provider'} /></label>
              <label className="grid gap-2 text-sm text-ink/72">Provider quote reference<input name="providerQuoteReference" defaultValue={run?.providerQuoteReference ?? ''} className="rounded-2xl border border-ink/10 bg-white px-4 py-3" /></label>
              <label className="grid gap-2 text-sm text-ink/72">Actual provider cost ({run?.currency ?? item.currency})<input required inputMode="decimal" name="actualProviderCost" className="rounded-2xl border border-ink/10 bg-white px-4 py-3" placeholder="0.00" /></label>
              <label className="grid gap-2 text-sm text-ink/72">Tax on customer-funded delivery<input inputMode="decimal" name="shortfallTax" className="rounded-2xl border border-ink/10 bg-white px-4 py-3" placeholder="0.00" /></label>
              <label className="grid gap-2 text-sm text-ink/72">Provider/payment fee<input inputMode="decimal" name="shortfallFee" className="rounded-2xl border border-ink/10 bg-white px-4 py-3" placeholder="0.00" /></label>
              <label className="grid gap-2 text-sm text-ink/72">Provider quote proof<input required type="file" name="quoteEvidence" accept="image/jpeg,image/png,image/webp" className="rounded-2xl border border-ink/10 bg-white px-4 py-3" /></label>
            </div>
            <label className="grid gap-2 text-sm text-ink/72">Customer-facing note<textarea name="customerNote" rows={2} className="rounded-[8px] border border-ink/10 bg-white px-4 py-3" placeholder="What the quote covers and when the provider can collect." /></label>
            <label className="grid gap-2 text-sm text-ink/72">Private Ops note<textarea name="internalNote" rows={2} className="rounded-[8px] border border-ink/10 bg-white px-4 py-3" placeholder="Source, negotiation, or recovery context." /></label>
            <button type="submit" className="inline-flex w-fit items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white">Save provider quote</button>
          </form>
        ) : null}

        {run?.providerQuoteEvidence.length ? (
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/38">Provider quote proof</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {run.providerQuoteEvidence.map((evidence, index) => (
                <EvidenceMediaTile key={`${evidence.url}-${index}`} url={evidence.url} label={`Provider quote proof ${index + 1}`} />
              ))}
            </div>
          </div>
        ) : null}

        {awaitingCustomer ? (
          <div className="mt-4 rounded-[10px] border border-amber-500/20 bg-amber-50 p-4">
            <p className="font-semibold text-ink">Waiting for the customer</p>
            <p className="mt-1 text-sm leading-6 text-ink/62">They can pay the exact amount due, request a cheaper option, switch to pickup, or decline. Booking stays blocked until that decision reaches a terminal outcome.</p>
          </div>
        ) : null}

        {canRecordEvent ? (
          <form action="/ops/action" method="post" encType="multipart/form-data" className="mt-4 grid min-w-0 gap-4 rounded-[10px] border border-ink/8 bg-white/82 p-4">
            <input type="hidden" name="kind" value="dispatch-event" />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input type="hidden" name="orderId" value={item.orderId} />
            {nextDispatchInstruction ? (
              <div className="rounded-[8px] border border-needle/14 bg-mint/32 px-4 py-3 text-sm font-medium leading-6 text-needle-800">
                {nextDispatchInstruction}
              </div>
            ) : null}
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm text-ink/72">Delivery update<select required name="eventType" className="rounded-2xl border border-ink/10 bg-white px-4 py-3">{eventOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="grid gap-2 text-sm text-ink/72">Provider<input name="providerName" defaultValue={parcel?.providerName ?? run?.providerName ?? ''} className="rounded-2xl border border-ink/10 bg-white px-4 py-3" /></label>
              <label className="grid gap-2 text-sm text-ink/72">Service level<input name="serviceLevel" defaultValue={parcel?.serviceLevel ?? (isLocalDelivery ? 'STANDARD' : 'INTERNATIONAL_STANDARD')} className="rounded-2xl border border-ink/10 bg-white px-4 py-3" /></label>
              <label className="grid gap-2 text-sm text-ink/72">Provider reference<input name="providerReference" defaultValue={parcel?.providerReference ?? ''} className="rounded-2xl border border-ink/10 bg-white px-4 py-3" /></label>
              <label className="grid gap-2 text-sm text-ink/72">Tracking number<input name="trackingNumber" defaultValue={parcel?.trackingNumber ?? ''} className="rounded-2xl border border-ink/10 bg-white px-4 py-3" /></label>
              <label className="grid gap-2 text-sm text-ink/72">Tracking link<input type="url" name="trackingUrl" defaultValue={parcel?.trackingUrl ?? ''} className="rounded-2xl border border-ink/10 bg-white px-4 py-3" /></label>
              <DispatchContextFields
                defaultLocationLabel={typeof parcel?.lastLocation?.label === 'string' ? parcel.lastLocation.label : ''}
                defaultLatitude={typeof parcel?.lastLocation?.latitude === 'number' ? String(parcel.lastLocation.latitude) : ''}
                defaultLongitude={typeof parcel?.lastLocation?.longitude === 'number' ? String(parcel.lastLocation.longitude) : ''}
              />
              <label className="grid gap-2 text-sm text-ink/72">Photo proof <span className="text-xs text-ink/45">Required for custody and delivery</span><input type="file" name="eventEvidence" accept="image/jpeg,image/png,image/webp" className="rounded-2xl border border-ink/10 bg-white px-4 py-3" /></label>
            </div>
            <label className="grid gap-2 text-sm text-ink/72">Customer update<textarea name="customerNote" rows={2} className="rounded-[8px] border border-ink/10 bg-white px-4 py-3" placeholder="Plain-language update shown to both people." /></label>
            <label className="grid gap-2 text-sm text-ink/72">Private Ops note<textarea name="internalNote" rows={2} className="rounded-[8px] border border-ink/10 bg-white px-4 py-3" /></label>
            <button type="submit" className="inline-flex w-fit items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white">
              {run?.status === 'IN_TRANSIT' && !run.custodyAcceptedAt ? 'Save missing handoff proof' : 'Save delivery update'}
            </button>
          </form>
        ) : null}

        {item.fulfillmentEvents.length > 0 ? (
          <details className="mt-4 rounded-[10px] border border-ink/8 bg-white/70 p-4">
            <summary className="cursor-pointer font-semibold text-ink">Delivery history · {item.fulfillmentEvents.length}</summary>
            <div className="mt-3 grid gap-3">{item.fulfillmentEvents.map((event) => <div key={event.id} className="border-t border-ink/8 pt-3"><p className="font-medium text-ink">{formatDatabaseEnumLabel(event.eventType, 'Update')}</p><p className="text-sm text-ink/55">{formatDateTime(event.occurredAt)}{event.customerNote ? ` · ${event.customerNote}` : ''}</p>{event.evidence.length ? <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{event.evidence.map((evidence, index) => <EvidenceMediaTile key={`${evidence.url}-${index}`} url={evidence.url} label={`${formatDatabaseEnumLabel(event.eventType, 'Delivery update')} proof ${index + 1}`} />)}</div> : null}</div>)}</div>
          </details>
        ) : null}
      </div>
    </CardCollapse>
  )
}

function OrderReviewCard({
  review,
  redirectTo,
}: {
  review: OpsOrderReviewItem
  redirectTo: string
}): React.JSX.Element {
  const reviewTypeLabel = review.reviewType === 'CANCELLATION' ? 'Cancellation review' : 'Delivery review'
  const reviewPausedOrder =
    review.reviewType === 'CANCELLATION'
    || review.riskAction === 'ORDER_AND_UNRELEASED_SETTLEMENT_PAUSED'
  const continueLabel =
    review.reviewType === 'CANCELLATION'
      ? 'Keep order active'
      : reviewPausedOrder && review.requestedFromStage
        ? `Return to ${formatDatabaseEnumLabel(review.requestedFromStage).toLowerCase()}`
        : 'Close help request'
  const refundLabel =
    review.reviewType === 'CANCELLATION'
      ? 'Approve cancellation'
      : 'Refund order'

  return (
    <CardCollapse
      background="bg-[linear-gradient(180deg,#fffdf9_0%,#f6efe5_100%)]"
      summary={
        <>
          <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${statusPillClass('UNDER_REVIEW')}`}>
            {reviewTypeLabel}
          </span>
          <span className="font-semibold text-ink">Order {review.orderReference ? `#${review.orderReference}` : review.orderId}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink/48">{review.reasonLabel}</span>
          <span className="shrink-0 text-xs text-ink/38">{formatRelativeTime(review.requestedAt)}</span>
        </>
      }
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg text-ink">Order {review.orderReference ? `#${review.orderReference}` : review.orderId}</span>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusPillClass('UNDER_REVIEW')}`}>
              {reviewTypeLabel}
            </span>
          </div>
          <p className="mt-2 text-sm leading-7 text-ink/66">{review.reasonLabel}</p>
        </div>
        <a
          href={sectionMailto(`${reviewTypeLabel}: ${review.orderReference ?? review.orderId}`)}
          className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone"
        >
          Email ops
        </a>
      </div>

      <div className="mt-5 grid gap-5">
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Parties</p>
          <DetailList
            items={[
              { label: 'Customer', value: review.customerEmail ? `${review.customerName} · ${review.customerEmail}` : review.customerName },
              { label: 'Tailor', value: review.tailorEmail ? `${review.tailorName} · ${review.tailorEmail}` : review.tailorName },
            ]}
          />
        </div>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Review</p>
          <DetailList
            items={[
              { label: 'Requested by', value: review.requestedBy },
              {
                label: 'Current stage',
                value: <StatusChip status={review.orderStage} domain="order" fallback="Not available" />,
              },
              {
                label: 'Opened from',
                value: <StatusChip status={review.requestedFromStage} domain="order" fallback="Not available" />,
              },
              {
                label: 'Money protection',
                value: reviewPausedOrder ? 'Order and unreleased settlement paused' : 'Order stays active · Ops follow-up only',
              },
              { label: 'Opened', value: formatDateTime(review.requestedAt) },
            ]}
          />
        </div>
      </div>

      {review.note ? (
        <div className="mt-5 rounded-[8px] border border-ink/6 bg-white/82 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Note</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink/78">{review.note}</p>
        </div>
      ) : null}

      <form action="/ops/action" method="post" className="mt-5 grid gap-3 rounded-[8px] border border-ink/6 bg-white/82 p-4">
        <input type="hidden" name="kind" value="order-review-resolution" />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <input type="hidden" name="orderId" value={review.orderId} />
        <input type="hidden" name="reviewType" value={review.reviewType} />
        <label className="grid gap-2 text-sm text-ink/72">
          Ops note
          <textarea
            name="resolution"
            rows={3}
            defaultValue=""
            className="rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
            placeholder={
              review.reviewType === 'CANCELLATION'
                ? 'Optional note like: We approved the cancellation and refund because the seller cannot fulfil the order.'
                : 'Optional note like: We reviewed the dispatch issue and returned the order to the live delivery flow.'
            }
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            name="outcome"
            value="REFUND"
            className="inline-flex items-center justify-center rounded-full bg-rust px-5 py-3 text-sm font-semibold text-white transition hover:bg-rust/90"
          >
            {refundLabel}
          </button>
          <button
            type="submit"
            name="outcome"
            value="CONTINUE"
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:bg-bone"
          >
            {continueLabel}
          </button>
        </div>
        <p className="text-xs leading-6 text-ink/58">
          Both sides will see this result in the order timeline. A refund requires Money Desk approval. {reviewPausedOrder
            ? 'Closing the review returns the order to its previous live stage and rechecks settlement.'
            : 'Closing this help request leaves the order at its current stage.'}
        </p>
      </form>
    </CardCollapse>
  )
}

const OPS_LOGIN_SECTIONS = [
  'Disputes', 'Payouts', 'Workflow issues', 'Dispatch',
  'Support', 'Verification', 'Applications', 'Reviews',
  'Bypass', 'Deletions', 'Incidents', 'Runbook',
]

function LoginView({
  error,
}: {
  error: string | null
}): React.JSX.Element {
  const bootstrapRole = getOpsBootstrapRole()

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(45,106,79,0.16),transparent_34%),radial-gradient(circle_at_80%_12%,rgba(216,90,48,0.12),transparent_28%),linear-gradient(180deg,#f7f1e8_0%,#efe8db_100%)]">
      <div className="mx-auto flex min-h-screen max-w-3xl items-center px-5 py-12 sm:px-8">
        <div className="grid w-full gap-4 lg:grid-cols-[1fr_1.4fr]">
          <div className="rounded-[8px] bg-ink p-8 text-white">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/46">Internal ops</p>
            <h1 className="mt-5 text-4xl leading-[1.06] text-white">Drapeon<br />control plane</h1>
            <p className="mt-4 text-sm leading-7 text-white/56">
              One surface for disputes, payouts, trust, and operations. Role-scoped per person.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              {OPS_LOGIN_SECTIONS.map((section) => (
                <span
                  key={section}
                  className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/46"
                >
                  {section}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-[8px] border border-white/70 bg-white/88 p-8 shadow-[0_28px_90px_rgba(22,28,24,0.10)] backdrop-blur">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-needle/80">Bootstrap token</p>
            <h2 className="mt-3 text-3xl text-ink">Unlock ops</h2>
            <p className="mt-2 text-sm leading-7 text-ink/60">
              Enter the shared ops token to open a scoped session on this device.
            </p>

            {error ? (
              <div className="mt-5 rounded-[8px] border border-rust/16 bg-rust/8 px-4 py-3 text-sm leading-7 text-rust-700">
                {error}
              </div>
            ) : null}

            <form action="/ops/login" method="post" className="mt-6 grid gap-3">
              <input type="hidden" name="redirectTo" value="/ops" />
              <input
                required
                type="password"
                name="token"
                autoFocus
                className="h-12 rounded-2xl border border-ink/10 bg-white px-5 text-sm text-ink outline-none transition placeholder:text-ink/32 focus:border-needle/40"
                placeholder="Enter the internal token"
              />
              <button
                type="submit"
                className="inline-flex h-12 items-center justify-center rounded-full bg-needle px-5 text-sm font-semibold text-white transition hover:bg-needle/90"
              >
                Open ops dashboard
              </button>
            </form>

            <div className="mt-6 rounded-[8px] border border-ink/6 bg-bone/60 px-4 py-3 text-[11px] leading-6 text-ink/50">
              Bootstrap role: <span className="font-semibold text-ink/68">{formatDatabaseEnumLabel(bootstrapRole)}</span>
              {' · '}
              Per-person enforcement moves to workforce SSO.
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

function WorkforceAccessView({
  error,
}: {
  error: string | null
}): React.JSX.Element {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(45,106,79,0.16),transparent_34%),radial-gradient(circle_at_80%_12%,rgba(216,90,48,0.12),transparent_28%),linear-gradient(180deg,#f7f1e8_0%,#efe8db_100%)]">
      <div className="mx-auto flex min-h-screen max-w-4xl items-center px-5 py-12 sm:px-8">
        <section className="w-full rounded-lg border border-white/70 bg-white/82 p-7 shadow-[0_28px_90px_rgba(22,28,24,0.12)] backdrop-blur sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Internal ops</p>
          <h1 className="mt-4 text-5xl leading-[0.94] text-ink sm:text-6xl">Use Drapeon workforce access, not a shared token.</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-ink/68">
            This control plane is configured for workforce login. Cloudflare Access should challenge the request before the app loads, and only `@drapeon.co` identities with an assigned role should reach this page.
          </p>

          <div className="mt-8 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-lg bg-ink p-6 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/62">What happens here</p>
              <div className="mt-4 grid gap-3 text-sm leading-7 text-white/78">
                <p>Cloudflare Access gates the route before page load.</p>
                <p>Only `@drapeon.co` workforce identities should be admitted.</p>
                <p>App-level permissions still decide which sections and actions are allowed.</p>
                <p>If access feels wrong, it is usually an Access policy, audience, or role assignment issue.</p>
              </div>
            </div>

            <div className="rounded-lg border border-ink/8 bg-[linear-gradient(180deg,#faf5ed_0%,#f2eade_100%)] p-6">
              <h2 className="text-3xl text-ink">Workforce checklist</h2>
              <div className="mt-4 grid gap-3 text-sm leading-7 text-ink/66">
                <p>1. The route is behind Cloudflare Access.</p>
                <p>2. Your sign-in identity uses `@drapeon.co`.</p>
                <p>3. The Access application audience is configured in web envs.</p>
                <p>4. Your email or group is assigned to a Drapeon control-plane role.</p>
              </div>
              {error ? (
                <div className="mt-5 rounded-[8px] border border-rust/16 bg-rust/8 px-4 py-3 text-sm leading-7 text-rust-700">
                  {error}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function SetupView(): React.JSX.Element {
  const bootstrapRole = getOpsBootstrapRole()
  const workforceConfigured = hasOpsWorkforceAccessConfig()
  const tokenStatus = getOpsDashboardTokenStatus()
  const hasWeakToken = tokenStatus === 'weak'
  const productionBootstrapBlocked =
    process.env.NODE_ENV === 'production' &&
    !workforceConfigured &&
    tokenStatus === 'ready' &&
    process.env.OPS_ALLOW_BOOTSTRAP_IN_PRODUCTION !== '1'

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f7f1e8_0%,#efe7da_100%)]">
      <div className="mx-auto flex min-h-screen max-w-4xl items-center px-5 py-12 sm:px-8">
        <section className="w-full rounded-lg border border-ink/8 bg-white/86 p-8 shadow-[0_24px_80px_rgba(22,28,24,0.08)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Internal ops</p>
          <h1 className="mt-4 text-4xl text-ink sm:text-5xl">
            {productionBootstrapBlocked
              ? 'Connect workforce access before this surface opens.'
              : hasWeakToken
                ? 'Strengthen the ops token before this surface opens.'
                : 'Set one token to bring the ops surface online.'}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-ink/68">
            {productionBootstrapBlocked
              ? 'Production ops requires Cloudflare Access by default. Use OPS_ALLOW_BOOTSTRAP_IN_PRODUCTION=1 only for a documented emergency window.'
              : hasWeakToken
                ? 'The configured bootstrap token is too short or uses a placeholder value. Use Cloudflare Access for production, or set a 32+ character emergency token.'
                : 'This route is intentionally locked until the shared ops token is configured in the web environment.'}
          </p>
          <div className="mt-8 rounded-[8px] border border-ink/8 bg-bone/70 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/46">Required env</p>
            {workforceConfigured ? (
              <>
                <code className="mt-3 block whitespace-pre-wrap rounded-[8px] bg-ink px-4 py-4 text-sm leading-7 text-white">
                  CF_ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com
                </code>
                <code className="mt-3 block whitespace-pre-wrap rounded-[8px] bg-ink px-4 py-4 text-sm leading-7 text-white">
                  CF_ACCESS_AUD=your_access_application_audience
                </code>
              </>
            ) : (
              <>
                <code className="mt-3 block whitespace-pre-wrap rounded-[8px] bg-ink px-4 py-4 text-sm leading-7 text-white">
                  OPS_DASHBOARD_TOKEN=your_shared_internal_token
                </code>
                <code className="mt-3 block whitespace-pre-wrap rounded-[8px] bg-ink px-4 py-4 text-sm leading-7 text-white">
                  OPS_DASHBOARD_BOOTSTRAP_ROLE={bootstrapRole}
                </code>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

function OpsNavItem({
  href,
  label,
  count,
  active,
}: {
  href: string
  label: string
  count: number
  active: boolean
}): React.JSX.Element {
  const countClass = count > 0
    ? 'border-rust/16 bg-rust/8 text-rust-700'
    : 'border-ink/8 bg-white/70 text-ink/40'

  return (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center justify-between rounded-[8px] border px-4 py-2.5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle/60 ${
        active
          ? 'border-needle/18 bg-needle/10 text-ink'
          : 'border-transparent text-ink/64 hover:border-ink/8 hover:bg-white/70 hover:text-ink'
      }`}
    >
      <p className="text-sm font-medium">{label}</p>
      {count > 0 ? (
        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums ${countClass}`}>
          {count}
        </span>
      ) : null}
    </a>
  )
}

const OPS_TEAM_NAV_ORDER: OpsTeam[] = [
  'ADMIN',
  'CUSTOMER_SUCCESS',
  'OPS',
  'TRUST',
  'FINANCE',
  'ENGINEERING',
]

const OPS_TEAM_NAV_LABELS: Record<OpsTeam, string> = {
  ADMIN: 'Workspace',
  CUSTOMER_SUCCESS: 'Customer success',
  OPS: 'Operations',
  TRUST: 'Trust & safety',
  FINANCE: 'Finance',
  ENGINEERING: 'Engineering',
}

function buildOpsNavigationGroups(sections: OpsVisibleSection[]) {
  return OPS_TEAM_NAV_ORDER
    .map((team) => ({
      team,
      label: OPS_TEAM_NAV_LABELS[team],
      sections: sections.filter((section) => section.team === team),
    }))
    .filter((group) => group.sections.length > 0)
}

function matchesOpsSearch(value: unknown, query: string) {
  return JSON.stringify(value).toLowerCase().includes(query.toLowerCase())
}

function filterOpsDashboardData(data: OpsDashboardData, query: string): OpsDashboardData {
  const trimmed = query.trim()
  if (!trimmed) return data

  return {
    ...data,
    disputes: data.disputes.filter((item) => matchesOpsSearch(item, trimmed)),
    bypassLogs: data.bypassLogs.filter((item) => matchesOpsSearch(item, trimmed)),
    applications: data.applications.filter((item) => matchesOpsSearch(item, trimmed)),
    pendingVerifications: data.pendingVerifications.filter((item) => matchesOpsSearch(item, trimmed)),
    deletionRequests: data.deletionRequests.filter((item) => matchesOpsSearch(item, trimmed)),
    reviewQueue: data.reviewQueue.filter((item) => matchesOpsSearch(item, trimmed)),
    payouts: data.payouts.filter((item) => matchesOpsSearch(item, trimmed)),
    moneyDeskRequests: data.moneyDeskRequests.filter((item) => matchesOpsSearch(item, trimmed)),
    returnResolutions: data.returnResolutions.filter((item) => matchesOpsSearch(item, trimmed)),
    shopItems: data.shopItems.filter((item) => matchesOpsSearch(item, trimmed)),
    supportThreads: data.supportThreads.filter((item) => matchesOpsSearch(item, trimmed)),
    orderReviews: data.orderReviews.filter((item) => matchesOpsSearch(item, trimmed)),
    workflowIssues: data.workflowIssues.filter((item) => matchesOpsSearch(item, trimmed)),
    dispatchQueue: data.dispatchQueue.filter((item) => matchesOpsSearch(item, trimmed)),
  }
}

function IncidentSurface({
  data,
  currentView,
  role,
}: {
  data: OpsDashboardData
  currentView: OpsView
  role: OpsRole
}): React.JSX.Element {
  const degradedProviders = data.systemHealth.providers.filter((provider) => provider.status.toUpperCase() !== 'OK')
  const incidentIssues = data.workflowIssues.filter((issue) => {
    const severity = issue.severity.toUpperCase()
    const status = issue.status.toUpperCase()
    return ['CRITICAL', 'HIGH'].includes(severity) || ['OPEN', 'ESCALATED'].includes(status)
  })
  const queueHasRisk =
    data.systemHealth.jobQueue.dead > 0 || data.systemHealth.jobQueue.retryable > 0 || data.systemHealth.jobQueue.pending > 25

  return (
    <SectionFrame
      id="incidents"
      eyebrow="Incident command"
      title="Provider and queue failures need one owner before they turn into customer pain."
      description="This is the live launch incident board: provider circuits, retry pressure, dead-lettered jobs, and high-severity workflow issues. It stays inside ops, uses server-only data, and creates manual issues instead of hiding work in Slack."
    >
      <div className="grid gap-5">
        <JobQueueCard queue={data.systemHealth.jobQueue} />

        <div className="rounded-[8px] border border-ink/8 bg-white/86 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/78">Incident posture</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <SummaryCard
              label="Provider alerts"
              value={degradedProviders.length}
              hint="Tracked provider lanes currently degraded or open."
            />
            <SummaryCard
              label="Queue risk"
              value={queueHasRisk ? 1 : 0}
              hint="Raised when jobs are dead-lettered, retrying, or backing up."
            />
            <SummaryCard
              label="Open incident candidates"
              value={incidentIssues.length}
              hint="High-severity workflow issues that deserve incident-style handling."
            />
          </div>
        </div>

        <details>
          <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-[8px] border border-needle/14 bg-needle/7 px-5 py-3 text-sm font-semibold text-needle-700 transition hover:bg-needle/10 [&::-webkit-details-marker]:hidden">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-needle/22 bg-white text-[15px] font-bold leading-none text-needle">+</span>
            New case
          </summary>
          <div className="mt-4">
            <ManualIssueCreateCard redirectTo={buildOpsRedirectTarget(currentView, 'incidents')} />
          </div>
        </details>

        {degradedProviders.length > 0 ? (
          <div className="grid gap-5">
            {degradedProviders.map((provider) => (
              <ProviderCircuitCard
                key={`${provider.provider}:${provider.operation}`}
                provider={provider}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No provider circuits are degraded right now."
            body="When Stripe, Paystack, push, email, SMS, or shipping circuit health degrades, the affected lane will show here with the latest provider error."
          />
        )}

        {incidentIssues.length > 0 ? (
          <div className="grid gap-5">
            {incidentIssues.map((issue) => (
              <WorkflowIssueCard
                key={issue.id}
                issue={issue}
                redirectTo={buildOpsRedirectTarget(currentView, 'incidents')}
                role={role}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No high-severity workflow issues need incident handling."
            body="Lower-severity support and workflow issues stay in the workflow lane so engineering can focus on true launch incidents here."
          />
        )}
      </div>
    </SectionFrame>
  )
}

function AccessControlSurface({ context }: { context: OpsRenderContext }): React.JSX.Element {
  const accessModeLabel =
    context.accessMode === 'cloudflare-access'
      ? 'Cloudflare Access'
      : context.accessMode === 'local-workforce'
        ? 'Local workforce dry run'
        : context.accessMode === 'bootstrap-token'
          ? 'Bootstrap token'
          : 'Unconfigured'
  const currentSections = getOpsRoleSections(context.session.role)
  const currentActions = getOpsRoleActions(context.session.role)

  return (
    <SectionFrame
      id="access"
      eyebrow="People and access"
      title="Every ops control should have an owner and a guard."
      description="This is the launch access map for the internal control plane. It keeps the current auth mode, current role, section visibility, and action permissions visible before we move fully to workforce SSO."
    >
      <div className="grid gap-5">
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="rounded-[8px] border border-ink/8 bg-white/86 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/78">Access mode</p>
            <h3 className="mt-3 text-2xl text-ink">{accessModeLabel}</h3>
            <p className="mt-3 text-sm leading-7 text-ink/64">
              {context.accessMode === 'cloudflare-access'
                ? 'Workforce login is gating the route before this app loads.'
                : context.accessMode === 'local-workforce'
                  ? 'Development-only named identity simulation. Money Desk records it as a dry run and it cannot activate in production.'
                  : 'This environment is using the shared bootstrap token. Keep it dev-only and move production behind workforce access.'}
            </p>
          </div>
          <div className="rounded-[8px] border border-ink/8 bg-white/86 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/78">Current session</p>
            <h3 className="mt-3 text-2xl text-ink">{formatDatabaseEnumLabel(context.session.role)}</h3>
            <p className="mt-3 text-sm leading-7 text-ink/64">
              {context.session.email ?? 'Shared-token session without an individual email claim.'}
            </p>
          </div>
          <div className="rounded-[8px] border border-ink/8 bg-white/86 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/78">Current reach</p>
            <h3 className="mt-3 text-2xl text-ink">{currentSections.length} sections</h3>
            <p className="mt-3 text-sm leading-7 text-ink/64">
              {currentActions.length} mutation types are allowed for this role. Everything else is blocked server-side by the action route.
            </p>
          </div>
        </div>

        <div className="rounded-[8px] border border-ink/8 bg-bone/58 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/78">Launch rule</p>
          <p className="mt-2 text-sm leading-7 text-ink/68">
            Production should use Cloudflare Access plus app-level role checks. The shared token is useful for dev unblockers, but it should never become the long-term production control plane.
          </p>
        </div>

        <div className="grid gap-5">
          {OPS_ROLE_ORDER.map((role) => (
            <RoleAccessCard key={role} role={role} />
          ))}
        </div>
      </div>
    </SectionFrame>
  )
}

function OpsRunbookSurface({ context }: { context: OpsRenderContext }): React.JSX.Element {
  const normalizedQuery = context.query.trim().toLowerCase()
  const entries = normalizedQuery
    ? OPS_RUNBOOK_ENTRIES.filter((entry) => {
        const haystack = [
          entry.title,
          entry.owner,
          entry.severity,
          entry.bucket ?? '',
          entry.useWhen,
          entry.firstMove,
          entry.customerCopy,
          entry.tailorCopy,
          ...entry.keywords,
          ...entry.opsActions,
        ]
          .join(' ')
          .toLowerCase()
        return haystack.includes(normalizedQuery)
      })
    : OPS_RUNBOOK_ENTRIES

  return (
    <SectionFrame
      id="runbook"
      eyebrow="Ops knowledge"
      title="Search the next move before replying."
      description="Use this when a live order, payout, message, dispatch, or fit problem needs a consistent Drapeon response. The copy is written to protect the trust chain without overpromising."
    >
      <div className="grid gap-5">
        {entries.length > 0 ? (
          entries.map((entry) => (
            <article
              key={entry.title}
              className="rounded-[8px] border border-ink/8 bg-white/88 p-5 shadow-sm"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-needle/14 bg-needle/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-needle-700">
                      {entry.owner}
                    </span>
                    <span className="rounded-full border border-ink/8 bg-bone px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/56">
                      {entry.severity}
                    </span>
                    {entry.bucket ? (
                      <span className="rounded-full border border-ink/8 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">
                        {OPS_RUNBOOK_BUCKET_LABELS[entry.bucket] ?? entry.bucket}
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-3 text-2xl text-ink">{entry.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-ink/64">{entry.useWhen}</p>
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
                <div className="rounded-[8px] border border-needle/12 bg-needle/8 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/78">First move</p>
                  <p className="mt-2 text-sm leading-7 text-ink/70">{entry.firstMove}</p>
                </div>
                <div className="rounded-[8px] border border-ink/8 bg-bone/62 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Search terms</p>
                  <p className="mt-2 text-sm leading-7 text-ink/62">{entry.keywords.join(', ')}</p>
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="rounded-[8px] border border-ink/8 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Customer copy</p>
                  <p className="mt-2 text-sm leading-7 text-ink/68">{entry.customerCopy}</p>
                </div>
                <div className="rounded-[8px] border border-ink/8 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Tailor copy</p>
                  <p className="mt-2 text-sm leading-7 text-ink/68">{entry.tailorCopy}</p>
                </div>
              </div>

              <div className="mt-4 rounded-[8px] border border-ink/8 bg-bone/52 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Ops actions</p>
                <ul className="mt-3 grid gap-2 text-sm leading-7 text-ink/68">
                  {entry.opsActions.map((action) => (
                    <li key={action} className="flex gap-3">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-needle" />
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))
        ) : (
          <EmptyState
            title="No runbook entry matches that search."
            body="Try a word like payout, stale, fit, delivery, refund, bypass, deletion, or fabric. If this keeps happening, add a new runbook entry before the answer lives only in someone's head."
          />
        )}
      </div>
    </SectionFrame>
  )
}

type OpsNextDecisionItem = {
  id: string
  view: OpsView
  label: string
  what: string
  who: string
  nextAction: string
  danger: 'safe' | 'caution' | 'destructive'
  age: string
  moneyAtRisk: number | null
  moneyCurrency: string | null
}

function buildNextDecisions(data: OpsDashboardData, visibleSections: OpsVisibleSection[]): OpsNextDecisionItem[] {
  const allowed = new Set(visibleSections.map((s) => s.key))
  const items: OpsNextDecisionItem[] = []

  if (allowed.has('workflow-issues')) {
    for (const issue of data.workflowIssues) {
      const sev = issue.severity.toUpperCase()
      if (issue.status === 'RESOLVED') continue
      const moneyAtRisk = issue.maxRefundableAmount > 0 ? issue.maxRefundableAmount : (issue.orderTotalAmount ?? 0)
      items.push({
        id: `wi-${issue.id}`,
        view: 'workflow-issues',
        label: `${issue.displayId} · ${workflowIssueLabel(issue.event)}`,
        what: issue.summary,
        who: `${issue.actorName}${issue.actorRole ? ` · ${formatDatabaseEnumLabel(issue.actorRole).toLowerCase()}` : ''}`,
        nextAction: issue.recommendedAction,
        danger: sev === 'CRITICAL' ? 'destructive' : sev === 'HIGH' || issue.maxRefundableAmount > 0 ? 'caution' : 'safe',
        age: formatRelativeTime(issue.createdAt),
        moneyAtRisk: moneyAtRisk > 0 ? moneyAtRisk : null,
        moneyCurrency: issue.orderCurrency,
      })
    }
  }

  if (allowed.has('payouts')) {
    for (const payout of data.payouts) {
      const st = payout.status.toUpperCase()
      if (!['BLOCKED', 'FAILED'].includes(st)) continue
      items.push({
        id: `pay-${payout.id}`,
        view: 'payouts',
        label: payout.orderReference ? `Order #${payout.orderReference}` : 'Blocked payout',
        what: `Payout ${formatDatabaseEnumLabel(payout.status).toLowerCase()}: ${payout.blockedReasonMessage ?? formatDatabaseEnumLabel(payout.blockedReason, 'no reason recorded')}`,
        who: `${payout.tailorDisplayName} (tailor)`,
        nextAction: 'Check escrow, customer confirmation, dispute state, and provider account — then retry payout release.',
        danger: 'destructive',
        age: formatRelativeTime(payout.processedAt),
        moneyAtRisk: payout.amount,
        moneyCurrency: payout.currency,
      })
    }
  }

  if (allowed.has('disputes')) {
    for (const dispute of data.disputes) {
      if (!['OPEN', 'UNDER_REVIEW'].includes(dispute.status)) continue
      items.push({
        id: `dis-${dispute.id}`,
        view: 'disputes',
        label: dispute.orderReference ? `Order #${dispute.orderReference}` : dispute.orderId.slice(0, 8),
        what: `${dispute.status === 'UNDER_REVIEW' ? 'Under review' : 'Open dispute'}: ${dispute.reason}`,
        who: `${dispute.customerName} vs ${dispute.tailorName}`,
        nextAction: 'Review and decide: refund the customer or release to the tailor.',
        danger: 'destructive',
        age: formatRelativeTime(dispute.createdAt),
        moneyAtRisk: dispute.amount,
        moneyCurrency: dispute.currency,
      })
    }
  }

  if (allowed.has('support')) {
    for (const thread of data.supportThreads) {
      if (thread.unreadCount === 0 && !thread.conversationBlocked) continue
      items.push({
        id: `sup-${thread.orderId}`,
        view: 'support',
        label: thread.orderReference ? `Order #${thread.orderReference}` : 'Support thread',
        what: thread.unreadCount > 0
          ? `${thread.unreadCount} unread from ${thread.latestSenderName}`
          : 'Conversation paused — needs ops review',
        who: `${thread.customerName} (customer) · ${thread.tailorName} (tailor)`,
        nextAction: thread.conversationBlocked
          ? 'Review thread and decide if it is safe to reopen.'
          : 'Read the thread and step in if the customer or tailor needs help.',
        danger: thread.conversationBlocked ? 'caution' : 'safe',
        age: formatRelativeTime(thread.latestMessageAt),
        moneyAtRisk: null,
        moneyCurrency: null,
      })
    }
  }

  if (allowed.has('order-reviews')) {
    for (const review of data.orderReviews) {
      items.push({
        id: `or-${review.id}`,
        view: 'order-reviews',
        label: review.orderReference ? `Order #${review.orderReference}` : 'Order review',
        what: `${review.reviewType === 'CANCELLATION' ? 'Cancellation' : 'Delivery'} review: ${review.reasonLabel}`,
        who: `Requested by ${review.requestedBy}`,
        nextAction: review.reviewType === 'CANCELLATION'
          ? 'Approve cancellation and refund, or keep the order active.'
          : 'Return to the live delivery flow, or refund the order.',
        danger: 'caution',
        age: formatRelativeTime(review.requestedAt),
        moneyAtRisk: null,
        moneyCurrency: null,
      })
    }
  }

  items.sort((a, b) => {
    const rank = { destructive: 0, caution: 1, safe: 2 }
    const dangerDiff = rank[a.danger] - rank[b.danger]
    if (dangerDiff !== 0) return dangerDiff
    return (b.moneyAtRisk ?? 0) - (a.moneyAtRisk ?? 0)
  })

  return items.slice(0, 5)
}

function NextDecisionRow({ item }: { item: OpsNextDecisionItem }): React.JSX.Element {
  const dangerClass =
    item.danger === 'destructive'
      ? 'border-rust/16 bg-rust/7'
      : item.danger === 'caution'
        ? 'border-needle/14 bg-needle/6'
        : 'border-ink/8 bg-white/72'

  const dangerBadgeClass =
    item.danger === 'destructive'
      ? 'border-rust/18 bg-rust/10 text-rust-700'
      : item.danger === 'caution'
        ? 'border-needle/18 bg-needle/10 text-needle-700'
        : 'border-ink/10 bg-bone text-ink/56'

  const dangerLabel =
    item.danger === 'destructive' ? 'Needs action' : item.danger === 'caution' ? 'Watch' : 'Low urgency'

  return (
    <a
      href={buildOpsHref(item.view)}
      className={`grid gap-3 rounded-[8px] border p-4 transition hover:-translate-y-0.5 hover:bg-white sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start ${dangerClass}`}
    >
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ink">{item.label}</span>
          <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${dangerBadgeClass}`}>
            {dangerLabel}
          </span>
          {item.moneyAtRisk ? (
            <span className="inline-flex rounded-full border border-rust/14 bg-rust/8 px-2.5 py-1 text-[10px] font-semibold text-rust-700">
              {formatMoney(item.moneyAtRisk, item.moneyCurrency)} at risk
            </span>
          ) : null}
        </div>
        <p className="text-sm leading-6 text-ink/68">{item.what}</p>
        <div className="grid gap-1 sm:grid-cols-2">
          <p className="text-xs text-ink/50">
            <span className="font-semibold uppercase tracking-[0.13em] text-ink/30">Who</span>{'  '}{item.who}
          </p>
          <p className="text-xs text-ink/50">
            <span className="font-semibold uppercase tracking-[0.13em] text-ink/30">Age</span>{'  '}{item.age}
          </p>
        </div>
        <div className="rounded-lg border border-needle/12 bg-needle/7 px-3 py-2 text-xs leading-6 text-ink/72">
          <span className="font-semibold uppercase tracking-[0.13em] text-needle/68">Next</span>{'  '}{item.nextAction}
        </div>
      </div>
      <span className="text-sm font-semibold text-needle">Open</span>
    </a>
  )
}

function OpsOverviewSurface({
  data,
  visibleSections,
}: {
  data: OpsDashboardData
  visibleSections: OpsVisibleSection[]
}): React.JSX.Element {
  const priorityItems = buildPriorityQueueItems(data, visibleSections)
  const nextDecisions = buildNextDecisions(data, visibleSections)
  const providerIssueCount = data.summary.providersDegraded + data.summary.deadJobs + data.summary.retryableJobs
  const moneyNeedsAttention = data.summary.pendingPayoutCount + data.summary.openDisputes + data.summary.pendingOrderReviews

  return (
    <div className="grid gap-6">
      {nextDecisions.length > 0 ? (
        <section className="rounded-[8px] border border-ink/8 bg-white/86 p-5 shadow-[0_18px_60px_rgba(22,28,24,0.08)] sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-needle/76">My next decisions</p>
              <h2 className="mt-2 text-2xl text-ink sm:text-3xl">Act on these first.</h2>
            </div>
            <span className="rounded-full border border-rust/16 bg-rust/8 px-3 py-1.5 text-xs font-semibold text-rust-700">
              {nextDecisions.length} need you
            </span>
          </div>
          <div className="mt-5 grid gap-3">
            {nextDecisions.map((item) => (
              <NextDecisionRow key={item.id} item={item} />
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-[8px] border border-ink/8 bg-white/86 p-5 shadow-[0_18px_60px_rgba(22,28,24,0.08)] sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-needle/76">My next decisions</p>
          <h2 className="mt-2 text-2xl text-ink sm:text-3xl">Queues are clear.</h2>
          <p className="mt-2 text-sm leading-7 text-ink/60">No blocked payouts, open disputes, or high-severity issues need your attention right now.</p>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <section className="rounded-[8px] border border-ink/8 bg-white/82 p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">All queues</p>
              <h3 className="mt-2 text-xl text-ink">Full workload</h3>
            </div>
            <div className="flex items-center gap-2">
              <CompactMetric label="Money" value={moneyNeedsAttention} tone={moneyNeedsAttention > 0 ? 'attention' : 'good'} />
              <CompactMetric label="System" value={providerIssueCount} tone={providerIssueCount > 0 ? 'attention' : 'good'} />
            </div>
          </div>
          <div className="mt-5 grid gap-3">
            {priorityItems.map((item) => (
              <QueueRow key={item.view} item={item} />
            ))}
          </div>
        </section>

        <section className="rounded-[8px] border border-ink/8 bg-white/82 p-5 shadow-sm sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">System pulse</p>
          <div className="mt-4 grid gap-3">
            <div className="rounded-[8px] border border-ink/8 bg-bone/48 p-4">
              <p className="text-sm font-semibold text-ink">Background queue</p>
              <p className="mt-2 text-sm leading-7 text-ink/62">
                {data.systemHealth.jobQueue.pending} pending · {data.systemHealth.jobQueue.processing} processing · {data.systemHealth.jobQueue.retryable} retrying · {data.systemHealth.jobQueue.dead} dead.
              </p>
            </div>
            <div className="rounded-[8px] border border-ink/8 bg-bone/48 p-4">
              <p className="text-sm font-semibold text-ink">Provider circuits</p>
              <p className="mt-2 text-sm leading-7 text-ink/62">
                {data.systemHealth.providers.length === 0
                  ? 'No provider circuit records yet.'
                  : `${data.summary.providersDegraded} degraded across ${data.systemHealth.providers.length} tracked lanes.`}
              </p>
            </div>
            <div className="rounded-[8px] border border-ink/8 bg-bone/48 p-4">
              <p className="text-sm font-semibold text-ink">Escrow</p>
              <p className="mt-2 text-sm leading-7 text-ink/62">
                {data.summary.ordersInEscrowValueLabel} protected across {data.summary.ordersInEscrowCount} paid orders.
              </p>
            </div>
            <div className="rounded-[8px] border border-ink/8 bg-bone/48 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ink">Tax controls</p>
                <span className="rounded-full border border-ink/10 bg-white px-2.5 py-1 text-[11px] font-semibold text-ink/64">
                  {data.taxControls.length} activated
                </span>
              </div>
              <p className="mt-2 text-sm leading-7 text-ink/62">
                {data.taxControls.length === 0
                  ? 'No reviewed scope is activated. Legacy pricing stays in place.'
                  : `${data.taxControls.filter((control) => ['EXPIRED', 'REVIEW_DUE'].includes(control.healthStatus)).length} need review. Exact environment and corridor decisions remain append-only.`}
              </p>
              {data.taxControls.slice(0, 3).map((control) => (
                <details key={control.activationId} className="mt-3 rounded-[8px] border border-ink/8 bg-white px-3 py-2.5">
                  <summary className="cursor-pointer text-xs font-semibold text-ink">
                    {control.environment} · {control.jurisdictionCountryCode} · {control.transactionType}
                  </summary>
                  <dl className="mt-3 grid gap-2 text-xs text-ink/62">
                    <div><dt className="font-semibold text-ink/78">Health</dt><dd>{control.healthStatus}</dd></div>
                    <div><dt className="font-semibold text-ink/78">Fulfillment</dt><dd>{control.fulfillmentClassification}</dd></div>
                    <div><dt className="font-semibold text-ink/78">Review due</dt><dd>{formatDateTime(control.reviewDueAt)}</dd></div>
                    <div><dt className="font-semibold text-ink/78">Evidence</dt><dd>{control.snapshotCount} snapshots · {control.affectedOpenReservations} open reservations</dd></div>
                    <div><dt className="font-semibold text-ink/78">Correlation</dt><dd className="break-all font-mono">{control.correlationId}</dd></div>
                    <div>
                      <dt className="font-semibold text-ink/78">Reviewed sources</dt>
                      <dd className="mt-1 flex flex-wrap gap-2">
                        {control.sourceUrls.map((source, index) => (
                          <a key={source} href={source} target="_blank" rel="noreferrer" className="rounded-full border border-ink/10 px-2 py-1 text-needle underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle">
                            Source {index + 1}
                          </a>
                        ))}
                      </dd>
                    </div>
                  </dl>
                </details>
              ))}
              {data.taxDecisions.length > 0 ? (
                <details className="mt-3 rounded-[8px] border border-needle/14 bg-mint/22 px-3 py-2.5">
                  <summary className="cursor-pointer text-xs font-semibold text-ink transition-colors hover:text-needle">Recent decision evidence</summary>
                  <div className="mt-3 grid gap-2">
                    {data.taxDecisions.slice(0, 3).map((decision) => (
                      <details key={decision.snapshotId} className="rounded-[8px] border border-ink/8 bg-white p-3">
                        <summary className="cursor-pointer text-xs font-semibold text-ink">
                          {decision.orderId ? `Order ${decision.orderId}` : decision.transactionType} · {decision.collectionMode.replaceAll('_', ' ').toLowerCase()}
                        </summary>
                        <dl className="mt-3 grid gap-2 text-xs text-ink/64 sm:grid-cols-2">
                          <div><dt className="font-semibold text-ink/80">Decision</dt><dd>{decision.supplyCharacterization} · {decision.responsibleParty}</dd></div>
                          <div><dt className="font-semibold text-ink/80">Registration</dt><dd>{decision.registrationDecision}</dd></div>
                          <div><dt className="font-semibold text-ink/80">Locked amounts</dt><dd>{formatMoney(decision.subtotalAmount, decision.currency)} subtotal · {formatMoney(decision.taxAmount, decision.currency)} tax · {formatMoney(decision.shippingAmount, decision.currency)} fulfillment</dd></div>
                          <div><dt className="font-semibold text-ink/80">Import treatment</dt><dd>{formatMoney(decision.importTaxAmount, decision.currency)} import tax · {formatMoney(decision.dutyAmount, decision.currency)} duty</dd></div>
                          <div><dt className="font-semibold text-ink/80">Filing account</dt><dd className="break-all font-mono">{decision.filingLiabilityAccount}</dd></div>
                          <div><dt className="font-semibold text-ink/80">Import liabilities</dt><dd className="break-all font-mono">{decision.importTaxLiabilityAccount ?? 'Not collected'} · {decision.dutyLiabilityAccount ?? 'Not collected'}</dd></div>
                          <div><dt className="font-semibold text-ink/80">Required border evidence</dt><dd>{decision.requiredExportEvidence.length} export · {decision.requiredCustomsFields.length} customs fields</dd></div>
                          <div><dt className="font-semibold text-ink/80">Provider</dt><dd>{decision.calculationProvider}</dd></div>
                          <div className="sm:col-span-2"><dt className="font-semibold text-ink/80">Correlation</dt><dd className="break-all font-mono">{decision.correlationId}</dd></div>
                        </dl>
                      </details>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function buildFilterHref(view: OpsView, query: string, chip: string) {
  const anchor = getOpsSection(view).anchor
  const q = query ? `&q=${encodeURIComponent(query)}` : ''
  const f = chip ? `&filter=${encodeURIComponent(chip)}` : ''
  return `/ops?view=${view}${q}${f}#${anchor}`
}

function OpsFilterChips({
  view,
  query,
  currentFilter,
  chips,
}: {
  view: OpsView
  query: string
  currentFilter: string
  chips: Array<{ key: string; label: string; count: number }>
}): React.JSX.Element {
  return (
    <div className="-mb-2 flex flex-wrap gap-2">
      <a
        href={buildFilterHref(view, query, '')}
        className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold transition ${!currentFilter ? 'border-ink/18 bg-ink text-white' : 'border-ink/10 bg-white text-ink/60 hover:bg-bone'}`}
      >
        All
      </a>
      {chips.map((chip) => (
        <a
          key={chip.key}
          href={buildFilterHref(view, query, chip.key)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${currentFilter === chip.key ? 'border-needle/20 bg-needle/10 text-needle-700' : 'border-ink/10 bg-white text-ink/60 hover:bg-bone'}`}
        >
          {chip.label}
          {chip.count > 0 ? (
            <span className={`rounded-full px-1.5 tabular-nums ${currentFilter === chip.key ? 'bg-needle/18 text-needle-700' : 'bg-ink/8 text-ink/50'}`}>{chip.count}</span>
          ) : null}
        </a>
      ))}
    </div>
  )
}

function applyOpsChipFilter(data: OpsDashboardData, view: OpsView, chip: string): OpsDashboardData {
  if (!chip) return data
  switch (view) {
    case 'money-desk':
      return {
        ...data,
        moneyDeskRequests:
          chip === 'approval'
            ? data.moneyDeskRequests.filter((request) => request.status === 'PENDING_APPROVAL')
            : chip === 'approved'
              ? data.moneyDeskRequests.filter((request) => request.status === 'APPROVED')
              : chip === 'failed'
                ? data.moneyDeskRequests.filter((request) => ['FAILED', 'REJECTED'].includes(request.status))
                : data.moneyDeskRequests,
      }
    case 'workflow-issues':
      return {
        ...data,
        workflowIssues:
          chip === 'consultations'
            ? data.workflowIssues.filter((i) => Boolean(i.consultationAttendance))
            : chip === 'critical'
            ? data.workflowIssues.filter((i) => ['CRITICAL', 'HIGH'].includes(i.severity.toUpperCase()))
            : chip === 'payment'
              ? data.workflowIssues.filter((i) => ['PAYOUT_BLOCKED', 'PAYMENT_BLOCKED'].includes(i.issueType))
              : chip === 'safety'
                ? data.workflowIssues.filter((i) => i.issueType === 'CONVERSATION_SAFETY')
                : chip === 'open'
                  ? data.workflowIssues.filter((i) => i.status !== 'RESOLVED')
                  : data.workflowIssues,
      }
    case 'payouts':
      return {
        ...data,
        payouts:
          chip === 'blocked'
            ? data.payouts.filter((p) => p.status.toUpperCase() === 'BLOCKED')
            : chip === 'failed'
              ? data.payouts.filter((p) => p.status.toUpperCase() === 'FAILED')
              : chip === 'pending'
                ? data.payouts.filter((p) => p.status.toUpperCase() === 'PENDING')
                : data.payouts,
      }
    case 'disputes':
      return {
        ...data,
        disputes:
          chip === 'open'
            ? data.disputes.filter((d) => d.status === 'OPEN')
            : chip === 'under-review'
              ? data.disputes.filter((d) => d.status === 'UNDER_REVIEW')
              : data.disputes,
      }
    case 'support':
      return {
        ...data,
        supportThreads:
          chip === 'unread'
            ? data.supportThreads.filter((t) => t.unreadCount > 0)
            : chip === 'paused'
              ? data.supportThreads.filter((t) => t.conversationBlocked)
              : data.supportThreads,
      }
    default:
      return data
  }
}

function moneyDeskActionLabel(actionType: string) {
  return MONEY_DESK_ACTION_TYPES.includes(actionType as (typeof MONEY_DESK_ACTION_TYPES)[number])
    ? MONEY_DESK_ACTION_LABELS[actionType as (typeof MONEY_DESK_ACTION_TYPES)[number]]
    : formatDatabaseEnumLabel(actionType)
}

function MoneyDeskRequestCard({
  item,
  context,
  redirectTo,
}: {
  item: OpsMoneyDeskRequest
  context: OpsRenderContext
  redirectTo: string
}) {
  const mayApprove = ['finance', 'admin'].includes(context.session.role)
  const namedMfaSession = isNamedOpsWorkforceSession(context.session) && context.session.mfaVerified
  const currentApproverDecision = item.decisions.find(
    (decision) => decision.approverEmail.toLowerCase() === context.session.email?.toLowerCase(),
  )
  const canExecute = mayApprove && item.status === 'APPROVED' && namedMfaSession
  const canDecide = mayApprove && item.status === 'PENDING_APPROVAL' && namedMfaSession && !currentApproverDecision
  const returnTo = `/ops?view=money-desk#money-desk-request-${item.id}`
  const originIssueHref = item.originIssue
    ? `/ops?view=workflow-issues&focusIssue=${encodeURIComponent(item.originIssue.id)}&returnTo=${encodeURIComponent(returnTo)}#workflow-issue-${item.originIssue.id}`
    : null

  return (
    <article id={`money-desk-request-${item.id}`} className="scroll-mt-6 overflow-hidden rounded-[8px] border border-ink/10 bg-white/92 shadow-sm">
      <div className="flex flex-col gap-4 border-b border-ink/10 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold tracking-wide text-needle-700">{item.reference}</span>
            <StatusChip status={item.status} className={statusPillClass(item.status)} />
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${item.riskLevel === 'HIGH' ? 'border-rust/18 bg-rust/8 text-rust-700' : 'border-needle/16 bg-needle/8 text-needle-700'}`}>
              {item.riskLevel} risk
            </span>
          </div>
          <h3 className="mt-2 text-xl text-ink">{moneyDeskActionLabel(item.actionType)}</h3>
          <p className="mt-1 break-words text-sm leading-6 text-ink/62">{item.reason}</p>
        </div>
        <div className="shrink-0 text-left sm:text-right">
          <p className="text-lg font-semibold text-ink">{formatMoney(item.amount, item.currency)}</p>
          <p className="mt-1 text-xs text-ink/48">{formatDateTime(item.createdAt)}</p>
        </div>
      </div>
      {item.originIssue ? (
        <section className="border-b border-ink/10 bg-mint/38 p-5" aria-labelledby={`review-context-${item.id}`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-needle-700">Review context</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h4 id={`review-context-${item.id}`} className="text-lg font-semibold text-ink">{item.originIssue.title}</h4>
                <span className="rounded-full border border-ink/10 bg-white px-2.5 py-1 font-mono text-[11px] font-semibold text-ink/64">{item.originIssue.displayId}</span>
                <StatusChip status={item.originIssue.status} className={statusPillClass(item.originIssue.status)} />
              </div>
              <p className="mt-2 text-sm leading-6 text-ink/72">{item.originIssue.summary}</p>
              <p className="mt-3 text-xs leading-5 text-ink/58"><span className="font-semibold text-ink/72">Reviewer should verify:</span> {item.originIssue.recommendedAction}</p>
            </div>
            {originIssueHref ? (
              <a href={originIssueHref} className="inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition-colors duration-200 hover:bg-needle/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle/60">
                Review originating issue
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
              </a>
            ) : null}
          </div>
        </section>
      ) : null}
      {item.payoutChangeReview ? (
        <section className="grid gap-4 border-b border-ink/10 p-5" aria-labelledby={`destination-comparison-${item.id}`}>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-ink/46">Payout destination comparison</p>
            <h4 id={`destination-comparison-${item.id}`} className="mt-1 text-base font-semibold text-ink">Confirm exactly what will change</h4>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {([
              ['Current active destination', item.payoutChangeReview.currentDestination],
              ['Requested replacement', item.payoutChangeReview.requestedDestination],
            ] as const).map(([title, destination], index) => (
              <div key={title} className={`rounded-[8px] border p-4 ${index === 1 ? 'border-needle/22 bg-mint/30' : 'border-ink/8 bg-bone/48'}`}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-ink/48">{title}</p>
                <dl className="mt-3 grid gap-2 text-sm">
                  <div className="flex justify-between gap-4"><dt className="text-ink/50">Provider</dt><dd className="text-right font-semibold text-ink">{destination?.provider ?? 'Not recorded'}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-ink/50">Currency</dt><dd className="text-right font-semibold text-ink">{destination?.currency ?? 'Not recorded'}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-ink/50">Bank</dt><dd className="text-right font-semibold text-ink">{destination?.bankName ?? 'Not recorded'}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-ink/50">Account holder</dt><dd className="text-right font-semibold text-ink">{destination?.accountName ?? 'Not recorded'}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-ink/50">Account</dt><dd className="text-right font-semibold text-ink">{destination?.accountMasked ?? 'Not recorded'}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-ink/50">Provider check</dt><dd className={`text-right font-semibold ${destination?.accountVerified ? 'text-needle-700' : 'text-rust-700'}`}>{destination?.accountVerified ? 'Verified' : 'Incomplete'}</dd></div>
                </dl>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Payout change risk reasons">
            {(item.payoutChangeReview.riskSignals.length > 0 ? item.payoutChangeReview.riskSignals : ['No destination differences detected']).map((signal) => (
              <span key={signal} className="rounded-full border border-rust/16 bg-rust/6 px-3 py-1.5 text-xs font-semibold text-rust-700">{signal}</span>
            ))}
            <span className="rounded-full border border-needle/16 bg-needle/6 px-3 py-1.5 text-xs font-semibold text-needle-700">
              Tailor confirmation {item.payoutChangeReview.confirmedAt ? 'recorded' : 'missing'}
            </span>
          </div>
        </section>
      ) : null}
      <div className="grid gap-px bg-ink/8 sm:grid-cols-3">
        {[
          ['Prepared by', item.requesterEmail],
          ['Approvals', `${item.approvalCount} of ${item.requiredApprovalCount}`],
          ['Prepared', formatDateTime(item.createdAt)],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 bg-bone/58 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/42">{label}</p>
            <p className="mt-1 truncate text-xs text-ink/72" title={value}>{value}</p>
          </div>
        ))}
      </div>
      {item.riskReasons.length > 0 ? (
        <div className="border-t border-ink/8 px-5 py-3 text-xs leading-6 text-rust-700">
          {item.riskReasons.map((reason) => formatDatabaseEnumLabel(reason)).join(' · ')}
        </div>
      ) : null}
      <details className="group border-t border-ink/8 bg-bone/32">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-xs font-semibold text-ink/58 transition-colors duration-200 hover:bg-bone/64 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-needle/60 [&::-webkit-details-marker]:hidden">
          <span>Technical audit identifiers</span>
          <span aria-hidden="true" className="transition-transform duration-200 group-open:rotate-180">⌄</span>
        </summary>
        <dl className="grid gap-3 border-t border-ink/8 px-5 py-4 text-xs text-ink/68 sm:grid-cols-2">
          <div><dt className="font-semibold text-ink/48">Target</dt><dd className="mt-1 break-all font-mono">{formatDatabaseEnumLabel(item.targetType)} · {item.targetId}</dd></div>
          <div><dt className="font-semibold text-ink/48">Correlation</dt><dd className="mt-1 break-all font-mono">{item.correlationId}</dd></div>
        </dl>
      </details>
      {item.evidenceCase ? (
        <details className="group border-t border-ink/10 bg-bone/38" open={item.status === 'PENDING_APPROVAL'}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-needle/60">
            <span>Evidence packet · {item.evidenceCase.reference}</span>
            <span aria-hidden="true" className="text-ink/44 transition group-open:rotate-180">⌄</span>
          </summary>
          <div className="grid gap-4 border-t border-ink/8 px-5 py-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[8px] border border-ink/8 bg-white p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/42">Reviewed reason</p>
                <p className="mt-2 text-sm font-medium text-ink">{formatDatabaseEnumLabel(item.evidenceCase.reasonCode)}</p>
              </div>
              <div className="rounded-[8px] border border-ink/8 bg-white p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/42">Decision basis</p>
                <p className="mt-2 text-sm font-medium text-ink">{item.evidenceCase.decisionBasis ? formatDatabaseEnumLabel(item.evidenceCase.decisionBasis) : 'Not recorded'}</p>
              </div>
            </div>
            <div className="rounded-[8px] border border-needle/14 bg-mint/42 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-needle-700">Party-safe summary</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink/76">{item.evidenceCase.summary}</p>
            </div>
            {item.evidenceCase.orderOutcome ? (
              <div className="rounded-[8px] border border-needle/18 bg-white p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-needle-700">Order outcome after provider success</p>
                <p className="mt-2 text-sm font-semibold text-ink">{formatDatabaseEnumLabel(item.evidenceCase.orderOutcome)}</p>
                <p className="mt-1 text-xs leading-5 text-ink/55">
                  {item.evidenceCase.orderOutcome === 'CONTINUE_ORDER' && item.evidenceCase.resumeStage
                    ? `Resume at ${formatDatabaseEnumLabel(item.evidenceCase.resumeStage)}.`
                    : item.evidenceCase.orderOutcome === 'CLOSE_ORDER'
                      ? 'Close the order as partially refunded and recalculate remaining settlement.'
                      : 'Keep the order under Drapeon review.'}
                </p>
              </div>
            ) : null}
            <div className="grid gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/48">Sources captured</p>
              {item.evidenceCase.evidence.map((evidence) => (
                <div key={evidence.id} className="grid gap-3 rounded-[8px] border border-ink/10 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{formatDatabaseEnumLabel(evidence.source)}</span>
                      <span className="rounded-full border border-ink/10 bg-bone px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/54">{formatDatabaseEnumLabel(evidence.verificationStatus)}</span>
                      <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${evidence.visibility === 'OPS_ONLY' ? 'border-rust/16 bg-rust/6 text-rust-700' : 'border-needle/14 bg-needle/6 text-needle-700'}`}>{evidence.visibility === 'OPS_ONLY' ? 'Ops only' : 'Party visible'}</span>
                    </div>
                    <p className="mt-2 text-xs text-ink/50">{formatDatabaseEnumLabel(evidence.evidenceType)} · {formatDateTime(evidence.capturedAt)}</p>
                    {evidence.externalReference ? <p className="mt-2 break-words text-sm leading-6 text-ink/72">{evidence.externalReference}</p> : null}
                  </div>
                  {evidence.signedUrl ? (
                    <a href={evidence.signedUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-[8px] border border-ink/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle/60" title="Open private evidence image">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={evidence.signedUrl} alt="Private refund evidence preview" className="h-24 w-32 object-cover" />
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </details>
      ) : null}
      {currentApproverDecision && item.status === 'PENDING_APPROVAL' ? (
        <div className="border-t border-needle/14 bg-needle/7 px-5 py-4" role="status">
          <p className="text-sm font-semibold text-needle-700">
            Your {currentApproverDecision.decision.toLowerCase()} decision is recorded.
          </p>
          <p className="mt-1 text-xs leading-5 text-ink/58">
            Waiting for {Math.max(item.requiredApprovalCount - item.approvalCount, 0)} more independent approval.
          </p>
        </div>
      ) : null}
      {canDecide ? (
        <form method="POST" action="/ops/action" className="grid gap-3 border-t border-ink/10 p-5 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <input type="hidden" name="kind" value="money-desk-decision" />
          <input type="hidden" name="requestId" value={item.id} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <label className="grid gap-1.5 text-xs font-semibold text-ink/64">
            Independent decision reason
            <input name="reason" required minLength={12} maxLength={1000} placeholder="What did you verify?" className="h-11 rounded-lg border border-ink/12 bg-white px-3 text-sm text-ink outline-none focus:border-needle/50" />
          </label>
          <button name="decision" value="REJECT" type="submit" className="self-end rounded-lg border border-rust/20 bg-rust/6 px-4 py-3 text-sm font-semibold text-rust-700">Reject</button>
          <button name="decision" value="APPROVE" type="submit" className="self-end rounded-lg bg-needle px-4 py-3 text-sm font-semibold text-white">Approve</button>
        </form>
      ) : null}
      {canExecute ? (
        <form method="POST" action="/ops/action" className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 p-5">
          <input type="hidden" name="kind" value="money-desk-execution" />
          <input type="hidden" name="requestId" value={item.id} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <p className="text-xs leading-6 text-ink/56">Execution is idempotent and must end as succeeded, failed, or blocked.</p>
          <button type="submit" className="rounded-lg bg-ink px-5 py-3 text-sm font-semibold text-white">Execute approved action</button>
        </form>
      ) : null}
    </article>
  )
}

function MoneyDeskSurface({
  data,
  context,
  currentView,
}: {
  data: OpsDashboardData
  context: OpsRenderContext
  currentView: OpsView
}) {
  const redirectTo = buildOpsRedirectTarget(currentView, 'money-desk')
  const namedSession = isNamedOpsWorkforceSession(context.session) && Boolean(context.session.email)
  const namedMfaSession = namedSession && hasFreshOpsMfa(context.session)
  const canPrepare = getOpsRoleActions(context.session.role).includes('money-desk-request')
  const canPrepareRefundRestoration = getOpsRoleActions(context.session.role).includes('return-refund-prepare')
  const canCreateCampaign = getOpsRoleActions(context.session.role).includes('benefit-campaign-create')
  const canActivateCampaign = getOpsRoleActions(context.session.role).includes('benefit-campaign-activate')
  const canCreateGrant = getOpsRoleActions(context.session.role).includes('benefit-grant-create')
  const elevationAcknowledged = context.noticeKey === 'money-desk-elevated'
  const historyStatuses = new Set(['SUCCEEDED', 'REJECTED', 'CANCELLED'])
  const activeMoneyDeskRequests = data.moneyDeskRequests.filter((item) => !historyStatuses.has(item.status))
  const moneyDeskHistory = data.moneyDeskRequests.filter((item) => historyStatuses.has(item.status))

  return (
    <SectionFrame
      id="money-desk"
      eyebrow="Protected money movement"
      title="Every manual money move needs a preparer, an independent approver, and a terminal outcome."
      description="This queue is the authoritative control surface for manual releases, refunds, destination changes, FX exceptions, and recoveries. Shared-token sessions remain read-only."
    >
      <div className={`rounded-[8px] border p-5 ${namedMfaSession ? 'border-needle/18 bg-needle/7' : 'border-rust/18 bg-rust/7'}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-ink">Workforce assurance</p>
            <p className="mt-1 text-sm leading-6 text-ink/62">
              {namedMfaSession
                ? context.session.mode === 'local-workforce'
                  ? `${context.session.email} is active through the development-only workforce dry-run bridge.`
                  : `${context.session.email} has a fresh Cloudflare Access MFA assertion.`
                : 'Read-only: enter or re-authenticate through Cloudflare Access with a named MFA-backed workforce identity.'}
            </p>
            {elevationAcknowledged ? (
              <p className="mt-2 inline-flex rounded-full border border-needle/18 bg-needle/10 px-3 py-1 text-xs font-semibold text-needle-700">
                Elevation active for 15 minutes
              </p>
            ) : null}
          </div>
          {namedMfaSession && canPrepare ? (
            <form method="POST" action="/ops/action" className="grid w-full gap-2 lg:max-w-xl lg:grid-cols-[minmax(0,1fr)_auto]">
              <input type="hidden" name="kind" value="money-desk-elevation" />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <input type="hidden" name="actionScopes" value={MONEY_DESK_ACTION_TYPES.filter((actionType) => actionType !== 'TIP_PAYOUT').join(',')} />
              <label className="grid gap-1.5 text-xs font-semibold text-ink/64">
                Why do you need elevation now?
                <input name="reason" required minLength={12} maxLength={500} placeholder="Reviewing today’s approved release queue" className="h-11 rounded-lg border border-ink/12 bg-white px-3 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
              <button type="submit" className="self-end rounded-lg bg-needle px-5 py-3 text-sm font-semibold text-white">
                {elevationAcknowledged ? 'Renew 15 min' : 'Elevate 15 min'}
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {data.returnResolutions.length > 0 ? (
        <div className="grid gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Returns and refund restoration</p>
            <p className="mt-1 text-sm text-ink/58">The agreement, return evidence, cash lines, restored benefits, and funding source stay separate. Provider execution begins only after Money Desk approval.</p>
          </div>
          {data.returnResolutions.map((item: OpsReturnResolution) => (
            <article key={item.id} className="overflow-hidden rounded-[8px] border border-ink/10 bg-white/92 shadow-sm">
              <div className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-semibold text-needle-700">{item.reference}</span><StatusChip status={item.status} className={statusPillClass(item.status)} /><StatusChip status={item.eligibilityStatus} className={statusPillClass(item.eligibilityStatus)} /></div>
                  <h3 className="mt-2 text-lg font-semibold text-ink">{formatDatabaseEnumLabel(item.reasonCode)} · {formatDatabaseEnumLabel(item.requestedRemedy)}</h3>
                  <p className="mt-1 text-sm leading-6 text-ink/64">{item.summary}</p>
                  <p className="mt-2 text-xs leading-5 text-ink/48">{item.eligibilityReason} · response due {formatDateTime(item.responseDueAt)}</p>
                </div>
                <div className="text-left lg:text-right"><p className="text-sm font-semibold text-ink">Order {item.orderId}</p><p className="mt-1 text-xs text-ink/46">{item.returnRequired ? 'Physical return required' : 'No physical return required'}</p></div>
              </div>
              {item.proposalId ? (
                <div className="grid gap-px border-t border-ink/8 bg-ink/8 sm:grid-cols-3">
                  <div className="bg-bone/60 px-4 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/42">Latest proposal</p><p className="mt-1 text-sm text-ink">{formatDatabaseEnumLabel(item.proposalRemedy ?? '')}</p></div>
                  <div className="bg-bone/60 px-4 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/42">Customer value</p><p className="mt-1 text-sm text-ink">{formatMoney(item.proposalAmount, item.proposalCurrency)}</p></div>
                  <div className="bg-bone/60 px-4 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/42">Agreement</p><p className="mt-1 text-sm text-ink">{formatDatabaseEnumLabel(item.proposalStatus ?? '')}</p></div>
                </div>
              ) : null}
              {canPrepareRefundRestoration && item.proposalId && item.proposalStatus === 'ACCEPTED' && ['PARTIAL_REFUND','FULL_REFUND','RETURN_AND_REFUND'].includes(item.proposalRemedy ?? '') && !item.refundResolutionId ? (
                <details className="border-t border-ink/10">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">Lock exact restoration<CardCollapseChevron /></summary>
                  <form method="POST" action="/ops/action" className="grid gap-3 border-t border-ink/8 bg-bone/45 p-5 sm:grid-cols-4">
                    <input type="hidden" name="kind" value="return-refund-prepare"/><input type="hidden" name="redirectTo" value={redirectTo}/><input type="hidden" name="returnRequestId" value={item.id}/><input type="hidden" name="proposalId" value={item.proposalId}/>
                    {[['tailorWorkAmount','Tailor work cash'],['platformFeeAmount','Service fee cash'],['taxAmount','Tax cash'],['fulfillmentAmount','Fulfillment cash'],['consultationAmount','Consultation cash'],['promotionAmount','Promotion restored'],['drapeonFundedAmount','Drapeon-funded cash'],['releasedTailorRecoveryAmount','Separate recovery value']].map(([name,label]) => <label key={name} className="grid gap-1.5 text-xs font-semibold text-ink/64">{label}<input name={name} required inputMode="numeric" pattern="[0-9]+" defaultValue="0" className="h-10 rounded-lg border border-ink/12 bg-white px-3 text-sm text-ink"/></label>)}
                    <p className="text-xs leading-5 text-ink/54 sm:col-span-3">Cash lines must equal {formatMoney(item.proposalAmount, item.proposalCurrency)}. Promotions are restored separately. Released tailor value requires Drapeon funding now and a separate recovery action later.</p>
                    <button type="submit" className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white">Lock restoration</button>
                  </form>
                </details>
              ) : null}
              {namedMfaSession && canPrepare && item.refundResolutionId && item.refundStatus === 'MONEY_DESK_REQUIRED' ? (
                <form method="POST" action="/ops/action" className="grid gap-3 border-t border-ink/10 p-5 sm:grid-cols-[1fr_auto] sm:items-end">
                  <input type="hidden" name="kind" value="money-desk-request"/><input type="hidden" name="redirectTo" value={redirectTo}/><input type="hidden" name="actionType" value="CUSTOMER_REFUND"/><input type="hidden" name="targetType" value="REFUND_RESOLUTION"/><input type="hidden" name="targetId" value={item.refundResolutionId}/><input type="hidden" name="refundResolutionId" value={item.refundResolutionId}/><input type="hidden" name="orderId" value={item.orderId}/><input type="hidden" name="caseId" value={item.financialCaseId}/><input type="hidden" name="amountMinor" value={item.refundAmount ?? ''}/><input type="hidden" name="currency" value={item.refundCurrency ?? ''}/>
                  <label className="grid gap-1.5 text-xs font-semibold text-ink/64">Evidence-based reason<input name="reason" required minLength={12} maxLength={1000} defaultValue={`Accepted ${formatDatabaseEnumLabel(item.proposalRemedy ?? 'refund').toLowerCase()} reviewed against return evidence and exact restoration.`} className="h-11 rounded-lg border border-ink/12 bg-white px-3 text-sm text-ink"/></label>
                  <button type="submit" className="rounded-lg bg-needle px-4 py-3 text-sm font-semibold text-white">Send to Money Desk</button>
                </form>
              ) : item.refundResolutionId ? <div className="border-t border-ink/10 px-5 py-3 text-xs text-ink/56">Refund {formatMoney(item.refundAmount, item.refundCurrency)} · {formatDatabaseEnumLabel(item.refundStatus ?? '')}{item.recoveryAmount > 0 ? ` · separate recovery ${formatMoney(item.recoveryAmount, item.refundCurrency)}` : ''}</div> : null}
            </article>
          ))}
        </div>
      ) : null}

      {data.settlementTranches.length > 0 ? (
        <div className="grid gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Staged settlement queue</p>
            <p className="mt-1 text-sm text-ink/58">Each row is one evidence-backed tranche. Frozen rows remain visible but cannot move.</p>
          </div>
          {data.settlementTranches.map((tranche) => (
            <article key={tranche.id} className="grid gap-4 rounded-[8px] border border-ink/10 bg-white/90 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm text-ink">{formatDatabaseEnumLabel(tranche.code)}</strong>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${tranche.planStatus === 'FROZEN' || tranche.status === 'BLOCKED' ? 'bg-rust/10 text-rust' : 'bg-needle/10 text-needle'}`}>{formatDatabaseEnumLabel(tranche.status)}</span>
                </div>
                <p className="mt-2 text-sm text-ink/62">{formatMoney(tranche.amount, tranche.currency)} · order {tranche.orderId} · eligible {formatDateTime(tranche.eligibleAt)}</p>
                <p className="mt-1 text-xs text-ink/48">Waiting {tranche.waitingHours}h{tranche.frozenReason ? ` · ${formatDatabaseEnumLabel(tranche.frozenReason)}` : ''}</p>
              </div>
              {namedMfaSession && canPrepare && tranche.status === 'ELIGIBLE' && tranche.planStatus === 'ACTIVE' ? (
                <form method="POST" action="/ops/action" className="grid gap-2 sm:min-w-[320px]">
                  <input type="hidden" name="kind" value="money-desk-request" /><input type="hidden" name="redirectTo" value={redirectTo} />
                  <input type="hidden" name="actionType" value="PAYOUT_RELEASE" /><input type="hidden" name="targetType" value="SETTLEMENT_TRANCHE" />
                  <input type="hidden" name="targetId" value={tranche.id} /><input type="hidden" name="trancheId" value={tranche.id} /><input type="hidden" name="orderId" value={tranche.orderId} />
                  <input type="hidden" name="amountMinor" value={tranche.amount} /><input type="hidden" name="currency" value={tranche.currency} />
                  <input name="reason" required minLength={12} maxLength={1000} defaultValue={`Verified ${formatDatabaseEnumLabel(tranche.code).toLowerCase()} evidence and open-review gate before release.`} className="h-11 rounded-lg border border-ink/12 bg-white px-3 text-sm text-ink" />
                  <button type="submit" className="rounded-lg bg-needle px-4 py-2.5 text-sm font-semibold text-white">Prepare tranche release</button>
                </form>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {data.benefitCampaigns.length > 0 || data.tips.length > 0 || (namedMfaSession && canCreateCampaign) ? (
        <div className="grid gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Benefits and customer tips</p>
            <p className="mt-1 text-sm text-ink/58">Campaign liability stays separate from customer cash. Captured tips wait here until an independently approved payout reaches a terminal provider outcome.</p>
          </div>
          {data.benefitCampaigns.length > 0 ? <div className="grid gap-3 lg:grid-cols-2">{data.benefitCampaigns.map(campaign=><article key={campaign.campaignId} className="rounded-[8px] border border-ink/10 bg-white/92 p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.15em] text-needle">{campaign.fundingSource} funded</p><h3 className="mt-1 text-lg font-semibold text-ink">{campaign.name}</h3></div><StatusChip status={campaign.status} className={statusPillClass(campaign.status)}/></div><div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-[6px] bg-ink/8"><div className="bg-bone/60 p-3"><p className="text-[10px] uppercase tracking-[.12em] text-ink/42">Reserved</p><p className="mt-1 text-sm font-semibold">{formatMoney(campaign.reservedAmount,campaign.currency)}</p></div><div className="bg-bone/60 p-3"><p className="text-[10px] uppercase tracking-[.12em] text-ink/42">Consumed</p><p className="mt-1 text-sm font-semibold">{formatMoney(campaign.consumedAmount,campaign.currency)}</p></div><div className="bg-bone/60 p-3"><p className="text-[10px] uppercase tracking-[.12em] text-ink/42">Uses</p><p className="mt-1 text-sm font-semibold">{campaign.redemptionCount}</p></div></div>{namedMfaSession&&canActivateCampaign&&campaign.status==='PENDING_APPROVAL'?<form method="POST" action="/ops/action" className="mt-4"><input type="hidden" name="kind" value="benefit-campaign-activate"/><input type="hidden" name="redirectTo" value={redirectTo}/><input type="hidden" name="campaignId" value={campaign.campaignId}/><button className="w-full rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white">Independently activate</button></form>:null}{namedMfaSession&&canCreateGrant&&campaign.status==='ACTIVE'&&campaign.benefitId?<details className="mt-4 border-t border-ink/8 pt-3"><summary className="cursor-pointer text-sm font-semibold text-needle">Issue account grant</summary><form method="POST" action="/ops/action" className="mt-3 grid gap-2"><input type="hidden" name="kind" value="benefit-grant-create"/><input type="hidden" name="redirectTo" value={redirectTo}/><input type="hidden" name="benefitId" value={campaign.benefitId}/><input name="userId" required placeholder="Customer user UUID" className="h-10 rounded-lg border border-ink/12 px-3 text-sm"/><input name="amount" inputMode="decimal" placeholder={`Full amount in ${campaign.currency ?? 'campaign currency'}; blank for complimentary`} className="h-10 rounded-lg border border-ink/12 px-3 text-sm"/><input name="expiresAt" type="datetime-local" className="h-10 rounded-lg border border-ink/12 px-3 text-sm"/><textarea name="reason" required minLength={12} maxLength={1000} placeholder="Reviewed reason and evidence" className="rounded-lg border border-ink/12 px-3 py-2 text-sm"/><button className="rounded-lg bg-needle px-4 py-2.5 text-sm font-semibold text-white">Create restricted grant</button></form></details>:null}</article>)}</div>:null}
          {data.tips.filter(tip=>['PAYOUT_PENDING','HELD','FAILED'].includes(tip.status)).map(tip=><article key={tip.id} className="grid gap-4 rounded-[8px] border border-ink/10 bg-white/92 p-5 lg:grid-cols-[1fr_auto] lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-ink">{formatMoney(tip.amount,tip.currency)} customer tip</strong><StatusChip status={tip.status} className={statusPillClass(tip.status)}/></div><p className="mt-2 text-xs text-ink/50">Order {tip.orderId} · correlation {tip.correlationId} · {formatDateTime(tip.createdAt)}</p></div>{namedMfaSession&&canPrepare&&tip.status==='PAYOUT_PENDING'?<form method="POST" action="/ops/action" className="grid gap-2 sm:min-w-[320px]"><input type="hidden" name="kind" value="money-desk-request"/><input type="hidden" name="redirectTo" value={redirectTo}/><input type="hidden" name="actionType" value="TIP_PAYOUT"/><input type="hidden" name="targetType" value="ORDER_TIP"/><input type="hidden" name="targetId" value={tip.id}/><input type="hidden" name="orderId" value={tip.orderId}/><input type="hidden" name="amountMinor" value={tip.amount}/><input type="hidden" name="currency" value={tip.currency}/><input name="reason" required minLength={12} maxLength={1000} defaultValue="Verified captured tip liability and tailor payout destination before release." className="h-11 rounded-lg border border-ink/12 bg-white px-3 text-sm text-ink"/><button type="submit" className="rounded-lg bg-needle px-4 py-2.5 text-sm font-semibold text-white">Prepare tip payout</button></form>:null}</article>)}
          {data.commercialDeliveryOutcomes.length>0?<div className="overflow-hidden rounded-[8px] border border-ink/10 bg-white/92"><div className="border-b border-ink/8 px-5 py-4"><p className="text-sm font-semibold text-ink">Communication terminal outcomes</p><p className="mt-1 text-xs text-ink/52">Push and email jobs remain visible until succeeded, failed, or dead.</p></div><div className="divide-y divide-ink/8">{data.commercialDeliveryOutcomes.map(row=><div key={`${row.source}:${row.jobType}:${row.status}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-5 py-3 text-sm"><span>{formatDatabaseEnumLabel(row.jobType)}</span><StatusChip status={row.status} className={statusPillClass(row.status)}/><strong>{row.outcomeCount}</strong></div>)}</div></div>:null}
          {namedMfaSession&&canCreateCampaign?<details className="rounded-[8px] border border-ink/10 bg-white/92"><summary className="cursor-pointer list-none p-5 font-semibold text-ink">Prepare controlled campaign</summary><form method="POST" action="/ops/action" className="grid gap-3 border-t border-ink/8 p-5 sm:grid-cols-2"><input type="hidden" name="kind" value="benefit-campaign-create"/><input type="hidden" name="redirectTo" value={redirectTo}/><input name="name" required minLength={3} placeholder="Campaign name" className="h-11 rounded-lg border border-ink/12 px-3 text-sm"/><select name="fundingSource" className="h-11 rounded-lg border border-ink/12 px-3 text-sm"><option value="DRAPEON">Drapeon funded</option><option value="TAILOR">Tailor funded</option><option value="PARTNER">Partner funded</option></select><select name="benefitKind" className="h-11 rounded-lg border border-ink/12 px-3 text-sm"><option value="FIXED_DISCOUNT">Fixed discount</option><option value="PERCENT_DISCOUNT">Percentage discount</option><option value="FREE_SHIPPING">Free shipping</option><option value="CAPPED_SHIPPING">Capped shipping</option><option value="ACCOUNT_GRANT">Account grant</option><option value="GOODWILL_GRANT">Goodwill grant</option><option value="COMPLIMENTARY_ORDER">Complimentary order</option><option value="CREATOR_CODE">Creator code percentage</option></select><input name="currency" required maxLength={3} placeholder="Currency, e.g. NGN" className="h-11 rounded-lg border border-ink/12 px-3 text-sm uppercase"/><input name="value" required inputMode="decimal" placeholder="Full discount amount, or percent" className="h-11 rounded-lg border border-ink/12 px-3 text-sm"/><input name="budgetAmount" inputMode="decimal" placeholder="Full campaign budget" className="h-11 rounded-lg border border-ink/12 px-3 text-sm"/><input name="maximumAmount" inputMode="decimal" placeholder="Optional full maximum" className="h-11 rounded-lg border border-ink/12 px-3 text-sm"/><input name="minimumOrderAmount" inputMode="decimal" placeholder="Full minimum order; default 0" className="h-11 rounded-lg border border-ink/12 px-3 text-sm"/><input name="code" placeholder="Code when customer-entered" className="h-11 rounded-lg border border-ink/12 px-3 text-sm uppercase"/><p className="text-xs leading-5 text-ink/54 sm:col-span-2">Enter currency amounts exactly as people see them (for example, 10,000 means ₦10,000 when currency is NGN). For percentage types, enter 10 for 10%. Creation leaves the campaign pending; a different named MFA-backed Finance or Admin operator must activate it.</p><button className="rounded-lg bg-ink px-5 py-3 text-sm font-semibold text-white sm:col-span-2">Prepare campaign</button></form></details>:null}
        </div>
      ) : null}

      {namedMfaSession && canPrepare ? (
        <details className="group rounded-[8px] border border-ink/10 bg-white/90">
          <summary className="flex cursor-pointer list-none items-center justify-between p-5 font-semibold text-ink [&::-webkit-details-marker]:hidden">
            Prepare a money action
            <CardCollapseChevron />
          </summary>
          <form method="POST" action="/ops/action" className="grid gap-4 border-t border-ink/10 p-5 sm:grid-cols-2">
            <input type="hidden" name="kind" value="money-desk-request" />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <label className="grid gap-1.5 text-xs font-semibold text-ink/64">Action
              <select name="actionType" required className="h-11 rounded-lg border border-ink/12 bg-white px-3 text-sm text-ink">
                {MONEY_DESK_ACTION_TYPES.map((actionType) => <option key={actionType} value={actionType}>{MONEY_DESK_ACTION_LABELS[actionType]}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-ink/64">Target type
              <select name="targetType" required className="h-11 rounded-lg border border-ink/12 bg-white px-3 text-sm text-ink">
                <option value="ORDER_RESIDUAL_SETTLEMENT">Residual tailor settlement (derived)</option><option value="ORDER">Legacy order release</option><option value="SETTLEMENT_TRANCHE">Settlement tranche</option><option value="CONSULTATION_BOOKING">Consultation earning recovery</option><option value="ORDER_TIP">Customer tip</option><option value="MATERIAL_ADVANCE">Material advance</option><option value="REFUND_RESOLUTION">Refund resolution</option><option value="FINANCIAL_CASE">Financial case</option><option value="PAYOUT_CHANGE_REQUEST">Payout change request</option><option value="STRIPE_TRANSFER_REVERSAL">Stripe transfer reversal</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-ink/64">Target ID
              <input name="targetId" required placeholder="Order, advance, case, or request ID" className="h-11 rounded-lg border border-ink/12 bg-white px-3 text-sm text-ink" />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-ink/64">Order ID (when applicable)
              <input name="orderId" placeholder="Optional order ID" className="h-11 rounded-lg border border-ink/12 bg-white px-3 text-sm text-ink" />
            </label>
            <input type="hidden" name="trancheId" value="" />
            <label className="grid gap-1.5 text-xs font-semibold text-ink/64">Amount in minor units
              <input name="amountMinor" inputMode="numeric" pattern="[0-9]+" placeholder="20000 = 200.00" className="h-11 rounded-lg border border-ink/12 bg-white px-3 text-sm text-ink" />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-ink/64">Currency
              <input name="currency" maxLength={3} placeholder="USD, NGN, GBP…" className="h-11 rounded-lg border border-ink/12 bg-white px-3 text-sm uppercase text-ink" />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-ink/64 sm:col-span-2">Evidence-based reason
              <textarea name="reason" required minLength={12} maxLength={1000} rows={3} placeholder="What is being moved, why, and which evidence was checked?" className="rounded-lg border border-ink/12 bg-white px-3 py-2 text-sm leading-6 text-ink" />
            </label>
            <p className="text-xs leading-5 text-ink/54 sm:col-span-2">Residual tailor settlement derives its amount and fulfilment split from the closed order; leave amount and currency blank. Stripe transfer reversal is only for an already released Stripe payout after provider-backed review.</p>
            <button type="submit" className="rounded-lg bg-needle px-5 py-3 text-sm font-semibold text-white sm:col-span-2 sm:justify-self-end">Submit for approval</button>
          </form>
        </details>
      ) : null}

      {activeMoneyDeskRequests.length > 0 ? (
        <div className="grid gap-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Active queue</p>
              <p className="mt-1 text-sm text-ink/58">Only requests that still need approval, execution, or failure follow-up remain expanded here.</p>
            </div>
            <span className="rounded-full border border-needle/14 bg-needle/7 px-3 py-1 text-xs font-semibold text-needle-700">{activeMoneyDeskRequests.length} active</span>
          </div>
          {activeMoneyDeskRequests.map((item) => <MoneyDeskRequestCard key={item.id} item={item} context={context} redirectTo={redirectTo} />)}
        </div>
      ) : data.moneyDeskRequests.length === 0 ? (
        <EmptyState title="No Money Desk requests yet." body="Prepared money actions will appear here with their risk reason, approval count, immutable correlation ID, and terminal execution outcome." />
      ) : (
        <div className="rounded-[8px] border border-needle/14 bg-mint/38 px-5 py-4" role="status">
          <p className="text-sm font-semibold text-needle-700">Active queue clear</p>
          <p className="mt-1 text-xs leading-5 text-ink/56">Completed requests remain available in history below for audit and investigation.</p>
        </div>
      )}

      {moneyDeskHistory.length > 0 ? (
        <details className="group rounded-[8px] border border-ink/10 bg-white/76">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle/60">
            <span>Completed history · {moneyDeskHistory.length}</span>
            <span aria-hidden="true" className="text-ink/44 transition group-open:rotate-180">⌄</span>
          </summary>
          <div className="grid gap-4 border-t border-ink/8 p-4">
            {moneyDeskHistory.map((item) => <MoneyDeskRequestCard key={item.id} item={item} context={context} redirectTo={redirectTo} />)}
          </div>
        </details>
      ) : null}
    </SectionFrame>
  )
}

function renderOpsSection(
  sectionKey: OpsView,
  data: OpsDashboardData,
  currentView: OpsView,
  context: OpsRenderContext,
): React.JSX.Element {
  switch (sectionKey) {
    case 'money-desk':
      return <MoneyDeskSurface data={data} context={context} currentView={currentView} />
    case 'incidents':
      return (
        <IncidentSurface
          data={data}
          currentView={currentView}
          role={context.session.role}
        />
      )
    case 'access':
      return <AccessControlSurface context={context} />
    case 'support': {
      const unreadThreads = data.supportThreads.filter(t => t.unreadCount > 0)
      return (
        <SectionFrame
          id="support"
          eyebrow="Support"
          title="Order conversations should stay visible enough for support to step in fast."
          description="This lane shows recent order threads, unread state, latest message context, payment state, and the safety switch to pause or reopen a conversation when trust breaks down."
        >
          {unreadThreads.length > 0 ? (
            <form method="POST" action="/ops/action" className="flex justify-end">
              <input type="hidden" name="kind" value="support-thread-mark-read" />
              <input type="hidden" name="redirectTo" value={buildOpsRedirectTarget(currentView, 'support')} />
              <input type="hidden" name="orderIds" value={unreadThreads.map(t => t.orderId).join(',')} />
              <button type="submit" className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 bg-white px-4 py-2 text-xs font-semibold text-ink transition hover:bg-bone">
                Mark all as read
                <span className="rounded-full border border-ink/10 bg-bone px-1.5 py-0.5 text-[10px] tabular-nums">{unreadThreads.length}</span>
              </button>
            </form>
          ) : null}
          {data.supportThreads.length > 0 ? (
            <div className="grid min-w-0 gap-5">
              {data.supportThreads.map((thread) => (
                <SupportThreadCard
                  key={thread.orderId}
                  thread={thread}
                  redirectTo={buildOpsRedirectTarget(currentView, 'support')}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No recent order conversations are showing."
              body="When customers or tailors send order messages, this lane gives support enough context to help without opening the mobile app."
            />
          )}
        </SectionFrame>
      )
    }
    case 'shop':
      return (
        <SectionFrame
          id="shop"
          eyebrow="Ready-made"
          title="Ready-made inventory needs the same trust posture as custom orders."
          description="This lane shows recent shop listings, stock risks, missing product photos, and fulfillment gaps so ops can catch checkout issues before buyers do."
        >
          {data.shopItems.length > 0 ? (
            <div className="grid gap-5">
              {data.shopItems.map((item) => (
                <ShopItemCard
                  key={item.id}
                  item={item}
                  redirectTo={buildOpsRedirectTarget(currentView, 'shop')}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No ready-made listings are showing yet."
              body="When tailors publish or edit ready-made pieces, this lane will show the items that need inventory, media, or fulfillment attention."
            />
          )}
        </SectionFrame>
      )
    case 'disputes':
      return (
        <SectionFrame
          id="disputes"
          eyebrow="Disputes"
          title="See the conflict context before you jump into rescue mode."
          description="This queue is intentionally narrow: who is involved, what the customer said, what the order stage is, and whether ops has picked it up."
        >
          {data.disputes.length > 0 ? (
            <div className="grid gap-5">
              {data.disputes.map((dispute) => (
                <DisputeCard
                  key={dispute.id}
                  dispute={dispute}
                  redirectTo={buildOpsRedirectTarget(currentView, 'disputes')}
                  context={context}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No disputes are open right now."
              body="That is the state we want. If a customer raises a concern later, it will land here with order context."
            />
          )}
        </SectionFrame>
      )
    case 'order-reviews':
      return (
        <SectionFrame
          id="order-reviews"
          eyebrow="Order reviews"
          title="Cancellation requests and shipping or delivery help should be visible the moment either side asks Drapeon to step in."
          description="Shipping and delivery help remains available after payment, including completed orders. Routine cases stay in the live lifecycle; material-risk cases pause the order and unreleased settlement until Ops resolves them."
        >
          {data.orderReviews.length > 0 ? (
            <div className="grid gap-5">
              {data.orderReviews.map((review) => (
                <OrderReviewCard
                  key={review.id}
                  review={review}
                  redirectTo={buildOpsRedirectTarget(currentView, 'order-reviews')}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No order reviews are open right now."
              body="If a customer or tailor asks Drapeon to review a cancellation or dispatch issue, it will appear here with full order context."
            />
          )}
        </SectionFrame>
      )
    case 'reviews':
      return (
        <SectionFrame
          id="reviews"
          eyebrow="Review moderation"
          title="Make review visibility intentional instead of accidental."
          description="This queue shows reviews that are still held or unpublished so ops can decide whether they should go public, stay held, or just be sanity-checked in context."
        >
          {data.reviewQueue.length > 0 ? (
            <div className="grid gap-5">
              {data.reviewQueue.map((review) => (
                <ReviewQueueCard
                  key={review.id}
                  review={review}
                  redirectTo={buildOpsRedirectTarget(currentView, 'reviews')}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No reviews are waiting on moderation right now."
              body="When a review is held for policy or dispute context, or it still needs a manual visibility decision, it will show up here."
            />
          )}
        </SectionFrame>
      )
    case 'bypass': {
      const unreviewedLogs = data.bypassLogs.filter(l => !l.reviewed)
      return (
        <SectionFrame
          id="bypass"
          eyebrow="Contact bypass"
          title="Review blocked contact attempts without digging through raw logs."
          description="This is the server-side record of users trying to move communication off-platform before the right milestone."
        >
          {unreviewedLogs.length > 1 ? (
            <form method="POST" action="/ops/action" className="flex justify-end">
              <input type="hidden" name="kind" value="bypass-bulk-review" />
              <input type="hidden" name="redirectTo" value={buildOpsRedirectTarget(currentView, 'bypass')} />
              <input type="hidden" name="logIds" value={unreviewedLogs.map(l => l.id).join(',')} />
              <button type="submit" className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 bg-white px-4 py-2 text-xs font-semibold text-ink transition hover:bg-bone">
                Mark all reviewed
                <span className="rounded-full border border-ink/10 bg-bone px-1.5 py-0.5 text-[10px] tabular-nums">{unreviewedLogs.length}</span>
              </button>
            </form>
          ) : null}
          {data.bypassLogs.length > 0 ? (
            <div className="grid gap-5">
              {data.bypassLogs.map((log) => (
                <BypassLogCard
                  key={log.id}
                  log={log}
                  redirectTo={buildOpsRedirectTarget(currentView, 'bypass')}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No blocked contact attempts yet."
              body="When the abuse filters catch phone numbers, handles, or external links, the review queue will show them here."
            />
          )}
        </SectionFrame>
      )
    }
    case 'applications':
      return (
        <SectionFrame
          id="applications"
          eyebrow="Tailor intake"
          title="Keep application review lightweight, visible, and moving."
          description="This mirrors the public application funnel from the website so ops can contact applicants and keep the pipeline from going stale."
        >
          {data.applications.length > 0 ? (
            <div className="grid gap-5">
              {data.applications.map((application) => (
                <ApplicationCard
                  key={application.id}
                  application={application}
                  redirectTo={buildOpsRedirectTarget(currentView, 'applications')}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No tailor applications are in the queue."
              body="New website applications will land here automatically."
            />
          )}
        </SectionFrame>
      )
    case 'verification':
      return (
        <SectionFrame
          id="verification"
          eyebrow="Verification"
          title="Pending verification stays visible even before a fuller admin system exists."
          description="This gives ops one place to spot pending tailor profiles and open the private challenge-video submission quickly."
        >
          {data.pendingVerifications.length > 0 ? (
            <div className="grid gap-5">
              {data.pendingVerifications.map((profile) => (
                <VerificationCard
                  key={profile.profileId}
                  profile={profile}
                  redirectTo={buildOpsRedirectTarget(currentView, 'verification')}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No pending verification requests right now."
              body="When a tailor submits ID verification, the profile will appear here until it is handled."
            />
          )}
        </SectionFrame>
      )
    case 'dispatch':
      return (
        <SectionFrame
          id="dispatch"
          eyebrow="Dispatch queue"
          title="Standard delivery and shipping handoff should happen from one ops queue."
          description="These orders already collected the flat Drapeon-managed fulfillment fee at checkout. Once the seller has packed the parcel, ops owns the actual rider or courier handoff from here."
        >
          {data.dispatchQueue.length > 0 ? (
            <div className="grid gap-5">
              {data.dispatchQueue.map((item) => (
                <DispatchCard
                  key={item.orderId}
                  item={item}
                  redirectTo={buildOpsRedirectTarget(currentView, 'dispatch')}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nothing is waiting for Drapeon dispatch right now."
              body="When a seller marks a delivery or shipping order ready for Drapeon dispatch, it will land here with the recipient details ops needs."
            />
          )}
        </SectionFrame>
      )
    case 'workflow-issues': {
      const wi = context.rawData.workflowIssues
      return (
        <SectionFrame
          id="workflow-issues"
          eyebrow="Workflow issues"
          title="Open customer, payment, consultation, and fulfillment issues need clear owners."
          description="Each protected case stays separate until its evidence-backed terminal decision is recorded. Financial, consultation, and safety cases are never bulk-closed."
        >
          <OpsFilterChips
            view="workflow-issues"
            query={context.query}
            currentFilter={context.filter}
            chips={[
              { key: 'critical', label: 'Critical / High', count: wi.filter((i) => ['CRITICAL', 'HIGH'].includes(i.severity.toUpperCase())).length },
              { key: 'consultations', label: 'Consultations', count: wi.filter((i) => Boolean(i.consultationAttendance)).length },
              { key: 'payment', label: 'Payment & payout', count: wi.filter((i) => ['PAYOUT_BLOCKED', 'PAYMENT_BLOCKED'].includes(i.issueType)).length },
              { key: 'safety', label: 'Safety', count: wi.filter((i) => i.issueType === 'CONVERSATION_SAFETY').length },
              { key: 'open', label: 'Open only', count: wi.filter((i) => i.status !== 'RESOLVED').length },
            ]}
          />
          <details>
            <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-[8px] border border-needle/14 bg-needle/7 px-5 py-3 text-sm font-semibold text-needle-700 transition hover:bg-needle/10 [&::-webkit-details-marker]:hidden">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-needle/22 bg-white text-[15px] font-bold leading-none text-needle">+</span>
              New case
            </summary>
            <div className="mt-4">
              <ManualIssueCreateCard
                redirectTo={buildOpsRedirectTarget(currentView, 'workflow-issues')}
              />
            </div>
          </details>
          {data.workflowIssues.length > 0 ? (
            <div className="grid gap-5">
              {data.workflowIssues.map((issue) => (
                <WorkflowIssueCard
                  key={issue.id}
                  issue={issue}
                  redirectTo={context.filter
                    ? `/ops?view=workflow-issues&filter=${encodeURIComponent(context.filter)}#workflow-issues`
                    : buildOpsRedirectTarget(currentView, 'workflow-issues')}
                  role={context.session.role}
                  defaultOpen={context.focusIssueId === issue.id || (context.filter === 'consultations' && Boolean(issue.consultationAttendance))}
                  returnTo={context.focusIssueId === issue.id ? context.returnTo : null}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No issues match this filter."
              body="Try clearing the filter above, or use All to see the full queue."
            />
          )}
        </SectionFrame>
      )
    }
    case 'runbook':
      return <OpsRunbookSurface context={context} />
    case 'deletions':
      return (
        <SectionFrame
          id="deletions"
          eyebrow="Privacy ops"
          title="Deletion requests should never disappear into a support inbox."
          description="People can already request deletion in-app. This queue makes the follow-through visible, statused, and easy to hand off between ops and privacy."
        >
          {data.deletionRequests.length > 0 ? (
            <div className="grid gap-5">
              {data.deletionRequests.map((request) => (
                <DeletionRequestCard
                  key={request.id}
                  request={request}
                  redirectTo={buildOpsRedirectTarget(currentView, 'deletions')}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No account deletion requests are waiting right now."
              body="When a customer or tailor starts a deletion request in the app, it will appear here with its current handling status."
            />
          )}
        </SectionFrame>
      )
    case 'payouts': {
      const po = context.rawData.payouts
      const releasablePayouts = data.payouts.filter(p => {
        const s = p.status.toUpperCase()
        return (s === 'PENDING' || s === 'FAILED') && p.orderId
      })
      return (
        <SectionFrame
          id="payouts"
          eyebrow="Payout visibility"
          title="Payouts should explain exactly why money is pending, released, or blocked."
              description="Finance can see payment capture, refund exposure, handoff confirmation, the 72-hour release window, payment-protection state, and retry payout release when the checks are clean."
        >
          <OpsFilterChips
            view="payouts"
            query={context.query}
            currentFilter={context.filter}
            chips={[
              { key: 'blocked', label: 'Blocked', count: po.filter((p) => p.status.toUpperCase() === 'BLOCKED').length },
              { key: 'failed', label: 'Failed', count: po.filter((p) => p.status.toUpperCase() === 'FAILED').length },
              { key: 'pending', label: 'Pending', count: po.filter((p) => p.status.toUpperCase() === 'PENDING').length },
            ]}
          />
          {releasablePayouts.length > 1 ? (
            <form method="POST" action="/ops/action" className="flex justify-end">
              <input type="hidden" name="kind" value="payout-bulk-release" />
              <input type="hidden" name="redirectTo" value={buildOpsRedirectTarget(currentView, 'payouts')} />
              <input type="hidden" name="orderIds" value={releasablePayouts.map(p => p.orderId as string).join(',')} />
              <button type="submit" className="inline-flex items-center gap-1.5 rounded-full bg-needle px-4 py-2 text-xs font-semibold text-white transition hover:bg-needle-600">
                Release all pending
                <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] tabular-nums">{releasablePayouts.length}</span>
              </button>
            </form>
          ) : null}
          {data.payouts.length > 0 ? (
            <div className="grid gap-5">
              {data.payouts.map((payout) => (
                <PayoutCard key={payout.id} payout={payout} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No payouts match this filter."
              body="Try clearing the filter above, or use All to see every payout record."
            />
          )}
        </SectionFrame>
      )
    }
    case 'overview':
    default:
      return (
        <OpsOverviewSurface
          data={data}
          visibleSections={getVisibleOpsSections(context.session.role)}
        />
      )
  }
}

export default async function OpsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<React.JSX.Element> {
  const params = await searchParams
  const accessMode = getOpsAccessMode()
  const noticeKey = readParam(params, 'notice')
  const errorKey = readParam(params, 'error')
  const errorDetail = readParam(params, 'errorDetail')
  const view = parseOpsView(readParam(params, 'view'))
  const query = readParam(params, 'q')?.trim() ?? ''
  const filter = readParam(params, 'filter')?.trim() ?? ''
  const focusIssueId = readParam(params, 'focusIssue')?.trim() ?? null
  const rawReturnTo = readParam(params, 'returnTo')?.trim() ?? null
  const returnTo = rawReturnTo && rawReturnTo.startsWith('/ops?') && !rawReturnTo.startsWith('//') && rawReturnTo.length <= 500
    ? rawReturnTo
    : null
  const notice = noticeKey ? NOTICE_COPY[noticeKey] ?? null : null
  const error = errorKey ? ERROR_COPY[errorKey] ?? 'Something went wrong while opening the ops surface.' : null

  if (accessMode === 'unconfigured') {
    return <SetupView />
  }

  const session = await getOpsSession()
  if (!session) {
    return accessMode === 'cloudflare-access' ? <WorkforceAccessView error={error} /> : <LoginView error={error} />
  }

  const visibleSections = getVisibleOpsSections(session.role)
  const navigationGroups = buildOpsNavigationGroups(visibleSections)
  const safeView = canAccessOpsSection(session.role, view) ? view : visibleSections[0]?.key ?? 'overview'
  const safeSection = getOpsSection(safeView)
  const roleError = safeView !== view ? ERROR_COPY.forbidden : error

  const loadedData = await loadOpsDashboardData({ bypassCache: Boolean(noticeKey || errorKey) })
  if (!loadedData) {
    return <LoginView error={ERROR_COPY['service-role-missing'] ?? 'Add the server-side Supabase service role env vars to load ops data.'} />
  }
  const filteredByQuery = filterOpsDashboardData(loadedData, query)
  const data = applyOpsChipFilter(filteredByQuery, safeView, filter)
  const pulseEnabled =
    canAccessOpsSection(session.role, 'workflow-issues') ||
    canAccessOpsSection(session.role, 'incidents')
  const pulseSnapshot = buildOpsPulseSnapshot(filteredByQuery)
  const renderContext: OpsRenderContext = {
    accessMode,
    session,
    query,
    filter,
    rawData: filteredByQuery,
    noticeKey: noticeKey ?? null,
    focusIssueId,
    returnTo,
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(45,106,79,0.16),transparent_34%),radial-gradient(circle_at_82%_10%,rgba(216,90,48,0.10),transparent_26%),linear-gradient(180deg,#f7f1e8_0%,#f1eadf_100%)]">
      <OpsActionBridge initialNotice={notice} initialError={roleError} initialErrorDetail={errorDetail} />
      <div className="mx-auto max-w-[95rem] px-5 py-6 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between gap-4 rounded-[8px] border border-white/72 bg-white/82 px-5 py-3 shadow-sm backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <p className="shrink-0 text-sm font-semibold text-ink">Drapeon Ops</p>
            <span className="text-ink/20">/</span>
            <h1 className="truncate text-sm text-ink/60">{safeSection.label}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border border-needle/14 bg-needle/8 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-needle-700">
              {formatDatabaseEnumLabel(session.role)}
            </span>
            <span className="hidden rounded-full border border-ink/8 bg-bone px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/52 sm:inline-flex">
              {accessMode.replace(/-/g, ' ')}
            </span>
            <a
              href={`mailto:${CONTACTS.ops}`}
              className="hidden items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone sm:inline-flex"
            >
              Email ops
            </a>
            <form action="/ops/logout" method="post">
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink/88"
              >
                Lock
              </button>
            </form>
          </div>
        </header>

        <OpsPulsePanel enabled={pulseEnabled} snapshot={pulseSnapshot} />

        {data.issues.length > 0 ? (
          <div className="mt-4 rounded-[8px] border border-rust/16 bg-rust/8 px-5 py-3 text-sm leading-7 text-rust-700">
            <p className="font-semibold text-rust-700">Some ops data could not be loaded cleanly.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {data.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {query ? (
          <div className="mt-4 rounded-[8px] border border-needle/16 bg-needle/8 px-5 py-3 text-sm leading-7 text-needle-700">
            Showing records matching &ldquo;{query}&rdquo;. Queue counts stay global so you can still see the full workload.
          </div>
        ) : null}

        <details className="group mt-4 rounded-[8px] border border-ink/8 bg-white/88 shadow-sm backdrop-blur lg:hidden">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/42">Browse Ops</span>
              <span className="mt-0.5 block truncate text-sm font-semibold text-ink">{safeSection.label}</span>
            </span>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-ink/8 bg-bone text-lg text-ink/60 transition group-open:rotate-45" aria-hidden="true">+</span>
          </summary>
          <div className="max-h-[70vh] overflow-y-auto border-t border-ink/8 p-3">
            <form action="/ops" method="get" className="mb-3 flex gap-2">
              <input type="hidden" name="view" value={safeView} />
              <label className="sr-only" htmlFor="ops-search-mobile">Search Ops</label>
              <input id="ops-search-mobile" name="q" defaultValue={query} placeholder="Search orders, people, or IDs" className="h-10 min-w-0 flex-1 rounded-lg border border-ink/10 bg-white px-3 text-sm outline-none focus:border-needle/40" />
              <button type="submit" className="h-10 rounded-lg bg-needle px-4 text-sm font-semibold text-white">Search</button>
            </form>
            <nav aria-label="Ops workspaces" className="grid gap-3 sm:grid-cols-2">
              {navigationGroups.map((group) => (
                <section key={group.team}>
                  <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/38">{group.label}</p>
                  <div className="grid gap-0.5">
                    {group.sections.map((section) => (
                      <OpsNavItem key={section.key} href={buildOpsHref(section.key)} label={section.label} count={section.summaryCount(data.summary)} active={safeView === section.key} />
                    ))}
                  </div>
                </section>
              ))}
            </nav>
          </div>
        </details>

        <div className="mt-5 grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="hidden h-[calc(100vh-2.5rem)] overflow-hidden rounded-[8px] border border-ink/8 bg-white/86 shadow-[0_18px_60px_rgba(22,28,24,0.08)] backdrop-blur lg:sticky lg:top-5 lg:flex lg:flex-col">
            <div className="border-b border-ink/8 p-3">
            <form action="/ops" method="get" className="flex gap-2 px-1 pb-1 pt-1">
              <input type="hidden" name="view" value={safeView} />
              <label className="sr-only" htmlFor="ops-search">Search ops</label>
              <input
                id="ops-search"
                name="q"
                defaultValue={query}
                placeholder="Search…"
                className="h-9 min-w-0 flex-1 rounded-lg border border-ink/10 bg-white/88 px-4 text-sm text-ink outline-none transition placeholder:text-ink/32 focus:border-needle/40"
              />
              <button
                type="submit"
                className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-needle px-4 text-sm font-semibold text-white transition hover:bg-needle/90"
              >
                Go
              </button>
              {query ? (
                <a
                  href={buildOpsHref(safeView)}
                  className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-ink/10 bg-white px-3 text-xs font-semibold text-ink/70 transition hover:bg-bone focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle/60"
                >
                  Clear
                </a>
              ) : null}
            </form>
            </div>
            <nav aria-label="Ops workspaces" className="flex-1 overflow-y-auto p-3">
              <div className="grid gap-3">
                {navigationGroups.map((group) => (
                  <section key={group.team}>
                    <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/38">{group.label}</p>
                    <div className="grid gap-0.5">
                      {group.sections.map((section) => (
                        <OpsNavItem key={section.key} href={buildOpsHref(section.key)} label={section.label} count={section.summaryCount(data.summary)} active={safeView === section.key} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </nav>
            <div className="border-t border-ink/8 bg-bone/45 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/38">Access scope</p>
              <p className="mt-1 truncate text-xs font-medium text-ink/62">{formatDatabaseEnumLabel(session.role)} · {visibleSections.length} workspaces</p>
            </div>
          </aside>

          <div className="min-w-0">
            {renderOpsSection(safeView, data, safeView, renderContext)}
          </div>
        </div>
      </div>
    </main>
  )
}
