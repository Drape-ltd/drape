import { PageHead } from '../../../../components/page-head'
import { OpsInstallGuide } from '../../../../components/ops-install-guide'
import { loadAccessGovernanceData } from '../../../../lib/remaining-domain-data'
import { runtimeContract } from '../../../../lib/work-items'
import { formatEnum, formatRelativeTime } from '../../../../lib/work-items'
import { OpsPhoneRestriction } from '../../../../components/ops-phone-restriction'
import { OpsPermissionRestriction } from '../../../../components/ops-permission-restriction'
import { isRestrictedOpsPhoneRequest } from '../../../../lib/client-surface'
import { hasOpsAreaAccess } from '../../../../lib/route-access'
import { getOpsSession, hasFreshOpsMfa } from '../../../../../web/lib/ops-auth'
import { WorkforceOffboardingPanel } from '../../../../components/workforce-offboarding-panel'

export const dynamic = 'force-dynamic'

export default async function AccessPage() {
  if (!(await hasOpsAreaAccess('access'))) return <OpsPermissionRestriction area="Workforce Access" />
  if (await isRestrictedOpsPhoneRequest()) return <OpsPhoneRestriction area="workforce access" />
  const contract = runtimeContract()
  const [data, session] = await Promise.all([loadAccessGovernanceData(), getOpsSession()])
  const active = data.principals.filter((principal) => principal.status === 'ACTIVE')
  const overdue = active.filter((principal) => principal.reviewDueAt && Date.parse(principal.reviewDueAt) < Date.now())
  const protectedAccess = Boolean(session && hasFreshOpsMfa(session))
  const protectedCheckpoint = '/ops/sensitive/workforce-access?returnTo=/ops/admin/access'
  return (
    <>
      <PageHead eyebrow="Governance / Access" title="Workforce access" description="Named identity, role, environment, step-up, revocation, and periodic review must all agree before Ops authority exists." />
      <section className="ops-panel">
        <div className="ops-panel-head"><h2>Current runtime contract</h2><span className="ops-chip" data-tone={contract.environment === 'production' ? 'warning' : 'healthy'}>{contract.environment}</span></div>
        <div className="ops-panel-body"><dl className="ops-runtime">
          <div className="ops-runtime-row"><dt>Release</dt><dd>{contract.release}</dd></div>
          <div className="ops-runtime-row"><dt>Supabase target</dt><dd>{contract.projectRef}</dd></div>
          <div className="ops-runtime-row"><dt>Identity boundary</dt><dd>{contract.accessMode}</dd></div>
          <div className="ops-runtime-row"><dt>Sensitive policy</dt><dd>{contract.sensitiveAccess}</dd></div>
          <div className="ops-runtime-row"><dt>Database authority</dt><dd>{contract.databaseAuthority}</dd></div>
          <div className="ops-runtime-row"><dt>Communications</dt><dd>{contract.communications}</dd></div>
        </dl></div>
      </section>
      <section className="ops-section-block">
        <OpsInstallGuide compact />
      </section>
      <section className="ops-section-block"><div className="ops-section-head"><div><p className="ops-action-label">Named authority</p><h2>Workforce principals</h2></div><span className="ops-muted">{active.length} active · {overdue.length} review overdue</span></div>{data.principals.length ? <div className="ops-domain-list">{data.principals.map((principal) => <article className="ops-domain-row ops-domain-row-compact" key={principal.id}><span className="ops-provider-icon" data-tone={principal.status === 'ACTIVE' ? 'healthy' : 'critical'}>{principal.email.slice(0,1).toUpperCase()}</span><div><strong>{principal.email}</strong><small>{formatEnum(principal.status)} · last seen {principal.lastSeenAt ? formatRelativeTime(principal.lastSeenAt) : 'never'}</small></div><div><span className="ops-label">Roles</span><strong>{principal.roles.map(formatEnum).join(', ')}</strong><small>Database-authorized</small></div><div><span className="ops-label">Scope & review</span><strong>{principal.environments.map(formatEnum).join(', ')}</strong><small>{principal.reviewDueAt ? `Review ${new Date(principal.reviewDueAt).toLocaleDateString()}` : 'Review date missing'}</small></div><WorkforceOffboardingPanel targetPrincipalId={principal.id} targetEmail={principal.email} targetStatus={principal.status} targetUpdatedAt={principal.updatedAt} actorEmail={session?.email ?? ''} offboardingCase={principal.offboardingCase} protectedAccess={protectedAccess} protectedCheckpoint={protectedCheckpoint} /></article>)}</div> : <div className="ops-empty"><h2>No workforce principal</h2><p>Cloudflare authentication alone grants no Ops authority. Provision a named database principal before use.</p></div>}</section>
    </>
  )
}
