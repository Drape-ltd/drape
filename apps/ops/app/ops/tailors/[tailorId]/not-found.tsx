import Link from 'next/link'

export default function TailorNotFound() {
  return <section className="ops-route-state" role="status">
    <div>
      <p className="ops-kicker">Tailor record unavailable</p>
      <h1>This tailor was not found or is no longer permitted.</h1>
      <p>The link may be mistyped, the profile may have been removed, or this workforce role may no longer have access. No public profile, evidence, or cached operational state was substituted.</p>
      <div className="ops-state-actions">
        <Link className="ops-button ops-button-primary" href="/ops/tailors">Back to tailors</Link>
        <Link className="ops-button" href="/ops/my-work">Open My Work</Link>
      </div>
    </div>
  </section>
}
