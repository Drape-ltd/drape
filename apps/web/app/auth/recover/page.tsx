import type { Metadata } from 'next'
import { RecoveryBridge } from './recovery-bridge'

export const metadata: Metadata = {
  title: 'Password recovery',
  robots: {
    index: false,
    follow: false,
  },
}

export default function RecoveryBridgePage(): JSX.Element {
  return <RecoveryBridge />
}
