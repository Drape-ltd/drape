import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '../../../lib/server-supabase'
import {
  checkPublicRateLimit,
  getClientIp,
  readJsonBody,
  trimmedString,
} from '../../../lib/request-security'

function isEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isOptionalUrl(value: unknown): value is string | null {
  if (value == null || value === '') return true
  if (typeof value !== 'string') return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  const client = createServiceRoleClient()
  if (!client) {
    return NextResponse.json(
      { error: 'We are unable to accept applications right now. Please try again shortly.' },
      { status: 500 }
    )
  }

  const ip = getClientIp(request)
  const allowed = await checkPublicRateLimit(client, `web:tailor-application:${ip}`, 3600, 10)
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

  const parsed = await readJsonBody(request)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status })
  }
  const body = parsed.data

  const businessName = trimmedString(body.businessName, 120)
  const displayName = trimmedString(body.displayName, 120)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const website = trimmedString(body.website, 255)
  const location = trimmedString(body.location, 120)
  const specialty = trimmedString(body.specialty, 80)
  const portfolioUrl = trimmedString(body.portfolioUrl, 2048) || null
  const instagramUrl = trimmedString(body.instagramUrl, 2048) || null
  const notes = trimmedString(body.notes, 1500)

  if (website) {
    return NextResponse.json({ ok: true })
  }

  if (!businessName || !displayName || !location || !specialty || !notes || !isEmail(email)) {
    return NextResponse.json({ error: 'Please complete the required fields with a valid email.' }, { status: 400 })
  }

  if (!isOptionalUrl(portfolioUrl) || !isOptionalUrl(instagramUrl)) {
    return NextResponse.json({ error: 'Please use valid links for portfolio or social proof.' }, { status: 400 })
  }

  if (!portfolioUrl && !instagramUrl) {
    return NextResponse.json(
      { error: 'Please include at least one portfolio or social proof link.' },
      { status: 400 }
    )
  }

  const { error } = await client.from('tailor_applications').upsert(
    {
      business_name: businessName,
      display_name: displayName,
      email,
      location,
      specialty,
      portfolio_url: portfolioUrl,
      instagram_url: instagramUrl,
      notes,
      source: 'WEB',
      status: 'PENDING',
    },
    {
      onConflict: 'email',
    }
  )

  if (error) {
    return NextResponse.json({ error: 'Unable to submit your application right now.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
