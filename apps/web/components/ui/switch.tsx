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
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-ink/16 p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drape-green/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        checked && 'bg-drape-green',
        className,
      )}
    >
      <span className={cn('block size-5 rounded-full bg-white shadow-sm transition-transform', checked && 'translate-x-5')} />
    </button>
  )
}
