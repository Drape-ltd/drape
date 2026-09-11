import 'server-only'

import { getOpsSession } from '../../web/lib/ops-auth'
import { canAccessOpsArea, type OpsArea } from './route-access-policy'

export async function hasOpsAreaAccess(area: OpsArea) {
  const session = await getOpsSession()
  return Boolean(session?.allowed && canAccessOpsArea(session.role, area))
}
