export const OPS_EXPORT_DATASETS = ['ACTION_RECEIPTS'] as const
export type OpsExportDataset = (typeof OPS_EXPORT_DATASETS)[number]

export const OPS_EXPORT_OUTCOMES = ['ALL', 'SUCCEEDED', 'PENDING', 'FAILED', 'CANCELLED'] as const
export type OpsExportOutcome = (typeof OPS_EXPORT_OUTCOMES)[number]

export const OPS_EXPORT_MAX_ROWS = 1_000
export const OPS_EXPORT_DEFAULT_ROWS = 250
export const OPS_EXPORT_TTL_MINUTES = 15
export const OPS_EXPORT_MAX_DOWNLOADS = 3

export type OpsExportPolicyInput = {
  dataset: unknown
  reason: unknown
  rowLimit: unknown
  filters: unknown
}

export type ValidOpsExportRequest = {
  dataset: OpsExportDataset
  reason: string
  rowLimit: number
  filters: {
    outcome: OpsExportOutcome
    from: string | null
    to: string | null
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function isoDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

export function opsExportCsvCell(value: unknown) {
  const raw = value == null ? '' : String(value)
  const formulaSafe = /^[\u0000-\u0020]*[=+\-@]/u.test(raw) ? `'${raw}` : raw
  return `"${formulaSafe.replaceAll('"', '""')}"`
}

export function canRequestOpsExport(roles: string[]) {
  const normalized = new Set(roles.map((role) => role.trim().toLowerCase()))
  return normalized.has('admin') || normalized.has('engineering')
}

export function validateOpsExportRequest(input: OpsExportPolicyInput):
  | { ok: true; value: ValidOpsExportRequest }
  | { ok: false; error: string } {
  const dataset = typeof input.dataset === 'string' ? input.dataset.trim().toUpperCase() : ''
  if (!OPS_EXPORT_DATASETS.includes(dataset as OpsExportDataset)) {
    return { ok: false, error: 'unsupported-dataset' }
  }

  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (reason.length < 12 || reason.length > 500) {
    return { ok: false, error: 'reason-must-be-12-to-500-characters' }
  }

  const rowLimit = input.rowLimit === undefined || input.rowLimit === null || input.rowLimit === ''
    ? OPS_EXPORT_DEFAULT_ROWS
    : Number(input.rowLimit)
  if (!Number.isSafeInteger(rowLimit) || rowLimit < 1 || rowLimit > OPS_EXPORT_MAX_ROWS) {
    return { ok: false, error: 'row-limit-out-of-range' }
  }

  const rawFilters = record(input.filters)
  const unknownKeys = Object.keys(rawFilters).filter((key) => !['outcome', 'from', 'to'].includes(key))
  if (unknownKeys.length > 0) return { ok: false, error: 'unsupported-filter' }

  const outcome = typeof rawFilters.outcome === 'string' && rawFilters.outcome.trim()
    ? rawFilters.outcome.trim().toUpperCase()
    : 'ALL'
  if (!OPS_EXPORT_OUTCOMES.includes(outcome as OpsExportOutcome)) {
    return { ok: false, error: 'unsupported-outcome' }
  }

  const from = isoDate(rawFilters.from)
  const to = isoDate(rawFilters.to)
  const hasFrom = rawFilters.from !== undefined && rawFilters.from !== null && rawFilters.from !== ''
  const hasTo = rawFilters.to !== undefined && rawFilters.to !== null && rawFilters.to !== ''
  if ((hasFrom && !from) || (hasTo && !to)) {
    return { ok: false, error: 'invalid-date-filter' }
  }
  if (from && to && Date.parse(from) > Date.parse(to)) {
    return { ok: false, error: 'invalid-date-range' }
  }

  return {
    ok: true,
    value: {
      dataset: dataset as OpsExportDataset,
      reason,
      rowLimit,
      filters: { outcome: outcome as OpsExportOutcome, from, to },
    },
  }
}

export function canDownloadOpsExport(input: {
  status: string
  requesterPrincipalId: string
  actorPrincipalId: string
  expiresAt: string | null
  downloadCount: number
  nowMs?: number
}) {
  if (input.status !== 'READY') return false
  if (!input.requesterPrincipalId || input.requesterPrincipalId !== input.actorPrincipalId) return false
  if (!input.expiresAt || Date.parse(input.expiresAt) <= (input.nowMs ?? Date.now())) return false
  return input.downloadCount < OPS_EXPORT_MAX_DOWNLOADS
}
