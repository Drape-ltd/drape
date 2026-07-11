'use client'

import { type JSX, useEffect, useId, useRef, useState } from 'react'

type Suggestion = {
  display_name: string
}

type LocationAutocompleteProps = {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  required?: boolean
  helperText?: string
}

export function LocationAutocomplete({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  helperText,
}: LocationAutocompleteProps): React.JSX.Element {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const rootRef = useRef<HTMLLabelElement | null>(null)
  const listId = useId()
  const trimmedValue = value.trim()
  const canSearch = trimmedValue.length >= 3

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [])

  useEffect(() => {
    if (!canSearch) return

    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      try {
        setLoading(true)
        setError('')

        const url = new URL('https://nominatim.openstreetmap.org/search')
        url.searchParams.set('q', trimmedValue)
        url.searchParams.set('format', 'jsonv2')
        url.searchParams.set('addressdetails', '1')
        url.searchParams.set('limit', '5')

        const response = await fetch(url.toString(), {
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
          },
        })

        if (!response.ok) {
          throw new Error('Location search failed.')
        }

        const payload = (await response.json()) as Suggestion[]
        setSuggestions(payload)
        setOpen(true)
      } catch (fetchError) {
        if ((fetchError as Error).name === 'AbortError') return
        setSuggestions([])
        setError('Suggestions unavailable. You can still type your location manually.')
      } finally {
        setLoading(false)
      }
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [canSearch, trimmedValue])

  function selectSuggestion(nextValue: string) {
    onChange(nextValue)
    setSuggestions([])
    setOpen(false)
    setError('')
  }

  return (
    <label ref={rootRef} className="grid gap-2 text-sm text-ink/72">
      {label}
      <div className="relative">
        <input
          required={required}
          value={value}
          onChange={(event) => {
            const nextValue = event.target.value
            onChange(nextValue)
            setOpen(true)
            if (nextValue.trim().length < 3) {
              setSuggestions([])
              setLoading(false)
              setError('')
            }
          }}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true)
          }}
          aria-autocomplete="list"
          aria-controls={canSearch && open ? listId : undefined}
          className="w-full rounded-2xl border border-ink/10 bg-bone px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40 focus:bg-white"
          placeholder={placeholder}
        />

        {canSearch && loading ? (
          <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs font-semibold uppercase tracking-[0.16em] text-needle/55">
            Search
          </div>
        ) : null}

        {canSearch && open && suggestions.length > 0 ? (
          <div
            id={listId}
            className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-[1.25rem] border border-ink/6 bg-white shadow-[0_22px_50px_rgba(22,28,24,0.12)]"
          >
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.display_name}
                type="button"
                onClick={() => selectSuggestion(suggestion.display_name)}
                className="block w-full border-b border-ink/6 px-4 py-3 text-left text-sm leading-6 text-ink/72 transition last:border-b-0 hover:bg-bone/70"
              >
                {suggestion.display_name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {canSearch && error ? <span className="text-xs leading-5 text-rust">{error}</span> : null}
      {helperText ? <span className="text-xs leading-5 text-ink/48">{helperText}</span> : null}
    </label>
  )
}
