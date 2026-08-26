'use client'

import {
  formatMinorCurrencyAmount,
  formatMoneyInputValue,
  moneyAmountReadback,
  parseMoneyInputToMinorUnits,
  type AccountCurrencyCode,
} from '@drape/shared'
import { useState } from 'react'

export function MoneyInput({
  id,
  label,
  value,
  onValueChange,
  currency,
  required = false,
  hint,
  allowZero = false,
  className = '',
}: {
  id: string
  label: string
  value: string
  onValueChange: (value: string) => void
  currency: AccountCurrencyCode
  required?: boolean
  hint?: string
  allowZero?: boolean
  className?: string
}) {
  const amountMinor = parseMoneyInputToMinorUnits(value, { allowZero })
  const exact = amountMinor == null ? '' : formatMinorCurrencyAmount(amountMinor, currency)
  const words = amountMinor == null ? '' : moneyAmountReadback(amountMinor, currency)

  return (
    <label htmlFor={id} className={`grid gap-1.5 text-sm font-semibold text-ink ${className}`}>
      <span>{label} <span className="text-ink/50">({currency})</span>{required ? <span className="text-rust"> *</span> : null}</span>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(event) => onValueChange(formatMoneyInputValue(event.target.value))}
        aria-describedby={`${id}-support`}
        className="rounded-[8px] border border-ui-border bg-white px-3 py-2 font-normal text-ink outline-none focus:border-needle/50 focus:ring-2 focus:ring-needle/10"
      />
      <span id={`${id}-support`} className="min-h-5 text-xs font-normal leading-5 text-ink/56" aria-live="polite">
        {exact ? <><strong className="font-semibold text-ink">{exact}</strong><span className="mx-1">·</span><span className="capitalize">{words}</span></> : hint ?? 'Enter the full amount.'}
      </span>
    </label>
  )
}

export function FormMoneyInput({
  id,
  name,
  label,
  currency,
  required = false,
  defaultValue = '',
  maximumMinorUnits,
}: {
  id: string
  name: string
  label: string
  currency: AccountCurrencyCode
  required?: boolean
  defaultValue?: string
  maximumMinorUnits?: number | null
}) {
  const [value, setValue] = useState(() => formatMoneyInputValue(defaultValue))
  const amountMinor = parseMoneyInputToMinorUnits(value)
  const exact = amountMinor == null ? '' : formatMinorCurrencyAmount(amountMinor, currency)
  const words = amountMinor == null ? '' : moneyAmountReadback(amountMinor, currency)
  const exceedsMaximum = amountMinor != null && typeof maximumMinorUnits === 'number' && amountMinor > maximumMinorUnits
  const canonicalMajorValue = amountMinor == null ? '' : (amountMinor / 100).toFixed(2)

  return (
    <label htmlFor={id} className="grid gap-2 text-sm font-medium text-ink/76">
      <span>{label} ({currency})</span>
      <input type="hidden" name={name} value={exceedsMaximum ? '' : canonicalMajorValue} />
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(event) => setValue(formatMoneyInputValue(event.target.value))}
        required={required}
        aria-invalid={exceedsMaximum}
        aria-describedby={`${id}-support`}
        className="rounded-[8px] border border-ink/14 bg-white px-4 py-3 text-ink outline-none transition focus:border-needle/50 focus:ring-2 focus:ring-needle/15 aria-[invalid=true]:border-rust"
      />
      <span id={`${id}-support`} className={`text-xs font-normal leading-5 ${exceedsMaximum ? 'text-rust' : 'text-ink/56'}`} role={exceedsMaximum ? 'alert' : undefined}>
        {exceedsMaximum
          ? `Above the maximum refundable amount of ${formatMinorCurrencyAmount(maximumMinorUnits ?? 0, currency)}.`
          : exact
            ? <><strong className="font-semibold text-ink">{exact}</strong><span className="mx-1">·</span><span className="capitalize">{words}</span></>
            : 'Enter the full amount. Drapeon will read it back before submission.'}
      </span>
    </label>
  )
}
