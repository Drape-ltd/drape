import { PageHead } from '../../../components/page-head'
import { MoneyDeskWorkspace } from '../../../components/money-desk-workspace'
import { loadMoneyData } from '../../../lib/money-data'
import { formatRelativeTime } from '../../../lib/work-items'
import { getOpsSession, hasFreshOpsMfa } from '../../../../web/lib/ops-auth'
import { canPerformOpsAction } from '../../../../web/lib/ops-console'
import { getActiveMoneyDeskGrant, isFounderMoneyDeskApprover, type MoneyDeskGrant } from '../../../../web/lib/money-desk'
import { invokeOpsReadBroker, requiresOpsEdgeBroker } from '../../../../web/lib/ops-edge-broker'
import { createServiceRoleClient } from '../../../../web/lib/server-supabase'
import { OpsPhoneRestriction } from '../../../components/ops-phone-restriction'
import { OpsPermissionRestriction } from '../../../components/ops-permission-restriction'
import { isRestrictedOpsPhoneRequest } from '../../../lib/client-surface'
import { hasOpsAreaAccess } from '../../../lib/route-access'

export const dynamic = 'force-dynamic'

const moneyViews = new Set(['approval', 'execution', 'payout-blocked', 'eligible-tranches'])

export default async function MoneyPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (!(await hasOpsAreaAccess('money'))) return <OpsPermissionRestriction area="Money Desk" />
  if (await isRestrictedOpsPhoneRequest()) return <OpsPhoneRestriction area="Money Desk" />
  const [data, session, query] = await Promise.all([loadMoneyData(), getOpsSession(), searchParams])
  const selectedView = moneyViews.has(String(query.view)) ? String(query.view) : null
  const sensitiveAccessReady = Boolean(session && hasFreshOpsMfa(session))
  let grant: MoneyDeskGrant | null = null
  if (sensitiveAccessReady && session) {
    if (requiresOpsEdgeBroker()) {
      grant = await invokeOpsReadBroker<MoneyDeskGrant | null>('money-grant', {
        actorRole: session.role,
      })
    } else {
      const client = createServiceRoleClient()
      grant = client ? await getActiveMoneyDeskGrant(client, session) : null
    }
  }
  const founderMoneyAuthority = Boolean(session?.email && isFounderMoneyDeskApprover(session.email))
  return <><PageHead eyebrow="Marketplace / Money Desk" title="Money Desk" description="A controlled queue for every manual release, refund, payout change, FX exception, and financial recovery." meta={`Observed ${formatRelativeTime(data.observedAt)}`} /><MoneyDeskWorkspace data={data} selectedView={selectedView} sensitiveAccessReady={sensitiveAccessReady} grantExpiresAt={grant?.expiresAt ?? null} actorEmail={session?.email ?? null} canApprove={Boolean(founderMoneyAuthority && session && canPerformOpsAction(session.role, 'money-desk-decision'))} canExecute={Boolean(founderMoneyAuthority && session && canPerformOpsAction(session.role, 'money-desk-execution'))} /></>
}
