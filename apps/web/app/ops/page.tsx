import type { Metadata } from 'next'
import { CONTACTS, OPS_ISSUE_SEVERITIES, OPS_ISSUE_TYPES } from '@drape/shared'
import Link from 'next/link'
import type { JSX, ReactNode } from 'react'
import {
  getOpsAccessMode,
  getOpsBootstrapRole,
  getOpsSession,
  hasOpsWorkforceAccessConfig,
} from '../../lib/ops-auth'
import {
  buildOpsHref,
  buildOpsRedirectTarget,
  canAccessOpsSection,
  getOpsSection,
  getVisibleOpsSections,
  OPS_FUTURE_SURFACES,
  OPS_LIVE_SECTIONS,
  parseOpsView,
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
  type OpsTailorApplication,
  type OpsVerification,
  type OpsIssueHistoryEntry,
  type OpsWorkflowIssue,
} from '../../lib/ops-data'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Ops | Drape',
  description: 'Internal Drape ops dashboard for disputes, review moderation, abuse review, verification, privacy and trust requests, workflow issues, account deletion follow-up, and payout visibility.',
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
  'deletion-saved': 'Deletion request status updated.',
  'dispatch-saved': 'Dispatch stage updated.',
  'review-published': 'Review is public now.',
  'review-held': 'Review is held from public view.',
  'conversation-blocked': 'Conversation paused for safety review.',
  'conversation-unblocked': 'Conversation reopened.',
  'order-review-refunded': 'Order review approved and refund resolution recorded.',
  'order-review-continued': 'Order review closed and the order was returned to its live stage.',
  'payout-release-triggered': 'Payout release was triggered for that order.',
  'payout-resolution-applied': 'Payout resolution was saved and payout release was retried.',
  'payout-resolution-refunded': 'Customer refund completed for that payout-blocked order.',
  'partial-refund-issued': 'Partial refund issued and logged to the order timeline.',
  'workflow-issue-saved': 'Workflow issue status updated.',
  'manual-issue-created': 'Manual ops issue created.',
}

const ERROR_COPY: Record<string, string> = {
  locked: 'Unlock the ops dashboard to continue.',
  forbidden: 'This bootstrap role does not have access to that control-plane surface.',
  'setup-needed': 'Add OPS_DASHBOARD_TOKEN before using the ops surface.',
  'invalid-token': 'That token did not match the configured ops access token.',
  'workforce-login-required': 'This control plane is protected by workforce access. Sign in through the Drape Access gate with your @drapeon.co account.',
  'workforce-unassigned': 'Your workforce identity is valid, but no control-plane role is assigned to it yet.',
  'service-role-missing': 'Add the server-side Supabase service role env vars to load ops data.',
  'invalid-action': 'That ops action was not recognized.',
  conflict: 'That record changed since the page loaded. Refresh the dashboard and try again.',
  'save-failed': 'That update could not be saved right now.',
  'refund-failed': 'The provider refund did not complete, so the order was not marked refunded.',
  'partial-refund-invalid': 'Enter a refund amount greater than zero and below the remaining refundable balance.',
  'payout-release-failed': 'The payout release could not be triggered right now.',
  'workflow-issue-save-failed': 'That workflow issue could not be updated right now.',
  'manual-issue-create-failed': 'That manual issue could not be created right now.',
  'verification-rejection-reason-required': 'Add a rejection reason before rejecting verification.',
}

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

function statusPillClass(status: string) {
  const normalized = status.toUpperCase()

  if (normalized === 'OPEN' || normalized === 'PENDING') {
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
}): JSX.Element {
  return (
    <div className="rounded-[1.5rem] border border-ink/8 bg-white/88 p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{label}</p>
      <div className="mt-4 text-4xl text-ink">{value}</div>
      <p className="mt-2 text-sm leading-7 text-ink/62">{hint}</p>
    </div>
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
}): JSX.Element {
  return (
    <section
      id={id}
      className="rounded-[2rem] border border-ink/8 bg-white/86 p-6 shadow-[0_24px_80px_rgba(22,28,24,0.08)] sm:p-7"
    >
      <div className="flex flex-col gap-3 border-b border-ink/6 pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{eyebrow}</p>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-3xl text-ink sm:text-4xl">{title}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-ink/65">{description}</p>
          </div>
        </div>
      </div>
      <div className="mt-6">{children}</div>
    </section>
  )
}

function EmptyState({
  title,
  body,
}: {
  title: string
  body: string
}): JSX.Element {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-ink/12 bg-bone/60 p-6">
      <h3 className="text-xl text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-7 text-ink/64">{body}</p>
    </div>
  )
}

function DetailList({
  items,
}: {
  items: Array<{ label: string; value: string }>
}): JSX.Element {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div key={`${item.label}:${item.value}`} className="rounded-[1.1rem] border border-ink/6 bg-bone/56 px-4 py-3">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/42">{item.label}</dt>
          <dd className="mt-1 text-sm leading-6 text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function IssueHistoryBlock({
  history,
}: {
  history: OpsIssueHistoryEntry[]
}): JSX.Element | null {
  if (history.length === 0) return null

  return (
    <div className="mt-5 rounded-[1.2rem] border border-ink/6 bg-white/82 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Audit trail</p>
      <div className="mt-3 grid gap-3">
        {history.slice(0, 4).map((entry) => (
          <div key={entry.id} className="rounded-[1rem] border border-ink/6 bg-bone/52 px-4 py-3">
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
}): JSX.Element {
  return (
    <article className="rounded-[1.5rem] border border-needle/12 bg-[linear-gradient(180deg,#ffffff_0%,#eef8f4_100%)] p-5 shadow-sm">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/78">Manual issue</p>
        <h3 className="text-2xl text-ink">Open a numbered case for anything the automations missed.</h3>
        <p className="text-sm leading-7 text-ink/64">
          Use this when ops needs a tracked case before the trigger is fully automated. Critical issues notify the ops inbox immediately.
        </p>
      </div>

      <form action="/ops/action" method="post" className="mt-5 grid gap-4">
        <input type="hidden" name="kind" value="manual-issue-create" />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="grid gap-2 text-sm text-ink/70">
            Issue type
            <select
              name="issueType"
              defaultValue="SYSTEM_ALERT"
              className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40"
            >
              {OPS_ISSUE_TYPES.map((issueType) => (
                <option key={issueType} value={issueType}>
                  {formatIssueTypeLabel(issueType)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm text-ink/70">
            Severity
            <select
              name="severity"
              defaultValue="MEDIUM"
              className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40"
            >
              {OPS_ISSUE_SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {formatIssueTypeLabel(severity)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="grid gap-2 text-sm text-ink/70">
          Title
          <input
            name="title"
            required
            placeholder="Short case title ops will recognize at a glance"
            className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
          />
        </label>

        <label className="grid gap-2 text-sm text-ink/70">
          Description
          <textarea
            name="description"
            required
            rows={4}
            placeholder="Explain what is wrong, what users are affected, and why this needs a case."
            className="min-h-[120px] rounded-[1.2rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
          />
        </label>

        <label className="grid gap-2 text-sm text-ink/70">
          Recommended next action
          <textarea
            name="recommendedAction"
            required
            rows={3}
            placeholder="Tell the next ops teammate exactly what should happen next."
            className="min-h-[104px] rounded-[1.2rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
          />
        </label>

        <div className="grid gap-4 lg:grid-cols-3">
          <label className="grid gap-2 text-sm text-ink/70">
            Order ID
            <input
              name="orderId"
              placeholder="Optional order UUID"
              className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
            />
          </label>
          <label className="grid gap-2 text-sm text-ink/70">
            User ID
            <input
              name="userId"
              placeholder="Optional user UUID"
              className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
            />
          </label>
          <label className="grid gap-2 text-sm text-ink/70">
            Tailor profile ID
            <input
              name="tailorProfileId"
              placeholder="Optional tailor profile UUID"
              className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
            />
          </label>
        </div>

        <div className="grid gap-4 lg:grid-cols-4">
          <label className="grid gap-2 text-sm text-ink/70">
            Related entity type
            <input
              name="relatedEntityType"
              placeholder="review, payout, order, user"
              className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
            />
          </label>
          <label className="grid gap-2 text-sm text-ink/70">
            Related entity ID
            <input
              name="relatedEntityId"
              placeholder="Optional entity ID"
              className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
            />
          </label>
          <label className="grid gap-2 text-sm text-ink/70">
            Provider
            <input
              name="provider"
              placeholder="PAYSTACK, STRIPE, Drape"
              className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
            />
          </label>
          <label className="grid gap-2 text-sm text-ink/70">
            Stage
            <input
              name="stage"
              placeholder="PAYMENT_PENDING, DELIVERED..."
              className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
            />
          </label>
        </div>

        <label className="grid gap-2 text-sm text-ink/70">
          Internal note
          <textarea
            name="note"
            rows={3}
            placeholder="Optional context for the audit trail only."
            className="min-h-[96px] rounded-[1.2rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
          />
        </label>

        <div className="flex justify-end">
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90"
          >
            Create ops case
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
}): JSX.Element {
  const editable = dispute.status === 'OPEN' || dispute.status === 'UNDER_REVIEW'
  const canResolve = editable && dispute.orderStage === 'IN_DISPUTE'
  const detailItems = [
    { label: 'Customer', value: dispute.customerEmail ? `${dispute.customerName} · ${dispute.customerEmail}` : dispute.customerName },
    { label: 'Tailor', value: dispute.tailorEmail ? `${dispute.tailorName} · ${dispute.tailorEmail}` : dispute.tailorName },
    { label: 'Stage', value: dispute.orderStage ?? '—' },
    { label: 'Amount', value: formatMoney(dispute.amount, dispute.currency) },
    { label: 'Delivery', value: dispute.deliveryMethod ?? dispute.fulfillmentOption ?? '—' },
    { label: 'Opened', value: formatDateTime(dispute.createdAt) },
  ]

  if (dispute.resolvedAt) {
    detailItems.push({ label: 'Resolved', value: formatDateTime(dispute.resolvedAt) })
  }

  return (
    <article className="rounded-[1.5rem] border border-ink/8 bg-[linear-gradient(180deg,#fffdf9_0%,#f6efe5_100%)] p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg text-ink">Order {dispute.orderReference ? `#${dispute.orderReference}` : dispute.orderId.slice(0, 8)}</span>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusPillClass(dispute.status)}`}>
              {dispute.status.replace(/_/g, ' ')}
            </span>
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

      <div className="mt-5">
        <DetailList items={detailItems} />
      </div>

      <div className="mt-5 rounded-[1.2rem] border border-ink/6 bg-white/82 p-4">
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
        <>
          <form action="/ops/action" method="post" className="mt-5 flex flex-col gap-3 border-t border-ink/6 pt-5 sm:flex-row sm:items-end">
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
            <form action="/ops/action" method="post" className="mt-4 grid gap-3 rounded-[1.25rem] border border-ink/6 bg-white/76 p-4">
              <input type="hidden" name="kind" value="dispute-resolution" />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <input type="hidden" name="disputeId" value={dispute.id} />
              <label className="grid gap-2 text-sm text-ink/70">
                Resolution note
                <textarea
                  name="resolution"
                  rows={3}
                  placeholder="Optional context that both parties should see on the resolution."
                  className="rounded-[1.25rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
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
            <div className="mt-4 rounded-[1.25rem] border border-dashed border-ink/10 bg-white/68 px-4 py-3 text-sm leading-7 text-ink/62">
              Refresh before resolving if the order is no longer in `IN_DISPUTE`. This card can still be triaged, but only active disputes can be closed here.
            </div>
          )}
        </>
      ) : null}
    </article>
  )
}

function BypassLogCard({
  log,
  redirectTo,
}: {
  log: OpsBypassLog
  redirectTo: string
}): JSX.Element {
  return (
    <article className="rounded-[1.5rem] border border-ink/8 bg-white/86 p-5 shadow-sm">
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

      <div className="mt-5 rounded-[1.2rem] border border-ink/6 bg-bone/56 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Blocked content</p>
        <p className="mt-2 whitespace-pre-wrap break-words font-mono text-sm leading-7 text-ink/78">{log.content}</p>
      </div>

      <IssueHistoryBlock history={log.history} />
    </article>
  )
}

function ApplicationCard({
  application,
  redirectTo,
}: {
  application: OpsTailorApplication
  redirectTo: string
}): JSX.Element {
  return (
    <article className="rounded-[1.5rem] border border-ink/8 bg-white/86 p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-ink/8 bg-bone px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/55">
              {application.displayId}
            </span>
            <span className="text-lg text-ink">{application.businessName}</span>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusPillClass(application.status)}`}>
              {application.status.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="mt-2 text-sm leading-7 text-ink/66">
            {application.displayName} · {application.email}
          </p>
        </div>
        <a
          href={`mailto:${application.email}?subject=${encodeURIComponent(`Drape tailor application: ${application.businessName}`)}`}
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

      <div className="mt-5 rounded-[1.2rem] border border-ink/6 bg-white/82 p-4">
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

      <form action="/ops/action" method="post" className="mt-5 flex flex-col gap-3 border-t border-ink/6 pt-5 sm:flex-row sm:items-end">
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

      <IssueHistoryBlock history={application.history} />
    </article>
  )
}

function VerificationCard({
  profile,
  redirectTo,
}: {
  profile: OpsVerification
  redirectTo: string
}): JSX.Element {
  return (
    <article className="rounded-[1.5rem] border border-ink/8 bg-white/86 p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-ink/8 bg-bone px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/55">
              {profile.displayId}
            </span>
            <span className="text-lg text-ink">{profile.displayName}</span>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusPillClass(profile.status)}`}>
              {profile.status.replace(/_/g, ' ')}
            </span>
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

      <div className="mt-5">
        <DetailList
          items={[
            { label: 'Location', value: profile.location },
            { label: 'Specialties', value: profile.specialtyTags.length > 0 ? profile.specialtyTags.join(', ') : '—' },
            { label: 'Payout path', value: profile.payoutProvider ? `${profile.payoutProvider} · ${profile.payoutCurrency ?? '—'}` : 'Not set up yet' },
            { label: 'Payout verified', value: profile.payoutAccountVerified ? 'Yes' : 'No' },
            { label: 'Submitted', value: formatDateTime(profile.createdAt) },
            { label: 'Last updated', value: formatDateTime(profile.updatedAt) },
          ]}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        {profile.idDocumentUrl ? (
          <a
            href={profile.idDocumentUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-full bg-needle px-4 py-2 text-sm font-semibold text-white transition hover:bg-needle/90"
          >
            Open ID document
          </a>
        ) : null}
      </div>

      <form action="/ops/action" method="post" className="mt-5 flex flex-col gap-3 border-t border-ink/6 pt-5">
        <input type="hidden" name="kind" value="verification-decision" />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <input type="hidden" name="tailorUserId" value={profile.userId} />
        <label className="grid gap-2 text-sm text-ink/72">
          Trust note / rejection reason
          <textarea
            name="reason"
            rows={3}
            required
            placeholder="Add what you verified, or explain exactly what needs resubmission before rejecting."
            className="min-h-[104px] rounded-[1.2rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40"
          />
        </label>
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

      <IssueHistoryBlock history={profile.history} />
    </article>
  )
}

function DeletionRequestCard({
  request,
  redirectTo,
}: {
  request: OpsAccountDeletionRequest
  redirectTo: string
}): JSX.Element {
  return (
    <article className="rounded-[1.5rem] border border-ink/8 bg-white/86 p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-ink/8 bg-bone px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/55">
              {request.displayId}
            </span>
            <span className="text-lg text-ink">{request.displayName}</span>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusPillClass(request.status)}`}>
              {request.status.replace(/_/g, ' ')}
            </span>
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

      <div className="mt-5 rounded-[1.2rem] border border-ink/6 bg-white/82 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Reason</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink/78">
          {request.reason?.trim() ? request.reason : 'No deletion note was provided in-app.'}
        </p>
      </div>

      <form action="/ops/action" method="post" className="mt-5 flex flex-col gap-3 border-t border-ink/6 pt-5 sm:flex-row sm:items-end">
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

      <IssueHistoryBlock history={request.history} />
    </article>
  )
}

function PayoutCard({ payout }: { payout: OpsPayout }): JSX.Element {
  const canRetryRelease =
    !!payout.orderId && ['BLOCKED', 'FAILED', 'PENDING'].includes(payout.status.toUpperCase())

  return (
    <article className="rounded-[1.5rem] border border-ink/8 bg-white/86 p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg text-ink">{payout.tailorDisplayName}</span>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusPillClass(payout.status)}`}>
              {payout.status.replace(/_/g, ' ')}
            </span>
            <span className="inline-flex rounded-full border border-ink/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-ink/70">
              {payout.provider}
            </span>
          </div>
          <p className="mt-2 text-sm leading-7 text-ink/66">
            {payout.tailorEmail ?? 'No email on file'}
          </p>
        </div>
        <a
          href={`mailto:${CONTACTS.payouts}?subject=${encodeURIComponent(`Payout review: ${payout.orderReference ?? payout.id}`)}`}
          className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone"
        >
          Email payouts
        </a>
      </div>

      <div className="mt-5">
        <DetailList
          items={[
            { label: 'Amount', value: formatMoney(payout.amount, payout.currency) },
            { label: 'Status', value: payout.status.replace(/_/g, ' ') },
            { label: 'Processed', value: formatDateTime(payout.processedAt) },
            { label: 'Initiated', value: formatDateTime(payout.initiatedAt) },
            { label: 'Completed', value: formatDateTime(payout.completedAt) },
            { label: 'Failed', value: formatDateTime(payout.failedAt) },
            { label: 'Order', value: payout.orderReference ? `#${payout.orderReference}` : payout.orderId ?? '—' },
            { label: 'Provider ID', value: payout.providerPayoutId ?? '—' },
            { label: 'Blocked reason', value: payout.blockedReason ? payout.blockedReason.replace(/_/g, ' ') : '—' },
          ]}
        />
      </div>

      {canRetryRelease ? (
        <form action="/ops/action" method="post" className="mt-5 flex flex-col gap-3 rounded-[1.2rem] border border-ink/6 bg-white/82 p-4 sm:flex-row sm:items-center">
          <input type="hidden" name="kind" value="payout-release" />
          <input type="hidden" name="redirectTo" value={buildOpsRedirectTarget('payouts', 'payouts')} />
          <input type="hidden" name="orderId" value={payout.orderId ?? ''} />
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Direct payout action</p>
            <p className="mt-2 text-sm leading-7 text-ink/68">
              Retry payout release for the related order after you have confirmed the payout account, delivery state, and dispute window are all clean.
            </p>
          </div>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90"
          >
            Retry payout release
          </button>
        </form>
      ) : null}
    </article>
  )
}

function WorkflowIssueCard({
  issue,
  redirectTo,
}: {
  issue: OpsWorkflowIssue
  redirectTo: string
}): JSX.Element {
  const canManageConversation =
    (issue.issueType === 'CONVERSATION_SAFETY' || issue.event === 'conversation.safety_reported')
    && !!issue.orderId
  const canUpdateIssueStatus = issue.source !== 'audit_logs'
  const canResolveBlockedPayout = issue.issueType === 'PAYOUT_BLOCKED' && !!issue.orderId
  const canPartialRefund =
    !!issue.orderId
    && issue.maxRefundableAmount > 0
    && ['AFTERCARE_REQUEST', 'ORDER_REVIEW', 'DELIVERY_REVIEW', 'PAYMENT_BLOCKED', 'PAYOUT_BLOCKED'].includes(issue.issueType)

  return (
    <article className="rounded-[1.5rem] border border-ink/8 bg-[linear-gradient(180deg,#fffdf9_0%,#f4eee3_100%)] p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-ink/8 bg-bone px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/55">
              {issue.displayId}
            </span>
            <span className="text-lg text-ink">{workflowIssueLabel(issue.event)}</span>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${severityPillClass(issue.severity)}`}>
              {issue.severity}
            </span>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusPillClass(issue.status)}`}>
              {issue.status.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="mt-2 text-sm leading-7 text-ink/66">{issue.summary}</p>
        </div>
        <a
          href={sectionMailto(`Workflow issue: ${issue.orderReference ?? issue.orderId ?? issue.id}`)}
          className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone"
        >
          Email ops
        </a>
      </div>

      <div className="mt-5">
        <DetailList
          items={[
            { label: 'Actor', value: issue.actorEmail ? `${issue.actorName} · ${issue.actorEmail}` : issue.actorName },
            { label: 'Role', value: issue.actorRole ?? 'SYSTEM' },
            { label: 'Created', value: formatDateTime(issue.createdAt) },
            { label: 'Order', value: issue.orderReference ? `#${issue.orderReference}` : issue.orderId ?? '—' },
            { label: 'Stage', value: issue.orderStage ?? '—' },
            { label: 'Provider', value: issue.provider ?? '—' },
            { label: 'Source', value: issue.source ?? 'ops-issues' },
            { label: 'Order total', value: formatMoney(issue.orderTotalAmount, issue.orderCurrency) },
            { label: 'Already refunded', value: formatMoney(issue.alreadyRefundedAmount, issue.orderCurrency) },
            { label: 'Refundable now', value: formatMoney(issue.maxRefundableAmount, issue.orderCurrency) },
          ]}
        />
      </div>

      {issue.reason || issue.trackingNumber || issue.paymentStatus ? (
        <div className="mt-5 rounded-[1.2rem] border border-ink/6 bg-white/82 p-4">
          <DetailList
            items={[
              { label: 'Reason', value: issue.reason ? issue.reason.replace(/_/g, ' ') : '—' },
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

      <div className="mt-5 rounded-[1.2rem] border border-needle/10 bg-needle/6 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/78">Recommended action</p>
        <p className="mt-2 text-sm leading-7 text-ink/72">{issue.recommendedAction}</p>
      </div>

      <IssueHistoryBlock history={issue.history} />

      {canUpdateIssueStatus ? (
        <form action="/ops/action" method="post" className="mt-5 flex flex-col gap-3 rounded-[1.2rem] border border-ink/6 bg-white/82 p-4">
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

      {canResolveBlockedPayout ? (
        <form action="/ops/action" method="post" className="mt-5 flex flex-col gap-3 rounded-[1.2rem] border border-rust/12 bg-rust/6 p-4">
          <input type="hidden" name="kind" value="payout-block-resolution" />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="issueId" value={issue.id} />
          <input type="hidden" name="orderId" value={issue.orderId ?? ''} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rust-700">Payout resolution</p>
            <p className="mt-2 text-sm leading-7 text-ink/72">
              Resolve this payout block from ops without touching the database. Use the locked order currency, convert to the current payout currency, or refund the customer if the order cannot be settled safely.
            </p>
          </div>
          <label className="grid gap-2 text-sm text-ink/70">
            Resolution note
            <textarea
              name="note"
              required
              rows={3}
              placeholder="Explain why this resolution is safe and what ops approved."
              className="rounded-[1.25rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              name="resolutionMode"
              value="ORIGINAL_CURRENCY"
              className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:bg-bone"
            >
              Pay original currency
            </button>
            <button
              type="submit"
              name="resolutionMode"
              value="CONVERT_TO_CURRENT"
              className="inline-flex items-center justify-center rounded-full border border-needle/18 bg-needle/8 px-5 py-3 text-sm font-semibold text-needle-700 transition hover:bg-needle/12"
            >
              Convert and pay out
            </button>
            <button
              type="submit"
              name="resolutionMode"
              value="REFUND_CUSTOMER"
              className="inline-flex items-center justify-center rounded-full border border-rust/18 bg-rust/10 px-5 py-3 text-sm font-semibold text-rust-700 transition hover:bg-rust/14"
            >
              Refund customer
            </button>
          </div>
        </form>
      ) : null}

      {canPartialRefund ? (
        <form action="/ops/action" method="post" className="mt-5 flex flex-col gap-3 rounded-[1.2rem] border border-rust/12 bg-white/92 p-4">
          <input type="hidden" name="kind" value="order-partial-refund" />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="issueId" value={issue.id} />
          <input type="hidden" name="orderId" value={issue.orderId ?? ''} />
          <input type="hidden" name="maxRefundableAmount" value={String(issue.maxRefundableAmount)} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rust-700">Partial refund</p>
            <p className="mt-2 text-sm leading-7 text-ink/72">
              Refund part of the customer payment without leaving ops. Use this for aftercare resolutions, delivery make-goods, or a payout block that only needs a partial customer return.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[1rem] border border-ink/8 bg-bone px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/46">Order total</p>
              <p className="mt-2 text-sm text-ink">{formatMoney(issue.orderTotalAmount, issue.orderCurrency)}</p>
            </div>
            <div className="rounded-[1rem] border border-ink/8 bg-bone px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/46">Already refunded</p>
              <p className="mt-2 text-sm text-ink">{formatMoney(issue.alreadyRefundedAmount, issue.orderCurrency)}</p>
            </div>
            <div className="rounded-[1rem] border border-ink/8 bg-bone px-4 py-3">
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
              className="rounded-[1.25rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/40"
            />
          </label>
          <label className="inline-flex items-center gap-3 text-sm text-ink/72">
            <input type="checkbox" name="notifyCustomer" value="yes" className="h-4 w-4 rounded border border-ink/18 text-needle" />
            Email the customer after the refund completes
          </label>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full border border-rust/18 bg-rust px-5 py-3 text-sm font-semibold text-white transition hover:bg-rust/92"
          >
            Issue partial refund
          </button>
        </form>
      ) : null}

      {canManageConversation ? (
        <form action="/ops/action" method="post" className="mt-5 flex flex-col gap-3 rounded-[1.2rem] border border-ink/6 bg-white/82 p-4 sm:flex-row sm:items-center">
          <input type="hidden" name="kind" value="conversation-access" />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="orderId" value={issue.orderId ?? ''} />
          <input type="hidden" name="reason" value={issue.reason ?? 'SAFETY_REVIEW'} />
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Conversation safety control</p>
            <p className="mt-2 text-sm leading-7 text-ink/68">
              Pause the chat while ops reviews the report, or reopen it if the thread can continue safely in Drape.
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
    </article>
  )
}

function ReviewQueueCard({
  review,
  redirectTo,
}: {
  review: OpsReviewQueueItem
  redirectTo: string
}): JSX.Element {
  const visibilityLabel = review.publishedAt ? 'Public' : review.flagged ? 'Held for review' : 'Not public yet'
  const visibilityTone = review.publishedAt ? 'APPROVED' : review.flagged ? 'PENDING' : 'UNDER_REVIEW'

  return (
    <article className="rounded-[1.5rem] border border-ink/8 bg-[linear-gradient(180deg,#fffdf9_0%,#f5eee3_100%)] p-5 shadow-sm">
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

      <div className="mt-5">
        <DetailList
          items={[
            { label: 'Customer', value: review.customerEmail ? `${review.customerName} · ${review.customerEmail}` : review.customerName },
            { label: 'Tailor', value: review.tailorEmail ? `${review.tailorName} · ${review.tailorEmail}` : review.tailorName },
            { label: 'Order stage', value: review.orderStage ?? '—' },
            { label: 'Submitted', value: formatDateTime(review.createdAt) },
            { label: 'Tags', value: review.tags.length > 0 ? review.tags.join(', ') : '—' },
            { label: 'Public since', value: formatDateTime(review.publishedAt) },
          ]}
        />
      </div>

      <div className="mt-5 rounded-[1.2rem] border border-ink/6 bg-white/82 p-4">
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

      <form action="/ops/action" method="post" className="mt-5 flex flex-col gap-3 border-t border-ink/6 pt-5 sm:flex-row">
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

      <IssueHistoryBlock history={review.history} />
    </article>
  )
}

function DispatchCard({
  item,
  redirectTo,
}: {
  item: OpsDispatchItem
  redirectTo: string
}): JSX.Element {
  const isLocalDelivery = item.deliveryMethod === 'LOCAL_DELIVERY'
  const targetStage = isLocalDelivery ? 'OUT_FOR_DELIVERY' : 'SHIPPED'
  const providerLabel = isLocalDelivery ? 'Rider or provider' : 'Courier or provider'
  const actionLabel = isLocalDelivery ? 'Mark out for delivery' : 'Mark shipped'
  const description = isLocalDelivery
    ? 'Drape handles the rider handoff here once the seller says the parcel is packed and ready.'
    : 'Drape handles the courier handoff here once the seller says the parcel is packed and ready.'

  return (
    <article className="rounded-[1.5rem] border border-ink/8 bg-[linear-gradient(180deg,#fffdf9_0%,#f5eee3_100%)] p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg text-ink">Order #{item.orderReference}</span>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusPillClass(item.stage)}`}>
              {item.stage.replace(/_/g, ' ')}
            </span>
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

      <div className="mt-5">
        <DetailList
          items={[
            { label: 'Customer', value: item.customerEmail ? `${item.customerName} · ${item.customerEmail}` : item.customerName },
            { label: 'Tailor', value: item.tailorEmail ? `${item.tailorName} · ${item.tailorEmail}` : item.tailorName },
            { label: 'Tailor location', value: item.tailorLocation ?? '—' },
            { label: 'Recipient', value: item.recipientName ?? '—' },
            { label: 'Recipient phone', value: item.recipientPhone ?? '—' },
            { label: 'Address', value: item.deliveryAddress ?? '—' },
            { label: 'Ready since', value: formatDateTime(item.stageUpdatedAt) },
            { label: 'Method', value: item.deliveryMethod?.replace(/_/g, ' ') ?? '—' },
          ]}
        />
      </div>

      <form action="/ops/action" method="post" className="mt-5 grid gap-4 border-t border-ink/6 pt-5">
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
            className="rounded-[1.6rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
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
    </article>
  )
}

function OrderReviewCard({
  review,
  redirectTo,
}: {
  review: OpsOrderReviewItem
  redirectTo: string
}): JSX.Element {
  const reviewTypeLabel = review.reviewType === 'CANCELLATION' ? 'Cancellation review' : 'Delivery review'
  const continueLabel =
    review.reviewType === 'CANCELLATION'
      ? 'Keep order active'
      : review.requestedFromStage
        ? `Return to ${review.requestedFromStage.toLowerCase().replace(/_/g, ' ')}`
        : 'Keep order active'
  const refundLabel =
    review.reviewType === 'CANCELLATION'
      ? 'Approve cancellation'
      : 'Refund order'

  return (
    <article className="rounded-[1.5rem] border border-ink/8 bg-[linear-gradient(180deg,#fffdf9_0%,#f6efe5_100%)] p-5 shadow-sm">
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

      <div className="mt-5">
        <DetailList
          items={[
            { label: 'Customer', value: review.customerEmail ? `${review.customerName} · ${review.customerEmail}` : review.customerName },
            { label: 'Tailor', value: review.tailorEmail ? `${review.tailorName} · ${review.tailorEmail}` : review.tailorName },
            { label: 'Requested by', value: review.requestedBy },
            { label: 'Current stage', value: review.orderStage ?? '—' },
            { label: 'Opened from', value: review.requestedFromStage ?? '—' },
            { label: 'Opened', value: formatDateTime(review.requestedAt) },
          ]}
        />
      </div>

      {review.note ? (
        <div className="mt-5 rounded-[1.2rem] border border-ink/6 bg-white/82 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">Note</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink/78">{review.note}</p>
        </div>
      ) : null}

      <form action="/ops/action" method="post" className="mt-5 grid gap-3 rounded-[1.2rem] border border-ink/6 bg-white/82 p-4">
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
            className="rounded-[1.6rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
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
          Both sides will see this result in the order timeline, and the order will either move to <code className="rounded bg-bone px-1 py-0.5 text-[11px]">REFUNDED</code> or return to its previous live stage.
        </p>
      </form>
    </article>
  )
}

function LoginView({
  error,
}: {
  error: string | null
}): JSX.Element {
  const bootstrapRole = getOpsBootstrapRole()

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(45,106,79,0.16),transparent_34%),radial-gradient(circle_at_80%_12%,rgba(216,90,48,0.12),transparent_28%),linear-gradient(180deg,#f7f1e8_0%,#efe8db_100%)]">
      <div className="mx-auto flex min-h-screen max-w-4xl items-center px-5 py-12 sm:px-8">
        <section className="w-full rounded-[2.4rem] border border-white/70 bg-white/82 p-7 shadow-[0_28px_90px_rgba(22,28,24,0.12)] backdrop-blur sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Internal ops</p>
          <h1 className="mt-4 text-5xl leading-[0.94] text-ink sm:text-6xl">One quiet place to triage trust issues.</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-ink/68">
            Use this to review disputes, held reviews, contact bypass attempts, privacy and trust requests, workflow issues, tailor applications, and pending verification without bouncing between dashboards.
          </p>

          <div className="mt-8 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-[1.75rem] bg-ink p-6 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/62">What is inside</p>
              <div className="mt-4 grid gap-3 text-sm leading-7 text-white/78">
                <p>Dispute queue with order context and safe under-review status updates.</p>
                <p>Held or unpublished reviews with simple publish or hide controls.</p>
                <p>Blocked contact attempts with review toggles.</p>
                <p>Tailor application triage with status updates.</p>
                <p>Pending verification profiles with direct approve or reject controls.</p>
                <p>Open ops issues now come from the dedicated issue ledger, with legacy shipping and privacy alerts still surfaced until every trigger is fully migrated.</p>
                <p>Deletion requests with privacy-safe status tracking.</p>
                <p>Recent payout records with enough context to answer trust questions fast.</p>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-ink/8 bg-[linear-gradient(180deg,#faf5ed_0%,#f2eade_100%)] p-6">
              <h2 className="text-3xl text-ink">Unlock ops</h2>
              <p className="mt-3 text-sm leading-7 text-ink/66">Enter the shared ops token. The session stays scoped to this internal surface only.</p>
              <div className="mt-4 rounded-[1.1rem] border border-ink/8 bg-white/72 px-4 py-3 text-xs leading-6 text-ink/58">
                Bootstrap role for this environment: <span className="font-semibold uppercase tracking-[0.14em] text-ink">{bootstrapRole.replace(/_/g, ' ')}</span>. Real per-person enforcement will come from workforce SSO, not the shared token.
              </div>
              {error ? (
                <div className="mt-5 rounded-[1.25rem] border border-rust/16 bg-rust/8 px-4 py-3 text-sm leading-7 text-rust-700">
                  {error}
                </div>
              ) : null}
              <form action="/ops/login" method="post" className="mt-6 grid gap-4">
                <input type="hidden" name="redirectTo" value="/ops" />
                <label className="grid gap-2 text-sm text-ink/72">
                  Ops token
                  <input
                    required
                    type="password"
                    name="token"
                    className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40"
                    placeholder="Enter the internal token"
                  />
                </label>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90"
                >
                  Open ops dashboard
                </button>
              </form>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function WorkforceAccessView({
  error,
}: {
  error: string | null
}): JSX.Element {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(45,106,79,0.16),transparent_34%),radial-gradient(circle_at_80%_12%,rgba(216,90,48,0.12),transparent_28%),linear-gradient(180deg,#f7f1e8_0%,#efe8db_100%)]">
      <div className="mx-auto flex min-h-screen max-w-4xl items-center px-5 py-12 sm:px-8">
        <section className="w-full rounded-[2.4rem] border border-white/70 bg-white/82 p-7 shadow-[0_28px_90px_rgba(22,28,24,0.12)] backdrop-blur sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Internal ops</p>
          <h1 className="mt-4 text-5xl leading-[0.94] text-ink sm:text-6xl">Use Drape workforce access, not a shared token.</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-ink/68">
            This control plane is configured for workforce login. Cloudflare Access should challenge the request before the app loads, and only `@drapeon.co` identities with an assigned role should reach this page.
          </p>

          <div className="mt-8 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-[1.75rem] bg-ink p-6 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/62">What happens here</p>
              <div className="mt-4 grid gap-3 text-sm leading-7 text-white/78">
                <p>Cloudflare Access gates the route before page load.</p>
                <p>Only `@drapeon.co` workforce identities should be admitted.</p>
                <p>App-level permissions still decide which sections and actions are allowed.</p>
                <p>If access feels wrong, it is usually an Access policy, audience, or role assignment issue.</p>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-ink/8 bg-[linear-gradient(180deg,#faf5ed_0%,#f2eade_100%)] p-6">
              <h2 className="text-3xl text-ink">Workforce checklist</h2>
              <div className="mt-4 grid gap-3 text-sm leading-7 text-ink/66">
                <p>1. The route is behind Cloudflare Access.</p>
                <p>2. Your sign-in identity uses `@drapeon.co`.</p>
                <p>3. The Access application audience is configured in web envs.</p>
                <p>4. Your email or group is assigned to a Drape control-plane role.</p>
              </div>
              {error ? (
                <div className="mt-5 rounded-[1.25rem] border border-rust/16 bg-rust/8 px-4 py-3 text-sm leading-7 text-rust-700">
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

function SetupView(): JSX.Element {
  const bootstrapRole = getOpsBootstrapRole()
  const workforceConfigured = hasOpsWorkforceAccessConfig()

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f7f1e8_0%,#efe7da_100%)]">
      <div className="mx-auto flex min-h-screen max-w-4xl items-center px-5 py-12 sm:px-8">
        <section className="w-full rounded-[2.2rem] border border-ink/8 bg-white/86 p-8 shadow-[0_24px_80px_rgba(22,28,24,0.08)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Internal ops</p>
          <h1 className="mt-4 text-4xl text-ink sm:text-5xl">Set one token to bring the ops surface online.</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-ink/68">
            This route is intentionally locked until the shared ops token is configured in the web environment.
          </p>
          <div className="mt-8 rounded-[1.5rem] border border-ink/8 bg-bone/70 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/46">Required env</p>
            {workforceConfigured ? (
              <>
                <code className="mt-3 block whitespace-pre-wrap rounded-[1.1rem] bg-ink px-4 py-4 text-sm leading-7 text-white">
                  CF_ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com
                </code>
                <code className="mt-3 block whitespace-pre-wrap rounded-[1.1rem] bg-ink px-4 py-4 text-sm leading-7 text-white">
                  CF_ACCESS_AUD=your_access_application_audience
                </code>
              </>
            ) : (
              <>
                <code className="mt-3 block whitespace-pre-wrap rounded-[1.1rem] bg-ink px-4 py-4 text-sm leading-7 text-white">
                  OPS_DASHBOARD_TOKEN=your_shared_internal_token
                </code>
                <code className="mt-3 block whitespace-pre-wrap rounded-[1.1rem] bg-ink px-4 py-4 text-sm leading-7 text-white">
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
  team,
  active,
}: {
  href: string
  label: string
  count: number
  team: string
  active: boolean
}): JSX.Element {
  return (
    <a
      href={href}
      className={`flex items-center justify-between rounded-[1.2rem] border px-4 py-3 transition ${
        active
          ? 'border-needle/18 bg-needle/10 text-ink'
          : 'border-ink/8 bg-white/82 text-ink/72 hover:bg-bone hover:text-ink'
      }`}
    >
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/42">{team}</p>
      </div>
      <span className="rounded-full border border-ink/8 bg-white px-2.5 py-1 text-xs font-semibold text-ink/72">
        {count}
      </span>
    </a>
  )
}

function FutureSurfaceCard({
  label,
  team,
  note,
}: {
  label: string
  team: string
  note: string
}): JSX.Element {
  return (
    <div className="rounded-[1.2rem] border border-dashed border-ink/10 bg-white/62 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink">{label}</p>
        <span className="rounded-full border border-ink/8 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/48">
          {team}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-ink/60">{note}</p>
    </div>
  )
}

function renderOpsSection(
  sectionKey: OpsView,
  data: OpsDashboardData,
  currentView: OpsView,
): JSX.Element {
  switch (sectionKey) {
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
          title="Cancellation and delivery reviews should become visible the moment either side asks Drape to step in."
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
              body="If a customer or tailor asks Drape to review a cancellation or dispatch issue, it will appear here with full order context."
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
    case 'bypass':
      return (
        <SectionFrame
          id="bypass"
          eyebrow="Contact bypass"
          title="Review blocked contact attempts without digging through raw logs."
          description="This is the server-side record of users trying to move communication off-platform before the right milestone."
        >
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
          description="This gives ops one place to spot pending tailor profiles and open the uploaded ID document quickly."
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
          description="These orders already collected the flat Drape-managed fulfillment fee at checkout. Once the seller has packed the parcel, ops owns the actual rider or courier handoff from here."
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
              title="Nothing is waiting for Drape dispatch right now."
              body="When a seller marks a delivery or shipping order ready for Drape dispatch, it will land here with the recipient details ops needs."
            />
          )}
        </SectionFrame>
      )
    case 'workflow-issues':
      return (
        <SectionFrame
          id="workflow-issues"
          eyebrow="Workflow issues"
          title="Open safety, payment, payout, and shipping issues should surface before support gets stuck guessing."
          description="This queue now reads from the dedicated ops issue ledger first, with legacy shipping and privacy alerts still shown until every trigger is migrated. Safety reports can also pause or reopen chat from here."
        >
          <div className="mb-5">
            <ManualIssueCreateCard
              redirectTo={buildOpsRedirectTarget(currentView, 'workflow-issues')}
            />
          </div>
          {data.workflowIssues.length > 0 ? (
            <div className="grid gap-5">
              {data.workflowIssues.map((issue) => (
                <WorkflowIssueCard
                  key={issue.id}
                  issue={issue}
                  redirectTo={buildOpsRedirectTarget(currentView, 'workflow-issues')}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No recent safety, payment, or shipping issues are showing."
              body="When someone reports unsafe chat behavior, requests privacy access, asks for seller access review, or checkout and delivery workflows get blocked, the latest audit breadcrumbs will appear here with enough context to triage quickly."
            />
          )}
        </SectionFrame>
      )
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
    case 'payouts':
      return (
        <SectionFrame
          id="payouts"
          eyebrow="Payout visibility"
          title="Recent payouts should be visible enough to answer trust questions quickly."
          description="This is intentionally read-only for now. The goal is simple operational context: who was paid, how much, when, and whether the payout maps back to an order."
        >
          {data.payouts.length > 0 ? (
            <div className="grid gap-5">
              {data.payouts.map((payout) => (
                <PayoutCard key={payout.id} payout={payout} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No payout records are showing yet."
              body="Once payouts start being written into the active database, this panel will show the latest records with order and tailor context."
            />
          )}
        </SectionFrame>
      )
    case 'overview':
    default:
      return (
        <div className="grid gap-8">
          {OPS_LIVE_SECTIONS.filter((section) => section.key !== 'overview').map((section) => (
            <div key={section.key}>{renderOpsSection(section.key, data, currentView)}</div>
          ))}
        </div>
      )
  }
}

export default async function OpsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<JSX.Element> {
  const params = await searchParams
  const accessMode = getOpsAccessMode()
  const noticeKey = readParam(params, 'notice')
  const errorKey = readParam(params, 'error')
  const view = parseOpsView(readParam(params, 'view'))
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

  const data = await loadOpsDashboardData()
  if (!data) {
    return <LoginView error={ERROR_COPY['service-role-missing'] ?? 'Add the server-side Supabase service role env vars to load ops data.'} />
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(45,106,79,0.16),transparent_34%),radial-gradient(circle_at_82%_10%,rgba(216,90,48,0.10),transparent_26%),linear-gradient(180deg,#f7f1e8_0%,#f1eadf_100%)]">
      <div className="mx-auto max-w-[95rem] px-5 py-6 sm:px-8 lg:px-12">
        <header className="rounded-[2rem] border border-white/72 bg-white/72 px-5 py-5 shadow-[0_18px_60px_rgba(22,28,24,0.08)] backdrop-blur sm:px-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Internal ops</p>
              <h1 className="mt-3 text-4xl text-ink sm:text-5xl">Drape control plane for launch-critical operations.</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-ink/64">
                The public website keeps serving waitlist and growth. This protected surface is where Drape resolves dispatch, payouts, verification, privacy requests, deletion follow-up, review moderation, disputes, and operational exceptions without leaving an audit trail gap.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <a
                href={`mailto:${CONTACTS.ops}`}
                className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:bg-bone"
              >
                Email ops inbox
              </a>
              <form action="/ops/logout" method="post">
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-ink/90"
                >
                  Lock dashboard
                </button>
              </form>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <div className="rounded-full border border-needle/18 bg-needle/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-needle">
              Bootstrap access mode
            </div>
            <div className="rounded-full border border-ink/8 bg-white/84 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-ink/56">
              Shared token today
            </div>
            <div className="rounded-full border border-ink/8 bg-white/84 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-ink/56">
              Workforce SSO next
            </div>
          </div>
        </header>

        {notice ? (
          <div className="mt-6 rounded-[1.3rem] border border-needle/16 bg-needle/8 px-5 py-4 text-sm leading-7 text-needle-700">
            {notice}
          </div>
        ) : null}

        {roleError ? (
          <div className="mt-6 rounded-[1.3rem] border border-rust/16 bg-rust/8 px-5 py-4 text-sm leading-7 text-rust-700">
            {roleError}
          </div>
        ) : null}

        {data.issues.length > 0 ? (
          <div className="mt-6 rounded-[1.3rem] border border-rust/16 bg-rust/8 px-5 py-4 text-sm leading-7 text-rust-700">
            <p className="font-semibold text-rust-700">Some ops data could not be loaded cleanly.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {data.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-8 grid gap-8 xl:grid-cols-[19rem_minmax(0,1fr)]">
          <aside className="h-fit rounded-[2rem] border border-ink/8 bg-white/80 p-5 shadow-[0_18px_60px_rgba(22,28,24,0.08)] backdrop-blur">
            <div className="rounded-[1.4rem] border border-needle/12 bg-needle/8 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/78">Current focus</p>
              <h2 className="mt-2 text-2xl text-ink">{safeSection.label}</h2>
              <p className="mt-2 text-sm leading-7 text-ink/62">{safeSection.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full border border-ink/8 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/56">
                  {safeSection.team}
                </span>
                <span className="rounded-full border border-ink/8 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/56">
                  {safeSection.status}
                </span>
                <span className="rounded-full border border-ink/8 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/56">
                  {session.role.replace(/_/g, ' ')}
                </span>
              </div>
            </div>

            <div className="mt-5 grid gap-3">
              {visibleSections.map((section) => (
                <OpsNavItem
                  key={section.key}
                  href={buildOpsHref(section.key)}
                  label={section.label}
                  count={section.summaryCount(data.summary)}
                  team={section.team}
                  active={safeView === section.key}
                />
              ))}
            </div>

            <div className="mt-6 border-t border-ink/6 pt-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/46">Next surfaces</p>
              <div className="mt-3 grid gap-3">
                {OPS_FUTURE_SURFACES.map((surface) => (
                  <FutureSurfaceCard
                    key={surface.key}
                    label={surface.label}
                    team={surface.team}
                    note={surface.note}
                  />
                ))}
              </div>
            </div>
          </aside>

          <div className="grid gap-8">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
              <SummaryCard
                label="Open disputes"
                value={data.summary.openDisputes}
                hint="Live disputes still waiting for human attention."
              />
              <SummaryCard
                label="Workflow issues"
                value={data.summary.openWorkflowIssues}
                hint="Open safety, payment, payout, privacy, and shipping issues that still need human action."
              />
              <SummaryCard
                label="Order reviews"
                value={data.summary.pendingOrderReviews}
                hint="Cancellation and delivery reviews waiting on Drape ops."
              />
              <SummaryCard
                label="Orders in escrow"
                value={data.summary.ordersInEscrowCount}
                hint={`${data.summary.ordersInEscrowValueLabel} gross still protected across active paid orders.`}
              />
              <SummaryCard
                label="Pending payouts"
                value={data.summary.pendingPayoutCount}
                hint={`${data.summary.pendingPayoutValueLabel} still needs release, completion, or manual ops review.`}
              />
              <SummaryCard
                label="Dispatch"
                value={data.summary.pendingDispatch}
                hint="Orders packed and waiting for Drape to hand off delivery or shipping."
              />
              <SummaryCard
                label="Verification"
                value={data.summary.pendingVerifications}
                hint="Profiles still waiting on verification review."
              />
              <SummaryCard
                label="Flagged content"
                value={data.summary.flaggedContentCount}
                hint="Unreviewed bypass attempts, flagged reviews, and safety reports now visible in ops."
              />
              <SummaryCard
                label="Deletion queue"
                value={data.summary.pendingDeletionRequests}
                hint="Account deletion requests still waiting on a first response."
              />
            </section>

            {safeView === 'overview' ? (
              <section className="rounded-[2rem] border border-ink/8 bg-white/80 p-6 shadow-[0_20px_70px_rgba(22,28,24,0.08)]">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/80">Architecture stance</p>
                <div className="mt-3 grid gap-4 lg:grid-cols-3">
                  <div className="rounded-[1.3rem] border border-ink/8 bg-bone/44 p-4">
                    <p className="text-sm font-semibold text-ink">Public web stays public</p>
                    <p className="mt-2 text-sm leading-7 text-ink/62">
                      Waitlist, marketing, and future customer acquisition stay clean. Internal ops should never leak into the public nav.
                    </p>
                  </div>
                  <div className="rounded-[1.3rem] border border-ink/8 bg-bone/44 p-4">
                    <p className="text-sm font-semibold text-ink">Drape owns the workflow</p>
                    <p className="mt-2 text-sm leading-7 text-ink/62">
                      Refunds, verification, deletion, dispatch, review moderation, and trust decisions live here with audit history.
                    </p>
                  </div>
                  <div className="rounded-[1.3rem] border border-ink/8 bg-bone/44 p-4">
                    <p className="text-sm font-semibold text-ink">Security gets stricter from here</p>
                    <p className="mt-2 text-sm leading-7 text-ink/62">
                      Today is token bootstrap mode. Next is workforce SSO, @drapeon.co gating, team roles, and app-level permission checks.
                    </p>
                  </div>
                </div>
              </section>
            ) : null}

            {renderOpsSection(safeView, data, safeView)}
          </div>
        </div>
      </div>
    </main>
  )
}
