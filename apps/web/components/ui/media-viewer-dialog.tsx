'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { Button } from './button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog'

export function MediaViewerDialog({
  children,
  description,
  initialIndex = 0,
  items,
  kind,
  src,
  title,
}: {
  children: React.ReactNode
  description?: string
  initialIndex?: number
  items?: Array<{ kind: 'image' | 'video'; src: string; title?: string }>
  kind: 'image' | 'video'
  src: string
  title: string
}): React.JSX.Element {
  const gallery = items?.length ? items : [{ kind, src, title }]
  const boundedInitialIndex = Math.min(Math.max(initialIndex, 0), gallery.length - 1)
  const [activeIndex, setActiveIndex] = React.useState(boundedInitialIndex)
  const activeItem = gallery[activeIndex] ?? gallery[0]!

  function move(direction: -1 | 1) {
    setActiveIndex((current) => (current + direction + gallery.length) % gallery.length)
  }

  return (
    <Dialog onOpenChange={(open) => { if (open) setActiveIndex(boundedInitialIndex) }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="max-h-[calc(100vh-1rem)] max-w-6xl bg-[#101210] p-3 text-white sm:p-4"
        onKeyDown={(event) => {
          if (gallery.length <= 1) return
          if (event.key === 'ArrowLeft') move(-1)
          if (event.key === 'ArrowRight') move(1)
        }}
      >
        <DialogHeader className="px-1 text-left">
          <DialogTitle className="text-white">{activeItem.title ?? title}</DialogTitle>
          <DialogDescription className="text-white/64">{description ?? 'Shared inside this protected order conversation.'}</DialogDescription>
        </DialogHeader>
        <div className="relative grid min-h-0 place-items-center overflow-hidden rounded-[8px] bg-black">
          {activeItem.kind === 'video' ? (
            <video key={activeItem.src} src={activeItem.src} controls playsInline preload="metadata" className="max-h-[72vh] w-full object-contain" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={activeItem.src} alt={activeItem.title ?? title} className="max-h-[72vh] w-full object-contain" />
          )}
          {gallery.length > 1 ? (
            <>
              <Button type="button" variant="secondary" size="icon" aria-label="Previous attachment" onClick={() => move(-1)} className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 shadow-lg">
                <ChevronLeft />
              </Button>
              <Button type="button" variant="secondary" size="icon" aria-label="Next attachment" onClick={() => move(1)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 shadow-lg">
                <ChevronRight />
              </Button>
              <span className="absolute bottom-3 rounded-full bg-black/72 px-3 py-1 text-xs font-semibold text-white">
                {activeIndex + 1} of {gallery.length}
              </span>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button asChild variant="secondary" size="sm">
            <a href={activeItem.src} target="_blank" rel="noreferrer"><ExternalLink /> Open original</a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
