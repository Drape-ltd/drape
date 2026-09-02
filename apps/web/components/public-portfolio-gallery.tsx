'use client'

import Image from 'next/image'
import { ChevronLeft, ChevronRight, Expand, Play, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

export type PublicPortfolioMedia = {
  id: string
  source: string
  posterSource: string | null
  kind: 'image' | 'video'
  focalX: number
  focalY: number
  altText: string | null
}

type PublicPortfolioGalleryProps = {
  items: PublicPortfolioMedia[]
  makerName: string
}

export function PublicPortfolioGallery({ items, makerName }: PublicPortfolioGalleryProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const triggerRefs = useRef<Array<HTMLButtonElement | null>>([])
  const openedFromIndexRef = useRef<number | null>(null)
  const close = useCallback(() => {
    setActiveIndex(null)
    window.requestAnimationFrame(() => {
      const triggerIndex = openedFromIndexRef.current
      if (triggerIndex !== null) triggerRefs.current[triggerIndex]?.focus()
    })
  }, [])
  const showPrevious = useCallback(() => {
    setActiveIndex((current) => current === null ? null : (current - 1 + items.length) % items.length)
  }, [items.length])
  const showNext = useCallback(() => {
    setActiveIndex((current) => current === null ? null : (current + 1) % items.length)
  }, [items.length])

  useEffect(() => {
    if (activeIndex === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
      if (event.key === 'ArrowLeft' && items.length > 1) showPrevious()
      if (event.key === 'ArrowRight' && items.length > 1) showNext()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    closeButtonRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [activeIndex, close, items.length, showNext, showPrevious])

  const activeItem = activeIndex === null ? null : items[activeIndex]

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            ref={(node) => { triggerRefs.current[index] = node }}
            onClick={() => {
              openedFromIndexRef.current = index
              setActiveIndex(index)
            }}
            className="group relative aspect-[4/5] cursor-pointer overflow-hidden rounded-[10px] bg-[#e7dfd0] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle"
            aria-label={`Open ${makerName} portfolio ${item.kind} ${index + 1} of ${items.length}`}
          >
            {item.kind === 'video' ? (
              <video src={item.source} poster={item.posterSource ?? undefined} className="h-full w-full object-cover" style={{ objectPosition: `${item.focalX * 100}% ${item.focalY * 100}%` }} muted playsInline preload="metadata" />
            ) : (
              <Image src={item.source} alt={item.altText ?? `${makerName} portfolio work ${index + 1}`} fill sizes="(min-width:1280px) 20vw,(min-width:640px) 33vw,50vw" className="object-cover transition duration-300 group-hover:scale-[1.015] motion-reduce:transition-none" style={{ objectPosition: `${item.focalX * 100}% ${item.focalY * 100}%` }} unoptimized />
            )}
            <span className="absolute bottom-2 right-2 inline-flex size-8 items-center justify-center rounded-full bg-black/68 text-white opacity-90 backdrop-blur-sm transition group-hover:bg-black/82">
              {item.kind === 'video' ? <Play aria-hidden="true" size={14} fill="currentColor" /> : <Expand aria-hidden="true" size={14} />}
            </span>
          </button>
        ))}
      </div>

      {activeItem ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/92 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label={`${makerName} portfolio viewer`}>
          <button ref={closeButtonRef} type="button" onClick={close} className="absolute right-4 top-4 z-10 inline-flex size-11 items-center justify-center rounded-full bg-white/12 text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" aria-label="Close portfolio viewer">
            <X aria-hidden="true" size={21} />
          </button>

          {items.length > 1 ? (
            <button type="button" onClick={showPrevious} className="absolute left-3 top-1/2 z-10 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/12 text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white sm:left-6" aria-label="Previous portfolio item">
              <ChevronLeft aria-hidden="true" size={23} />
            </button>
          ) : null}

          <div className="relative flex h-[84vh] w-full max-w-6xl items-center justify-center">
            {activeItem.kind === 'video' ? (
              <video key={activeItem.id} src={activeItem.source} poster={activeItem.posterSource ?? undefined} className="max-h-full max-w-full" controls autoPlay playsInline preload="metadata" />
            ) : (
              <Image key={activeItem.id} src={activeItem.source} alt={activeItem.altText ?? `${makerName} portfolio work ${(activeIndex ?? 0) + 1}`} fill sizes="100vw" className="object-contain" unoptimized priority />
            )}
          </div>

          {items.length > 1 ? (
            <button type="button" onClick={showNext} className="absolute right-3 top-1/2 z-10 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/12 text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white sm:right-6" aria-label="Next portfolio item">
              <ChevronRight aria-hidden="true" size={23} />
            </button>
          ) : null}

          <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/68">{(activeIndex ?? 0) + 1} / {items.length}</p>
        </div>
      ) : null}
    </>
  )
}
