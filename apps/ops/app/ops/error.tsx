'use client'

import { AlertTriangle, RotateCw } from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'

export default function OpsRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[ops] route render failed', { digest: error.digest ?? 'unavailable' })
  }, [error])

  return (
    <section className="ops-route-state" role="alert">
      <span className="ops-state-icon"><AlertTriangle aria-hidden="true" /></span>
      <div>
        <p className="ops-kicker">Authoritative read unavailable</p>
        <h1>This work area could not load safely.</h1>
        <p>No fixture or cached action state was substituted. Retry the scoped read; if it still fails, use the legacy rollback surface and open a reliability case.</p>
        {error.digest ? <code>Reference {error.digest}</code> : null}
        <div className="ops-state-actions">
          <button className="ops-button ops-button-primary" type="button" onClick={reset}><RotateCw size={15} />Retry scoped read</button>
          <Link className="ops-button" href="/ops/my-work">Return to My Work</Link>
        </div>
      </div>
    </section>
  )
}
