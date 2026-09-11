import type { ReactNode } from 'react'
import { OpsShell } from '../../components/ops-shell'
import { getOpsAccessMode, getOpsSession } from '../../../web/lib/ops-auth'

function LockScreen({ mode }: { mode: string }) {
  const production = process.env.DRAPE_OPS_ENV === 'production' || process.env.NODE_ENV === 'production'
  return (
    <main className="ops-lock" id="ops-content">
      <section className="ops-lock-card">
        <p className="ops-kicker">Restricted workforce system</p>
        <h1>{production ? 'Continue through Drapeon Access.' : 'Local Ops is locked.'}</h1>
        <p>
          {production
            ? 'Cloudflare Access must present a valid named workforce identity before this application loads any operational data.'
            : 'Use the legacy local unlock once to establish the named development dry-run identity, then return here. Production never accepts that bridge.'}
        </p>
        <div className="ops-lock-note">
          <strong>Fail-closed state</strong><br />
          Access mode: {mode}. No customer, tailor, payment, evidence, or incident data was requested.
        </div>
        {!production ? <a className="ops-button ops-button-primary" style={{ marginTop: 18 }} href="http://localhost:3004/ops">Open local workforce unlock</a> : null}
      </section>
    </main>
  )
}

export default async function OpsLayout({ children }: { children: ReactNode }) {
  const mode = getOpsAccessMode()
  const session = await getOpsSession()
  if (!session?.allowed || !session.email) return <LockScreen mode={mode} />

  const environment = process.env.DRAPE_OPS_ENV === 'production' || process.env.DRAPE_WEB_ENV === 'production'
    ? 'production'
    : 'development'

  return <OpsShell
    email={session.email}
    role={session.role}
    environment={environment}
    accessKeyState={session.accessKeyState}
    accessKeyAgeMs={session.accessKeyAgeMs}
  >{children}</OpsShell>
}
