'use client'

import Image from 'next/image'
import { marketplaceMediaObjectPosition, type MarketplaceMedia } from '@drape/shared'

function safeUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function inferredKind(url: string): 'IMAGE' | 'VIDEO' {
  return /\.(mp4|mov|m4v|webm)(?:$|\?)/i.test(url) ? 'VIDEO' : 'IMAGE'
}

export function legacyItemMedia(
  urls: string[] | null | undefined,
  title: string
): MarketplaceMedia[] {
  return (urls ?? []).flatMap((rawUrl, index) => {
    const url = safeUrl(rawUrl)
    if (!url) return []
    return [
      {
        id: `legacy-${index}-${url}`,
        kind: inferredKind(url),
        url,
        posterUrl: null,
        width: null,
        height: null,
        focalX: 0.5,
        focalY: 0.5,
        altText: `${title}, view ${index + 1}`,
        isPrimary: index === 0,
        position: index,
      } satisfies MarketplaceMedia,
    ]
  })
}

export function MarketplaceMediaTile({
  media,
  title,
  priority = false,
  className = '',
}: {
  media: MarketplaceMedia | null
  title: string
  priority?: boolean
  className?: string
}) {
  if (!media)
    return (
      <div
        className={`h-full w-full bg-[linear-gradient(145deg,rgba(46,113,84,0.14),rgba(244,240,232,0.72))] ${className}`}
        role="img"
        aria-label={`${title} media coming soon`}
      />
    )
  const position = marketplaceMediaObjectPosition(media)
  if (media.kind === 'VIDEO') {
    return (
      <video
        src={media.url}
        poster={media.posterUrl ?? undefined}
        muted
        loop
        autoPlay
        playsInline
        preload="metadata"
        aria-label={media.altText || `${title} video`}
        className={`h-full w-full object-cover ${className}`}
        style={{ objectPosition: position }}
      />
    )
  }
  return (
    <Image
      src={media.url}
      alt={media.altText || title}
      fill
      priority={priority}
      sizes="(min-width:1440px) 22vw,(min-width:1024px) 28vw,(min-width:640px) 45vw,92vw"
      unoptimized
      className={`object-cover ${className}`}
      style={{ objectPosition: position }}
    />
  )
}
