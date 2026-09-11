'use client'

import { ArrowRight, Search, ShieldCheck } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { OPS_SERVICE_CATALOGUE, type OpsServiceQueue } from '../lib/service-catalogue'

const queueLabels: Readonly<Record<OpsServiceQueue | 'all', string>> = {
  all: 'All queues',
  support: 'Support',
  privacy: 'Privacy',
  trust: 'Trust',
  money: 'Money Desk',
  delivery: 'Delivery',
  reliability: 'Reliability',
  operations: 'Operations',
}

export function OpsServiceCatalogue() {
  const [query, setQuery] = useState('')
  const [queue, setQueue] = useState<OpsServiceQueue | 'all'>('all')
  const services = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return OPS_SERVICE_CATALOGUE.filter((service) => {
      if (queue !== 'all' && !service.queues.includes(queue)) return false
      if (!normalized) return true
      return [service.label, service.records, service.terminalProof, service.authority, ...service.caseTypes, ...service.owners, ...service.queues]
        .join(' ')
        .toLowerCase()
        .includes(normalized)
    })
  }, [query, queue])

  return <section className="ops-section-block" id="service-catalogue" aria-labelledby="service-catalogue-title">
    <div className="ops-section-head">
      <div><p className="ops-action-label">No ad-hoc handling</p><h2 id="service-catalogue-title">Service ownership catalogue</h2></div>
      <span className="ops-muted">{OPS_SERVICE_CATALOGUE.length} launch workflows mapped</span>
    </div>
    <div className="ops-service-toolbar" role="search">
      <label className="ops-service-search"><span>Find a service or record</span><span className="ops-service-control"><Search size={15} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Refund, onboarding, Vision…" /></span></label>
      <label className="ops-service-filter"><span>Queue</span><select value={queue} onChange={(event) => setQueue(event.target.value as OpsServiceQueue | 'all')}>{Object.entries(queueLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <output className="ops-service-count" aria-live="polite">{services.length} matching workflow{services.length === 1 ? '' : 's'}</output>
    </div>
    {services.length ? <div className="ops-service-list">{services.map((service) => <article className="ops-service-row" key={service.key}>
      <div className="ops-service-identity"><span className="ops-provider-icon"><ShieldCheck size={15} aria-hidden="true" /></span><div><h3>{service.label}</h3><p>{service.queues.map((entry) => queueLabels[entry]).join(' + ')} · {service.owners.join(' + ')}</p></div></div>
      <dl><div><dt>Authoritative records</dt><dd>{service.records}</dd></div><div><dt>Action authority</dt><dd>{service.authority}</dd></div><div><dt>Done means</dt><dd>{service.terminalProof}</dd></div></dl>
      <div className="ops-service-actions"><details className="ops-service-policy"><summary>Case types & runbooks</summary><div><span>{service.caseTypes.join(' · ')}</span><span>Runbooks: {service.runbooks.map((entry) => queueLabels[entry]).join(' + ')}</span></div></details><Link className="ops-service-link" href={service.href as Route}>Open workspace <ArrowRight size={14} aria-hidden="true" /></Link></div>
    </article>)}</div> : <div className="ops-empty"><Search size={20} /><h2>No mapped workflow matches</h2><p>Try a broader service name or clear the queue filter. Do not create an ad-hoc process for an unmapped service.</p></div>}
  </section>
}
