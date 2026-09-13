import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { JsonLd } from '../../../components/json-ld'
import { PublicSiteHeader } from '../../../components/public-site-header'
import { SiteFooter } from '../../../components/site-footer'
import { TailorProfileView } from '../../../components/tailor-profile-view'
import { getApprovedPublicTailor } from '../../../lib/public-marketplace'
import { buildMetadata, siteUrl } from '../../../lib/metadata'

type TailorPageProps = { params: Promise<{ profileId: string }> }

export async function generateMetadata({ params }: TailorPageProps): Promise<Metadata> {
  const { profileId } = await params
  const tailor = await getApprovedPublicTailor(profileId)
  if (!tailor) return { title: 'Tailor profile | Drapeon', robots: { index: false, follow: false } }
  const specialtyText = tailor.specialties.slice(0, 3).join(', ')
  const locationText = tailor.location ? ` in ${tailor.location}` : ''
  const description = (tailor.bio ?? (
    specialtyText
      ? `Explore ${tailor.displayName}${locationText} on Drapeon. See approved portfolio work in ${specialtyText} and check custom or ready-made availability.`
      : `Explore the approved Drapeon profile and complete portfolio for ${tailor.displayName}${locationText}.`
  )).replace(/\s+/g, ' ').trim().slice(0, 180)
  const socialMedia = tailor.media.find((item) => item.kind === 'IMAGE')
  const socialImageUrl = socialMedia?.url ?? socialMedia?.posterUrl ?? tailor.avatarUrl
  return buildMetadata({
    title: `${tailor.displayName} — tailor portfolio`,
    description,
    path: `/tailors/${tailor.id}`,
    image: socialImageUrl
      ? {
          url: socialImageUrl,
          width: socialMedia?.width ?? undefined,
          height: socialMedia?.height ?? undefined,
          alt: socialMedia?.altText ?? `Portfolio work by ${tailor.displayName}`,
        }
      : null,
  })
}

export default async function PublicTailorPage({ params }: TailorPageProps) {
  const { profileId } = await params
  const tailor = await getApprovedPublicTailor(profileId)
  if (!tailor) notFound()
  const profileUrl = `${siteUrl}/tailors/${tailor.id}`
  const publicImages = Array.from(new Set([
    ...tailor.media.filter((item) => item.kind === 'IMAGE').map((item) => item.url),
    ...tailor.portfolioPhotos,
    ...(tailor.avatarUrl ? [tailor.avatarUrl] : []),
  ])).slice(0, 12)
  const serviceJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfessionalService',
    '@id': `${profileUrl}#tailor`,
    name: tailor.displayName,
    url: profileUrl,
    description: tailor.bio ?? undefined,
    image: publicImages,
    areaServed: tailor.location ?? undefined,
    knowsAbout: tailor.specialties,
    priceRange: tailor.currency && tailor.priceRangeMin != null && tailor.priceRangeMax != null
      ? `${tailor.currency} ${tailor.priceRangeMin}–${tailor.priceRangeMax}`
      : undefined,
    aggregateRating: tailor.totalReviews > 0 && tailor.averageRating > 0
      ? {
          '@type': 'AggregateRating',
          ratingValue: tailor.averageRating,
          reviewCount: tailor.totalReviews,
          bestRating: 5,
          worstRating: 1,
        }
      : undefined,
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: `${tailor.displayName} services`,
      itemListElement: [
        tailor.acceptsCustomOrders
          ? { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Custom clothing orders' } }
          : null,
        tailor.supportsReadyMade
          ? { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Ready-made clothing' } }
          : null,
      ].filter(Boolean),
    },
  }
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Drapeon', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Explore tailors', item: `${siteUrl}/explore` },
      { '@type': 'ListItem', position: 3, name: tailor.displayName, item: profileUrl },
    ],
  }
  return <main className="min-h-screen bg-[#f4f0e8] text-ink"><JsonLd data={[serviceJsonLd, breadcrumbJsonLd]} /><div className="mx-auto max-w-[92rem] px-4 pt-4 sm:px-6"><PublicSiteHeader /></div><section className="mx-auto max-w-[92rem] px-5 pb-16 pt-8 sm:px-8"><TailorProfileView tailor={tailor} /></section><div className="mx-auto max-w-[92rem] px-5 sm:px-8"><SiteFooter /></div></main>
}
