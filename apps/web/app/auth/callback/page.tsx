import type { Metadata } from 'next'
import { AuthCallbackClient } from '../../../components/auth-callback-client'

export const metadata: Metadata = {
  title: 'Opening account',
  robots: {
    index: false,
    follow: false,
  },
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function AuthCallbackPage(): React.JSX.Element {
  return <AuthCallbackClient />
}
