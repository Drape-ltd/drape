'use client'

import Image from 'next/image'
import { useState, type CSSProperties } from 'react'

function mediaReportPayload(source: string) {
  try {
    const url = new URL(source, window.location.origin)
    return { host: url.hostname, path: url.pathname, page: window.location.pathname }
  } catch {
    return { host: 'invalid', path: '', page: window.location.pathname }
  }
}

/**
 * Report one failed public asset per browser session. The endpoint only receives
 * host/path metadata, never a signed URL or query string.
 */
export function reportPublicMediaFailure(source: string) {
  if (typeof window === 'undefined') return
  const payload = mediaReportPayload(source)
  const key = `drapeon.media-failure:${payload.host}${payload.path}`
  try {
    if (window.sessionStorage.getItem(key)) return
    window.sessionStorage.setItem(key, '1')
  } catch {
    // Storage can be unavailable in private browsing; still attempt the report.
  }
  const body = JSON.stringify(payload)
  try {
    const blob = new Blob([body], { type: 'application/json' })
    if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon('/api/media-health', blob)) return
  } catch {
    // Fall through to a keepalive request.
  }
  void fetch('/api/media-health', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined)
}

type PublicMediaImageProps = {
  src: string
  alt: string
  className?: string
  sizes?: string
  priority?: boolean
  style?: CSSProperties
  fill?: boolean
}

export function PublicMediaImage({ src, alt, className, sizes, priority, style, fill = true }: PublicMediaImageProps) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="grid size-full place-items-center bg-[#e7dfd0] px-4 text-center text-xs font-semibold text-ink/48" role="img" aria-label={`${alt} unavailable`}>
        Media temporarily unavailable
      </div>
    )
  }
  return (
    <Image
      src={src}
      alt={alt}
      fill={fill}
      width={fill ? undefined : 640}
      height={fill ? undefined : 800}
      sizes={sizes}
      priority={priority}
      className={className}
      style={style}
      onError={() => {
        setFailed(true)
        reportPublicMediaFailure(src)
      }}
    />
  )
}

type PublicMediaVideoProps = {
  src: string
  poster?: string
  label: string
  className?: string
  style?: CSSProperties
}

export function PublicMediaVideo({ src, poster, label, className, style }: PublicMediaVideoProps) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="grid size-full place-items-center bg-[#e7dfd0] px-4 text-center text-xs font-semibold text-ink/48" role="img" aria-label={`${label} unavailable`}>
        Media temporarily unavailable
      </div>
    )
  }
  return (
    <video
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="metadata"
      className={className ?? 'size-full object-cover'}
      style={style}
      aria-label={label}
      onError={() => {
        setFailed(true)
        reportPublicMediaFailure(src)
      }}
    />
  )
}
