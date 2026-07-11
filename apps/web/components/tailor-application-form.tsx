'use client'

import Link from 'next/link'
import { type JSX, useState } from 'react'
import { LocationAutocomplete } from './location-autocomplete'
import { trackWebEvent } from './web-analytics'

export function TailorApplicationForm(): JSX.Element {
  const [businessName, setBusinessName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [location, setLocation] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [portfolioUrl, setPortfolioUrl] = useState('')
  const [instagramUrl, setInstagramUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (status === 'submitting') return

    if (!portfolioUrl.trim() && !instagramUrl.trim()) {
      setStatus('error')
      setMessage('Please include at least one portfolio or social proof link.')
      trackWebEvent('tailor_application_submit_failure', { reason: 'missing_proof_link' })
      return
    }

    setStatus('submitting')
    setMessage('')
    trackWebEvent('tailor_application_submit_attempt')

    try {
      const response = await fetch('/api/tailor-application', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName,
          displayName,
          email,
          website,
          location,
          specialty,
          portfolioUrl,
          instagramUrl,
          notes,
        }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to submit your application right now.')
      }

      setStatus('success')
      setMessage("Application received. We'll review it and reach out when the next step is ready.")
      trackWebEvent('tailor_application_submit_success')
      setBusinessName('')
      setDisplayName('')
      setEmail('')
      setWebsite('')
      setLocation('')
      setSpecialty('')
      setPortfolioUrl('')
      setInstagramUrl('')
      setNotes('')
    } catch (error) {
      setStatus('error')
      const errorMessage = error instanceof Error ? error.message : 'Unable to submit your application right now.'
      setMessage(errorMessage)
      trackWebEvent('tailor_application_submit_failure', { message: errorMessage })
    }
  }

  return (
    <form className="mt-10 grid gap-4 lg:grid-cols-2" onSubmit={onSubmit}>
      <div className="grid gap-3 rounded-[1.5rem] border border-ink/6 bg-bone/72 p-5 lg:col-span-2 sm:grid-cols-3">
        {[
          'Show your strongest specialty clearly.',
          'Share one or two links that represent your work well.',
          'Tell us the kind of orders that fit your studio best.',
        ].map((item) => (
          <div key={item} className="text-sm leading-6 text-ink/68">
            {item}
          </div>
        ))}
      </div>

      <label className="grid gap-2 text-sm text-ink/72">
        Business name
        <input
          required
          value={businessName}
          onChange={(event) => {
            setBusinessName(event.target.value)
            if (status === 'error') setMessage('')
          }}
          autoComplete="organization"
          className="rounded-2xl border border-ink/10 bg-bone px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40 focus:bg-white"
          placeholder="Studio name"
        />
      </label>

      <label className="grid gap-2 text-sm text-ink/72">
        Display name
        <input
          required
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value)
            if (status === 'error') setMessage('')
          }}
          autoComplete="name"
          className="rounded-2xl border border-ink/10 bg-bone px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40 focus:bg-white"
          placeholder="John Doe"
        />
      </label>

      <label className="grid gap-2 text-sm text-ink/72">
        Email
        <input
          required
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
            if (status === 'error') setMessage('')
          }}
          autoComplete="email"
          inputMode="email"
          spellCheck={false}
          className="rounded-2xl border border-ink/10 bg-bone px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40 focus:bg-white"
          placeholder="you@example.com"
        />
      </label>

      <label className="hidden" aria-hidden="true">
        Website
        <input
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </label>

      <LocationAutocomplete
        label="Location"
        value={location}
        onChange={setLocation}
        placeholder="City, country"
        required
        helperText="Search with OpenStreetMap so your studio location is easier to normalize and review."
      />

      <label className="grid gap-2 text-sm text-ink/72">
        Core specialty
        <input
          required
          value={specialty}
          onChange={(event) => {
            setSpecialty(event.target.value)
            if (status === 'error') setMessage('')
          }}
          className="rounded-2xl border border-ink/10 bg-bone px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40 focus:bg-white"
          placeholder="Suits, bridal, occasionwear..."
        />
      </label>

      <label className="grid gap-2 text-sm text-ink/72">
        Portfolio URL
        <input
          type="url"
          value={portfolioUrl}
          onChange={(event) => {
            setPortfolioUrl(event.target.value)
            if (status === 'error') setMessage('')
          }}
          autoComplete="url"
          inputMode="url"
          spellCheck={false}
          className="rounded-2xl border border-ink/10 bg-bone px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40 focus:bg-white"
          placeholder="https://..."
        />
        <span className="text-xs leading-5 text-ink/48">At least one proof-of-craft link is required.</span>
      </label>

      <label className="grid gap-2 text-sm text-ink/72 lg:col-span-2">
        Instagram or social proof link
        <input
          type="url"
          value={instagramUrl}
          onChange={(event) => {
            setInstagramUrl(event.target.value)
            if (status === 'error') setMessage('')
          }}
          autoComplete="url"
          inputMode="url"
          spellCheck={false}
          className="rounded-2xl border border-ink/10 bg-bone px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40 focus:bg-white"
          placeholder="https://instagram.com/..."
        />
        <span className="text-xs leading-5 text-ink/48">Instagram, TikTok, Pinterest, website, or another live proof link.</span>
      </label>

      <label className="grid gap-2 text-sm text-ink/72 lg:col-span-2">
        Tell us about your work
        <textarea
          required
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value)
            if (status === 'error') setMessage('')
          }}
          className="min-h-32 rounded-2xl border border-ink/10 bg-bone px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40 focus:bg-white"
          placeholder="What do you make best, who do you serve, and what should we know about your studio?"
        />
      </label>

      <div className="rounded-[1.5rem] border border-ink/6 bg-[linear-gradient(180deg,#faf6f0_0%,#f3ece1_100%)] p-5 lg:col-span-2">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <p className="text-sm leading-6 text-ink/60">
            We’ll review it and reach out if there’s a fit.
          </p>
          <button
            type="submit"
            disabled={status === 'submitting'}
            className="inline-flex w-full items-center justify-center rounded-full bg-needle px-6 py-4 text-sm font-semibold text-white shadow-[0_16px_35px_rgba(45,106,79,0.16)] transition hover:bg-needle-600 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
            data-analytics-event="form_cta_click"
            data-analytics-label="Tailor application"
          >
            {status === 'submitting' ? 'Submitting…' : 'Submit application'}
          </button>
        </div>
      </div>

      {message ? (
        <div
          className={`rounded-2xl px-4 py-3 text-sm lg:col-span-2 ${
            status === 'success'
              ? 'bg-needle/10 text-needle'
              : 'bg-rust/10 text-rust'
          }`}
        >
          {message}
        </div>
      ) : null}

      {status === 'success' ? (
        <div className="rounded-[1.5rem] border border-ink/6 bg-bone/80 p-5 lg:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">What happens next</p>
          <p className="mt-3 text-sm leading-7 text-ink/68">
            We have your application. We’ll review it and get back to you.
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/tailors"
              className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
            >
              Explore the tailor journey
            </Link>
            <Link
              href="/trust"
              className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink"
            >
              See the trust layer
            </Link>
          </div>
        </div>
      ) : null}
    </form>
  )
}
