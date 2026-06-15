import type { JSX } from 'react'

type PreviewVariant = 'explore' | 'vision' | 'timeline' | 'tailor' | 'privacy' | 'contact' | 'trust' | 'account'

const previewContent: Record<PreviewVariant, {
  eyebrow: string
  title: string
  rows: Array<string>
  action: string
}> = {
  explore: {
    eyebrow: 'Explore',
    title: 'Find your tailor',
    rows: ['Verified • Lagos', 'Agbada, bridal, ready-made', '4.9 rating • Available'],
    action: 'Start custom order',
  },
  vision: {
    eyebrow: 'Drape Vision',
    title: 'Review measurements',
    rows: ['Camera-guided scan', 'Retake available', 'Manual fallback ready'],
    action: 'Use for order',
  },
  timeline: {
    eyebrow: 'Order',
    title: 'Production timeline',
    rows: ['Designing complete', 'Sourcing approved', 'Cutting next'],
    action: 'View update',
  },
  tailor: {
    eyebrow: 'Tailor',
    title: 'Today’s cockpit',
    rows: ['2 active orders', '1 quote awaiting reply', 'Payout pending release'],
    action: 'Open orders',
  },
  privacy: {
    eyebrow: 'Privacy',
    title: 'User controls',
    rows: ['Review before saving', 'No raw video by default', 'Delete account route'],
    action: 'Manage data',
  },
  contact: {
    eyebrow: 'Support',
    title: 'Route the issue',
    rows: ['Customer support', 'Tailor support', 'Privacy and security'],
    action: 'Email team',
  },
  trust: {
    eyebrow: 'Trust',
    title: 'Protected order',
    rows: ['Payment tracked', 'Messages attached', 'Handoff confirmed'],
    action: 'Open timeline',
  },
  account: {
    eyebrow: 'Account',
    title: 'Choose your side',
    rows: ['Customer orders', 'Tailor workspace', 'Protected ops console'],
    action: 'Open access path',
  },
}

export function AppSurfacePreview({ variant = 'explore' }: { variant?: PreviewVariant }): JSX.Element {
  const content = previewContent[variant]

  return (
    <div className="w-full max-w-[22rem] min-w-0 rounded-[1.6rem] border border-ink/8 bg-white/84 p-4 shadow-[0_18px_60px_rgba(22,28,24,0.06)] sm:max-w-none">
      <div className="min-w-0 rounded-[1.2rem] bg-ink p-5 text-white">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/58">{content.eyebrow}</p>
          <span className="rounded-full bg-white/12 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-white/64">
            Drapeon
          </span>
        </div>
        <h3 className="mt-3 break-words text-2xl text-white sm:text-3xl">{content.title}</h3>
        <div className="mt-5 grid gap-2">
          {content.rows.map((row) => (
            <div key={row} className="flex min-w-0 items-center gap-3 rounded-[0.95rem] border border-white/10 bg-white/8 px-3 py-2 text-sm text-white/74">
              <span className="size-2 shrink-0 rounded-full bg-white/72" />
              <span className="min-w-0 break-words">{row}</span>
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-full bg-white px-4 py-2 text-center text-xs font-semibold text-ink">
          {content.action}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {['Fit', 'Order', 'Trust'].map((item) => (
          <div key={item} className="rounded-[0.9rem] border border-ink/6 bg-bone/78 px-3 py-2 text-center text-xs font-semibold text-ink/58">
            {item}
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProductSurfaceGrid(): JSX.Element {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <AppSurfaceMini variant="explore" />
      <AppSurfaceMini variant="timeline" />
      <AppSurfaceMini variant="tailor" />
    </div>
  )
}

function AppSurfaceMini({ variant }: { variant: PreviewVariant }): JSX.Element {
  const content = previewContent[variant]

  return (
    <div className="rounded-[1.35rem] border border-ink/8 bg-white p-4 shadow-sm">
      <div className="rounded-[1rem] bg-bone/80 p-4">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-needle/78">{content.eyebrow}</p>
        <h3 className="mt-2 text-2xl text-ink">{content.title}</h3>
        <div className="mt-4 grid gap-2">
          {content.rows.map((row) => (
            <div key={row} className="rounded-[0.85rem] border border-ink/6 bg-white px-3 py-2 text-sm text-ink/70">
              {row}
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-full bg-needle px-4 py-2 text-center text-xs font-semibold text-white">
          {content.action}
        </div>
      </div>
    </div>
  )
}
