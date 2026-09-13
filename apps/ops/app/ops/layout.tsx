import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { OpsShell } from '../../components/ops-shell'
import { getOpsAccessMode, getOpsSession } from '../../../web/lib/ops-auth'

function LocalIdentityButtons() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 18 }}>
      <form action="/ops/local-unlock" method="post">
        <input name="identity" type="hidden" value="reviewer" />
        <button className="ops-button" type="submit">Continue as Ops reviewer</button>
      </form>
      <form action="/ops/local-unlock" method="post">
        <input name="identity" type="hidden" value="founder" />
        <button className="ops-button ops-button-primary" type="submit">Continue as founder approver</button>
      </form>
    </div>
  )
}

function LockScreen({ mode, signedOut }: { mode: string; signedOut: boolean }) {
  const production = process.env.DRAPE_OPS_ENV === 'production' || process.env.NODE_ENV === 'production'
  if (signedOut && !production) {
    return (
      <main className="ops-lock" id="ops-content">
        <section className="ops-lock-card">
          <p className="ops-kicker">Drapeon Ops</p>
          <h1>You’re signed out.</h1>
          <p>Your workforce session is closed. Sign back in when you’re ready to continue.</p>
          <div className="ops-lock-note">
            Operational data stays hidden until you open a new authenticated session.
          </div>
          <LocalIdentityButtons />
        </section>
      </main>
    )
  }

  return (
    <main className="ops-lock" id="ops-content">
      <section className="ops-lock-card">
        <p className="ops-kicker">Restricted workforce system</p>
        <h1>{production ? 'Continue through Drapeon Access.' : 'Local Ops is locked.'}</h1>
        <p>
          {production
            ? 'Cloudflare Access must present a valid named workforce identity before this application loads any operational data.'
            : 'Establish the named development dry-run identity on this machine, then continue. Production never accepts this bridge.'}
        </p>
        <div className="ops-lock-note">
          <strong>Fail-closed state</strong><br />
          Access mode: {mode}. No customer, tailor, payment, evidence, or incident data was requested.
        </div>
        {!production ? <LocalIdentityButtons /> : null}
      </section>
    </main>
  )
}

export default async function OpsLayout({ children }: { children: ReactNode }) {
  const mode = getOpsAccessMode()
  const session = await getOpsSession()
  if (!session?.allowed || !session.email) {
    const requestHeaders = await headers()
    return <LockScreen mode={mode} signedOut={requestHeaders.get('x-ops-notice') === 'ops-signed-out'} />
  }

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
