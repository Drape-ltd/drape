import { NextResponse } from 'next/server'
import { getOpsSession } from '../../../../../web/lib/ops-auth'
import { loadCanonicalOpsData } from '../../../../lib/data'
import { deriveOpsCaseMetricSets } from '../../../../lib/metric-eligibility.mjs'
import { buildOpsWorkItems } from '../../../../lib/work-items'

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}

export async function GET() {
  const session = await getOpsSession()
  if (!session?.allowed || !session.email || session.mode === 'bootstrap-token') {
    return json({ ok: false, error: 'named-workforce-session-required' }, 401)
  }

  try {
    const canonical = await loadCanonicalOpsData()
    const metrics = deriveOpsCaseMetricSets(buildOpsWorkItems(canonical), Date.now())
    const attention = new Set([...metrics.urgent, ...metrics.breached].map((item) => item.id))
    return json({ ok: true, attentionCount: attention.size, observedAt: canonical.observedAt })
  } catch {
    console.error('[ops-badge] authoritative-read-failed')
    return json({ ok: false, error: 'badge-source-unavailable' }, 503)
  }
}
