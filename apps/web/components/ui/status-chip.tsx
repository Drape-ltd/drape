import * as React from 'react'
import { formatDatabaseEnumLabel } from '@drape/shared'
import { Badge, type BadgeProps } from './badge'

type StatusTone = NonNullable<BadgeProps['tone']>

const SUCCESS_TOKENS = ['APPROVED', 'ACTIVE', 'AVAILABLE', 'COMPLETE', 'COMPLETED', 'DELIVERED', 'LIVE', 'PAID', 'READY', 'VERIFIED']
const WARNING_TOKENS = ['AWAITING', 'DRAFT', 'HOLD', 'PAUSED', 'PENDING', 'PROCESSING', 'REVIEW', 'SCHEDULED']
const DANGER_TOKENS = ['BLOCKED', 'CANCELLED', 'DECLINED', 'DISPUTED', 'FAILED', 'OVERDUE', 'REJECTED']

function inferTone(status: string | null | undefined): StatusTone {
  const normalized = status?.toUpperCase() ?? ''
  if (SUCCESS_TOKENS.some((token) => normalized.includes(token))) return 'success'
  if (DANGER_TOKENS.some((token) => normalized.includes(token))) return 'danger'
  if (WARNING_TOKENS.some((token) => normalized.includes(token))) return 'warning'
  return 'neutral'
}

export interface StatusChipProps extends Omit<BadgeProps, 'children' | 'tone'> {
  status: string | null | undefined
  fallback?: string
  tone?: StatusTone
}

export function StatusChip({ fallback = 'Not set', status, tone, ...props }: StatusChipProps): React.JSX.Element {
  return (
    <Badge tone={tone ?? inferTone(status)} {...props}>
      <span className="truncate">{formatDatabaseEnumLabel(status, fallback)}</span>
    </Badge>
  )
}
