import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Explore',
  description: 'Browse live Drapeon tailors and ready-made pieces from your web account.',
  path: '/account/explore',
})

export default function AccountExplorePage(): never {
  redirect('/explore')
}
