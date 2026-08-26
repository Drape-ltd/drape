'use client'

import { useEffect, useRef, useState } from 'react'
import {
  parseAddressSearchSuggestion,
  type AddressSearchSuggestion,
  type StructuredAddressFields,
} from '@drape/shared/address'

type Props = {
  onSelect: (address: StructuredAddressFields & { displayValue: string; reference: string }) => void
}

export function StructuredAddressSearch({ onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AddressSearchSuggestion[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle')
  const [retryKey, setRetryKey] = useState(0)
  const sequence = useRef(0)

  useEffect(() => {
    const text = query.trim()
    if (text.length < 5) {
      return
    }
    const request = ++sequence.current
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setState('loading')
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&addressdetails=1&limit=5`, {
          headers: { 'Accept-Language': 'en' },
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`Address lookup failed with ${response.status}`)
        const payload = await response.json() as unknown
        if (request !== sequence.current) return
        const next = Array.isArray(payload)
          ? payload.filter((item): item is AddressSearchSuggestion => !!item && typeof item === 'object' && typeof item.display_name === 'string')
          : []
        setResults(next)
        setState(next.length ? 'idle' : 'empty')
      } catch {
        if (controller.signal.aborted || request !== sequence.current) return
        setResults([])
        setState('error')
      }
    }, 350)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, retryKey])

  return (
    <div className="grid gap-1.5 md:col-span-2">
      <label className="grid gap-1.5">
        <span className="text-xs font-semibold text-ink">Find address</span>
        <input
          value={query}
          onChange={(event) => {
            const next = event.target.value
            sequence.current += 1
            setQuery(next)
            if (next.trim().length < 5) {
              setResults([])
              setState('idle')
            }
          }}
          placeholder="Search address, area, or landmark"
          autoComplete="street-address"
          className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
        />
      </label>
      {state === 'loading' ? <p role="status" className="text-xs text-ink/52">Searching addresses…</p> : null}
      {state === 'empty' ? <p role="status" className="text-xs text-ink/52">No exact match. Try a nearby landmark, or enter it manually.</p> : null}
      {state === 'error' ? (
        <p role="alert" className="text-xs text-ink/52">
          Suggestions are unavailable. Enter it manually or{' '}
          <button type="button" onClick={() => setRetryKey((key) => key + 1)} className="font-semibold text-needle underline">try again</button>.
        </p>
      ) : null}
      {results.length ? (
        <div className="overflow-hidden rounded-[8px] border border-ui-border bg-white shadow-sm">
          {results.map((result, index) => (
            <button
              type="button"
              key={`${result.place_id ?? result.display_name ?? index}`}
              onClick={() => {
                const parsed = parseAddressSearchSuggestion(result)
                setQuery(parsed.displayValue)
                setResults([])
                setState('idle')
                onSelect({ ...parsed, reference: String(result.place_id ?? result.display_name ?? '') })
              }}
              className="block w-full border-b border-ui-border px-3 py-2 text-left text-sm text-ink last:border-b-0 hover:bg-bone focus:bg-bone focus:outline-none"
            >
              {result.display_name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
