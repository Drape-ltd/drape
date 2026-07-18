import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/cn'

export const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(
  ({ className, children, ...props }, ref) => (
    <span className="relative block min-w-0">
      <select
        ref={ref}
        className={cn(
          'h-10 w-full min-w-0 appearance-none rounded-[8px] border border-ui-border bg-white py-2 pl-3 pr-9 text-sm text-ink shadow-sm outline-none transition-colors focus:border-drape-green focus:ring-2 focus:ring-drape-green/15 disabled:cursor-not-allowed disabled:bg-ui-muted disabled:opacity-70',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ui-subtle" aria-hidden="true" />
    </span>
  ),
)
NativeSelect.displayName = 'NativeSelect'
