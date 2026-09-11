import { PageHead } from '../../../../components/page-head'
import { WorkList } from '../../../../components/work-list'
import { loadCanonicalOpsData } from '../../../../lib/data'
import { buildOpsWorkItems, formatEnum } from '../../../../lib/work-items'

export const dynamic = 'force-dynamic'

export default async function QueuePage({ params, searchParams }: { params: Promise<{ queueKey: string }>; searchParams: Promise<{ q?: string; scope?: string; phase?: string }> }) {
  const [{ queueKey }, query] = await Promise.all([params, searchParams])
  const data = await loadCanonicalOpsData({ includeResolved: query.scope === 'closed' || query.scope === 'all' })
  const allItems = buildOpsWorkItems(data)
  const items = queueKey === 'all' ? allItems : allItems.filter((entry) => entry.queueKey === queueKey)
  const title = queueKey === 'all' ? 'All operational queues' : `${formatEnum(queueKey)} queue`

  return (
    <>
      <PageHead eyebrow="Work / Queues" title={title} description="Live records only. Queue membership is derived from authoritative workflow state and never from placeholder counts." meta={`${items.length} source record${items.length === 1 ? '' : 's'}`} />
      <WorkList items={items} query={query.q ?? ''} />
    </>
  )
}
