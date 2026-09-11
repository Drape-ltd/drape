'use client'

import { ArrowUpRight, Columns3, SlidersHorizontal } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useRef, useState } from 'react'
import { matchesOpsPriority, matchesOpsSlaPhase, matchesOpsWorkScope } from '../lib/metric-eligibility.mjs'
import type { OpsWorkItem } from '../lib/work-items'
import { formatEnum, formatRelativeTime, formatSla } from '../lib/work-items'

function tone(value: string) {
  const normalized = value.toUpperCase()
  if (normalized === 'CRITICAL' || normalized === 'HIGH' || normalized === 'OVERDUE') return 'critical'
  if (normalized === 'MEDIUM' || normalized === 'WARNING' || normalized.includes('BLOCK')) return 'warning'
  if (normalized === 'RESOLVED' || normalized === 'CLOSED' || normalized === 'APPROVED') return 'healthy'
  return 'neutral'
}

function compactContext(value: string) {
  const match = value.match(/^Order ([0-9a-f]{8})-[0-9a-f-]{19,}-([0-9a-f]{4})$/i)
  return match ? `Order ${match[1]}…${match[2]}` : value
}

function compactAssignee(value: string | null) {
  if (!value) return 'Unassigned'
  return value.includes('@') ? value.split('@')[0] : value
}

export function WorkList({ items, query = '' }: { items: OpsWorkItem[]; query?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [filterOpen, setFilterOpen] = useState(false)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [activeRow, setActiveRow] = useState(0)
  const rowLinks = useRef<Array<HTMLAnchorElement | null>>([])
  const [visibleColumns, setVisibleColumns] = useState({ context: true, assignee: true, nextAction: true, activity: true })
  const normalizedQuery = (params.get('q') ?? query).trim().toLowerCase()
  const scope = params.get('scope') ?? 'open'
  const priority = params.get('priority') ?? 'all'
  const queue = params.get('queue') ?? 'all'
  const phase = params.get('phase') ?? 'all'

  const visible = useMemo(() => {
    const nowMs = Date.now()
    return items.filter((entry) => {
    if (normalizedQuery && ![entry.caseNumber, entry.title, entry.summary, entry.context, entry.caseType]
      .some((value) => value.toLowerCase().includes(normalizedQuery))) return false
    if (!matchesOpsWorkScope(entry, scope, nowMs)) return false
    if (!matchesOpsPriority(entry, priority)) return false
    if (queue !== 'all' && entry.queueKey !== queue) return false
    if (!matchesOpsSlaPhase(entry, phase)) return false
    return true
    })
  }, [items, normalizedQuery, phase, priority, queue, scope])
  const pageSize = 20
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const pageItems = visible.slice(safePage * pageSize, (safePage + 1) * pageSize)

  function focusRow(index: number) {
    const bounded = Math.max(0, Math.min(pageItems.length - 1, index))
    setActiveRow(bounded)
    rowLinks.current[bounded]?.focus()
  }

  function setParameter(key: string, value: string) {
    setPage(0)
    setActiveRow(0)
    const next = new URLSearchParams(params.toString())
    if (value === 'all' || (key === 'scope' && value === 'open')) next.delete(key)
    else next.set(key, value)
    const search = next.toString()
    router.replace((search ? `${pathname}?${search}` : pathname) as Route, { scroll: false })
  }

  function clearFilters() {
    setPage(0)
    setActiveRow(0)
    const next = new URLSearchParams(params.toString())
    next.delete('priority')
    next.delete('queue')
    next.delete('phase')
    const search = next.toString()
    router.replace((search ? `${pathname}?${search}` : pathname) as Route, { scroll: false })
  }

  const queues = [...new Set(items.map((entry) => entry.queueKey))].sort()

  return (
    <>
      <div className="ops-toolbar">
        <div className="ops-tabs" aria-label="Work filters">
          <button className="ops-tab" data-active={scope === 'open'} aria-pressed={scope === 'open'} type="button" onClick={() => setParameter('scope', 'open')}>Open <span className="ops-muted">{visible.length}</span></button>
          <button className="ops-tab" data-active={scope === 'unassigned'} aria-pressed={scope === 'unassigned'} type="button" onClick={() => setParameter('scope', 'unassigned')}>Unassigned</button>
          <button className="ops-tab" data-active={scope === 'overdue'} aria-pressed={scope === 'overdue'} type="button" onClick={() => setParameter('scope', 'overdue')}>Overdue</button>
          <button className="ops-tab" data-active={scope === 'due'} aria-pressed={scope === 'due'} type="button" onClick={() => setParameter('scope', 'due')}>Due soon</button>
          <button className="ops-tab" data-active={scope === 'closed'} aria-pressed={scope === 'closed'} type="button" onClick={() => setParameter('scope', 'closed')}>Recently closed</button>
        </div>
        <span className="ops-toolbar-spacer" />
        <button className="ops-button" type="button" aria-expanded={filterOpen} aria-controls="ops-filter-panel" onClick={() => { setFilterOpen((open) => !open); setColumnsOpen(false) }}><SlidersHorizontal size={15} />Filter</button>
        <button className="ops-button" type="button" aria-expanded={columnsOpen} aria-controls="ops-column-panel" onClick={() => { setColumnsOpen((open) => !open); setFilterOpen(false) }}><Columns3 size={15} />Columns</button>
      </div>
      {filterOpen ? (
        <section className="ops-control-panel" id="ops-filter-panel" aria-label="Queue filters">
          <label>Priority<select value={priority} onChange={(event) => setParameter('priority', event.target.value)}><option value="all">All priorities</option><option value="critical">P0 or P1</option>{['P0', 'P1', 'P2', 'P3'].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
          <label>Queue<select value={queue} onChange={(event) => setParameter('queue', event.target.value)}><option value="all">All queues</option>{queues.map((value) => <option value={value} key={value}>{formatEnum(value)}</option>)}</select></label>
          <label>SLA phase<select value={phase} onChange={(event) => setParameter('phase', event.target.value)}><option value="all">All phases</option><option value="first-response">First response</option><option value="resolution">Active resolution</option></select></label>
          <button className="ops-button" type="button" onClick={clearFilters}>Clear filters</button>
        </section>
      ) : null}
      {columnsOpen ? (
        <section className="ops-control-panel" id="ops-column-panel" aria-label="Visible columns">
          <label className="ops-check"><input type="checkbox" checked={visibleColumns.context} onChange={(event) => setVisibleColumns((current) => ({ ...current, context: event.target.checked }))} />Context</label>
          <label className="ops-check"><input type="checkbox" checked={visibleColumns.assignee} onChange={(event) => setVisibleColumns((current) => ({ ...current, assignee: event.target.checked }))} />Assignee</label>
          <label className="ops-check"><input type="checkbox" checked={visibleColumns.nextAction} onChange={(event) => setVisibleColumns((current) => ({ ...current, nextAction: event.target.checked }))} />Next action</label>
          <label className="ops-check"><input type="checkbox" checked={visibleColumns.activity} onChange={(event) => setVisibleColumns((current) => ({ ...current, activity: event.target.checked }))} />Activity</label>
        </section>
      ) : null}
      <p className="ops-visually-hidden" id="ops-work-list-status" aria-live="polite" aria-atomic="true">
        {visible.length} matching {visible.length === 1 ? 'case' : 'cases'}. Page {safePage + 1} of {pageCount}.
      </p>
      {visible.length > 0 ? (
        <div className="ops-table-wrap">
          <p className="ops-visually-hidden" id="ops-row-navigation-help">Use the up and down arrow keys to move between cases. Press Enter to open the focused case.</p>
          <table className="ops-table" aria-describedby="ops-work-list-status ops-row-navigation-help">
            <thead>
              <tr>
                <th>Case</th>
                <th>Priority</th>
                <th>Status</th>
                {visibleColumns.context ? <th>Context</th> : null}
                {visibleColumns.assignee ? <th>Assignee</th> : null}
                {visibleColumns.nextAction ? <th>Next action</th> : null}
                <th>SLA</th>
                {visibleColumns.activity ? <th>Activity</th> : null}
              </tr>
            </thead>
            <tbody>
              {pageItems.map((item, index) => {
                const sla = formatSla(item.slaDueAt, item.slaPaused)
                return (
                  <tr className="ops-row" data-keyboard-active={index === activeRow} key={`${item.caseType}-${item.id}`}>
                    <td>
                      <Link
                        className="ops-case-link"
                        href={`/ops/cases/${encodeURIComponent(item.caseNumber)}` as Route}
                        ref={(element) => { rowLinks.current[index] = element }}
                        tabIndex={index === activeRow ? 0 : -1}
                        onFocus={() => setActiveRow(index)}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowDown') {
                            event.preventDefault()
                            focusRow(index + 1)
                          } else if (event.key === 'ArrowUp') {
                            event.preventDefault()
                            focusRow(index - 1)
                          } else if (event.key === 'Home') {
                            event.preventDefault()
                            focusRow(0)
                          } else if (event.key === 'End') {
                            event.preventDefault()
                            focusRow(pageItems.length - 1)
                          }
                        }}
                      >
                        <span className="ops-case-number">{item.caseNumber}</span>
                        <span>{item.title}</span>
                        <small>{item.summary}</small>
                      </Link>
                    </td>
                    <td data-label="Priority"><span className="ops-chip" data-tone={tone(item.priority === 'P0' || item.priority === 'P1' ? 'HIGH' : item.priority === 'P2' ? 'WARNING' : 'INFO')}>{item.priority}</span><br /><span className="ops-muted" style={{ fontSize: 10 }}>{formatEnum(item.severity)}</span></td>
                    <td data-label="Status"><span className="ops-chip" data-tone={tone(item.status)}>{formatEnum(item.status)}</span></td>
                    {visibleColumns.context ? <td data-label="Context"><span className="ops-cell-compact" title={item.context}>{compactContext(item.context)}</span><span className="ops-muted ops-cell-subtext">{formatRelativeTime(item.updatedAt)}</span></td> : null}
                    {visibleColumns.assignee ? <td data-label="Assignee"><span className="ops-cell-compact" title={item.assignee ?? 'Unassigned'}>{compactAssignee(item.assignee)}</span><span className="ops-muted ops-cell-subtext">{item.ownerTeam ? formatEnum(item.ownerTeam) : 'Policy unavailable'}</span></td> : null}
                    {visibleColumns.nextAction ? <td data-label="Next action"><span className="ops-cell-compact ops-cell-wrap">{item.waitingReason ? formatEnum(item.waitingReason) : item.recommendedAction}</span></td> : null}
                    <td data-label="SLA"><span className="ops-sla" data-overdue={sla.overdue}>{sla.label}</span><br /><span className="ops-muted" style={{ fontSize: 11 }}>{item.slaPaused ? 'Waiting clock paused' : item.slaPhase === 'FIRST_RESPONSE' ? 'First response' : 'Active resolution'}</span></td>
                    {visibleColumns.activity ? <td data-label="Activity"><span className="ops-cell-compact">{formatRelativeTime(item.updatedAt)}</span><span className="ops-muted ops-cell-subtext">{item.history[0] ? formatEnum(item.history[0].actionTaken) : 'Case created'}</span></td> : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <nav className="ops-pagination" aria-label="Work list pages">
            <span>{visible.length === 0 ? 'No results' : `${safePage * pageSize + 1}–${Math.min((safePage + 1) * pageSize, visible.length)} of ${visible.length}`}</span>
            <div>
              <button className="ops-button" type="button" disabled={safePage === 0} onClick={() => { setPage(Math.max(0, safePage - 1)); setActiveRow(0) }}>Previous</button>
              <span>Page {safePage + 1} of {pageCount}</span>
              <button className="ops-button" type="button" disabled={safePage >= pageCount - 1} onClick={() => { setPage(Math.min(pageCount - 1, safePage + 1)); setActiveRow(0) }}>Next</button>
            </div>
          </nav>
        </div>
      ) : (
        <div className="ops-empty">
          <h2>No matching operational work</h2>
          <p>This is live data, not a demo state. Clear the search or change the queue. New authoritative cases appear here when a monitored workflow creates them.</p>
        </div>
      )}
      <p className="ops-muted" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 11 }}>
        <ArrowUpRight size={13} /> Rows open route-owned case workspaces; no dashboard-wide loader or fixture counts.
      </p>
    </>
  )
}
