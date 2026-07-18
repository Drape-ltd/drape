import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

const buttonVariants = cva(
  'inline-flex min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[8px] text-sm font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drape-green/45 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-drape-green text-white shadow-sm hover:bg-[#235d45]',
        secondary: 'border border-ui-border bg-white text-ink shadow-sm hover:bg-ui-muted',
        outline: 'border border-ui-border bg-transparent text-ink hover:bg-ui-muted',
        ghost: 'text-ui-subtle hover:bg-ui-muted hover:text-ink',
        destructive: 'bg-rust text-white shadow-sm hover:bg-[#a84225]',
        link: 'h-auto rounded-none p-0 text-drape-green underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 px-3',
        md: 'h-10 px-4',
        lg: 'h-11 px-5 text-base',
        icon: 'size-10 p-0',
        'icon-sm': 'size-9 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild = false, className, size, variant, type = 'button', ...props }, ref) => {
    const Component = asChild ? Slot : 'button'
    return (
      <Component
        ref={ref}
        type={asChild ? undefined : type}
        className={cn(buttonVariants({ size, variant }), className)}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { buttonVariants }
