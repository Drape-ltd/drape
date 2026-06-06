import type { Metadata } from 'next'
import type { JSX } from 'react'
import { AccountAppSurface } from '../../../components/account-app-surface'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Work queue',
  description: 'Review Drapeon tailor orders, payment state, production stages, and next actions.',
  path: '/account/work',
})

export default function AccountWorkPage(): JSX.Element {
  return <AccountAppSurface surface="work" />
}
