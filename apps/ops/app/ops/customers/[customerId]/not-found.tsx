import Link from 'next/link'

export default function CustomerNotFound() {
  return <section className="ops-route-state" role="status">
    <div>
      <p className="ops-kicker">Customer record unavailable</p>
      <h1>This customer was not found or is no longer permitted.</h1>
      <p>The link may be mistyped, the account may have moved into a retained privacy record, or this workforce role may no longer have access. No broad customer list or cached record was substituted.</p>
      <div className="ops-state-actions">
        <Link className="ops-button ops-button-primary" href="/ops/customers">Back to customers</Link>
        <Link className="ops-button" href="/ops/my-work">Open My Work</Link>
      </div>
    </div>
  </section>
}
