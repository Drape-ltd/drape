import { ArrowLeft, ShieldX } from 'lucide-react'
import Link from 'next/link'

export function OpsPermissionRestriction({ area }: { area: string }) {
  return (
    <section className="ops-phone-restriction" role="status">
      <span className="ops-state-icon"><ShieldX aria-hidden="true" /></span>
      <div>
        <p className="ops-kicker">Role-scoped authority</p>
        <h1>Your current workforce role cannot open {area}.</h1>
        <p>The route was denied before its operational projection loaded. Ask an administrator to review the named principal only when this area is required for assigned work.</p>
        <div className="ops-state-actions">
          <Link className="ops-button ops-button-primary" href="/ops/my-work"><ArrowLeft size={14} aria-hidden="true" />Return to My Work</Link>
          <Link className="ops-button" href="/ops/knowledge#authority">Review authority policy</Link>
        </div>
      </div>
    </section>
  )
}
