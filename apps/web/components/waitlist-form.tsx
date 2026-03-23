'use client'

import Link from 'next/link'
import { useState } from 'react'
import { LocationAutocomplete } from './location-autocomplete'

type WaitlistFormProps = {
  role: 'CUSTOMER' | 'TAILOR'
  title: string
  description: string
}

export function WaitlistForm({ role, title, description }: WaitlistFormProps): JSX.Element {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [location, setLocation] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (status === 'submitting') return

    setStatus('submitting')
    setMessage('')

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role,
          name,
          email,
          website,
          location,
          specialty: role === 'TAILOR' ? specialty : null,
          notes,
        }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to join the waitlist right now.')
      }

      setStatus('success')
      setMessage("You're in. We'll reach out when this side opens.")
      setName('')
      setEmail('')
      setWebsite('')
      setLocation('')
      setSpecialty('')
      setNotes('')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'Unable to join the waitlist right now.')
    }
  }

  return (
    <div className="rounded-[2rem] border border-white/80 bg-white/88 p-6 shadow-[0_24px_70px_rgba(22,28,24,0.08)] backdrop-blur sm:p-7">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{role === 'CUSTOMER' ? 'Customer queue' : 'Tailor queue'}</p>
        <h3 className="mt-3 text-3xl text-ink">{title}</h3>
        <p className="mt-4 text-sm leading-7 text-ink/68">{description}</p>
      </div>

      <form className="mt-8 grid gap-4 lg:grid-cols-2" onSubmit={onSubmit}>
      <label className="grid gap-2 text-sm text-ink/72">
        Full name
        <input
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            if (status === 'error') setMessage('')
          }}
          autoComplete="name"
          className="rounded-2xl border border-ink/10 bg-bone px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40 focus:bg-white"
          placeholder="Your name"
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
          placeholder={role === 'TAILOR' ? 'City, country' : 'Where you want to book from'}
          helperText="Search with OpenStreetMap or keep typing manually if the suggestion you want does not appear."
        />

        {role === 'TAILOR' ? (
          <label className="grid gap-2 text-sm text-ink/72">
            Specialty
            <input
              value={specialty}
              onChange={(event) => setSpecialty(event.target.value)}
              className="rounded-2xl border border-ink/10 bg-bone px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40 focus:bg-white"
              placeholder="Bridal, suiting, occasionwear..."
            />
          </label>
        ) : null}

        <label className="grid gap-2 text-sm text-ink/72 lg:col-span-2">
          Note
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="min-h-28 rounded-2xl border border-ink/10 bg-bone px-4 py-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-needle/40 focus:bg-white"
            placeholder={role === 'TAILOR' ? 'Tell us what you make and the kind of clients you want.' : 'Tell us what you are looking for.'}
          />
        </label>

        <div className="rounded-[1.5rem] border border-ink/6 bg-[linear-gradient(180deg,#faf6f0_0%,#f3ece1_100%)] p-5 lg:col-span-2">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-sm leading-6 text-ink/60">
              Join now and we’ll keep you posted.
            </p>
            <button
              type="submit"
              disabled={status === 'submitting'}
              className="inline-flex w-full items-center justify-center rounded-full bg-needle px-6 py-4 text-sm font-semibold text-white shadow-[0_16px_35px_rgba(45,106,79,0.16)] transition hover:bg-needle-600 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
            >
              {status === 'submitting' ? 'Joining…' : 'Join the queue'}
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
            You’re in. We’ll reach out when this side opens.
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Link
              href={role === 'CUSTOMER' ? '/customers' : '/tailors'}
              className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
            >
              {role === 'CUSTOMER' ? 'Explore the customer journey' : 'Explore the tailor journey'}
            </Link>
            <Link
              href="/how-it-works"
              className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink"
            >
              See how Drape works
            </Link>
          </div>
        </div>
      ) : null}
      </form>
    </div>
  )
}
