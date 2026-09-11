import type { Metadata } from 'next'
import { OpsInstallGuide } from '../../components/ops-install-guide'

export const metadata: Metadata = {
  title: 'Install Drapeon Ops',
  description: 'Install the restricted Drapeon workforce application on an authorized staff device.',
}

export default function InstallPage() {
  return (
    <main className="ops-install-page" id="ops-content">
      <header className="ops-install-page-head">
        <span className="ops-brand-mark" aria-hidden="true">D</span>
        <div><p className="ops-kicker">Restricted workforce application</p><h1>Put Drapeon Ops on this device.</h1><p>Install the control plane like an app, then sign in with an approved staff identity whenever you launch it.</p></div>
      </header>
      <OpsInstallGuide />
      <p className="ops-install-footnote">Installation does not grant access. Lost or retired devices can be revoked centrally without changing this QR code.</p>
    </main>
  )
}
