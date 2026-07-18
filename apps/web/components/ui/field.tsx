import * as React from 'react'
import { cn } from '../../lib/cn'

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  error?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn('grid min-w-0 gap-1.5', className)}>
      <span className="text-sm font-semibold text-ink">{label}</span>
      {children}
      {error ? <span className="text-xs leading-5 text-rust">{error}</span> : hint ? <span className="text-xs leading-5 text-ui-subtle">{hint}</span> : null}
    </label>
  )
}
