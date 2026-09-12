import * as React from 'react'
import { cn } from '../../lib/cn'

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  'aria-label': ariaLabel,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  'aria-label': string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-ink/30 bg-ink/35 p-0.5 shadow-inner transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drape-green/50 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        checked && 'border-drape-green bg-drape-green',
        className,
      )}
    >
      <span className={cn('block size-5 rounded-full bg-white shadow-md ring-1 ring-black/10 transition-transform', checked && 'translate-x-5')} />
    </button>
  )
}
