import type { Metadata } from 'next'
import { PublicSiteHeader } from '../../components/public-site-header'
import { SiteFooter } from '../../components/site-footer'
import { TailorDirectory, type TailorDirectoryParams } from '../../components/tailor-directory'
import { buildMetadata } from '../../lib/metadata'
import { getApprovedPublicTailors } from '../../lib/public-marketplace'

export const metadata: Metadata = buildMetadata({
  title: 'Explore independent tailors',
  description:
    'Browse approved Drapeon tailor profiles and find the right fit for your next project.',
  path: '/explore',
})

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<TailorDirectoryParams>
}) {
  const params = await searchParams
  const page = Math.max(1, Math.min(250, Number.parseInt(params.page ?? '1', 10) || 1))
  const offset = (page - 1) * 40
  const query = params.q?.trim() ?? ''
  const [tailors, nextPage] = await Promise.all([
    getApprovedPublicTailors(40, offset, query),
    getApprovedPublicTailors(1, offset + 40, query),
  ])
  return (
    <main className="min-h-screen bg-[#f4f0e8] text-ink">
      <div className="mx-auto max-w-[92rem] px-4 pt-4 sm:px-6">
        <PublicSiteHeader />
      </div>
      <section className="mx-auto max-w-[92rem] px-5 pb-16 pt-9 sm:px-8 lg:pb-20">
        <div className="mb-6 border-b border-ink/10 pb-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-needle">
            Independent tailors
          </p>
          <h1 className="mt-2 max-w-3xl text-4xl leading-[1.02] sm:text-5xl">
            Find the right tailor.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink/62">
            Compare approved portfolios, specialties, availability, and custom or ready-made
            options.
          </p>
        </div>
        <TailorDirectory
          tailors={tailors}
          params={params}
          basePath="/explore"
          profileBasePath="/tailors"
          pagination={{ page, hasNextPage: nextPage.length > 0 }}
        />
      </section>
      <div className="mx-auto max-w-[92rem] px-5 sm:px-8">
        <SiteFooter />
      </div>
    </main>
  )
}
