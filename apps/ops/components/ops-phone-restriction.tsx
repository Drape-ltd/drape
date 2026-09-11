import { ArrowLeft, MonitorUp, ShieldCheck } from 'lucide-react'
import Link from 'next/link'

export function OpsPhoneRestriction({ area }: { area: string }) {
  return (
    <section className="ops-phone-restriction" role="status">
      <span className="ops-state-icon"><MonitorUp aria-hidden="true" /></span>
      <div>
        <p className="ops-kicker">Desktop-only authority</p>
        <h1>Continue {area} on a trusted desktop.</h1>
        <p>This installed phone workspace is intentionally limited to alerts, My Work, scoped case summaries, acknowledgement, assignment, notes, escalation, incidents, and runbooks.</p>
        <div className="ops-install-security"><ShieldCheck size={15} aria-hidden="true" /><span>No sensitive record or action control was loaded on this device.</span></div>
        <div className="ops-state-actions">
          <Link className="ops-button ops-button-primary" href="/ops/my-work"><ArrowLeft size={14} aria-hidden="true" />Return to My Work</Link>
          <Link className="ops-button" href="/ops/knowledge">Open runbooks</Link>
        </div>
      </div>
    </section>
  )
}
