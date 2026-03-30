import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '../../../lib/server-supabase'
import {
  checkPublicRateLimit,
  getClientIp,
  optionalTrimmedString,
  readJsonBody,
  trimmedString,
} from '../../../lib/request-security'

function isEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
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
  const allowed = await checkPublicRateLimit(client, `web:waitlist:${ip}`, 3600, 20)
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

  const parsed = await readJsonBody(request)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status })
  }
  const body = parsed.data

  const role = body.role === 'TAILOR' ? 'TAILOR' : body.role === 'CUSTOMER' ? 'CUSTOMER' : null
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

  const { error } = await client.from('waitlist_signups').upsert(
    {
      role,
      name,
      email,
      location,
      specialty,
      notes,
      source: 'WEB',
    },
    {
      onConflict: 'role,email',
    }
  )

  if (error) {
    return NextResponse.json({ error: 'Unable to join the waitlist right now.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
