import * as React from 'react'
import { cn } from '../../lib/cn'

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-10 w-full min-w-0 rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink shadow-sm outline-none transition-colors placeholder:text-ui-subtle focus:border-drape-green focus:ring-2 focus:ring-drape-green/15 disabled:cursor-not-allowed disabled:bg-ui-muted disabled:opacity-70',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'
