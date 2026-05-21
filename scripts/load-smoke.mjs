#!/usr/bin/env node
import { readFileSync } from 'node:fs'

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function loadEnv(path) {
  try {
    const text = readFileSync(path, 'utf8')
    const env = {}
    for (const line of text.split(/\r?\n/u)) {
      const match = line.match(/^([^#=\s]+)=(.*)$/u)
      if (!match) continue
      env[match[1]] = match[2].replace(/^"|"$/gu, '')
    }
    return env
  } catch {
    return {}
  }
}

async function timed(label, fn) {
  const started = performance.now()
  try {
    const result = await fn()
    return { label, ok: true, ms: Math.round(performance.now() - started), status: result.status }
  } catch (error) {
    return {
      label,
      ok: false,
      ms: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function expectOk(response) {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${response.status}: ${text.slice(0, 240)}`)
  }
  return { status: response.status }
}

const envFile = argValue('--env', 'apps/mobile/.env.local')
const iterations = Math.max(1, Math.min(200, Number(argValue('--iterations', '20')) || 20))
const concurrency = Math.max(1, Math.min(20, Number(argValue('--concurrency', '5')) || 5))
const env = { ...loadEnv(envFile), ...process.env }

const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL
const anonKey = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY
const healthSecret = env.DRAPE_HEALTHCHECK_SECRET ?? env.HEALTHCHECK_SECRET
const cronSecret = env.DRAPE_CRON_SECRET ?? env.SUPABASE_CRON_SECRET

if (!supabaseUrl || !anonKey) {
  console.error(`Missing Supabase URL or publishable key. Checked ${envFile} and process env.`)
  process.exit(2)
}

const functionBase = `${supabaseUrl}/functions/v1`
const headers = {
  apikey: anonKey,
  authorization: `Bearer ${anonKey}`,
  'content-type': 'application/json',
}

const scenarios = [
  () => timed('service-health/live', () => fetch(`${functionBase}/service-health?check=live`, { headers }).then(expectOk)),
  () => timed('read-gateway/explore-tailors', () =>
    fetch(`${functionBase}/read-gateway`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'explore-tailors', limit: 12 }),
    }).then(expectOk)),
]

if (healthSecret) {
  scenarios.push(() => timed('service-health/ready', () =>
    fetch(`${functionBase}/service-health?check=ready`, {
      headers: { ...headers, 'x-drape-healthcheck-secret': healthSecret },
    }).then(expectOk)))
}

if (cronSecret) {
  scenarios.push(() => timed('process-job-queue/noop', () =>
    fetch(`${functionBase}/process-job-queue`, {
      method: 'POST',
      headers: { ...headers, 'x-drape-cron-secret': cronSecret },
      body: JSON.stringify({ limit: 1 }),
    }).then(expectOk)))
}

const results = []
let next = 0

async function worker() {
  while (next < iterations) {
    const index = next
    next += 1
    const scenario = scenarios[index % scenarios.length]
    results.push(await scenario())
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()))

const failed = results.filter((result) => !result.ok)
const sorted = [...results].sort((left, right) => left.ms - right.ms)
const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]?.ms ?? 0

console.log(JSON.stringify({
  ok: failed.length === 0,
  iterations,
  concurrency,
  scenarios: scenarios.length,
  p95Ms: p95,
  failed: failed.slice(0, 10),
  byLabel: results.reduce((acc, result) => {
    const existing = acc[result.label] ?? { count: 0, failed: 0, maxMs: 0 }
    existing.count += 1
    existing.failed += result.ok ? 0 : 1
    existing.maxMs = Math.max(existing.maxMs, result.ms)
    acc[result.label] = existing
    return acc
  }, {}),
}, null, 2))

if (failed.length > 0) process.exit(1)
