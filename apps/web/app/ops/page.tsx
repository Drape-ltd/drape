import type { Metadata } from 'next'
import {
  CONTACTS,
  DRAPE_EXCEPTION_BUCKETS,
  DRAPE_EXCEPTION_RUNBOOK_ENTRIES,
  formatDatabaseEnumLabel,
  OPS_ISSUE_SEVERITIES,
  OPS_ISSUE_TYPES,
} from '@drape/shared'
import { isVideoMediaUrl, videoPosterFrameUrl } from '@drape/shared/media-policy'
import type { JSX, ReactNode } from 'react'
import {
  getOpsAccessMode,
  getOpsBootstrapRole,
  getOpsDashboardTokenStatus,
  getOpsSession,
  hasOpsWorkforceAccessConfig,
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

export const dynamic = 'force-dynamic'

type OpsRenderContext = {
  accessMode: ReturnType<typeof getOpsAccessMode>
  session: OpsSession
  query: string
  filter: string
  rawData: OpsDashboardData
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
  'deletion-saved': 'Deletion request status updated.',
  'dispatch-saved': 'Dispatch stage updated.',
  'review-published': 'Review is public now.',
  'review-held': 'Review is held from public view.',
  'conversation-blocked': 'Conversation paused for safety review.',
  'conversation-unblocked': 'Conversation reopened.',
  'order-review-refunded': 'Order review approved and refund resolution recorded.',
  'order-review-continued': 'Order review closed and the order was returned to its live stage.',
  'payout-release-triggered': 'Payout release was triggered for that order.',
  'material-advance-release-triggered': 'Material advance release was triggered.',
  'payout-resolution-applied': 'Payout resolution was saved and payout release was retried.',
  'payout-resolution-refunded': 'Customer refund completed for that payout-blocked order.',
  'partial-refund-issued': 'Partial refund issued and logged to the order timeline.',
  'workflow-issue-saved': 'Workflow issue status updated.',
  'workflow-issues-bulk-resolved': 'All visible workflow issues resolved.',
  'support-threads-read': 'Support threads marked as read.',
  'payouts-bulk-released': 'Payout release triggered for all visible orders.',
  'bypass-bulk-reviewed': 'All visible bypass logs marked as reviewed.',
  'manual-issue-created': 'Manual ops issue created.',
  'seller-item-hidden': 'Ready-made item is hidden from buyers.',
  'seller-item-restored': 'Ready-made item is live again.',
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
  'partial-refund-invalid': 'Enter a refund amount greater than zero and below the remaining refundable balance.',
  'payout-release-failed': 'The payout release could not be triggered right now.',
  'material-advance-release-failed': 'The material advance could not be released right now.',
  'workflow-issue-save-failed': 'That workflow issue could not be updated right now.',
  'manual-issue-create-failed': 'That manual issue could not be created right now.',
  'seller-item-save-failed': 'That ready-made item could not be updated right now.',
  'verification-rejection-reason-required': 'Add a rejection reason before rejecting verification.',
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
    <section id={id} className="grid gap-5">
      <div className="border-b border-ink/8 pb-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-needle/72">{eyebrow}</p>
        <h2 className="mt-2 text-2xl text-ink sm:text-3xl">{title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-ink/60">{description}</p>
      </div>
      <div className="grid gap-5">{children}</div>
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
  background,
  summary,
  children,
}: {
  background: string
  summary: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <article className={`rounded-[8px] border border-ink/8 ${background} shadow-sm`}>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-5 [&::-webkit-details-marker]:hidden">
          {summary}
          <CardCollapseChevron />
        </summary>
        <div className="border-t border-ink/8 px-5 pb-5 pt-5">
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
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item, index) => (
        <div key={`${item.label}:${index}`} className="rounded-[8px] border border-ink/6 bg-bone/56 px-4 py-3">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/42">{item.label}</dt>
          <dd className="mt-1 text-sm leading-6 text-ink">{item.value}</dd>
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
}: {
  dispute: OpsDispute
  redirectTo: string
}): React.JSX.Element {
  const editable = dispute.status === 'OPEN' || dispute.status === 'UNDER_REVIEW'
  const canResolve = editable && dispute.orderStage === 'IN_DISPUTE'

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

      <div className="mt-5 grid gap-5">
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
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/36">Order</p>
          <DetailList
            items={[
              { label: 'Stage', value: dispute.orderStage ?? '—' },
              { label: 'Amount', value: formatMoney(dispute.amount, dispute.currency) },
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

            {canResolve ? (
              <form action="/ops/action" method="post" className="grid gap-3 rounded-[8px] border border-ink/6 bg-white/76 p-4">
                <input type="hidden" name="kind" value="dispute-resolution" />
                <input type="hidden" name="redirectTo" value={redirectTo} />
                <input type="hidden" name="disputeId" value={dispute.id} />
                <label className="grid gap-2 text-sm text-ink/70">
                  Resolution note
                  <textarea
                    name="resolution"
                    rows={3}
                    placeholder="Optional context that both parties should see on the resolution."
                    className="rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
                  />
                </label>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="submit"
                    name="outcome"
                    value="REFUND"
                    className="inline-flex items-center justify-center rounded-full border border-rust/18 bg-rust/8 px-5 py-3 text-sm font-semibold text-rust-700 transition hover:bg-rust/12"
                  >
                    Refund customer
                  </button>
                  <button
                    type="submit"
                    name="outcome"
                    value="RELEASE"
                    className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90"
                  >
                    Release to tailor
                  </button>
                </div>
              </form>
            ) : (
              <div className="rounded-[8px] border border-dashed border-ink/10 bg-white/68 px-4 py-3 text-sm leading-7 text-ink/62">
                Refresh before resolving if the order is no longer in `IN_DISPUTE`. This card can still be triaged, but only active disputes can be closed here.
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
          <StatusChip status={payout.status} className={`shrink-0 ${statusPillClass(payout.status)}`} />
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
            <StatusChip status={payout.status} className={statusPillClass(payout.status)} />
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
              { label: 'Status', value: formatDatabaseEnumLabel(payout.status) },
              { label: 'Escrow released', value: payout.escrowReleased ? 'Yes' : 'No' },
              { label: 'Provider ID', value: payout.providerPayoutId ?? '—' },
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
}: {
  issue: OpsWorkflowIssue
  redirectTo: string
  role: OpsRole
}): React.JSX.Element {
  const issueOpen = issue.status !== 'RESOLVED'
  const canManageConversation =
    issueOpen
    &&
    (issue.issueType === 'CONVERSATION_SAFETY' || issue.event === 'conversation.safety_reported')
    && !!issue.orderId
  const canUpdateIssueStatus = issue.source !== 'audit_logs'
  const canResolveBlockedPayout = issueOpen && issue.issueType === 'PAYOUT_BLOCKED' && !!issue.orderId
  const canPartialRefund =
    issueOpen
    &&
    !!issue.orderId
    && issue.maxRefundableAmount > 0
    && ['AFTERCARE_REQUEST', 'ORDER_REVIEW', 'DELIVERY_REVIEW', 'PAYMENT_BLOCKED', 'PAYOUT_BLOCKED'].includes(issue.issueType)
  const canReleaseMaterialAdvance =
    issueOpen
    && !!issue.materialAdvanceId
    && getOpsRoleActions(role).includes('material-advance-release')
  const canDecideProfileChange =
    issueOpen
    && issue.relatedEntityType === 'profile_change_request'
    && !!issue.relatedEntityId
    && getOpsRoleActions(role).includes('profile-change-decision')
  const canDecidePayoutChange =
    issueOpen
    && issue.relatedEntityType === 'payout_change_request'
    && !!issue.relatedEntityId
    && getOpsRoleActions(role).includes('payout-change-decision')

  return (
    <CardCollapse
      background="bg-[linear-gradient(180deg,#fffdf9_0%,#f4eee3_100%)]"
      summary={
        <>
          <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${severityPillClass(issue.severity)}`}>
            {issue.severity}
          </span>
          <span className="font-semibold text-ink">{workflowIssueLabel(issue.event)}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink/48">{issue.summary}</span>
          {issue.maxRefundableAmount > 0 ? <span className="shrink-0 text-sm font-semibold text-rust-700/80">{formatMoney(issue.maxRefundableAmount, issue.orderCurrency)}</span> : null}
          <span className="shrink-0 text-xs text-ink/38">{formatRelativeTime(issue.createdAt)}</span>
        </>
      }
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-ink/8 bg-bone px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/55">
              {issue.displayId}
            </span>
            <span className="text-lg text-ink">{workflowIssueLabel(issue.event)}</span>
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
        <p className="mt-1 text-sm leading-7 text-ink/76">{issue.recommendedAction}</p>
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

      <IssueHistoryBlock history={issue.history} />

      {(canUpdateIssueStatus || canResolveBlockedPayout || canReleaseMaterialAdvance || canPartialRefund || canManageConversation || canDecideProfileChange || canDecidePayoutChange) ? (
        <div className="mt-5 border-t border-ink/8 pt-5">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/38">Actions</p>
          <div className="grid gap-4">
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
        <form action="/ops/action" method="post" className="flex flex-col gap-3 rounded-[8px] border border-rust/12 bg-rust/6 p-4">
          <input type="hidden" name="kind" value="payout-change-decision" />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="requestId" value={issue.relatedEntityId ?? ''} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rust-700">Payout destination review</p>
            <p className="mt-2 text-sm leading-7 text-ink/72">Approve to replace the live payout destination and start the normal cooldown/hold window. Reject to keep the current payout destination active.</p>
          </div>
          <label className="grid gap-2 text-sm text-ink/70">
            Reason or ops note
            <textarea name="reason" rows={2} placeholder="Required for rejection; useful for approval notes" className="rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40" />
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
          <div className="flex flex-wrap gap-3">
            <button type="submit" name="decision" value="APPROVE" className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90">Approve payout destination</button>
            <button type="submit" name="decision" value="REJECT" className="inline-flex items-center justify-center rounded-full border border-rust/18 bg-rust/10 px-5 py-3 text-sm font-semibold text-rust-700 transition hover:bg-rust/14">Reject destination</button>
          </div>
        </form>
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
              These actions run immediately and leave an audit trail. Retry the payout in the order currency, convert the payout to the tailor&apos;s current payout currency, or refund the customer if this order cannot be settled safely.
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
            <button
              type="submit"
              name="resolutionMode"
              value="REFUND_CUSTOMER"
              className="inline-flex items-center justify-center rounded-full border border-rust/18 bg-rust/10 px-5 py-3 text-sm font-semibold text-rust-700 transition hover:bg-rust/14"
            >
              Refund customer instead
            </button>
          </div>
        </form>
      ) : null}

      {canReleaseMaterialAdvance ? (
        <form action="/ops/action" method="post" className="flex flex-col gap-3 rounded-[8px] border border-needle/14 bg-needle/6 p-4">
          <input type="hidden" name="kind" value="material-advance-release" />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="advanceId" value={issue.materialAdvanceId ?? ''} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/78">Material advance release</p>
            <p className="mt-2 text-sm leading-7 text-ink/72">
              Release only the customer-approved material amount. This does not touch the main order escrow; the tailor must still upload receipt proof for the order record.
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
            Release note
            <textarea
              name="note"
              required
              rows={3}
              placeholder="Confirm what was reviewed before releasing this material advance."
              className="rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40"
            />
          </label>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90"
          >
            Release approved material advance
          </button>
        </form>
      ) : null}

      {canPartialRefund ? (
        <form action="/ops/action" method="post" className="flex flex-col gap-3 rounded-[8px] border border-rust/12 bg-white/92 p-4">
          <input type="hidden" name="kind" value="order-partial-refund" />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="issueId" value={issue.id} />
          <input type="hidden" name="orderId" value={issue.orderId ?? ''} />
          <input type="hidden" name="maxRefundableAmount" value={String(issue.maxRefundableAmount)} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rust-700">Partial refund</p>
            <p className="mt-2 text-sm leading-7 text-ink/72">
              Refund part of the customer payment now. The provider refund runs first; only after it succeeds does Drapeon update the order timeline and resolve this issue.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-ink/8 bg-bone px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/46">Order total</p>
              <p className="mt-2 text-sm text-ink">{formatMoney(issue.orderTotalAmount, issue.orderCurrency)}</p>
            </div>
            <div className="rounded-lg border border-ink/8 bg-bone px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/46">Already refunded</p>
              <p className="mt-2 text-sm text-ink">{formatMoney(issue.alreadyRefundedAmount, issue.orderCurrency)}</p>
            </div>
            <div className="rounded-lg border border-ink/8 bg-bone px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/46">Maximum now</p>
              <p className="mt-2 text-sm text-ink">{formatMoney(issue.maxRefundableAmount, issue.orderCurrency)}</p>
            </div>
          </div>
          <label className="grid gap-2 text-sm text-ink/70">
            Refund amount ({issue.orderCurrency ?? 'order currency'})
            <input
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              placeholder="25.00"
              className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40"
            />
          </label>
          <label className="grid gap-2 text-sm text-ink/70">
            Refund reason
            <textarea
              name="note"
              required
              rows={3}
              placeholder="Explain why this partial refund is being issued and what the customer was told."
              className="rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40"
            />
          </label>
          <label className="inline-flex items-center gap-3 text-sm text-ink/72">
            <input type="checkbox" name="notifyCustomer" value="yes" className="h-4 w-4 rounded border border-ink/18 text-needle" />
            Email the customer after the provider confirms the refund
          </label>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full border border-rust/18 bg-rust px-5 py-3 text-sm font-semibold text-white transition hover:bg-rust/92"
          >
            Refund this amount
          </button>
        </form>
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
  const targetStage = isLocalDelivery ? 'OUT_FOR_DELIVERY' : 'SHIPPED'
  const providerLabel = isLocalDelivery ? 'Rider or provider' : 'Courier or provider'
  const actionLabel = isLocalDelivery ? 'Mark out for delivery' : 'Mark shipped'
  const description = isLocalDelivery
    ? 'Drapeon handles the rider handoff here once the seller says the parcel is packed and ready.'
    : 'Drapeon handles the courier handoff here once the seller says the parcel is packed and ready.'

  return (
    <CardCollapse
      background="bg-[linear-gradient(180deg,#fffdf9_0%,#f5eee3_100%)]"
      summary={
        <>
          <StatusChip status={item.stage} className={`shrink-0 ${statusPillClass(item.stage)}`} />
          <span className="font-semibold text-ink">Order #{item.orderReference}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink/48">{item.itemTitle ?? item.garmentType} · {formatDatabaseEnumLabel(item.deliveryMethod, 'Fulfillment')}</span>
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
          <p className="mt-1 text-sm leading-7 text-ink/64">{description}</p>
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
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/38">Actions</p>
        <form action="/ops/action" method="post" className="grid gap-4 rounded-[8px] border border-ink/6 bg-white/82 p-4">
        <input type="hidden" name="kind" value="dispatch-stage" />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <input type="hidden" name="orderId" value={item.orderId} />
        <input type="hidden" name="targetStage" value={targetStage} />
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm text-ink/72">
            Service level
            <select
              name="serviceLevel"
              defaultValue={isLocalDelivery ? 'STANDARD' : 'INTERNATIONAL_STANDARD'}
              className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40"
            >
              {isLocalDelivery ? (
                <>
                  <option value="STANDARD">Standard</option>
                  <option value="SAME_DAY">Same day</option>
                  <option value="NEXT_DAY">Next day</option>
                  <option value="CUSTOM">Custom</option>
                </>
              ) : (
                <>
                  <option value="STANDARD">Standard</option>
                  <option value="NEXT_DAY">Next day</option>
                  <option value="INTERNATIONAL_STANDARD">International standard</option>
                  <option value="INTERNATIONAL_EXPRESS">International express</option>
                  <option value="CUSTOM">Custom</option>
                </>
              )}
            </select>
          </label>
          <label className="grid gap-2 text-sm text-ink/72">
            {providerLabel}
            <input
              required
              type="text"
              name="provider"
              defaultValue={item.provider ?? item.carrier ?? ''}
              className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
              placeholder={isLocalDelivery ? 'e.g. Gokada, Uber, local rider' : 'e.g. DHL, USPS, UPS'}
            />
          </label>
          <label className="grid gap-2 text-sm text-ink/72">
            {isLocalDelivery ? 'Trip or dispatch reference' : 'Shipment reference'}
            <input
              type="text"
              name="reference"
              defaultValue={item.reference ?? ''}
              className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
              placeholder={isLocalDelivery ? 'Optional internal or rider reference' : 'Optional if tracking is known'}
            />
          </label>
          <label className="grid gap-2 text-sm text-ink/72">
            Contact name
            <input
              required
              type="text"
              name="contactName"
              defaultValue={item.contactName ?? ''}
              className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
              placeholder={isLocalDelivery ? 'Rider name or ops contact' : 'Courier desk or ops contact'}
            />
          </label>
          <label className="grid gap-2 text-sm text-ink/72">
            Contact phone
            <input
              required
              type="text"
              name="contactPhone"
              defaultValue={item.contactPhone ?? ''}
              className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
              placeholder="Include country code if known"
            />
          </label>
          {!isLocalDelivery ? (
            <label className="grid gap-2 text-sm text-ink/72 md:col-span-2">
              Tracking number
              <input
                type="text"
                name="trackingNumber"
                defaultValue={item.trackingNumber ?? ''}
                className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
                placeholder="Tracking number or leave blank if shipment reference is enough"
              />
            </label>
          ) : null}
        </div>
        <label className="grid gap-2 text-sm text-ink/72">
          Customer note
          <textarea
            name="note"
            rows={3}
            defaultValue=""
            className="rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
            placeholder={
              isLocalDelivery
                ? 'Optional note like: Your rider has collected the parcel and is on the way.'
                : 'Optional note like: DHL accepted the parcel and tracking is now active.'
            }
          />
        </label>
        <label className="inline-flex items-center gap-3 text-sm text-ink/72">
          <input type="checkbox" name="premiumException" value="on" className="size-4 rounded border border-ink/20" />
          Mark this as a premium or non-standard dispatch exception
        </label>
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90"
          >
            {actionLabel}
          </button>
        </div>
      </form>
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
  const continueLabel =
    review.reviewType === 'CANCELLATION'
      ? 'Keep order active'
      : review.requestedFromStage
        ? `Return to ${formatDatabaseEnumLabel(review.requestedFromStage).toLowerCase()}`
        : 'Keep order active'
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
          Both sides will see this result in the order timeline. A refund closes the order; keeping it active returns it to the previous live stage.
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
      className={`flex items-center justify-between rounded-[8px] border px-4 py-2.5 transition ${
        active
          ? 'border-needle/18 bg-needle/10 text-ink'
          : 'border-transparent text-ink/64 hover:border-ink/8 hover:bg-white/70 hover:text-ink'
      }`}
    >
      <p className="text-sm font-medium">{label}</p>
      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums ${countClass}`}>
        {count}
      </span>
    </a>
  )
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
    case 'workflow-issues':
      return {
        ...data,
        workflowIssues:
          chip === 'critical'
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

function renderOpsSection(
  sectionKey: OpsView,
  data: OpsDashboardData,
  currentView: OpsView,
  context: OpsRenderContext,
): React.JSX.Element {
  switch (sectionKey) {
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
            <div className="grid gap-5">
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
          title="Cancellation and delivery reviews should become visible the moment either side asks Drapeon to step in."
          description="These reviews come straight from the order timeline before handoff finishes cleanly. Use them to spot cancellation and delivery trouble early, not after it becomes a full dispute."
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
      const openIssues = data.workflowIssues.filter(i => i.status.toUpperCase() !== 'RESOLVED')
      return (
        <SectionFrame
          id="workflow-issues"
          eyebrow="Workflow issues"
          title="Open safety, payment, payout, and shipping issues should surface before support gets stuck guessing."
          description="This queue now reads from the dedicated ops issue ledger first, with legacy shipping and privacy alerts still shown until every trigger is migrated. Safety reports can also pause or reopen chat from here."
        >
          <OpsFilterChips
            view="workflow-issues"
            query={context.query}
            currentFilter={context.filter}
            chips={[
              { key: 'critical', label: 'Critical / High', count: wi.filter((i) => ['CRITICAL', 'HIGH'].includes(i.severity.toUpperCase())).length },
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
          {openIssues.length > 1 ? (
            <form method="POST" action="/ops/action" className="flex justify-end">
              <input type="hidden" name="kind" value="ops-issue-bulk-resolve" />
              <input type="hidden" name="redirectTo" value={buildOpsRedirectTarget(currentView, 'workflow-issues')} />
              <input type="hidden" name="issueIds" value={openIssues.map(i => i.id).join(',')} />
              <button type="submit" className="inline-flex items-center gap-1.5 rounded-full bg-needle px-4 py-2 text-xs font-semibold text-white transition hover:bg-needle-600">
                Resolve all visible
                <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] tabular-nums">{openIssues.length}</span>
              </button>
            </form>
          ) : null}
          {data.workflowIssues.length > 0 ? (
            <div className="grid gap-5">
              {data.workflowIssues.map((issue) => (
                <WorkflowIssueCard
                  key={issue.id}
                  issue={issue}
                  redirectTo={buildOpsRedirectTarget(currentView, 'workflow-issues')}
                  role={context.session.role}
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
          description="Finance can see payment capture, refund exposure, handoff confirmation, the 72-hour release window, escrow state, and retry payout release when the checks are clean."
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
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(45,106,79,0.16),transparent_34%),radial-gradient(circle_at_82%_10%,rgba(216,90,48,0.10),transparent_26%),linear-gradient(180deg,#f7f1e8_0%,#f1eadf_100%)]">
      <OpsActionBridge />
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

        {notice ? (
          <div className="mt-4 rounded-[8px] border border-needle/16 bg-needle/8 px-5 py-3 text-sm leading-7 text-needle-700">
            {notice}
          </div>
        ) : null}

        {roleError ? (
          <div className="mt-4 rounded-[8px] border border-rust/16 bg-rust/8 px-5 py-3 text-sm leading-7 text-rust-700">
            <p>{roleError}</p>
            {errorDetail ? <p className="mt-1.5 text-xs text-rust-700/78">{errorDetail}</p> : null}
          </div>
        ) : null}

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

        {/* Mobile section strip — visible only below xl breakpoint */}
        <div className="mt-4 xl:hidden">
          <div className="flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
            {visibleSections.map((section) => {
              const count = section.summaryCount(data.summary)
              const isActive = safeView === section.key
              return (
                <a
                  key={section.key}
                  href={buildOpsHref(section.key)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition ${isActive ? 'border-needle/20 bg-needle/10 text-needle-700' : 'border-ink/10 bg-white/88 text-ink/64 hover:bg-bone'}`}
                >
                  {section.label}
                  {count > 0 ? (
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${isActive ? 'bg-needle/18 text-needle-700' : 'bg-rust/10 text-rust-700'}`}>{count}</span>
                  ) : null}
                </a>
              )
            })}
          </div>
        </div>

        <div className="mt-5 grid gap-6 xl:grid-cols-[19rem_minmax(0,1fr)]">
          <aside className="hidden h-fit rounded-[8px] border border-ink/8 bg-white/86 p-3 shadow-[0_18px_60px_rgba(22,28,24,0.08)] backdrop-blur xl:block xl:sticky xl:top-5">
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
                  className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-ink/10 bg-white px-3 text-sm font-semibold text-ink/70 transition hover:bg-bone"
                >
                  ✕
                </a>
              ) : null}
            </form>
            <div className="mt-1 grid gap-0.5">
              {visibleSections.map((section, index) => {
                const prevTeam = index > 0 ? visibleSections[index - 1]?.team : null
                const showTeamLabel = section.team !== prevTeam
                return (
                  <div key={section.key}>
                    {showTeamLabel ? (
                      <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/34 first:pt-1">
                        {section.team}
                      </p>
                    ) : null}
                    <OpsNavItem
                      href={buildOpsHref(section.key)}
                      label={section.label}
                      count={section.summaryCount(data.summary)}
                      active={safeView === section.key}
                    />
                  </div>
                )
              })}
            </div>
          </aside>

          <div>
            {renderOpsSection(safeView, data, safeView, renderContext)}
          </div>
        </div>
      </div>
    </main>
  )
}
