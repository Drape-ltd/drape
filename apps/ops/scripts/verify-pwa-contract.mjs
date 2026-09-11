import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const read = (path) => readFileSync(`${root}/${path}`, 'utf8')
const manifestRoute = read('apps/ops/app/ops-manifest.webmanifest/route.ts')
const serviceWorker = read('apps/ops/public/ops-sw.js')
const pwaControl = read('apps/ops/components/ops-pwa-control.tsx')
const badgeRoute = read('apps/ops/app/ops/api/badge/route.ts')
const installGuide = read('apps/ops/components/ops-install-guide.tsx')
const workforceOffboarding = read('supabase/migrations/20260911016000_ops_workforce_offboarding_actions.sql')
const serviceWorkerContext = vm.createContext({
  URL,
  self: {
    addEventListener() {},
    location: { origin: 'https://ops.drapeon.co' },
  },
})
vm.runInContext(serviceWorker, serviceWorkerContext)
const safeOpsPath = serviceWorkerContext.safeOpsPath
const pathCases = {
  exact: safeOpsPath('/ops/cases/OPS-000123?view=timeline#receipt'),
  sameOrigin: safeOpsPath('https://ops.drapeon.co/ops/my-work?scope=overdue'),
  external: safeOpsPath('https://example.com/ops/cases/OPS-000123'),
  traversal: safeOpsPath('/ops/../account/settings'),
  protocolRelative: safeOpsPath('//example.com/ops/my-work'),
  malformed: safeOpsPath('http://%'),
}

const checks = [
  ['manifest launches canonical My Work', manifestRoute.includes("start_url: '/ops/my-work'")],
  ['manifest uses standalone display', manifestRoute.includes("display: 'standalone'")],
  ['service worker removes old Ops caches', serviceWorker.includes("key.startsWith('drapeon-ops-')")],
  ['push notifications use generic privacy-safe copy', serviceWorker.includes("showNotification('Drapeon Ops needs attention'")],
  ['push paths are normalized and restricted to same-origin Ops routes', serviceWorker.includes('new URL(candidate, self.location.origin)') && serviceWorker.includes('url.origin === self.location.origin') && serviceWorker.includes("url.pathname.startsWith('/ops/')")],
  ['unsafe or malformed push paths fail closed to My Work', serviceWorker.includes("return '/ops/my-work'") && serviceWorker.includes('catch {')],
  ['exact Ops notification context survives normalization', pathCases.exact === '/ops/cases/OPS-000123?view=timeline#receipt' && pathCases.sameOrigin === '/ops/my-work?scope=overdue'],
  ['external, traversal, protocol-relative, and malformed destinations fail closed at runtime', [pathCases.external, pathCases.traversal, pathCases.protocolRelative, pathCases.malformed].every((path) => path === '/ops/my-work')],
  ['service worker contains no fetch cache interception', !serviceWorker.includes("addEventListener('fetch'") && !serviceWorker.includes('caches.put(')],
  ['notification click reuses or opens the exact safe route', serviceWorker.includes('existing.navigate(path)') && serviceWorker.includes('clients.openWindow(path)')],
  ['subscription registration uses the authenticated Ops action', pwaControl.includes("fetch('/ops/api/web-push'")],
  ['foreground app badges reconcile from an authenticated no-store source set', pwaControl.includes("fetch('/ops/api/badge'") && pwaControl.includes("cache: 'no-store'") && pwaControl.includes("document.addEventListener('visibilitychange', onForeground)") && pwaControl.includes("window.addEventListener('focus', onForeground)") && badgeRoute.includes('getOpsSession()') && badgeRoute.includes('deriveOpsCaseMetricSets')],
  ['badge reads are private, bounded, and clear after authorization loss or unsubscribe', badgeRoute.includes("'Cache-Control': 'private, no-store, max-age=0'") && badgeRoute.includes('new Set([...metrics.urgent, ...metrics.breached]') && pwaControl.includes('response.status === 401 || response.status === 403') && pwaControl.includes('await clearAppBadge()')],
  ['foreground focus and visibility events share one short-lived in-flight badge read', pwaControl.includes('if (badgeReconciliation) return badgeReconciliation') && pwaControl.includes('Date.now() - lastBadgeReconciliationAt < 10_000') && pwaControl.includes('performAppBadgeReconciliation().finally')],
  ['sign-out cleanup can remove and unsubscribe a device', pwaControl.includes("method: 'DELETE'") && pwaControl.includes('subscription.unsubscribe()')],
  ['lost-device offboarding revokes the workforce session cutoff and every Ops push subscription', workforceOffboarding.includes('session_revoked_before = v_now') && workforceOffboarding.includes("failure_reason = 'WORKFORCE_ACCESS_REVOKED'") && workforceOffboarding.includes("where audience = 'OPS'")],
  ['installer QR contains only the stable HTTPS installer URL', installGuide.includes("const INSTALL_URL = 'https://ops.drapeon.co/install'")],
  ['installer states that installation does not bypass authentication', installGuide.includes('contains no password, session, staff identity, or access bypass')],
]

const failures = checks.filter(([, passed]) => !passed).map(([name]) => name)
if (failures.length > 0) {
  console.error(['Ops PWA contract verification failed:', ...failures.map((failure) => `- ${failure}`)].join('\n'))
  process.exit(1)
}

console.log(`Ops PWA contract verification passed (${checks.length} checks).`)
