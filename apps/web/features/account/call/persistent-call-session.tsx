'use client'

import Link from 'next/link'
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { Maximize2, PhoneOff } from 'lucide-react'
import type { AccountSurface } from '../surface-contract'

export type ActiveWebCall = {
  roomUrl: string
  orderId: string
  title: string
  callKind: 'consultation' | 'ready-made'
  callType: 'audio' | 'video'
}

type PersistentCallSessionValue = {
  activeCall: ActiveWebCall | null
  startCall: (call: ActiveWebCall) => void
  endCall: () => void
}

const PersistentCallSessionContext = createContext<PersistentCallSessionValue | null>(null)

export function usePersistentCallSession() {
  const value = useContext(PersistentCallSessionContext)
  if (!value) throw new Error('Persistent call session is unavailable outside the account workspace.')
  return value
}

export function PersistentCallSessionProvider({
  surface,
  collapsed,
  children,
}: {
  surface: AccountSurface
  collapsed: boolean
  children: ReactNode
}) {
  const [activeCall, setActiveCall] = useState<ActiveWebCall | null>(null)
  const value = useMemo<PersistentCallSessionValue>(() => ({
    activeCall,
    startCall: setActiveCall,
    endCall: () => setActiveCall(null),
  }), [activeCall])
  const focused = surface === 'call'
  const returnHref = activeCall
    ? {
        pathname: '/account/call-join' as const,
        query: {
          orderId: activeCall.orderId,
          callKind: activeCall.callKind,
          callType: activeCall.callType,
        },
      }
    : { pathname: '/account/messages' as const }

  return (
    <PersistentCallSessionContext.Provider value={value}>
      {children}
      {activeCall ? (
        <section
          aria-label={focused ? 'Active call' : 'Active call mini player'}
          className={
            focused
              ? `account-active-call account-active-call--focused ${collapsed ? 'account-active-call--collapsed' : ''}`
              : 'account-active-call account-active-call--floating'
          }
        >
          {!focused ? (
            <div className="flex h-11 items-center justify-between gap-3 border-b border-white/10 px-3 text-white">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold">{activeCall.title}</p>
                <p className="text-[0.65rem] text-white/55">Call continues while you browse</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Link
                  href={returnHref}
                  title="Return to call"
                  className="grid size-8 place-items-center rounded-full bg-white/10 transition hover:bg-white/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                  <Maximize2 className="size-4" aria-hidden="true" />
                  <span className="sr-only">Return to call</span>
                </Link>
                <button
                  type="button"
                  title="End call"
                  onClick={() => setActiveCall(null)}
                  className="grid size-8 place-items-center rounded-full bg-rust text-white transition hover:bg-rust/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                  <PhoneOff className="size-4" aria-hidden="true" />
                  <span className="sr-only">End call</span>
                </button>
              </div>
            </div>
          ) : null}
          <iframe
            title={`${activeCall.title} call`}
            src={activeCall.roomUrl}
            allow="camera; microphone; fullscreen; display-capture; autoplay"
            className={`block w-full border-0 bg-[#1f2e3f] ${focused ? 'h-full' : 'h-52'}`}
          />
        </section>
      ) : null}
    </PersistentCallSessionContext.Provider>
  )
}
