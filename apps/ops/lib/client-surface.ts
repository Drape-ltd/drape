import 'server-only'

import { headers } from 'next/headers'
export { isRestrictedOpsPhoneHeaders } from './client-surface-policy'
import { isRestrictedOpsPhoneHeaders } from './client-surface-policy'

export async function isRestrictedOpsPhoneRequest() {
  return isRestrictedOpsPhoneHeaders(await headers())
}
