import * as React from 'react'
import { cn } from '../../lib/cn'

export interface SurfaceProps extends React.HTMLAttributes<HTMLElement> {
  as?: 'section' | 'article' | 'div'
}

export function Surface({ as: Component = 'section', className, ...props }: SurfaceProps) {
  return (
    <Component
      className={cn('rounded-[8px] border border-ui-border bg-white shadow-sm', className)}
      {...props}
    />
  )
}

export function SurfaceHeader({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: string
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-3 border-b border-ui-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="text-xs font-semibold uppercase text-drape-green">{eyebrow}</p> : null}
        <h2 className="mt-0.5 text-xl font-semibold text-ink">{title}</h2>
        {description ? <div className="mt-1 max-w-3xl text-sm leading-6 text-ui-subtle">{description}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
