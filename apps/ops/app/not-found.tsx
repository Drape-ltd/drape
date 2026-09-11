'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function NotFound() {
  const router = useRouter()

  return <main className="ops-lock" id="ops-content"><section className="ops-lock-card"><p className="ops-kicker">Recoverable route</p><h1>This Ops destination is unavailable.</h1><p>It may be retired, mistyped, or outside the current workforce role. No broad dashboard fallback was loaded.</p><div className="ops-state-actions"><button className="ops-button" type="button" onClick={() => router.back()}>Go back</button><Link className="ops-button ops-button-primary" href="/ops/my-work">Open My Work</Link><Link className="ops-button" href="/ops/knowledge">Open runbooks</Link></div></section></main>
}
