import * as React from 'react'
import { Button, type ButtonProps } from './button'

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'size'> {
  label: string
  children: React.ReactNode
  size?: 'icon' | 'icon-sm'
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ children, label, size = 'icon', ...props }, ref) => (
    <Button ref={ref} size={size} aria-label={label} title={label} {...props}>
      {children}
      <span className="sr-only">{label}</span>
    </Button>
  ),
)
IconButton.displayName = 'IconButton'
