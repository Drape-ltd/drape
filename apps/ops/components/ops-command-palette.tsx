'use client'

import { ArrowRight, CornerDownLeft, Search, X } from 'lucide-react'
import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

export type OpsCommandDestination = {
  group: string
  href: string
  label: string
  mobileSafe: boolean
}

export function OpsCommandPalette({ destinations }: { destinations: OpsCommandDestination[] }) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [phoneLayout, setPhoneLayout] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const update = () => setPhoneLayout(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((current) => {
          if (!current) setActiveIndex(0)
          return !current
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      window.setTimeout(() => inputRef.current?.focus(), 0)
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const permitted = phoneLayout ? destinations.filter((destination) => destination.mobileSafe) : destinations
    const matches = normalized
      ? permitted.filter((destination) => `${destination.group} ${destination.label}`.toLowerCase().includes(normalized))
      : permitted
    const search = normalized
      ? [{ group: 'Search', label: `Search all work for “${query.trim()}”`, href: `/ops/queues/all?q=${encodeURIComponent(query.trim())}`, mobileSafe: true }]
      : []
    return [...search, ...matches].slice(0, 12)
  }, [destinations, phoneLayout, query])

  const selectedIndex = Math.min(activeIndex, Math.max(0, results.length - 1))

  function choose(href: string) {
    setOpen(false)
    setQuery('')
    router.push(href as Route)
  }

  return <>
    <button className="ops-command-trigger" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setActiveIndex(0); setOpen(true) }}>
      <Search size={16} aria-hidden="true" />
      <span>Search cases or jump to a workspace…</span>
      <kbd><span aria-hidden="true">⌘</span>K</kbd>
    </button>
    <dialog className="ops-command-dialog" ref={dialogRef} onClose={() => setOpen(false)} onCancel={() => setOpen(false)} aria-labelledby="ops-command-title" aria-describedby="ops-command-help">
      <div className="ops-command-head">
        <Search size={18} aria-hidden="true" />
        <label className="ops-visually-hidden" htmlFor="ops-command-query" id="ops-command-title">Search Drapeon Ops</label>
        <input
          id="ops-command-query"
          ref={inputRef}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActiveIndex(0) }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setOpen(false)
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIndex((index) => Math.min(results.length - 1, index + 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((index) => Math.max(0, index - 1))
            } else if (event.key === 'Enter' && results[selectedIndex]) {
              event.preventDefault()
              choose(results[selectedIndex].href)
            }
          }}
          placeholder="Case number, title, or workspace"
          autoComplete="off"
          aria-controls="ops-command-results"
          aria-activedescendant={results[selectedIndex] ? `ops-command-${selectedIndex}` : undefined}
        />
        <button className="ops-command-close" type="button" onClick={() => setOpen(false)} aria-label="Close command palette"><X size={17} /></button>
      </div>
      <p className="ops-visually-hidden" id="ops-command-help">Use the arrow keys to move through results, Enter to open, and Escape to close.</p>
      <div className="ops-command-results" id="ops-command-results" role="listbox" aria-label="Ops destinations and search results">
        {results.length > 0 ? results.map((result, index) => <button
          className="ops-command-result"
          data-active={index === selectedIndex}
          id={`ops-command-${index}`}
          key={`${result.group}:${result.href}`}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => choose(result.href)}
        >
          <span><small>{result.group}</small><strong>{result.label}</strong></span>
          {index === selectedIndex ? <span className="ops-command-enter"><CornerDownLeft size={13} />Enter</span> : <ArrowRight size={15} aria-hidden="true" />}
        </button>) : <div className="ops-command-empty"><strong>No permitted destination matches.</strong><span>Try a case number, case title, or another workspace name.</span></div>}
      </div>
      <footer className="ops-command-foot"><span><kbd>↑</kbd><kbd>↓</kbd> Move</span><span><kbd>↵</kbd> Open</span><span><kbd>esc</kbd> Close</span>{phoneLayout ? <strong>Phone-safe routes only</strong> : null}</footer>
    </dialog>
  </>
}
