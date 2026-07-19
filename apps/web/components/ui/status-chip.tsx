import * as React from 'react'
import {
  resolveStatusDisplay,
  type StatusDisplayDomain,
} from '@drape/shared'
import { Badge, type BadgeProps } from './badge'

type StatusTone = NonNullable<BadgeProps['tone']>

export interface StatusChipProps extends Omit<BadgeProps, 'children' | 'tone'> {
  status: string | null | undefined
  fallback?: string
  tone?: StatusTone
  domain?: StatusDisplayDomain
}

export function StatusChip({ domain = 'generic', fallback = 'Not set', status, tone, ...props }: StatusChipProps): React.JSX.Element {
  const display = resolveStatusDisplay(status, { domain, fallback })
  return (
    <Badge tone={tone ?? display.tone} {...props}>
      <span className="truncate">{display.label}</span>
    </Badge>
  )
}
