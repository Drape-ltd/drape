import type { OpsDashboardData } from './ops-data'

export type OpsTeam = 'OPS' | 'CUSTOMER_SUCCESS' | 'TRUST' | 'FINANCE' | 'ENGINEERING' | 'ADMIN'
export type OpsRole = 'ops' | 'customer_success' | 'trust' | 'finance' | 'engineering' | 'admin'

export type OpsView =
  | 'overview'
  | 'dispatch'
  | 'order-reviews'
  | 'disputes'
  | 'reviews'
  | 'verification'
  | 'applications'
  | 'deletions'
  | 'payouts'
  | 'workflow-issues'
  | 'bypass'

export type OpsSurfaceStatus = 'live' | 'planned'

export type OpsActionKind =
  | 'dispute-status'
  | 'dispute-resolution'
  | 'bypass-review'
  | 'application-status'
  | 'verification-decision'
  | 'deletion-status'
  | 'review-visibility'
  | 'conversation-access'
  | 'dispatch-stage'
  | 'order-review-resolution'
  | 'order-partial-refund'
  | 'payout-release'
  | 'payout-block-resolution'
  | 'ops-issue-status'
  | 'manual-issue-create'

export type OpsSectionDefinition = {
  key: OpsView
  label: string
  shortLabel: string
  eyebrow: string
  title: string
  description: string
  team: OpsTeam
  status: OpsSurfaceStatus
  anchor: string
  summaryCount: (summary: OpsDashboardData['summary']) => number
}

export const OPS_LIVE_SECTIONS: OpsSectionDefinition[] = [
  {
    key: 'overview',
    label: 'Overview',
    shortLabel: 'Overview',
    eyebrow: 'Control plane',
    title: 'See the whole operating picture before touching anything.',
    description:
      'This is the launch control surface for trust, dispatch, payouts, verification, deletions, and exception handling. It should become the place Drape resolves real customer and tailor problems without bouncing across tools.',
    team: 'ADMIN',
    status: 'live',
    anchor: 'overview',
    summaryCount: () => 0,
  },
  {
    key: 'dispatch',
    label: 'Dispatch queue',
    shortLabel: 'Dispatch',
    eyebrow: 'Dispatch',
    title: 'Own Drape-managed delivery and shipping from one queue.',
    description:
      'These orders already collected the flat Drape-managed fulfillment fee. Ops owns the rider or courier handoff from here once the seller marks the parcel ready.',
    team: 'OPS',
    status: 'live',
    anchor: 'dispatch',
    summaryCount: (summary) => summary.pendingDispatch,
  },
  {
    key: 'order-reviews',
    label: 'Order reviews',
    shortLabel: 'Reviews',
    eyebrow: 'Order reviews',
    title: 'Resolve cancellations and dispatch exceptions before they become disputes.',
    description:
      'This is where Drape handles cancellation review, fulfillment change follow-up, and delivery exceptions while the order can still be saved or refunded cleanly.',
    team: 'CUSTOMER_SUCCESS',
    status: 'live',
    anchor: 'order-reviews',
    summaryCount: (summary) => summary.pendingOrderReviews,
  },
  {
    key: 'disputes',
    label: 'Disputes',
    shortLabel: 'Disputes',
    eyebrow: 'Disputes',
    title: 'See the conflict context before rescue mode starts.',
    description:
      'This queue is intentionally narrow: who is involved, what the customer said, which order stage the dispute came from, and whether ops has picked it up.',
    team: 'CUSTOMER_SUCCESS',
    status: 'live',
    anchor: 'disputes',
    summaryCount: (summary) => summary.openDisputes,
  },
  {
    key: 'reviews',
    label: 'Review moderation',
    shortLabel: 'Reviews',
    eyebrow: 'Review moderation',
    title: 'Make public review visibility an intentional Drape decision.',
    description:
      'This queue keeps held or unpublished reviews visible until Drape chooses whether they should go public, stay held, or be reviewed in context.',
    team: 'TRUST',
    status: 'live',
    anchor: 'reviews',
    summaryCount: (summary) => summary.pendingReviewVisibility,
  },
  {
    key: 'verification',
    label: 'Verification',
    shortLabel: 'Verification',
    eyebrow: 'Verification',
    title: 'Keep tailor identity review visible before it becomes back-office sprawl.',
    description:
      'Pending tailor profiles, uploaded ID documents, and go-live decisions should stay in one place with direct trust ownership.',
    team: 'TRUST',
    status: 'live',
    anchor: 'verification',
    summaryCount: (summary) => summary.pendingVerifications,
  },
  {
    key: 'applications',
    label: 'Tailor intake',
    shortLabel: 'Intake',
    eyebrow: 'Tailor intake',
    title: 'Keep the application funnel moving before it goes stale.',
    description:
      'This mirrors the public application intake so ops can contact applicants, review proof of work, and move the queue without relying on inbox memory.',
    team: 'OPS',
    status: 'live',
    anchor: 'applications',
    summaryCount: (summary) => summary.pendingApplications,
  },
  {
    key: 'deletions',
    label: 'Deletion requests',
    shortLabel: 'Deletion',
    eyebrow: 'Privacy ops',
    title: 'Never let deletion requests disappear into support limbo.',
    description:
      'Customers and tailors can already request deletion in-app. This queue keeps privacy follow-through visible, statused, and ready for handoff between ops and trust.',
    team: 'TRUST',
    status: 'live',
    anchor: 'deletions',
    summaryCount: (summary) => summary.pendingDeletionRequests,
  },
  {
    key: 'payouts',
    label: 'Payouts',
    shortLabel: 'Payouts',
    eyebrow: 'Payout visibility',
    title: 'See payout truth fast enough to answer trust questions without digging.',
    description:
      'Finance and ops can see pending or blocked payouts here, retry releases where appropriate, and connect payout problems back to the original order quickly.',
    team: 'FINANCE',
    status: 'live',
    anchor: 'payouts',
    summaryCount: (summary) => summary.pendingPayoutCount,
  },
  {
    key: 'workflow-issues',
    label: 'Workflow issues',
    shortLabel: 'Workflow',
    eyebrow: 'Workflow issues',
    title: 'Surface stuck or risky product flows before customers feel abandoned.',
    description:
      'This is the launch-critical issue queue for safety reports, payment and payout blockers, access holds, aftercare requests, and system alerts that still need human action.',
    team: 'ENGINEERING',
    status: 'live',
    anchor: 'workflow-issues',
    summaryCount: (summary) => summary.openWorkflowIssues,
  },
  {
    key: 'bypass',
    label: 'Bypass logs',
    shortLabel: 'Bypass',
    eyebrow: 'Contact bypass',
    title: 'Review blocked attempts to move communication off Drape.',
    description:
      'This is the server-side record of users trying to move communication off-platform before the right milestone.',
    team: 'TRUST',
    status: 'live',
    anchor: 'bypass',
    summaryCount: (summary) => summary.unreviewedBypassLogs,
  },
]

export const OPS_FUTURE_SURFACES = [
  {
    key: 'support-inbox',
    label: 'Customer success inbox',
    team: 'CUSTOMER_SUCCESS' as OpsTeam,
    note: 'Unified order, consultation, and support threads will land here once Drape-owned messaging and SLA routing are online.',
  },
  {
    key: 'incidents',
    label: 'Incidents and on-call',
    team: 'ENGINEERING' as OpsTeam,
    note: 'This will carry outage tracking, Cloudflare and API alerts, annotations, and on-call coordination.',
  },
  {
    key: 'people-access',
    label: 'People and access',
    team: 'ADMIN' as OpsTeam,
    note: 'This is where workforce SSO, group sync, section access, and audit-safe permission overrides should live.',
  },
] as const

const ROLE_SECTION_ACCESS: Record<OpsRole, OpsView[]> = {
  admin: OPS_LIVE_SECTIONS.map((section) => section.key),
  ops: ['overview', 'dispatch', 'applications', 'payouts'],
  customer_success: ['overview', 'order-reviews', 'disputes'],
  trust: ['overview', 'reviews', 'verification', 'deletions', 'bypass', 'workflow-issues'],
  finance: ['overview', 'payouts'],
  engineering: ['overview', 'workflow-issues', 'dispatch'],
}

const ROLE_ACTION_ACCESS: Record<OpsRole, OpsActionKind[]> = {
  admin: [
    'dispute-status',
    'dispute-resolution',
    'bypass-review',
    'application-status',
    'verification-decision',
    'deletion-status',
    'review-visibility',
    'conversation-access',
    'dispatch-stage',
    'order-review-resolution',
    'order-partial-refund',
    'payout-release',
    'ops-issue-status',
    'manual-issue-create',
  ],
  ops: ['application-status', 'dispatch-stage', 'order-partial-refund', 'payout-block-resolution', 'ops-issue-status', 'manual-issue-create'],
  customer_success: ['dispute-status', 'dispute-resolution', 'order-review-resolution', 'order-partial-refund', 'payout-block-resolution', 'ops-issue-status', 'manual-issue-create'],
  trust: ['bypass-review', 'verification-decision', 'deletion-status', 'review-visibility', 'conversation-access', 'ops-issue-status', 'manual-issue-create'],
  finance: ['order-partial-refund', 'payout-release', 'payout-block-resolution', 'ops-issue-status', 'manual-issue-create'],
  engineering: ['ops-issue-status', 'manual-issue-create'],
}

export function parseOpsView(value: string | null | undefined): OpsView {
  if (!value) return 'overview'

  const normalized = value.trim().toLowerCase()
  const match = OPS_LIVE_SECTIONS.find((section) => section.key === normalized)
  return match?.key ?? 'overview'
}

export function getOpsSection(view: OpsView): OpsSectionDefinition {
  const fallback = OPS_LIVE_SECTIONS[0]
  if (!fallback) {
    throw new Error('Ops sections are not configured')
  }

  return OPS_LIVE_SECTIONS.find((section) => section.key === view) ?? fallback
}

export function getVisibleOpsSections(role: OpsRole): OpsSectionDefinition[] {
  const allowed = new Set<OpsView>(ROLE_SECTION_ACCESS[role] ?? ROLE_SECTION_ACCESS.admin)
  return OPS_LIVE_SECTIONS.filter((section) => allowed.has(section.key))
}

export function canAccessOpsSection(role: OpsRole, view: OpsView) {
  return getVisibleOpsSections(role).some((section) => section.key === view)
}

export function canPerformOpsAction(role: OpsRole, action: OpsActionKind) {
  return (ROLE_ACTION_ACCESS[role] ?? ROLE_ACTION_ACCESS.admin).includes(action)
}

export function buildOpsHref(view: OpsView) {
  return view === 'overview' ? '/ops?view=overview' : `/ops?view=${view}#${getOpsSection(view).anchor}`
}

export function buildOpsRedirectTarget(view: OpsView, anchor?: string) {
  const resolvedAnchor = anchor ?? getOpsSection(view).anchor
  return view === 'overview' ? `/ops?view=overview#${resolvedAnchor}` : `/ops?view=${view}#${resolvedAnchor}`
}
