import { AlertTriangle, CircleUserRound, ShieldCheck, UserRoundCheck } from 'lucide-react'
import Link from 'next/link'
import { OpsPhoneRestriction } from '../../../components/ops-phone-restriction'
import { OpsPermissionRestriction } from '../../../components/ops-permission-restriction'
import { PageHead } from '../../../components/page-head'
import { isRestrictedOpsPhoneRequest } from '../../../lib/client-surface'
import { loadCustomerNetworkData } from '../../../lib/remaining-domain-data'
import { hasOpsAreaAccess } from '../../../lib/route-access'
import { formatEnum, formatRelativeTime } from '../../../lib/work-items'

export const dynamic = 'force-dynamic'

const customerViews = new Set(['cases', 'deletion', 'phone-verified'])

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (!(await hasOpsAreaAccess('customers'))) return <OpsPermissionRestriction area="Customer operations" />
  if (await isRestrictedOpsPhoneRequest()) return <OpsPhoneRestriction area="Customer operations" />
  const [data, query] = await Promise.all([loadCustomerNetworkData(), searchParams])
  const selectedView = customerViews.has(String(query.view)) ? String(query.view) : null
  const withCases = data.customers.filter((customer) => customer.openCaseCount > 0).length
  const deletion = data.customers.filter((customer) => customer.deletionStatus && !['COMPLETED', 'CANCELLED'].includes(customer.deletionStatus)).length
  const phoneVerified = data.customers.filter((customer) => customer.phoneVerified).length
  const customers = selectedView === 'cases'
    ? data.customers.filter((customer) => customer.openCaseCount > 0)
    : selectedView === 'deletion'
      ? data.customers.filter((customer) => customer.deletionStatus && !['COMPLETED', 'CANCELLED'].includes(customer.deletionStatus))
      : selectedView === 'phone-verified'
        ? data.customers.filter((customer) => customer.phoneVerified)
        : data.customers
  return <>
    <PageHead eyebrow="Marketplace / Customers" title="Customer operations" description="Account, support, privacy, and order context without exposing messages, addresses, or body measurements in the roster." meta={`Latest ${data.customers.length} · observed ${formatRelativeTime(data.observedAt)}`} />
    <section className="ops-summary-grid" aria-label="Customer operations summary">
      <Link className="ops-summary-cell ops-summary-link" href="/ops/customers#customer-roster"><div className="ops-summary-label">Accounts in view</div><div className="ops-summary-value">{data.customers.length}</div><div className="ops-summary-detail">Bounded to the latest {data.coverageLimit}</div></Link>
      <Link className="ops-summary-cell ops-summary-link" href="/ops/customers?view=cases#customer-roster"><div className="ops-summary-label">Open case context</div><div className="ops-summary-value">{withCases}</div><div className="ops-summary-detail">Needs operational follow-through</div></Link>
      <Link className="ops-summary-cell ops-summary-link" href="/ops/customers?view=deletion#customer-roster"><div className="ops-summary-label">Deletion active</div><div className="ops-summary-value">{deletion}</div><div className="ops-summary-detail">Privacy workflow remains separate</div></Link>
      <Link className="ops-summary-cell ops-summary-link" href="/ops/customers?view=phone-verified#customer-roster"><div className="ops-summary-label">Phone verified</div><div className="ops-summary-value">{phoneVerified}</div><div className="ops-summary-detail">No phone numbers shown here</div></Link>
    </section>
    <div className="ops-status-banner ops-banner-after-grid" data-tone="healthy" role="status"><ShieldCheck size={16} />Roster rows exclude email, phone, addresses, private messages, and measurement values. Open one customer only for an assigned operational purpose.</div>
    <section className="ops-section-block" id="customer-roster">
      <div className="ops-section-head"><div><p className="ops-action-label">Authoritative roster</p><h2>{selectedView ? `${formatEnum(selectedView)} accounts` : 'Recently active accounts'}</h2></div><div className="ops-section-actions">{selectedView ? <Link className="ops-button" href="/ops/customers#customer-roster">Clear filter</Link> : null}<Link className="ops-button" href="/ops/queues/support">Open support queue</Link></div></div>
      {customers.length ? <div className="ops-domain-list">{customers.map((customer) => <article className="ops-domain-row" key={customer.id}>
        <span className="ops-provider-icon" data-tone={customer.highestOpenSeverity === 'CRITICAL' ? 'critical' : customer.openCaseCount ? 'warning' : 'healthy'}>{customer.openCaseCount ? <AlertTriangle size={16} /> : customer.phoneVerified ? <UserRoundCheck size={16} /> : <CircleUserRound size={16} />}</span>
        <div><Link className="ops-case-link" href={`/ops/customers/${customer.id}`}><strong>{customer.name}</strong><small>Updated {formatRelativeTime(customer.updatedAt)}</small></Link></div>
        <div><span className="ops-label">Account</span><strong>{formatEnum(customer.role)}</strong><small>{customer.region ?? 'Region not recorded'} · {customer.currency ?? 'Currency not recorded'}</small></div>
        <div><span className="ops-label">Operations</span><strong>{customer.openCaseCount} open case{customer.openCaseCount === 1 ? '' : 's'}</strong><small>{customer.highestOpenSeverity ? `${formatEnum(customer.highestOpenSeverity)} highest severity` : 'No open exception'}</small></div>
        <div><span className="ops-label">Privacy</span><strong>{customer.deletionStatus ? formatEnum(customer.deletionStatus) : 'No active request'}</strong><small>Joined {new Date(customer.createdAt).toLocaleDateString()}</small></div>
      </article>)}</div> : <div className="ops-empty"><CircleUserRound size={20} /><h2>{selectedView ? `No ${formatEnum(selectedView).toLowerCase()} account` : 'No customer accounts yet'}</h2><p>The selected authoritative view has no eligible account record. No demonstration rows were inserted.</p></div>}
    </section>
  </>
}
