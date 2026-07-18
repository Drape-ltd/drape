'use client'

import * as React from 'react'
import { ExternalLink } from 'lucide-react'
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
  kind,
  src,
  title,
}: {
  children: React.ReactNode
  description?: string
  kind: 'image' | 'video'
  src: string
  title: string
}): React.JSX.Element {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-1rem)] max-w-6xl bg-[#101210] p-3 text-white sm:p-4">
        <DialogHeader className="px-1 text-left">
          <DialogTitle className="text-white">{title}</DialogTitle>
          <DialogDescription className="text-white/64">{description ?? 'Shared inside this protected order conversation.'}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 place-items-center overflow-hidden rounded-[8px] bg-black">
          {kind === 'video' ? (
            <video src={src} controls playsInline preload="metadata" className="max-h-[72vh] w-full object-contain" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={title} className="max-h-[72vh] w-full object-contain" />
          )}
        </div>
        <DialogFooter>
          <Button asChild variant="secondary" size="sm">
            <a href={src} target="_blank" rel="noreferrer"><ExternalLink /> Open original</a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
