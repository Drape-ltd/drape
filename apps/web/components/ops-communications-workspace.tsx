import type { OpsActionKind } from '../lib/ops-console'
import type { OpsDashboardData } from '../lib/ops-data'

type Props = {
  data: OpsDashboardData
  redirectTo: string
  actorEmail: string | null
  roleActions: OpsActionKind[]
}

const TERMINAL_CAMPAIGN_STATUSES = new Set(['COMPLETED', 'CANCELLED', 'REJECTED'])
const TERMINAL_INCIDENT_STATUSES = new Set(['RESOLVED', 'CLOSED'])

function label(value: string) {
  return value.toLowerCase().replaceAll('_', ' ').replace(/(^|\s)\S/g, (character) => character.toUpperCase())
}

function formatDate(value: string | null) {
  if (!value) return 'Not scheduled'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function HiddenAction({ kind, redirectTo }: { kind: OpsActionKind; redirectTo: string }) {
  return <><input type="hidden" name="kind" value={kind} /><input type="hidden" name="redirectTo" value={redirectTo} /></>
}

function CampaignCard({
  campaign,
  recipients,
  redirectTo,
  actions,
}: {
  campaign: OpsDashboardData['communicationCampaigns'][number]
  recipients: OpsDashboardData['communicationRecipients']
  redirectTo: string
  actions: Set<OpsActionKind>
}) {
  const failedRecipients = recipients.filter((recipient) => recipient.campaignId === campaign.id && recipient.status === 'FAILED')
  const canReview = actions.has('communication-campaign-review') && campaign.status === 'PENDING_APPROVAL'
  const canPublish = actions.has('communication-campaign-publish') && ['APPROVED', 'SCHEDULED'].includes(campaign.status)
  const canPause = actions.has('communication-campaign-pause') && ['SENDING', 'SCHEDULED'].includes(campaign.status)
  const canResume = actions.has('communication-campaign-resume') && campaign.status === 'PAUSED'
  const canCancel = actions.has('communication-campaign-cancel') && !TERMINAL_CAMPAIGN_STATUSES.has(campaign.status)

  return (
    <article className="overflow-hidden rounded-[18px] border border-ink/10 bg-white shadow-[0_16px_44px_rgba(25,45,37,0.06)]">
      <div className="grid gap-4 p-5 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-needle">
            <span>{label(campaign.kind)}</span><span aria-hidden="true">·</span><span>{label(campaign.status)}</span>
          </div>
          <h3 className="mt-2 text-xl font-semibold text-ink">{campaign.name}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/64">{label(campaign.category)} · {label(campaign.purpose)} · {label(campaign.severity)}</p>
          <p className="mt-1 text-xs text-ink/48">Created {formatDate(campaign.createdAt)} by {campaign.createdByEmail ?? 'Drapeon Ops'}</p>
        </div>
        <dl className="grid grid-cols-4 gap-2 text-center text-xs tabular-nums">
          {[
            ['Audience', campaign.recipientCount], ['Delivered', campaign.deliveredCount],
            ['Failed', campaign.failedCount], ['Skipped', campaign.skippedCount],
          ].map(([name, count]) => <div key={name} className="rounded-xl bg-bone px-3 py-2"><dt className="text-ink/52">{name}</dt><dd className="mt-1 font-semibold text-ink">{count}</dd></div>)}
        </dl>
      </div>

      {campaign.lastError ? <div className="border-y border-rust/20 bg-rust/5 px-5 py-3 text-sm text-rust">Last delivery issue: {campaign.lastError}</div> : null}

      <div className="grid gap-4 border-t border-ink/8 bg-bone/45 p-5">
        {canReview ? (
          <form method="POST" action="/ops/action" className="grid gap-3 rounded-xl border border-ink/10 bg-white p-4">
            <HiddenAction kind="communication-campaign-review" redirectTo={redirectTo} />
            <input type="hidden" name="campaignId" value={campaign.id} />
            <label className="text-sm font-semibold text-ink">Independent review reason
              <textarea name="reason" required minLength={12} className="mt-2 min-h-24 w-full rounded-xl border border-ink/15 bg-white p-3 font-normal" placeholder="Confirm the audience, wording, channels, destination, and timing." />
            </label>
            <div className="flex flex-wrap gap-2">
              <button name="decision" value="APPROVE" className="rounded-full bg-needle px-5 py-2.5 text-sm font-semibold text-white">Approve campaign</button>
              <button name="decision" value="REJECT" className="rounded-full border border-rust/25 bg-white px-5 py-2.5 text-sm font-semibold text-rust">Reject</button>
            </div>
          </form>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {canPublish ? <form method="POST" action="/ops/action"><HiddenAction kind="communication-campaign-publish" redirectTo={redirectTo} /><input type="hidden" name="campaignId" value={campaign.id} /><button className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white">Publish</button></form> : null}
          {canPause ? <form method="POST" action="/ops/action"><HiddenAction kind="communication-campaign-pause" redirectTo={redirectTo} /><input type="hidden" name="campaignId" value={campaign.id} /><input type="hidden" name="reason" value="Paused by Ops for review." /><button className="rounded-full border border-ink/15 bg-white px-5 py-2.5 text-sm font-semibold text-ink">Pause</button></form> : null}
          {canResume ? <form method="POST" action="/ops/action"><HiddenAction kind="communication-campaign-resume" redirectTo={redirectTo} /><input type="hidden" name="campaignId" value={campaign.id} /><button className="rounded-full bg-needle px-5 py-2.5 text-sm font-semibold text-white">Resume</button></form> : null}
          {canCancel ? <form method="POST" action="/ops/action"><HiddenAction kind="communication-campaign-cancel" redirectTo={redirectTo} /><input type="hidden" name="campaignId" value={campaign.id} /><input type="hidden" name="reason" value="Cancelled by Ops." /><button className="rounded-full border border-rust/20 bg-white px-5 py-2.5 text-sm font-semibold text-rust">Cancel</button></form> : null}
        </div>

        {failedRecipients.length > 0 ? (
          <details className="rounded-xl border border-rust/15 bg-white">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-rust">Failed recipients · {failedRecipients.length}</summary>
            <div className="grid gap-3 border-t border-ink/8 p-4">
              {failedRecipients.map((recipient) => (
                <form key={recipient.id} method="POST" action="/ops/action" className="grid gap-2 rounded-lg bg-bone p-3 md:grid-cols-[1fr_2fr_auto] md:items-end">
                  <HiddenAction kind="communication-recipient-retry" redirectTo={redirectTo} />
                  <input type="hidden" name="recipientId" value={recipient.id} />
                  <div className="text-xs text-ink/60"><strong className="block text-ink">Recipient {recipient.userId.slice(0, 8)}</strong>{recipient.channels.map(label).join(', ')}</div>
                  <label className="text-xs font-semibold text-ink">Retry reason<input name="reason" required minLength={8} className="mt-1 w-full rounded-lg border border-ink/15 bg-white px-3 py-2 font-normal" /></label>
                  <button className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white">Retry failed delivery</button>
                </form>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </article>
  )
}

export function OpsCommunicationsWorkspace({ data, redirectTo, actorEmail, roleActions }: Props) {
  const actions = new Set(roleActions)
  const activeCampaigns = data.communicationCampaigns.filter((campaign) => !TERMINAL_CAMPAIGN_STATUSES.has(campaign.status))
  const campaignHistory = data.communicationCampaigns.filter((campaign) => TERMINAL_CAMPAIGN_STATUSES.has(campaign.status))
  const activeIncidents = data.serviceIncidents.filter((incident) => !TERMINAL_INCIDENT_STATUSES.has(incident.status))
  const incidentHistory = data.serviceIncidents.filter((incident) => TERMINAL_INCIDENT_STATUSES.has(incident.status))

  return (
    <section id="communications" className="grid gap-8">
      <header className="grid gap-3 border-b border-ink/10 pb-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-needle">Communications control</p><h2 className="mt-2 max-w-4xl font-serif text-4xl leading-tight text-ink">Every important message should have an owner, audience, destination, and terminal outcome.</h2></div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold"><span className="rounded-full bg-needle/10 px-3 py-2 text-needle">{activeCampaigns.length} active campaigns</span><span className="rounded-full bg-rust/10 px-3 py-2 text-rust">{activeIncidents.length} active incidents</span></div>
      </header>

      {actions.has('communication-campaign-create') ? (
        <details className="rounded-[18px] border border-ink/10 bg-white shadow-sm">
          <summary className="cursor-pointer list-none px-5 py-4 text-base font-semibold text-ink">Create a communication</summary>
          <form method="POST" action="/ops/action" className="grid gap-4 border-t border-ink/8 p-5 md:grid-cols-2">
            <HiddenAction kind="communication-campaign-create" redirectTo={redirectTo} />
            <label className="text-sm font-semibold">Internal name<input name="name" required className="mt-2 w-full rounded-xl border border-ink/15 px-3 py-3 font-normal" /></label>
            <label className="text-sm font-semibold">Message kind<select name="campaignKind" className="mt-2 w-full rounded-xl border border-ink/15 px-3 py-3 font-normal"><option value="PSA">Public service announcement</option><option value="SERVICE_STATUS">Service status</option><option value="PRODUCT_UPDATE">Product update</option><option value="PROMOTION">Promotion</option></select></label>
            <label className="text-sm font-semibold">Category<input name="category" required placeholder="Order, payment, safety, promotion…" className="mt-2 w-full rounded-xl border border-ink/15 px-3 py-3 font-normal" /></label>
            <label className="text-sm font-semibold">Purpose<input name="purpose" required placeholder="Why this message is necessary" className="mt-2 w-full rounded-xl border border-ink/15 px-3 py-3 font-normal" /></label>
            <label className="text-sm font-semibold md:col-span-2">Email subject<input name="subject" required className="mt-2 w-full rounded-xl border border-ink/15 px-3 py-3 font-normal" /></label>
            <label className="text-sm font-semibold md:col-span-2">In-app title<input name="title" required className="mt-2 w-full rounded-xl border border-ink/15 px-3 py-3 font-normal" /></label>
            <label className="text-sm font-semibold md:col-span-2">Authoritative message<textarea name="body" required minLength={12} className="mt-2 min-h-32 w-full rounded-xl border border-ink/15 px-3 py-3 font-normal" /></label>
            <fieldset className="rounded-xl border border-ink/10 p-4"><legend className="px-1 text-sm font-semibold">Audience</legend><div className="mt-2 flex flex-wrap gap-4 text-sm"><label><input type="checkbox" name="audienceRoles" value="CUSTOMER" className="mr-2" />Customers</label><label><input type="checkbox" name="audienceRoles" value="TAILOR" className="mr-2" />Tailors</label><label><input type="checkbox" name="audienceRoles" value="OPS" className="mr-2" />Ops</label></div><label className="mt-4 block text-xs font-semibold">Specific user IDs (comma separated)<input name="userIds" className="mt-1 w-full rounded-lg border border-ink/15 px-3 py-2 font-normal" /></label></fieldset>
            <fieldset className="rounded-xl border border-ink/10 p-4"><legend className="px-1 text-sm font-semibold">Channels</legend><div className="mt-2 flex flex-wrap gap-4 text-sm"><label><input type="checkbox" checked readOnly className="mr-2" />In-app</label><label><input type="checkbox" name="channels" value="PUSH" className="mr-2" />Push</label><label><input type="checkbox" name="channels" value="EMAIL" className="mr-2" />Email</label><label><input type="checkbox" name="channels" value="SMS" className="mr-2" />SMS</label></div></fieldset>
            <label className="text-sm font-semibold">Destination key<input name="destinationKey" required placeholder="ORDER_DETAIL" className="mt-2 w-full rounded-xl border border-ink/15 px-3 py-3 font-normal" /></label>
            <label className="text-sm font-semibold">Destination path<input name="destinationPath" required placeholder="/orders/:id" className="mt-2 w-full rounded-xl border border-ink/15 px-3 py-3 font-normal" /></label>
            <label className="text-sm font-semibold">Severity<select name="severity" className="mt-2 w-full rounded-xl border border-ink/15 px-3 py-3 font-normal"><option>INFO</option><option>WARNING</option><option>CRITICAL</option></select></label>
            <label className="text-sm font-semibold">Risk level<select name="riskLevel" className="mt-2 w-full rounded-xl border border-ink/15 px-3 py-3 font-normal"><option>LOW</option><option>MEDIUM</option><option>HIGH</option></select></label>
            <label className="text-sm font-semibold">Schedule (optional)<input type="datetime-local" name="scheduledAt" className="mt-2 w-full rounded-xl border border-ink/15 px-3 py-3 font-normal" /></label>
            <label className="text-sm font-semibold">Expires (optional)<input type="datetime-local" name="expiresAt" className="mt-2 w-full rounded-xl border border-ink/15 px-3 py-3 font-normal" /></label>
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="acknowledgementRequired" value="true" />Require acknowledgement</label>
            <label className="text-sm font-semibold">Linked promotion (optional)<select name="commercialCampaignId" className="mt-2 w-full rounded-xl border border-ink/15 px-3 py-3 font-normal"><option value="">None</option>{data.benefitCampaigns.filter((campaign) => campaign.status === 'ACTIVE').map((campaign) => <option key={campaign.campaignId} value={campaign.campaignId}>{campaign.name}</option>)}</select></label>
            <button className="rounded-full bg-needle px-6 py-3 text-sm font-semibold text-white md:col-span-2">Save for independent review</button>
          </form>
        </details>
      ) : null}

      <div className="grid gap-4"><h3 className="text-lg font-semibold text-ink">Active campaign queue</h3>{activeCampaigns.length ? activeCampaigns.map((campaign) => <CampaignCard key={campaign.id} campaign={campaign} recipients={data.communicationRecipients} redirectTo={redirectTo} actions={actions} />) : <p className="rounded-xl border border-dashed border-ink/15 bg-white/60 p-6 text-sm text-ink/58">No campaign currently needs review, delivery, or recovery.</p>}</div>

      <div className="grid gap-4"><h3 className="text-lg font-semibold text-ink">Incident communications</h3>
        {actions.has('service-incident-upsert') ? <details className="rounded-[18px] border border-ink/10 bg-white"><summary className="cursor-pointer px-5 py-4 font-semibold">Open or update an incident</summary><form method="POST" action="/ops/action" className="grid gap-4 border-t border-ink/8 p-5 md:grid-cols-2"><HiddenAction kind="service-incident-upsert" redirectTo={redirectTo} /><label className="text-sm font-semibold">Incident key<input name="incidentKey" required placeholder="SUPABASE_IO_2026_08_28" className="mt-2 w-full rounded-xl border border-ink/15 px-3 py-3 font-normal" /></label><label className="text-sm font-semibold">Title<input name="title" required className="mt-2 w-full rounded-xl border border-ink/15 px-3 py-3 font-normal" /></label><label className="text-sm font-semibold md:col-span-2">Customer-safe summary<textarea name="summary" required className="mt-2 min-h-24 w-full rounded-xl border border-ink/15 px-3 py-3 font-normal" /></label><label className="text-sm font-semibold">Severity<select name="severity" className="mt-2 w-full rounded-xl border border-ink/15 px-3 py-3 font-normal"><option value="NOTICE">Minor</option><option value="WARNING">Major</option><option value="CRITICAL">Critical</option></select></label><label className="text-sm font-semibold">Status<select name="status" className="mt-2 w-full rounded-xl border border-ink/15 px-3 py-3 font-normal"><option>INVESTIGATING</option><option>IDENTIFIED</option><option>MONITORING</option><option>RESOLVED</option></select></label><label className="text-sm font-semibold">Affected services (comma separated)<input name="affectedServices" required className="mt-2 w-full rounded-xl border border-ink/15 px-3 py-3 font-normal" /></label><label className="text-sm font-semibold">Source reference<input name="sourceReference" className="mt-2 w-full rounded-xl border border-ink/15 px-3 py-3 font-normal" /></label><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="publicVisible" value="true" />Visible to affected users</label><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="acknowledgementRequired" value="true" />Require acknowledgement</label><input type="hidden" name="source" value="DRAPEON_OPS" /><input type="hidden" name="destinationKey" value="SERVICE_STATUS" /><input type="hidden" name="destinationPath" value="/service-status" /><button className="rounded-full bg-ink px-6 py-3 text-sm font-semibold text-white md:col-span-2">Save incident state</button></form></details> : null}
        {activeIncidents.map((incident) => <article key={incident.id} className="grid gap-4 rounded-[18px] border border-rust/15 bg-white p-5"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-rust">{label(incident.severity)} · {label(incident.status)}</p><h4 className="mt-2 text-xl font-semibold">{incident.title}</h4><p className="mt-2 text-sm leading-6 text-ink/65">{incident.summary}</p><p className="mt-2 text-xs text-ink/48">{incident.affectedServices.join(', ')} · Updated {formatDate(incident.updatedAt)}</p></div>{actions.has('incident-communication-create') ? <form method="POST" action="/ops/action" className="grid gap-3 rounded-xl bg-bone p-4 md:grid-cols-2"><HiddenAction kind="incident-communication-create" redirectTo={redirectTo} /><input type="hidden" name="incidentId" value={incident.id} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked readOnly />In-app</label><div className="flex flex-wrap gap-4 text-sm"><label><input type="checkbox" name="channels" value="PUSH" className="mr-2" />Push</label><label><input type="checkbox" name="channels" value="EMAIL" className="mr-2" />Email</label><label><input type="checkbox" name="channels" value="SMS" className="mr-2" />SMS</label></div><input type="hidden" name="destinationKey" value="SERVICE_STATUS" /><input type="hidden" name="destinationPath" value="/service-status" /><button className="rounded-full bg-rust px-5 py-2.5 text-sm font-semibold text-white md:col-span-2">Create reviewed incident update</button></form> : null}</article>)}
      </div>

      {(campaignHistory.length || incidentHistory.length) ? <details className="rounded-[18px] border border-ink/10 bg-white/65"><summary className="cursor-pointer px-5 py-4 font-semibold">Completed communications history · {campaignHistory.length + incidentHistory.length}</summary><div className="grid gap-3 border-t border-ink/8 p-5">{campaignHistory.map((campaign) => <CampaignCard key={campaign.id} campaign={campaign} recipients={data.communicationRecipients} redirectTo={redirectTo} actions={actions} />)}{incidentHistory.map((incident) => <div key={incident.id} className="rounded-xl bg-bone p-4"><strong>{incident.title}</strong><p className="mt-1 text-sm text-ink/58">{label(incident.status)} · {formatDate(incident.resolvedAt)}</p></div>)}</div></details> : null}
      <p className="text-xs text-ink/45">Signed in as {actorEmail ?? 'Drapeon workforce'}. All decisions, retries, recipients, and channel outcomes are auditable.</p>
    </section>
  )
}
