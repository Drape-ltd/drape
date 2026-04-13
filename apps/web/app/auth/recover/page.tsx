import type { Metadata } from 'next'
import { RecoveryBridge } from './recovery-bridge'

export const metadata: Metadata = {
  title: 'Password recovery',
  robots: {
    index: false,
    follow: false,
  },
}

// Keep the return type loose so Next/OpenNext do not disagree over React element types.
export default function RecoveryBridgePage(): any {
  return <RecoveryBridge />
}
