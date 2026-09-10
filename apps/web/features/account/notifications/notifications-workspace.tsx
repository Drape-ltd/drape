'use client'

import { CommunicationCenter } from '../../../components/communication-center'
import { AccountRouteRuntime } from '../account-route-runtime'

export function NotificationsWorkspace() {
  return (
    <AccountRouteRuntime surface="notifications">
      {({ session }) => (
        <section data-route-content-ready="true" className="app-surface p-5 sm:p-6">
          <CommunicationCenter session={session} mode="inbox" inboxLimit={50} />
        </section>
      )}
    </AccountRouteRuntime>
  )
}
