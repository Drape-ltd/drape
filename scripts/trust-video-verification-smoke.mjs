#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

function loadEnv(filePath) {
  try {
    const env = {}
    for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
      const match = line.match(/^([^#=\s]+)=(.*)$/u)
      if (match) env[match[1]] = match[2].replace(/^"|"$/gu, '').trim()
    }
    return env
  } catch {
    return {}
  }
}

const env = {
  ...loadEnv(new URL('../apps/web/.env.local', import.meta.url)),
  ...process.env,
}
const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL ?? '').replace(/\/+$/u, '')
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY ?? ''
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error('Supabase URL, anon key, and service-role key are required.')
}

if (!supabaseUrl.includes('pqptfuqogvrajozfsqzi')) {
  throw new Error('This smoke is development-only and refuses to run against an unknown project.')
}

const stamp = Date.now()
const email = `trust.video.qa.${stamp}@drapeon.co`
const password = `TrustVideoQA-${randomUUID()}!`
let userId = null
let profileId = null
let handoffId = null
let storagePath = null

function headers(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

async function request(url, options, label) {
  const response = await fetch(url, options)
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`)
  }
  return { status: response.status, body }
}

async function rest(table, query = '') {
  return request(
    `${supabaseUrl}/rest/v1/${table}${query}`,
    { headers: headers(serviceRoleKey) },
    `Read ${table}`,
  )
}

async function restWrite(table, method, body, query = '', prefer = 'return=representation') {
  return request(
    `${supabaseUrl}/rest/v1/${table}${query}`,
    {
      method,
      headers: headers(serviceRoleKey, { Prefer: prefer }),
      body: body == null ? undefined : JSON.stringify(body),
    },
    `${method} ${table}`,
  )
}

async function invoke(action, body, bearer = anonKey) {
  return request(
    `${supabaseUrl}/functions/v1/identity-handoff-action`,
    {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, ...body }),
    },
    `identity-handoff-action:${action}`,
  )
}

async function cleanup() {
  const failures = []
  const attempt = async (label, fn) => {
    try {
      await fn()
    } catch (error) {
      failures.push({ label, error: error instanceof Error ? error.message : String(error) })
    }
  }

  if (userId && profileId) {
    await attempt('verification reset', async () => {
      const state = await rest('tailor_profiles', `?select=id_verification_status&id=eq.${profileId}`)
      if (state.body?.[0]?.id_verification_status !== 'PENDING') return
      await request(
        `${supabaseUrl}/rest/v1/rpc/ops_decide_verification`,
        {
          method: 'POST',
          headers: headers(serviceRoleKey),
          body: JSON.stringify({
            p_tailor_user_id: userId,
            p_decision: 'REJECT',
            p_reason: 'Disposable trust-video QA fixture cleanup.',
            p_rejection_code: null,
          }),
        },
        'Reset pending trust verification',
      )
    })
  }
  if (storagePath) {
    await attempt('storage object', () => request(
      `${supabaseUrl}/storage/v1/object/trust-verification`,
      {
        method: 'DELETE',
        headers: headers(serviceRoleKey),
        body: JSON.stringify({ prefixes: [storagePath] }),
      },
      'Delete trust video object',
    ))
  }
  if (userId) {
    await attempt('audit logs', () => restWrite('audit_logs', 'DELETE', null, `?actor_id=eq.${userId}`, 'return=minimal'))
    await attempt('decision audit logs', () => restWrite(
      'audit_logs',
      'DELETE',
      null,
      `?event=eq.tailor.verification_decided&payload=cs.${encodeURIComponent(JSON.stringify({ tailor_user_id: userId }))}`,
      'return=minimal',
    ))
    await attempt('consents', () => restWrite('identity_verification_consents', 'DELETE', null, `?tailor_user_id=eq.${userId}`, 'return=minimal'))
    await attempt('handoffs', () => restWrite('identity_verification_handoffs', 'DELETE', null, `?tailor_user_id=eq.${userId}`, 'return=minimal'))
  }
  if (profileId) {
    await attempt('ops issues', () => restWrite('ops_issues', 'DELETE', null, `?tailor_profile_id=eq.${profileId}`, 'return=minimal'))
    await attempt('profile', () => restWrite('tailor_profiles', 'DELETE', null, `?id=eq.${profileId}`, 'return=minimal'))
  }
  if (userId) {
    await attempt('public user', () => restWrite('users', 'DELETE', null, `?id=eq.${userId}`, 'return=minimal'))
    await attempt('auth user', () => request(
      `${supabaseUrl}/auth/v1/admin/users/${userId}`,
      { method: 'DELETE', headers: headers(serviceRoleKey) },
      'Delete auth user',
    ))
  }
  return failures
}

let result = null
try {
  const authUser = await request(
    `${supabaseUrl}/auth/v1/admin/users`,
    {
      method: 'POST',
      headers: headers(serviceRoleKey),
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: 'Trust Video QA', role: 'TAILOR' },
      }),
    },
    'Create disposable auth user',
  )
  userId = authUser.body?.id
  if (!userId) throw new Error('Disposable auth user did not return an ID.')

  await restWrite('users', 'POST', {
    id: userId,
    email,
    phone: `+15563${String(stamp).slice(-6)}`,
    display_name: 'Trust Video QA',
    role: 'TAILOR',
    default_currency: 'USD',
    currency_source: 'USER_SELECTED',
    region_code: 'US',
    currency_confirmed_at: new Date().toISOString(),
  }, '?on_conflict=id', 'resolution=merge-duplicates,return=representation')

  const profile = await restWrite('tailor_profiles', 'POST', {
    user_id: userId,
    display_name: 'Trust Video QA',
    business_name: 'Trust Video QA Studio',
    bio: 'Disposable profile used to prove the private challenge-video submission contract.',
    location: 'Chicago, IL',
    languages: ['English'],
    specialty_tags: ['Alterations'],
    avatar_url: 'https://drapeon.co/logo.png',
    portfolio_photo_urls: ['https://drapeon.co/logo.png'],
    supports_custom_orders: true,
    supports_ready_made: false,
    id_verification_status: 'NOT_SUBMITTED',
    profile_completed: false,
  }, '?on_conflict=user_id', 'resolution=merge-duplicates,return=representation')
  profileId = profile.body?.[0]?.id
  if (!profileId) throw new Error('Disposable tailor profile did not return an ID.')

  const session = await request(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: headers(anonKey),
      body: JSON.stringify({ email, password }),
    },
    'Create disposable tailor session',
  )
  const accessToken = session.body?.access_token
  if (!accessToken) throw new Error('Disposable tailor session did not return an access token.')

  const created = await invoke('create', {}, accessToken)
  const token = created.body?.token
  handoffId = created.body?.handoffId
  const challengeId = created.body?.challengeId
  const challengeText = created.body?.challengeText
  if (!token || !handoffId || !challengeId || !challengeText) {
    throw new Error('Challenge creation did not return its complete contract.')
  }

  const resolved = await invoke('resolve-token', { token })
  if (resolved.body?.status !== 'OPENED' || resolved.body?.challengeId !== challengeId) {
    throw new Error('Challenge resolution did not preserve the active challenge.')
  }

  const upload = await invoke('create-upload-url', { token, contentType: 'video/mp4' })
  storagePath = upload.body?.path
  const uploadToken = upload.body?.uploadToken
  if (!storagePath || !uploadToken) throw new Error('Signed upload contract was incomplete.')

  await request(
    `${supabaseUrl}/storage/v1/object/upload/sign/trust-verification/${storagePath}?token=${encodeURIComponent(uploadToken)}`,
    {
      method: 'PUT',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'video/mp4',
        'cache-control': 'max-age=3600',
        'x-upsert': 'false',
      },
      body: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]),
    },
    'Upload disposable challenge video',
  )

  const submitted = await invoke('submit', {
    token,
    storagePath,
    consentGranted: true,
    consentVersion: 'tailor-trust-video-v1',
    consentSource: 'WEB_HANDOFF',
    locale: 'en-US',
  })
  if (submitted.body?.status !== 'PENDING' || submitted.body?.profileId !== profileId) {
    throw new Error('Challenge submission did not return the pending profile contract.')
  }

  const profileState = await rest(
    'tailor_profiles',
    `?select=id,id_verification_status,id_verification_method,trust_verification_video_path,trust_verification_challenge_id,trust_verification_challenge_text&id=eq.${profileId}`,
  )
  const handoffState = await rest(
    'identity_verification_handoffs',
    `?select=id,status,storage_path,challenge_id,challenge_text&id=eq.${handoffId}`,
  )
  const consentState = await rest(
    'identity_verification_consents',
    `?select=policy_version,source,tailor_user_id&tailor_user_id=eq.${userId}&policy_version=eq.tailor-trust-video-v1`,
  )
  const auditState = await rest(
    'audit_logs',
    `?select=event,actor_id&actor_id=eq.${userId}&event=eq.trust_video_handoff.submitted`,
  )

  const savedProfile = profileState.body?.[0]
  const savedHandoff = handoffState.body?.[0]
  if (
    savedProfile?.id_verification_status !== 'PENDING'
    || savedProfile?.id_verification_method !== 'CHALLENGE_VIDEO'
    || savedProfile?.trust_verification_video_path !== storagePath
    || savedProfile?.trust_verification_challenge_id !== challengeId
    || savedHandoff?.status !== 'SUBMITTED'
    || savedHandoff?.storage_path !== storagePath
    || consentState.body?.length !== 1
    || auditState.body?.length < 1
  ) {
    throw new Error('Persisted challenge-video state did not match the submitted contract.')
  }

  result = {
    createStatus: created.status,
    resolveStatus: resolved.status,
    uploadContractStatus: upload.status,
    submitStatus: submitted.status,
    profileStatus: savedProfile.id_verification_status,
    verificationMethod: savedProfile.id_verification_method,
    handoffStatus: savedHandoff.status,
    consentRecorded: consentState.body.length === 1,
    auditRecorded: auditState.body.length >= 1,
    privatePathValid: storagePath.startsWith(`verification-video/${userId}/challenge_${challengeId}_`),
  }
} finally {
  const cleanupFailures = await cleanup()
  console.log(JSON.stringify({ ...result, cleanupFailures }, null, 2))
  if (!result || cleanupFailures.length > 0) process.exitCode = 1
}
