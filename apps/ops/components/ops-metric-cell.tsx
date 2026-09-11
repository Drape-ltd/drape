import type { Route } from 'next'
import Link from 'next/link'
import { getOpsMetricDefinition, type OpsMetricKey } from '../lib/metric-catalogue'

export function OpsMetricCell({ metricKey, value, detail, ariaLabel }: {
  metricKey: OpsMetricKey
  value: string | number | null
  detail?: string
  ariaLabel?: string
}) {
  const metric = getOpsMetricDefinition(metricKey)
  const unavailable = value === null
  return <Link
    className="ops-summary-cell ops-summary-link"
    href={metric.drillDownHref as Route}
    aria-label={ariaLabel ?? `${metric.label}: ${unavailable ? metric.emptyState : value}`}
    title={metric.definition}
    data-metric-key={metric.key}
  >
    <div className="ops-summary-label">{metric.label}</div>
    <div className="ops-summary-value">{unavailable ? '—' : value}</div>
    <div className="ops-summary-detail">{detail ?? (unavailable ? metric.emptyState : metric.eligibility)}</div>
  </Link>
}
