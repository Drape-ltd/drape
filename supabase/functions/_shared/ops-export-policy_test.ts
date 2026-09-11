import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  canDownloadOpsExport,
  canRequestOpsExport,
  opsExportCsvCell,
  OPS_EXPORT_DEFAULT_ROWS,
  validateOpsExportRequest,
} from './ops-export-policy.ts'

Deno.test('Ops exports are limited to governance roles', () => {
  assertEquals(canRequestOpsExport(['ops', 'customer_success']), false)
  assertEquals(canRequestOpsExport(['engineering']), true)
  assertEquals(canRequestOpsExport(['admin']), true)
})

Deno.test('Ops export requests require a bounded reason, dataset, filters, and row limit', () => {
  const valid = validateOpsExportRequest({
    dataset: 'action_receipts',
    reason: 'Investigate failed protected actions for the launch review.',
    rowLimit: undefined,
    filters: { outcome: 'failed', from: '2026-09-01', to: '2026-09-30' },
  })
  assertEquals(valid.ok, true)
  if (valid.ok) {
    assertEquals(valid.value.dataset, 'ACTION_RECEIPTS')
    assertEquals(valid.value.rowLimit, OPS_EXPORT_DEFAULT_ROWS)
    assertEquals(valid.value.filters.outcome, 'FAILED')
  }

  assertEquals(validateOpsExportRequest({ dataset: 'USERS', reason: 'Browse users casually', rowLimit: 50, filters: {} }).ok, false)
  assertEquals(validateOpsExportRequest({ dataset: 'ACTION_RECEIPTS', reason: 'Too short', rowLimit: 50, filters: {} }).ok, false)
  assertEquals(validateOpsExportRequest({ dataset: 'ACTION_RECEIPTS', reason: 'A valid operational export reason.', rowLimit: 1001, filters: {} }).ok, false)
  assertEquals(validateOpsExportRequest({ dataset: 'ACTION_RECEIPTS', reason: 'A valid operational export reason.', rowLimit: 50, filters: { email: 'person@example.com' } }).ok, false)
  assertEquals(validateOpsExportRequest({ dataset: 'ACTION_RECEIPTS', reason: 'A valid operational export reason.', rowLimit: 50, filters: { from: false } }).ok, false)
  assertEquals(validateOpsExportRequest({ dataset: 'ACTION_RECEIPTS', reason: 'A valid operational export reason.', rowLimit: 50, filters: { from: '2026-09-30', to: '2026-09-01' } }).ok, false)
})

Deno.test('Ops CSV cells neutralize spreadsheet formulas including whitespace-prefixed payloads', () => {
  assertEquals(opsExportCsvCell('=HYPERLINK("https://example.invalid")'), '"\'=HYPERLINK(""https://example.invalid"")"')
  assertEquals(opsExportCsvCell('  +1+1'), '"\'  +1+1"')
  assertEquals(opsExportCsvCell('Ordinary status'), '"Ordinary status"')
})

Deno.test('Ops export downloads require the requester, ready state, unexpired content, and remaining allowance', () => {
  const base = {
    status: 'READY',
    requesterPrincipalId: 'principal-a',
    actorPrincipalId: 'principal-a',
    expiresAt: '2026-09-11T12:15:00.000Z',
    downloadCount: 0,
    nowMs: Date.parse('2026-09-11T12:00:00.000Z'),
  }
  assertEquals(canDownloadOpsExport(base), true)
  assertEquals(canDownloadOpsExport({ ...base, actorPrincipalId: 'principal-b' }), false)
  assertEquals(canDownloadOpsExport({ ...base, status: 'PROCESSING' }), false)
  assertEquals(canDownloadOpsExport({ ...base, nowMs: Date.parse('2026-09-11T12:16:00.000Z') }), false)
  assertEquals(canDownloadOpsExport({ ...base, downloadCount: 3 }), false)
})
