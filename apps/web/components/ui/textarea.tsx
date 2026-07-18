import * as React from 'react'
import { cn } from '../../lib/cn'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-24 w-full min-w-0 resize-y rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm leading-6 text-ink shadow-sm outline-none transition-colors placeholder:text-ui-subtle focus:border-drape-green focus:ring-2 focus:ring-drape-green/15 disabled:cursor-not-allowed disabled:bg-ui-muted disabled:opacity-70',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
