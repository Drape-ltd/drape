import type { ReactNode } from 'react'

export function PageHead({ eyebrow, title, description, meta }: { eyebrow: string; title: string; description: string; meta?: ReactNode }) {
  return (
    <header className="ops-page-head">
      <div>
        <p className="ops-kicker">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {meta ? <div className="ops-freshness">{meta}</div> : null}
    </header>
  )
}
