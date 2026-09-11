import Link from 'next/link'

export default function CaseNotFound() {
  return <div className="ops-empty"><h2>Case not found or no longer permitted</h2><p>The record may have moved, closed, or become unavailable to this role. Return to My Work for the current authoritative queue.</p><Link className="ops-button ops-button-primary" style={{ marginTop: 16 }} href="/ops/my-work">Return to My Work</Link></div>
}
