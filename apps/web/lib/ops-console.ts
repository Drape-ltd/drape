import type { OpsDashboardData } from './ops-data'

export type OpsTeam = 'OPS' | 'CUSTOMER_SUCCESS' | 'TRUST' | 'FINANCE' | 'ENGINEERING' | 'ADMIN'
export type OpsRole = 'ops' | 'customer_success' | 'trust' | 'finance' | 'engineering' | 'admin'

export type OpsView =
  | 'overview'
  | 'incidents'
  | 'communications'
  | 'access'
  | 'support'
  | 'shop'
  | 'dispatch'
  | 'order-reviews'
  | 'disputes'
  | 'reviews'
  | 'verification'
  | 'applications'
  | 'deletions'
  | 'money-desk'
  | 'payouts'
  | 'workflow-issues'
  | 'runbook'
  | 'bypass'

export type OpsSurfaceStatus = 'live' | 'planned'

export type OpsActionKind =
  | 'seller-item-visibility'
  | 'dispute-status'
  | 'dispute-resolution'
  | 'order-cancellation-refund-request'
  | 'bypass-review'
  | 'application-status'
  | 'verification-decision'
  | 'profile-change-decision'
  | 'payout-change-decision'
  | 'deletion-status'
  | 'review-visibility'
  | 'conversation-access'
  | 'dispatch-stage'
  | 'dispatch-quote'
  | 'dispatch-event'
  | 'order-review-resolution'
  | 'order-partial-refund'
  | 'reviewed-partial-refund-outcome'
  | 'payout-release'
  | 'material-advance-release'
  | 'material-overage-resolution'
  | 'payout-block-resolution'
  | 'ops-issue-status'
  | 'manual-issue-create'
  | 'ops-issue-bulk-resolve'
  | 'support-thread-mark-read'
  | 'payout-bulk-release'
  | 'bypass-bulk-review'
  | 'money-desk-elevation'
  | 'money-desk-request'
  | 'money-desk-decision'
  | 'money-desk-execution'
  | 'return-refund-prepare'
  | 'benefit-campaign-create'
  | 'benefit-campaign-activate'
  | 'benefit-grant-create'
  | 'consultation-attendance-resolution'
  | 'communication-campaign-create'
  | 'communication-campaign-review'
  | 'communication-campaign-publish'
  | 'communication-campaign-pause'
  | 'communication-campaign-resume'
  | 'communication-campaign-cancel'
  | 'communication-recipient-retry'
  | 'service-incident-upsert'
  | 'incident-communication-create'

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
      'This is the launch control surface for trust, dispatch, payouts, verification, deletions, and exception handling. It should become the place Drapeon resolves real customer and tailor problems without bouncing across tools.',
    team: 'ADMIN',
    status: 'live',
    anchor: 'overview',
    summaryCount: () => 0,
  },
  {
    key: 'incidents',
    label: 'Incidents',
    shortLabel: 'Incidents',
    eyebrow: 'Incident command',
    title: 'Treat provider, queue, and critical workflow failures like incidents.',
    description:
      'Engineering can see degraded provider circuits, dead-lettered jobs, retry pressure, and high-severity workflow issues in one place before customers feel the outage.',
    team: 'ENGINEERING',
    status: 'live',
    anchor: 'incidents',
    summaryCount: (summary) => summary.deadJobs + summary.retryableJobs + summary.providersDegraded,
  },
  {
    key: 'communications',
    label: 'Communications',
    shortLabel: 'Comms',
    eyebrow: 'Communications control',
    title: 'Send service updates, action notices, and promotions with proof.',
    description:
      'Create, independently approve, publish, pause, and recover Drapeon communications across in-app, push, email, and justified SMS from one auditable queue.',
    team: 'OPS',
    status: 'live',
    anchor: 'communications',
    summaryCount: (summary) => summary.activeCommunicationCampaigns,
  },
  {
    key: 'access',
    label: 'Access control',
    shortLabel: 'Access',
    eyebrow: 'People and access',
    title: 'Know who can touch each control before launch pressure hits.',
    description:
      'This shows the active access mode, current session role, and the section/action matrix that protects ops work until workforce SSO fully takes over.',
    team: 'ADMIN',
    status: 'live',
    anchor: 'access',
    summaryCount: () => 0,
  },
  {
    key: 'support',
    label: 'Support inbox',
    shortLabel: 'Support',
    eyebrow: 'Support',
    title: 'Watch live order conversations before customers feel abandoned.',
    description:
      'Recent order threads surface here with the latest message, unread state, payment context, and conversation safety controls so support can act without digging through the mobile app.',
    team: 'CUSTOMER_SUCCESS',
    status: 'live',
    anchor: 'support',
    summaryCount: (summary) => summary.activeSupportThreads,
  },
  {
    key: 'shop',
    label: 'Shop inventory',
    shortLabel: 'Shop',
    eyebrow: 'Ready-made',
    title: 'Keep ready-made listings trustworthy before buyers hit checkout.',
    description:
      'Ops can spot live listings with missing photos, low stock, sold-out inventory, hidden items, and fulfillment gaps without opening the mobile app.',
    team: 'OPS',
    status: 'live',
    anchor: 'shop',
    summaryCount: (summary) => summary.shopInventoryAlerts,
  },
  {
    key: 'dispatch',
    label: 'Dispatch queue',
    shortLabel: 'Dispatch',
    eyebrow: 'Dispatch',
    title: 'Own Drapeon-managed delivery and shipping from one queue.',
    description:
      'These orders already collected the flat Drapeon-managed fulfillment fee. Ops owns the rider or courier handoff from here once the seller marks the parcel ready.',
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
      'This is where Drapeon handles cancellation review, fulfillment change follow-up, and delivery exceptions while the order can still be saved or refunded cleanly.',
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
    title: 'Make public review visibility an intentional Drapeon decision.',
    description:
      'This queue keeps held or unpublished reviews visible until Drapeon chooses whether they should go public, stay held, or be reviewed in context.',
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
      'Pending tailor profiles, private challenge videos, and go-live decisions should stay in one place with direct trust ownership.',
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
    key: 'money-desk',
    label: 'Money Desk',
    shortLabel: 'Money',
    eyebrow: 'Protected money movement',
    title: 'Prepare, approve, and execute every manual money move with evidence.',
    description:
      'Money Desk separates the preparer from the approver, requires short-lived MFA-backed elevation, and records every request through a terminal outcome.',
    team: 'FINANCE',
    status: 'live',
    anchor: 'money-desk',
    summaryCount: (summary) => summary.pendingMoneyDeskApprovals,
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
    key: 'runbook',
    label: 'Runbook',
    shortLabel: 'Runbook',
    eyebrow: 'Ops knowledge',
    title: 'Find the right playbook before replying to a customer or tailor.',
    description:
      'This keeps Drapeon launch guidance in the same control plane as disputes, payouts, dispatch, support, and safety queues so ops can act consistently.',
    team: 'OPS',
    status: 'live',
    anchor: 'runbook',
    summaryCount: () => 0,
  },
  {
    key: 'bypass',
    label: 'Bypass logs',
    shortLabel: 'Bypass',
    eyebrow: 'Contact bypass',
    title: 'Review blocked attempts to move communication off Drapeon.',
    description:
      'This is the server-side record of users trying to move communication off-platform before the right milestone.',
    team: 'TRUST',
    status: 'live',
    anchor: 'bypass',
    summaryCount: (summary) => summary.unreviewedBypassLogs,
  },
]

export const OPS_FUTURE_SURFACES = [] as const

const ROLE_SECTION_ACCESS: Record<OpsRole, OpsView[]> = {
  admin: OPS_LIVE_SECTIONS.map((section) => section.key),
  ops: ['overview', 'communications', 'support', 'shop', 'dispatch', 'applications', 'money-desk', 'payouts', 'runbook'],
  customer_success: ['overview', 'communications', 'support', 'order-reviews', 'disputes', 'money-desk', 'workflow-issues', 'runbook'],
  trust: ['overview', 'support', 'reviews', 'verification', 'deletions', 'bypass', 'workflow-issues', 'runbook'],
  finance: ['overview', 'communications', 'money-desk', 'payouts', 'runbook'],
  engineering: ['overview', 'incidents', 'communications', 'workflow-issues', 'dispatch', 'runbook'],
}

const ROLE_ACTION_ACCESS: Record<OpsRole, OpsActionKind[]> = {
  admin: [
    'seller-item-visibility',
    'dispute-status',
    'dispute-resolution',
    'order-cancellation-refund-request',
    'bypass-review',
    'application-status',
    'verification-decision',
    'profile-change-decision',
    'payout-change-decision',
    'deletion-status',
    'review-visibility',
    'conversation-access',
    'dispatch-stage',
    'dispatch-quote',
    'dispatch-event',
    'order-review-resolution',
    'order-partial-refund',
    'reviewed-partial-refund-outcome',
    'payout-release',
    'material-advance-release',
    'material-overage-resolution',
    'payout-block-resolution',
    'ops-issue-status',
    'manual-issue-create',
    'ops-issue-bulk-resolve',
    'support-thread-mark-read',
    'payout-bulk-release',
    'bypass-bulk-review',
    'money-desk-elevation',
    'money-desk-request',
    'money-desk-decision',
    'money-desk-execution',
    'return-refund-prepare',
    'benefit-campaign-create',
    'benefit-campaign-activate',
    'benefit-grant-create',
    'consultation-attendance-resolution',
    'communication-campaign-create',
    'communication-campaign-review',
    'communication-campaign-publish',
    'communication-campaign-pause',
    'communication-campaign-resume',
    'communication-campaign-cancel',
    'communication-recipient-retry',
    'service-incident-upsert',
    'incident-communication-create',
  ],
  ops: ['seller-item-visibility', 'application-status', 'dispatch-stage', 'dispatch-quote', 'dispatch-event', 'order-partial-refund', 'reviewed-partial-refund-outcome', 'material-advance-release', 'payout-block-resolution', 'ops-issue-status', 'manual-issue-create', 'ops-issue-bulk-resolve', 'support-thread-mark-read', 'money-desk-elevation', 'money-desk-request', 'consultation-attendance-resolution', 'communication-campaign-create', 'communication-campaign-review', 'communication-campaign-publish', 'communication-campaign-pause', 'communication-campaign-resume', 'communication-campaign-cancel', 'communication-recipient-retry', 'service-incident-upsert', 'incident-communication-create'],
  customer_success: ['dispute-status', 'dispute-resolution', 'order-cancellation-refund-request', 'conversation-access', 'order-review-resolution', 'order-partial-refund', 'reviewed-partial-refund-outcome', 'material-advance-release', 'payout-block-resolution', 'ops-issue-status', 'manual-issue-create', 'ops-issue-bulk-resolve', 'support-thread-mark-read', 'money-desk-elevation', 'money-desk-request', 'consultation-attendance-resolution', 'communication-campaign-create', 'communication-campaign-review', 'communication-campaign-publish', 'communication-campaign-pause', 'communication-campaign-resume', 'communication-campaign-cancel', 'communication-recipient-retry', 'service-incident-upsert', 'incident-communication-create'],
  trust: ['seller-item-visibility', 'bypass-review', 'verification-decision', 'profile-change-decision', 'deletion-status', 'review-visibility', 'conversation-access', 'ops-issue-status', 'manual-issue-create', 'ops-issue-bulk-resolve', 'support-thread-mark-read', 'bypass-bulk-review'],
  finance: ['order-cancellation-refund-request', 'order-partial-refund', 'reviewed-partial-refund-outcome', 'payout-release', 'payout-change-decision', 'material-advance-release', 'material-overage-resolution', 'payout-block-resolution', 'ops-issue-status', 'manual-issue-create', 'ops-issue-bulk-resolve', 'payout-bulk-release', 'money-desk-elevation', 'money-desk-request', 'money-desk-decision', 'money-desk-execution', 'return-refund-prepare', 'benefit-campaign-create', 'benefit-campaign-activate', 'benefit-grant-create', 'consultation-attendance-resolution', 'communication-campaign-create', 'communication-campaign-review', 'communication-campaign-publish', 'communication-campaign-pause', 'communication-campaign-resume', 'communication-campaign-cancel', 'communication-recipient-retry'],
  engineering: ['ops-issue-status', 'manual-issue-create', 'ops-issue-bulk-resolve', 'communication-campaign-create', 'communication-campaign-review', 'communication-campaign-publish', 'communication-campaign-pause', 'communication-campaign-resume', 'communication-campaign-cancel', 'communication-recipient-retry', 'service-incident-upsert', 'incident-communication-create'],
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

export function getOpsRoleSections(role: OpsRole) {
  return getVisibleOpsSections(role).map((section) => section.key)
}

export function getOpsRoleActions(role: OpsRole) {
  return ROLE_ACTION_ACCESS[role] ?? ROLE_ACTION_ACCESS.admin
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
