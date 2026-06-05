import type { Metadata } from 'next'
import type { JSX } from 'react'
import { AuthCallbackClient } from '../../../components/auth-callback-client'

export const metadata: Metadata = {
  title: 'Opening account',
  robots: {
    index: false,
    follow: false,
  },
}

export default function AuthCallbackPage(): JSX.Element {
  return <AuthCallbackClient />
}
