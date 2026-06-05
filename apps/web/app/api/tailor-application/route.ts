import { NextResponse } from 'next/server'
import {
  RATE_LIMIT_RETRY_AFTER_SECONDS,
  RATE_LIMITS,
  createRateLimitPayload,
} from '@drape/shared/rate-limit'
import { createServiceRoleClient } from '../../../lib/server-supabase'
import { sendTailorApplicationNotification } from '../../../lib/lead-notifications'
import {
  checkPublicRateLimit,
  getClientIp,
  readJsonBody,
  trimmedString,
} from '../../../lib/request-security'

async function createOrRefreshApplicationOpsIssue(
  client: ReturnType<typeof createServiceRoleClient>,
  input: {
    applicationId: string
    displayName: string
    email: string
    location: string
    specialty: string
    status: string
    source: string
  },
) {
  if (!client) return

  const dedupeKey = `tailor-application:${input.applicationId}`
  const existing = await client
    .from('ops_issues')
    .select('id, status')
    .eq('dedupe_key', dedupeKey)
    .maybeSingle()

  const payload = {
    issue_type: 'TAILOR_APPLICATION',
    severity: 'MEDIUM',
    status: 'OPEN',
    source: 'tailor-application-web',
    actor_role: 'SYSTEM',
    related_entity_type: 'tailor_application',
    related_entity_id: input.applicationId,
    title: 'New tailor application',
    description: `${input.displayName} submitted or updated a tailor application from the public site.`,
    recommended_action: 'Review the application details, proof of work, and contact context before moving the intake status forward.',
    dedupe_key: dedupeKey,
    metadata: {
      display_name: input.displayName,
      email: input.email,
      location: input.location,
      specialty: input.specialty,
      status: input.status,
      source: input.source,
    },
    resolved_at: null,
    last_seen_at: new Date().toISOString(),
  }

  if (existing.data?.id) {
    await client
      .from('ops_issues')
      .update(payload)
      .eq('id', existing.data.id)
  } else {
    await client
      .from('ops_issues')
      .insert(payload)
  }
}

function rateLimitResponse() {
  return NextResponse.json(
    createRateLimitPayload(RATE_LIMIT_RETRY_AFTER_SECONDS),
    {
      status: 429,
      headers: {
        'Retry-After': String(RATE_LIMIT_RETRY_AFTER_SECONDS),
        'Content-Type': 'application/json',
      },
    },
  )
}

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

function hasMeaningfulApplicationChanges(
  existing: {
    business_name: string
    display_name: string
    location: string
    specialty: string
    portfolio_url: string | null
    instagram_url: string | null
    notes: string
    source: string
    status: string
  } | null,
  next: {
    business_name: string
    display_name: string
    location: string
    specialty: string
    portfolio_url: string | null
    instagram_url: string | null
    notes: string
    source: string
    status: string
  },
) {
  if (!existing) return true

  return (
    existing.business_name !== next.business_name ||
    existing.display_name !== next.display_name ||
    existing.location !== next.location ||
    existing.specialty !== next.specialty ||
    existing.portfolio_url !== next.portfolio_url ||
    existing.instagram_url !== next.instagram_url ||
    existing.notes !== next.notes ||
    existing.source !== next.source ||
    existing.status !== next.status
  )
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
  const ipRateLimit = await checkPublicRateLimit(
    client,
    `web:tailor-application:ip:${ip}`,
    RATE_LIMITS.unauthenticated.windowMs / 1000,
    RATE_LIMITS.unauthenticated.limit,
  )
  if (!ipRateLimit.ok) {
    return NextResponse.json(
      { error: 'We are unable to accept applications right now. Please try again shortly.' },
      { status: 500 }
    )
  }
  if (!ipRateLimit.allowed) {
    return rateLimitResponse()
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

  const emailRateLimit = await checkPublicRateLimit(
    client,
    `web:tailor-application:email:${email}`,
    RATE_LIMITS.unauthenticated.windowMs / 1000,
    RATE_LIMITS.unauthenticated.limit,
  )
  if (!emailRateLimit.ok) {
    return NextResponse.json(
      { error: 'We are unable to accept applications right now. Please try again shortly.' },
      { status: 500 }
    )
  }
  if (!emailRateLimit.allowed) {
    return rateLimitResponse()
  }

  const application = {
    business_name: businessName,
    display_name: displayName,
    email,
    location,
    specialty,
    portfolio_url: portfolioUrl,
    instagram_url: instagramUrl,
    notes,
    source: 'WEB' as const,
    status: 'PENDING' as const,
  }

  const { data: existingApplication, error: existingApplicationError } = await client
    .from('tailor_applications')
    .select('business_name, display_name, location, specialty, portfolio_url, instagram_url, notes, source, status')
    .eq('email', email)
    .maybeSingle()

  if (existingApplicationError) {
    console.error('[tailor-application] Unable to read existing application before upsert.', {
      email,
      message: existingApplicationError.message,
    })
    return NextResponse.json({ error: 'Unable to submit your application right now.' }, { status: 500 })
  }

  const shouldNotifyInbox = hasMeaningfulApplicationChanges(existingApplication, application)

  const { data: savedApplication, error } = await client
    .from('tailor_applications')
    .upsert(application, {
      onConflict: 'email',
    })
    .select('id, created_at, status')
    .single()

  if (error) {
    return NextResponse.json({ error: 'Unable to submit your application right now.' }, { status: 500 })
  }

  if (shouldNotifyInbox) {
    const notification = await sendTailorApplicationNotification({
      mode: existingApplication ? 'updated' : 'created',
      businessName,
      displayName,
      email,
      location,
      specialty,
      portfolioUrl,
      instagramUrl,
      notes,
      source: application.source,
      status: savedApplication?.status ?? application.status,
      createdAt: savedApplication?.created_at ?? null,
    })

    if (!notification.ok && !notification.skipped) {
      console.error('[tailor-application] Application saved but lead email failed.', { email })
    }
  }

  if (savedApplication?.id) {
    await createOrRefreshApplicationOpsIssue(client, {
      applicationId: savedApplication.id,
      displayName,
      email,
      location,
      specialty,
      status: savedApplication.status ?? application.status,
      source: application.source,
    })
  }

  return NextResponse.json({ ok: true })
}
