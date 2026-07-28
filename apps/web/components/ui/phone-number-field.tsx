'use client'

import * as React from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import {
  composeInternationalPhoneNumber,
  DEFAULT_PHONE_COUNTRY_CODE,
  FEATURED_PHONE_COUNTRY_CODES,
  getNationalPhoneInput,
  getPhoneCountryOption,
  inferPhoneCountryCode,
  searchPhoneCountries,
  type PhoneCountryCode,
  type PhoneCountryOption,
} from '@drape/shared/phone-countries'
import { cn } from '../../lib/cn'

type PhoneNumberFieldProps = Omit<
  React.ComponentProps<'input'>,
  'onChange' | 'type' | 'value'
> & {
  label?: React.ReactNode
  value: string
  onValueChange: (value: string) => void
  hint?: React.ReactNode
  error?: React.ReactNode
  defaultCountryCode?: PhoneCountryCode
  containerClassName?: string
}

function prioritizedCountries(query: string): readonly PhoneCountryOption[] {
  const matches = searchPhoneCountries(query)
  if (query.trim()) return matches

  const featured = FEATURED_PHONE_COUNTRY_CODES.map(getPhoneCountryOption)
  const featuredCodes = new Set(FEATURED_PHONE_COUNTRY_CODES)
  return [...featured, ...matches.filter((item) => !featuredCodes.has(item.code))]
}

export function PhoneNumberField({
  label,
  value,
  onValueChange,
  hint,
  error,
  required,
  defaultCountryCode = DEFAULT_PHONE_COUNTRY_CODE,
  containerClassName,
  className,
  placeholder = 'Phone number',
  onFocus,
  onBlur,
  id,
  ...inputProps
}: PhoneNumberFieldProps) {
  const generatedId = React.useId()
  const inputId = id ?? generatedId
  const menuId = `${inputId}-countries`
  const initialCountry = inferPhoneCountryCode(value, defaultCountryCode)
  const [countryCode, setCountryCode] = React.useState<PhoneCountryCode>(initialCountry)
  const [nationalValue, setNationalValue] = React.useState(() =>
    getNationalPhoneInput(value, initialCountry),
  )
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const rootRef = React.useRef<HTMLDivElement>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const lastEmittedValue = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (value === lastEmittedValue.current) return

    const nextCountry = inferPhoneCountryCode(value, countryCode)
    setCountryCode(nextCountry)
    setNationalValue(getNationalPhoneInput(value, nextCountry))
  }, [countryCode, value])

  React.useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    requestAnimationFrame(() => searchRef.current?.focus())
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const selectedCountry = getPhoneCountryOption(countryCode)
  const countries = React.useMemo(() => prioritizedCountries(query), [query])

  function emitNationalValue(nextNationalValue: string, code = countryCode) {
    const normalizedValue = nextNationalValue.trim().replace(/^00/, '+')
    const nextCountryCode = normalizedValue.startsWith('+')
      ? inferPhoneCountryCode(normalizedValue, code)
      : code
    const nextDisplayValue = normalizedValue.startsWith('+')
      ? getNationalPhoneInput(normalizedValue, nextCountryCode)
      : nextNationalValue

    if (nextCountryCode !== countryCode) setCountryCode(nextCountryCode)
    setNationalValue(nextDisplayValue)
    const nextValue = composeInternationalPhoneNumber(nextNationalValue, code)
    lastEmittedValue.current = nextValue
    onValueChange(nextValue)
  }

  function selectCountry(country: PhoneCountryOption) {
    setCountryCode(country.code)
    setOpen(false)
    setQuery('')
    emitNationalValue(nationalValue, country.code)
  }

  return (
    <div ref={rootRef} className={cn('relative grid min-w-0 gap-1.5', containerClassName)}>
      {label ? (
        <label htmlFor={inputId} className="text-sm font-semibold text-ink">
          {label}
          {required ? <span className="text-rust"> *</span> : null}
        </label>
      ) : null}

      <div
        className={cn(
          'flex min-h-12 min-w-0 overflow-visible rounded-[8px] border bg-white shadow-sm transition focus-within:border-drape-green focus-within:ring-2 focus-within:ring-drape-green/15',
          error ? 'border-rust/60' : 'border-ui-border',
        )}
      >
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={`Country code, ${selectedCountry.name} ${selectedCountry.callingCode}`}
          onClick={() => setOpen((current) => !current)}
          className="flex min-h-12 shrink-0 items-center gap-2 border-r border-ui-border px-3 text-sm font-semibold text-ink outline-none transition hover:bg-ui-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-drape-green/40"
        >
          <span className="grid min-w-8 place-items-center rounded-[6px] bg-ui-muted px-1.5 py-1 text-xs font-bold">
            {selectedCountry.code}
          </span>
          <span>{selectedCountry.callingCode}</span>
          <ChevronDown className="size-4 text-ui-subtle" aria-hidden="true" />
        </button>

        <input
          {...inputProps}
          id={inputId}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          required={required}
          value={nationalValue}
          onChange={(event) => emitNationalValue(event.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          className={cn(
            'min-h-12 min-w-0 flex-1 rounded-r-[8px] bg-transparent px-3 text-base font-normal text-ink outline-none placeholder:text-ui-subtle',
            className,
          )}
        />
      </div>

      {open ? (
        <div
          id={menuId}
          className="absolute left-0 top-full z-[120] mt-2 w-[min(24rem,calc(100vw-2rem))] min-w-full max-w-[calc(100vw-2rem)] overflow-hidden rounded-[8px] border border-ui-border bg-white shadow-2xl"
        >
          <div className="flex items-center gap-2 border-b border-ui-border p-3">
            <Search className="size-4 shrink-0 text-ui-subtle" aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search country or calling code"
              aria-label="Search countries"
              className="min-h-10 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ui-subtle"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="grid size-10 place-items-center rounded-[8px] text-ui-subtle hover:bg-ui-muted hover:text-ink"
                aria-label="Clear country search"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <div role="listbox" aria-label="Country calling codes" className="max-h-80 overflow-y-auto overscroll-contain p-1">
            {countries.length > 0 ? countries.map((country) => {
              const selected = country.code === countryCode
              const showNativeName = country.nativeName !== country.name
              return (
                <button
                  key={country.code}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => selectCountry(country)}
                  className={cn(
                    'flex min-h-12 w-full items-center gap-3 rounded-[6px] px-3 py-2 text-left transition hover:bg-ui-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drape-green/40',
                    selected && 'bg-drape-green/[0.08]',
                  )}
                >
                  <span className="grid min-w-9 place-items-center rounded-[6px] bg-ui-muted px-1.5 py-1 text-xs font-bold text-ink">
                    {country.code}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{country.name}</span>
                    {showNativeName ? (
                      <span className="block truncate text-xs text-ui-subtle">{country.nativeName}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-ui-subtle">{country.callingCode}</span>
                  {selected ? <Check className="size-4 shrink-0 text-drape-green" aria-hidden="true" /> : null}
                </button>
              )
            }) : (
              <p className="px-3 py-8 text-center text-sm text-ui-subtle">No countries match that search.</p>
            )}
          </div>
        </div>
      ) : null}

      {error ? (
        <span className="text-xs leading-5 text-rust" role="alert">{error}</span>
      ) : hint ? (
        <span className="text-xs leading-5 text-ui-subtle">{hint}</span>
      ) : null}
    </div>
  )
}
