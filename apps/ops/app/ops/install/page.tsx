import { OpsInstallGuide } from '../../../components/ops-install-guide'
import { PageHead } from '../../../components/page-head'

export const dynamic = 'force-dynamic'

export default function OpsInstallPage() {
  return (
    <>
      <PageHead eyebrow="Access / Mobile app" title="Install Drapeon Ops" description="Put the restricted control plane on a staff phone without distributing a second native binary or weakening workforce access." />
      <OpsInstallGuide />
    </>
  )
}
