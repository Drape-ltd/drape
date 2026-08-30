'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Clock3, RefreshCw } from 'lucide-react'
import type { CommunicationSeverity } from '@drape/shared'

import { createClient } from '../lib/supabase'
import { Button } from './ui/button'

type IncidentStatus = 'INVESTIGATING' | 'IDENTIFIED' | 'MONITORING' | 'RESOLVED'

type ServiceIncident = {
  id: string
  incident_key: string
  title: string
  summary: string
  severity: CommunicationSeverity
  status: IncidentStatus
  affected_services: string[]
  acknowledgement_required: boolean
  destination: Record<string, unknown>
  started_at: string
  resolved_at: string | null
  updated_at: string
}

const statusLabels: Record<IncidentStatus, string> = {
  INVESTIGATING: 'Investigating',
  IDENTIFIED: 'Issue identified',
  MONITORING: 'Monitoring recovery',
  RESOLVED: 'Resolved',
}

const severityLabels: Record<CommunicationSeverity, string> = {
  INFO: 'Information',
  NOTICE: 'Notice',
  WARNING: 'Important',
  CRITICAL: 'Critical',
}

function friendlyService(value: string) {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function updatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently updated'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function IncidentCard({ incident }: { incident: ServiceIncident }) {
  const active = incident.status !== 'RESOLVED'
  const critical = incident.severity === 'CRITICAL'

  return (
    <article className={`rounded-lg border bg-white/90 p-5 shadow-sm ${critical ? 'border-rust/35' : active ? 'border-amber-500/30' : 'border-ink/8'}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className={`mt-1.5 size-2.5 shrink-0 rounded-full ${active ? critical ? 'bg-rust' : 'bg-amber-500' : 'bg-needle'}`} />
        <div className="min-w-0 flex-1">
          <h3 className="text-xl text-ink">{incident.title}</h3>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink/48">
            {statusLabels[incident.status]} · {severityLabels[incident.severity]}
          </p>
        </div>
      </div>
      <p className="mt-4 text-sm leading-7 text-ink/68">{incident.summary}</p>
      {incident.affected_services.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Affected services">
          {incident.affected_services.map((service) => (
            <span key={service} className="rounded-full bg-bone px-3 py-1.5 text-xs font-medium text-ink/66">
              {friendlyService(service)}
            </span>
          ))}
        </div>
      ) : null}
      <p className="mt-4 flex items-center gap-1.5 text-xs text-ink/42">
        <Clock3 aria-hidden="true" className="size-3.5" /> Updated {updatedAt(incident.updated_at)}
      </p>
    </article>
  )
}

export function ServiceStatusSurface(): React.JSX.Element {
  const [incidents, setIncidents] = useState<ServiceIncident[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const { data, error: functionError } = await createClient().functions.invoke('communications-action', {
        body: { action: 'STATUS_LIST' },
      })
      if (functionError) throw functionError
      if (data?.error) throw new Error(String(data.error))
      setIncidents(Array.isArray(data?.incidents) ? data.incidents as ServiceIncident[] : [])
    } catch {
      setError('Drapeon could not load service status. Your account and orders are unchanged.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const active = useMemo(() => incidents.filter((incident) => incident.status !== 'RESOLVED'), [incidents])
  const resolved = useMemo(() => incidents.filter((incident) => incident.status === 'RESOLVED').slice(0, 8), [incidents])

  if (loading) {
    return (
      <div className="flex min-h-52 items-center justify-center rounded-lg border border-ink/6 bg-white/80">
        <RefreshCw aria-hidden="true" className="size-5 animate-spin text-needle" />
        <span className="ml-3 text-sm text-ink/58">Checking Drapeon services…</span>
      </div>
    )
  }

  return (
    <div className="grid gap-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-sm leading-7 text-ink/58">Current availability and recent recovery updates across Drapeon.</p>
        <Button variant="outline" disabled={refreshing} onClick={() => void load(true)} className="self-start sm:self-auto">
          <RefreshCw aria-hidden="true" className={`mr-2 size-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh status
        </Button>
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-rust/25 bg-white/90 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-rust" />
            <div>
              <h2 className="text-xl text-ink">Status unavailable</h2>
              <p className="mt-2 text-sm leading-7 text-ink/64">{error}</p>
              <Button className="mt-5" onClick={() => void load()}>Try again</Button>
            </div>
          </div>
        </div>
      ) : active.length === 0 ? (
        <div className="flex items-start gap-4 rounded-lg border border-needle/15 bg-white/90 p-6 shadow-sm">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-needle text-white">
            <Check aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h2 className="text-2xl text-needle">All systems operational</h2>
            <p className="mt-2 text-sm leading-7 text-ink/64">Drapeon services are working normally.</p>
          </div>
        </div>
      ) : (
        <section aria-labelledby="active-status-title">
          <p id="active-status-title" className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Active updates</p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">{active.map((incident) => <IncidentCard key={incident.id} incident={incident} />)}</div>
        </section>
      )}

      {!error && resolved.length > 0 ? (
        <section aria-labelledby="resolved-status-title">
          <p id="resolved-status-title" className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Recently resolved</p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">{resolved.map((incident) => <IncidentCard key={incident.id} incident={incident} />)}</div>
        </section>
      ) : null}
    </div>
  )
}
