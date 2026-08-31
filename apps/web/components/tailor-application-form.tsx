'use client'

import Link from 'next/link'
import { type JSX, useEffect, useState } from 'react'
import { LocationAutocomplete } from './location-autocomplete'
import { trackWebEvent } from './web-analytics'
import { createClient } from '../lib/supabase'

export function TailorApplicationForm(): React.JSX.Element {
  const [businessName, setBusinessName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [location, setLocation] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [portfolioUrl, setPortfolioUrl] = useState('')
  const [instagramUrl, setInstagramUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [source, setSource] = useState<'WEB' | 'SIGNED_IN_ACCOUNT'>(() => {
    if (typeof window === 'undefined') return 'WEB'
    return new URLSearchParams(window.location.search).get('source') === 'account' ? 'SIGNED_IN_ACCOUNT' : 'WEB'
  })
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true

    let supabase: ReturnType<typeof createClient>
    try {
      supabase = createClient()
    } catch {
      return () => {
        active = false
      }
    }

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active || !data.session) return
      const user = data.session.user
      const metadata = user.user_metadata ?? {}
      const metadataName = typeof metadata.display_name === 'string' ? metadata.display_name : ''

      setSource('SIGNED_IN_ACCOUNT')
      setEmail((current) => current || user.email || '')
      setDisplayName((current) => current || metadataName)

      const { data: customerProfile } = await supabase
        .from('customer_profiles')
        .select('display_name')
        .eq('user_id', user.id)
        .maybeSingle()

      if (!active) return
      const profileName = typeof customerProfile?.display_name === 'string' ? customerProfile.display_name : ''
      setDisplayName((current) => current || profileName || metadataName)
    }).catch(() => {
      // Public applications should remain usable even if session prefill cannot load.
    })

    return () => {
      active = false
    }
  }, [])

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
          source,
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
    <form className="mt-7 grid gap-5 lg:grid-cols-2" onSubmit={onSubmit}>
      {source === 'SIGNED_IN_ACCOUNT' ? (
        <div className="rounded-lg border border-needle/12 bg-needle/8 px-4 py-3 text-sm leading-6 text-needle lg:col-span-2">
          This application is tied to your signed-in Drapeon account. Ops will review it before tailor workspace setup opens.
        </div>
      ) : null}

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
          className="rounded-[10px] border border-ink/10 bg-bone px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40 focus:bg-white focus:ring-2 focus:ring-needle/10"
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
          className="rounded-[10px] border border-ink/10 bg-bone px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40 focus:bg-white focus:ring-2 focus:ring-needle/10"
          placeholder="e.g. John Doe"
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
          className="rounded-[10px] border border-ink/10 bg-bone px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40 focus:bg-white focus:ring-2 focus:ring-needle/10"
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
          className="rounded-[10px] border border-ink/10 bg-bone px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40 focus:bg-white focus:ring-2 focus:ring-needle/10"
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
          className="rounded-[10px] border border-ink/10 bg-bone px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40 focus:bg-white focus:ring-2 focus:ring-needle/10"
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
          className="rounded-[10px] border border-ink/10 bg-bone px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40 focus:bg-white focus:ring-2 focus:ring-needle/10"
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
          className="min-h-32 resize-y rounded-[10px] border border-ink/10 bg-bone px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40 focus:bg-white focus:ring-2 focus:ring-needle/10"
          placeholder="What do you make best, who do you serve, and what should we know about your studio?"
        />
      </label>

      <div className="rounded-[10px] border border-ink/6 bg-[linear-gradient(180deg,#faf6f0_0%,#f3ece1_100%)] p-5 lg:col-span-2">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <p className="text-sm leading-6 text-ink/60">
            We’ll review it and reach out if there’s a fit.
          </p>
          <button
            type="submit"
            disabled={status === 'submitting'}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-needle px-5 text-sm font-semibold text-white shadow-[0_16px_35px_rgba(45,106,79,0.16)] transition hover:bg-needle-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
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
        <div className="rounded-[8px] border border-ink/6 bg-bone/80 p-5 lg:col-span-2">
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
