import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import Link from 'next/link'
import type { JSX } from 'react'
import { hasOpsAccess, hasOpsDashboardToken } from '../../lib/ops-auth'
import {
  type OpsAccountDeletionRequest,
  loadOpsDashboardData,
  type OpsBypassLog,
  type OpsDispute,
  type OpsPayout,
  type OpsReviewQueueItem,
  type OpsTailorApplication,
  type OpsVerification,
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
  'review-published': 'Review is public now.',
  'review-held': 'Review is held from public view.',
  'conversation-blocked': 'Conversation paused for safety review.',
  'conversation-unblocked': 'Conversation reopened.',
}

const ERROR_COPY: Record<string, string> = {
  locked: 'Unlock the ops dashboard to continue.',
  'setup-needed': 'Add OPS_DASHBOARD_TOKEN before using the ops surface.',
  'invalid-token': 'That token did not match the configured ops access token.',
  'service-role-missing': 'Add the server-side Supabase service role env vars to load ops data.',
  'invalid-action': 'That ops action was not recognized.',
  conflict: 'That record changed since the page loaded. Refresh the dashboard and try again.',
  'save-failed': 'That update could not be saved right now.',
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
  if (normalized === 'UNDER_REVIEW' || normalized === 'REVIEWING' || normalized === 'CONTACTED') {
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

  if (normalized === 'ERROR') {
    return 'border-rust/20 bg-rust/10 text-rust-700'
  }

  if (normalized === 'WARN') {
    return 'border-rust/16 bg-rust/8 text-rust-700'
  }

  return 'border-needle/20 bg-needle/10 text-needle-700'
}

function workflowIssueLabel(event: string) {
  switch (event) {
    case 'conversation.safety_reported':
      return 'Safety report'
    case 'conversation.blocked':
      return 'Conversation paused'
    case 'payment.blocked':
      return 'Payment blocked'
    case 'privacy.data_access_requested':
      return 'Data access request'
    case 'seller.access_review_requested':
      return 'Seller access review'
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
      return event.replace(/\./g, ' ')
  }
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
  children: JSX.Element
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

function DisputeCard({ dispute }: { dispute: OpsDispute }): JSX.Element {
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
            <input type="hidden" name="redirectTo" value="/ops#disputes" />
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
              <input type="hidden" name="redirectTo" value="/ops#disputes" />
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

function BypassLogCard({ log }: { log: OpsBypassLog }): JSX.Element {
  return (
    <article className="rounded-[1.5rem] border border-ink/8 bg-white/86 p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
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
          <input type="hidden" name="redirectTo" value="/ops#bypass" />
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
    </article>
  )
}

function ApplicationCard({ application }: { application: OpsTailorApplication }): JSX.Element {
  return (
    <article className="rounded-[1.5rem] border border-ink/8 bg-white/86 p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
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
        <input type="hidden" name="redirectTo" value="/ops#applications" />
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
    </article>
  )
}

function VerificationCard({ profile }: { profile: OpsVerification }): JSX.Element {
  return (
    <article className="rounded-[1.5rem] border border-ink/8 bg-white/86 p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
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

      <form action="/ops/action" method="post" className="mt-5 flex flex-col gap-3 border-t border-ink/6 pt-5 sm:flex-row">
        <input type="hidden" name="kind" value="verification-decision" />
        <input type="hidden" name="redirectTo" value="/ops#verifications" />
        <input type="hidden" name="tailorUserId" value={profile.userId} />
        <button
          type="submit"
          name="decision"
          value="APPROVE"
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
      </form>
    </article>
  )
}

function DeletionRequestCard({ request }: { request: OpsAccountDeletionRequest }): JSX.Element {
  return (
    <article className="rounded-[1.5rem] border border-ink/8 bg-white/86 p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
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
        <input type="hidden" name="redirectTo" value="/ops#deletions" />
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
    </article>
  )
}

function PayoutCard({ payout }: { payout: OpsPayout }): JSX.Element {
  return (
    <article className="rounded-[1.5rem] border border-ink/8 bg-white/86 p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg text-ink">{payout.tailorDisplayName}</span>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusPillClass('COMPLETED')}`}>
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
            { label: 'Processed', value: formatDateTime(payout.processedAt) },
            { label: 'Order', value: payout.orderReference ? `#${payout.orderReference}` : payout.orderId ?? '—' },
            { label: 'Provider ID', value: payout.providerPayoutId ?? '—' },
          ]}
        />
      </div>
    </article>
  )
}

function WorkflowIssueCard({ issue }: { issue: OpsWorkflowIssue }): JSX.Element {
  const canManageConversation = issue.event === 'conversation.safety_reported' && !!issue.orderId

  return (
    <article className="rounded-[1.5rem] border border-ink/8 bg-[linear-gradient(180deg,#fffdf9_0%,#f4eee3_100%)] p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg text-ink">{workflowIssueLabel(issue.event)}</span>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${severityPillClass(issue.severity)}`}>
              {issue.severity}
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
          ]}
        />
      </div>

      {issue.reason || issue.trackingNumber || issue.paymentStatus ? (
        <div className="mt-5 rounded-[1.2rem] border border-ink/6 bg-white/82 p-4">
          <DetailList
            items={[
              { label: 'Reason', value: issue.reason ? issue.reason.replace(/_/g, ' ') : '—' },
              { label: 'Tracking', value: issue.trackingNumber ?? '—' },
              { label: 'Payment status', value: issue.paymentStatus ?? '—' },
            ]}
          />
        </div>
      ) : null}

      {canManageConversation ? (
        <form action="/ops/action" method="post" className="mt-5 flex flex-col gap-3 rounded-[1.2rem] border border-ink/6 bg-white/82 p-4 sm:flex-row sm:items-center">
          <input type="hidden" name="kind" value="conversation-access" />
          <input type="hidden" name="redirectTo" value="/ops#workflow-issues" />
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

function ReviewQueueCard({ review }: { review: OpsReviewQueueItem }): JSX.Element {
  const visibilityLabel = review.publishedAt ? 'Public' : review.flagged ? 'Held for review' : 'Not public yet'
  const visibilityTone = review.publishedAt ? 'APPROVED' : review.flagged ? 'PENDING' : 'UNDER_REVIEW'

  return (
    <article className="rounded-[1.5rem] border border-ink/8 bg-[linear-gradient(180deg,#fffdf9_0%,#f5eee3_100%)] p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
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
        <input type="hidden" name="redirectTo" value="/ops#reviews" />
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
    </article>
  )
}

function LoginView({
  error,
}: {
  error: string | null
}): JSX.Element {
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
                <p>Recent safety, privacy, trust, payment, and shipping workflow issues pulled straight from audit logs.</p>
                <p>Deletion requests with privacy-safe status tracking.</p>
                <p>Recent payout records with enough context to answer trust questions fast.</p>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-ink/8 bg-[linear-gradient(180deg,#faf5ed_0%,#f2eade_100%)] p-6">
              <h2 className="text-3xl text-ink">Unlock ops</h2>
              <p className="mt-3 text-sm leading-7 text-ink/66">Enter the shared ops token. The session stays scoped to this internal surface only.</p>
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

function SetupView(): JSX.Element {
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
            <code className="mt-3 block whitespace-pre-wrap rounded-[1.1rem] bg-ink px-4 py-4 text-sm leading-7 text-white">
              OPS_DASHBOARD_TOKEN=your_shared_internal_token
            </code>
          </div>
        </section>
      </div>
    </main>
  )
}

export default async function OpsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<JSX.Element> {
  const params = await searchParams
  const noticeKey = readParam(params, 'notice')
  const errorKey = readParam(params, 'error')
  const notice = noticeKey ? NOTICE_COPY[noticeKey] ?? null : null
  const error = errorKey ? ERROR_COPY[errorKey] ?? 'Something went wrong while opening the ops surface.' : null

  if (!hasOpsDashboardToken()) {
    return <SetupView />
  }

  const access = await hasOpsAccess()
  if (!access) {
    return <LoginView error={error} />
  }

  const data = await loadOpsDashboardData()
  if (!data) {
    return <LoginView error={ERROR_COPY['service-role-missing'] ?? 'Add the server-side Supabase service role env vars to load ops data.'} />
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(45,106,79,0.16),transparent_34%),radial-gradient(circle_at_82%_10%,rgba(216,90,48,0.10),transparent_26%),linear-gradient(180deg,#f7f1e8_0%,#f1eadf_100%)]">
      <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8 lg:px-12">
        <header className="rounded-[2rem] border border-white/72 bg-white/72 px-5 py-5 shadow-[0_18px_60px_rgba(22,28,24,0.08)] backdrop-blur sm:px-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Internal ops</p>
              <h1 className="mt-3 text-4xl text-ink sm:text-5xl">Trust, abuse, and intake in one operating view.</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-ink/64">
                This is the lightweight control surface for launch-critical support work: disputes, review moderation, contact bypass review, conversation safety reports, privacy and trust requests, workflow issues, tailor intake, pending verification, account deletion follow-up, and payout visibility.
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

          <nav className="mt-5 flex flex-wrap gap-2 text-sm font-medium text-ink/70">
            {([
              { href: '#disputes', label: 'Disputes' },
              { href: '#reviews', label: 'Reviews' },
              { href: '#bypass', label: 'Bypass logs' },
              { href: '#applications', label: 'Applications' },
              { href: '#verification', label: 'Verification' },
              { href: '#workflow-issues', label: 'Workflow issues' },
              { href: '#deletions', label: 'Deletion' },
              { href: '#payouts', label: 'Payouts' },
            ] as const).map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="rounded-full border border-ink/8 bg-white/88 px-4 py-2 transition hover:bg-bone hover:text-ink"
              >
                {label}
              </Link>
            ))}
          </nav>
        </header>

        {notice ? (
          <div className="mt-6 rounded-[1.3rem] border border-needle/16 bg-needle/8 px-5 py-4 text-sm leading-7 text-needle-700">
            {notice}
          </div>
        ) : null}

        {error ? (
          <div className="mt-6 rounded-[1.3rem] border border-rust/16 bg-rust/8 px-5 py-4 text-sm leading-7 text-rust-700">
            {error}
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

        <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-7">
          <SummaryCard
            label="Open disputes"
            value={data.summary.openDisputes}
            hint="Live disputes still waiting for human attention."
          />
          <SummaryCard
            label="Review holds"
            value={data.summary.pendingReviewVisibility}
            hint="Reviews still waiting on a publish or hold decision."
          />
          <SummaryCard
            label="Bypass review"
            value={data.summary.unreviewedBypassLogs}
            hint="Blocked contact attempts still unreviewed."
          />
          <SummaryCard
            label="Safety reports"
            value={data.summary.recentSafetyReports}
            hint="Conversation safety reports from the last 7 days."
          />
          <SummaryCard
            label="Applications"
            value={data.summary.pendingApplications}
            hint="Tailor applications still sitting in pending."
          />
          <SummaryCard
            label="Verification"
            value={data.summary.pendingVerifications}
            hint="Profiles still waiting on verification review."
          />
          <SummaryCard
            label="Deletion queue"
            value={data.summary.pendingDeletionRequests}
            hint="Account deletion requests still waiting on a first response."
          />
        </section>

        <div className="mt-8 grid gap-8">
          <SectionFrame
            id="disputes"
            eyebrow="Disputes"
            title="See the conflict context before you jump into rescue mode."
            description="This queue is intentionally narrow: who is involved, what the customer said, what the order stage is, and whether ops has picked it up."
          >
            {data.disputes.length > 0 ? (
              <div className="grid gap-5">
                {data.disputes.map((dispute) => (
                  <DisputeCard key={dispute.id} dispute={dispute} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No disputes are open right now."
                body="That is the state we want. If a customer raises a concern later, it will land here with order context."
              />
            )}
          </SectionFrame>

          <SectionFrame
            id="reviews"
            eyebrow="Review moderation"
            title="Make review visibility intentional instead of accidental."
            description="This queue shows reviews that are still held or unpublished so ops can decide whether they should go public, stay held, or just be sanity-checked in context."
          >
            {data.reviewQueue.length > 0 ? (
              <div className="grid gap-5">
                {data.reviewQueue.map((review) => (
                  <ReviewQueueCard key={review.id} review={review} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No reviews are waiting on moderation right now."
                body="When a review is held for policy or dispute context, or it still needs a manual visibility decision, it will show up here."
              />
            )}
          </SectionFrame>

          <SectionFrame
            id="bypass"
            eyebrow="Contact bypass"
            title="Review blocked contact attempts without digging through raw logs."
            description="This is the server-side record of users trying to move communication off-platform before the right milestone."
          >
            {data.bypassLogs.length > 0 ? (
              <div className="grid gap-5">
                {data.bypassLogs.map((log) => (
                  <BypassLogCard key={log.id} log={log} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No blocked contact attempts yet."
                body="When the abuse filters catch phone numbers, handles, or external links, the review queue will show them here."
              />
            )}
          </SectionFrame>

          <SectionFrame
            id="applications"
            eyebrow="Tailor intake"
            title="Keep application review lightweight, visible, and moving."
            description="This mirrors the public application funnel from the website so ops can contact applicants and keep the pipeline from going stale."
          >
            {data.applications.length > 0 ? (
              <div className="grid gap-5">
                {data.applications.map((application) => (
                  <ApplicationCard key={application.id} application={application} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No tailor applications are in the queue."
                body="New website applications will land here automatically."
              />
            )}
          </SectionFrame>

          <SectionFrame
            id="verification"
            eyebrow="Verification"
            title="Pending verification stays visible even before a fuller admin system exists."
            description="This gives ops one place to spot pending tailor profiles and open the uploaded ID document quickly."
          >
            {data.pendingVerifications.length > 0 ? (
              <div className="grid gap-5">
                {data.pendingVerifications.map((profile) => (
                  <VerificationCard key={profile.profileId} profile={profile} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No pending verification requests right now."
                body="When a tailor submits ID verification, the profile will appear here until it is handled."
              />
            )}
          </SectionFrame>

          <SectionFrame
            id="workflow-issues"
            eyebrow="Workflow issues"
            title="Recent safety, payment, and shipping problems should surface before support gets stuck guessing."
            description="This is the launch-critical workflow stream from audit logs: conversation safety reports, in-app data access requests, seller access review requests, blocked payment starts, blocked shipping handoffs, and delivery webhooks that were skipped or failed. Safety reports can also pause or reopen chat from here."
          >
            {data.workflowIssues.length > 0 ? (
              <div className="grid gap-5">
                {data.workflowIssues.map((issue) => (
                  <WorkflowIssueCard key={issue.id} issue={issue} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No recent safety, payment, or shipping issues are showing."
                body="When someone reports unsafe chat behavior, requests privacy access, asks for seller access review, or checkout and delivery workflows get blocked, the latest audit breadcrumbs will appear here with enough context to triage quickly."
              />
            )}
          </SectionFrame>

          <SectionFrame
            id="deletions"
            eyebrow="Privacy ops"
            title="Deletion requests should never disappear into a support inbox."
            description="People can already request deletion in-app. This queue makes the follow-through visible, statused, and easy to hand off between ops and privacy."
          >
            {data.deletionRequests.length > 0 ? (
              <div className="grid gap-5">
                {data.deletionRequests.map((request) => (
                  <DeletionRequestCard key={request.id} request={request} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No account deletion requests are waiting right now."
                body="When a customer or tailor starts a deletion request in the app, it will appear here with its current handling status."
              />
            )}
          </SectionFrame>

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
        </div>
      </div>
    </main>
  )
}
