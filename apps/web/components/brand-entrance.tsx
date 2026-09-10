'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

const publicRoutes = new Set(['/', '/about', '/explore', '/how-it-works', '/tailors', '/trust', '/vision'])
const sessionKey = 'drapeon-brand-entrance-seen'

export function BrandEntrance(): React.JSX.Element | null {
  const pathname = usePathname()
  const [visible, setVisible] = useState(true)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const isMobile = window.matchMedia('(max-width: 767px)').matches
    const shouldShow = isMobile && publicRoutes.has(pathname) && sessionStorage.getItem(sessionKey) !== '1'

    if (!shouldShow) {
      const hideTimer = window.setTimeout(() => setVisible(false), 0)
      return () => window.clearTimeout(hideTimer)
    }

    sessionStorage.setItem(sessionKey, '1')
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const leaveTimer = window.setTimeout(() => setLeaving(true), reduceMotion ? 160 : 980)
    const removeTimer = window.setTimeout(() => {
      setVisible(false)
      document.body.style.overflow = previousOverflow
    }, reduceMotion ? 220 : 1300)

    return () => {
      window.clearTimeout(leaveTimer)
      window.clearTimeout(removeTimer)
      document.body.style.overflow = previousOverflow
    }
  }, [pathname])

  if (!visible || !publicRoutes.has(pathname)) return null

  return (
    <div
      role="status"
      aria-label="Opening Drapeon"
      className={`brand-entrance fixed inset-0 z-[200] grid place-items-center overflow-hidden bg-[#0f5a41] text-white md:hidden ${leaving ? 'brand-entrance--leaving' : ''}`}
    >
      <div aria-hidden="true" className="brand-entrance__grain absolute inset-0" />
      <div aria-hidden="true" className="brand-entrance__thread absolute inset-x-0 top-1/2 h-px bg-white/24" />
      <div className="relative flex flex-col items-center">
        <div className="brand-entrance__mark relative grid size-28 place-items-center overflow-hidden rounded-[30px] border border-white/22 bg-[#0b4f39] shadow-[0_28px_80px_rgba(4,24,17,0.34)]">
          <Image src="/icon-192.png" alt="" width={112} height={112} className="size-full" />
        </div>
        <p className="brand-entrance__word mt-6 text-[11px] font-semibold uppercase tracking-[0.34em] text-white/78">Drapeon</p>
        <p className="brand-entrance__sub mt-2 text-xs text-white/52">Made with clarity.</p>
      </div>
    </div>
  )
}
