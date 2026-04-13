import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '../../../lib/server-supabase'
import { sendWaitlistSignupNotification } from '../../../lib/lead-notifications'
import {
  checkPublicRateLimit,
  getClientIp,
  optionalTrimmedString,
  readJsonBody,
  trimmedString,
} from '../../../lib/request-security'

type WaitlistRole = 'CUSTOMER' | 'TAILOR'

function isEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function hasMeaningfulWaitlistChanges(
  existing: {
    name: string
    location: string | null
    specialty: string | null
    notes: string | null
    source: string
  } | null,
  next: {
    name: string
    location: string | null
    specialty: string | null
    notes: string | null
    source: string
  },
) {
  if (!existing) return true

  return (
    existing.name !== next.name ||
    existing.location !== next.location ||
    existing.specialty !== next.specialty ||
    existing.notes !== next.notes ||
    existing.source !== next.source
  )
}

export async function POST(request: Request) {
  const client = createServiceRoleClient()
  if (!client) {
    return NextResponse.json(
      { error: 'We are unable to accept waitlist signups right now. Please try again shortly.' },
      { status: 500 }
    )
  }

  const ip = getClientIp(request)
  const ipRateLimit = await checkPublicRateLimit(client, `web:waitlist:ip:${ip}`, 3600, 100)
  if (!ipRateLimit.ok) {
    return NextResponse.json(
      { error: 'We are unable to accept waitlist signups right now. Please try again shortly.' },
      { status: 500 }
    )
  }
  if (!ipRateLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

  const parsed = await readJsonBody(request)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status })
  }
  const body = parsed.data

  const role: WaitlistRole | null =
    body.role === 'TAILOR' ? 'TAILOR' : body.role === 'CUSTOMER' ? 'CUSTOMER' : null
  const name = trimmedString(body.name, 80)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const website = trimmedString(body.website, 255)
  const location = optionalTrimmedString(body.location, 120)
  const specialty = optionalTrimmedString(body.specialty, 80)
  const notes = optionalTrimmedString(body.notes, 500)

  if (website) {
    return NextResponse.json({ ok: true })
  }

  if (!role || !name || !isEmail(email)) {
    return NextResponse.json({ error: 'Please provide a valid name, role, and email.' }, { status: 400 })
  }

  const emailRateLimit = await checkPublicRateLimit(client, `web:waitlist:email:${email}`, 3600, 5)
  if (!emailRateLimit.ok) {
    return NextResponse.json(
      { error: 'We are unable to accept waitlist signups right now. Please try again shortly.' },
      { status: 500 }
    )
  }
  if (!emailRateLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

  const signup: {
    role: WaitlistRole
    name: string
    email: string
    location: string | null
    specialty: string | null
    notes: string | null
    source: 'WEB'
  } = {
    role,
    name,
    email,
    location,
    specialty,
    notes,
    source: 'WEB' as const,
  }

  const { data: existingSignup, error: existingSignupError } = await client
    .from('waitlist_signups')
    .select('name, location, specialty, notes, source')
    .eq('role', role)
    .eq('email', email)
    .maybeSingle()

  if (existingSignupError) {
    console.error('[waitlist] Unable to read existing signup before upsert.', {
      role,
      email,
      message: existingSignupError.message,
    })
    return NextResponse.json({ error: 'Unable to join the waitlist right now.' }, { status: 500 })
  }

  const shouldNotifyInbox = hasMeaningfulWaitlistChanges(existingSignup, signup)

  const { data: savedSignup, error } = await client
    .from('waitlist_signups')
    .upsert(signup, {
      onConflict: 'role,email',
    })
    .select('created_at')
    .single()

  if (error) {
    return NextResponse.json({ error: 'Unable to join the waitlist right now.' }, { status: 500 })
  }

  if (shouldNotifyInbox) {
    const notification = await sendWaitlistSignupNotification({
      ...signup,
      mode: existingSignup ? 'updated' : 'created',
      createdAt: savedSignup?.created_at ?? null,
    })

    if (!notification.ok && !notification.skipped) {
      console.error('[waitlist] Signup saved but lead email failed.', { role, email })
    }
  }

  return NextResponse.json({ ok: true })
}
