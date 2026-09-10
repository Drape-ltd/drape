import type { ReactNode } from 'react'
import { PersistentAccountRuntime } from '../../features/account/account-route-runtime'

export default function AccountLayout({ children }: { children: ReactNode }) {
  return <PersistentAccountRuntime>{children}</PersistentAccountRuntime>
}
