import * as React from 'react'
import { cn } from '../../lib/cn'

export function MetricCard({
  label,
  value,
  hint,
  icon,
  className,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0 rounded-[8px] border border-ui-border bg-white p-4 shadow-sm', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-ui-subtle">{label}</p>
          <div className="mt-1 truncate text-2xl font-semibold text-ink">{value}</div>
        </div>
        {icon ? <div className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-ui-muted text-drape-green">{icon}</div> : null}
      </div>
      {hint ? <div className="mt-2 text-xs leading-5 text-ui-subtle">{hint}</div> : null}
    </div>
  )
}
