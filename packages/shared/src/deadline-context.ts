export type DeadlineWarningCode =
  | 'PUBLIC_HOLIDAY'
  | 'CULTURAL_RUSH'
  | 'CUSTOMS_RISK'
  | 'NONE'

export type DeadlineContextWarning = {
  code: DeadlineWarningCode
  message: string
  suggestedDate?: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

function parseDateOnly(value: string | Date | null | undefined) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function daysBetween(left: Date, right: Date) {
  const leftOnly = new Date(left.getFullYear(), left.getMonth(), left.getDate())
  const rightOnly = new Date(right.getFullYear(), right.getMonth(), right.getDate())
  return Math.round((rightOnly.getTime() - leftOnly.getTime()) / DAY_MS)
}

function suggestedBusinessDateAfter(date: Date, offsetDays: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + offsetDays)
  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1)
  }
  return isoDate(next)
}

export function resolveDeadlineContextWarning(input: {
  deadline: string | Date | null | undefined
  fulfillmentOption?: string | null
  shippingCountry?: string | null
  tailorCountry?: string | null
  now?: string | Date | null
}): DeadlineContextWarning | null {
  const deadline = parseDateOnly(input.deadline)
  if (!deadline) return null

  const month = deadline.getMonth() + 1
  const day = deadline.getDate()
  const now = parseDateOnly(input.now ?? new Date())
  const daysUntil = now ? daysBetween(now, deadline) : null
  const fulfillment = (input.fulfillmentOption ?? '').toUpperCase()
  const shippingCountry = (input.shippingCountry ?? '').toUpperCase()
  const tailorCountry = (input.tailorCountry ?? '').toUpperCase()

  if ((month === 12 && day >= 20) || (month === 1 && day <= 3)) {
    return {
      code: 'PUBLIC_HOLIDAY',
      message:
        'This deadline falls around the Christmas and New Year delivery window. Couriers and tailors may have holiday closures, so choose an earlier handoff date if the event is fixed.',
      suggestedDate: month === 12 ? suggestedBusinessDateAfter(deadline, -4) : suggestedBusinessDateAfter(deadline, 4),
    }
  }

  if (month === 10 && day >= 1 && day <= 3) {
    return {
      code: 'PUBLIC_HOLIDAY',
      message:
        'This deadline falls near Nigerian Independence Day. Confirm courier and tailor availability before relying on same-week handoff.',
      suggestedDate: suggestedBusinessDateAfter(deadline, 2),
    }
  }

  if ((month === 3 || month === 4 || month === 5) && daysUntil != null && daysUntil <= 21) {
    return {
      code: 'CULTURAL_RUSH',
      message:
        'This date may sit inside Eid, wedding, or spring event rush. Drapeon will keep the deadline visible, but ask the tailor to confirm capacity before cutting.',
      suggestedDate: null,
    }
  }

  if (fulfillment === 'SHIPPING' && shippingCountry && tailorCountry && shippingCountry !== tailorCountry) {
    return {
      code: 'CUSTOMS_RISK',
      message:
        'International shipping can include customs review, duties, and carrier delays outside Drapeon or the tailor. Build in extra days before the event.',
      suggestedDate: daysUntil != null && daysUntil < 21 ? suggestedBusinessDateAfter(deadline, 7) : null,
    }
  }

  return null
}
