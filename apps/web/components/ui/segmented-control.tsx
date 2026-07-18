import * as React from 'react'
import { cn } from '../../lib/cn'

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string; count?: number }>
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('inline-flex min-w-0 items-center gap-1 rounded-[8px] border border-ui-border bg-ui-muted p-1', className)}
    >
      {options.map((option) => {
        const active = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-[6px] px-3 text-xs font-semibold transition-colors',
              active ? 'bg-white text-ink shadow-sm' : 'text-ui-subtle hover:text-ink',
            )}
          >
            <span className="truncate">{option.label}</span>
            {typeof option.count === 'number' ? (
              <span className={cn('text-[0.68rem] tabular-nums', active ? 'text-drape-green' : 'text-ui-subtle')}>{option.count}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
