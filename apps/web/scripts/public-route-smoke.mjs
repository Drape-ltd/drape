#!/usr/bin/env node

const baseUrl = (process.env.DRAPE_WEB_SMOKE_BASE_URL || 'http://localhost:3004').replace(/\/$/, '')
const timeoutMs = 20_000
const routes = [
  '/',
  '/explore',
  '/how-it-works',
  '/tailors',
  '/apply',
  '/vision',
  '/about',
  '/privacy',
  '/terms',
  '/security',
  '/contact',
  '/sign-in',
  '/sign-up',
]

async function fetchBounded(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'Drapeon-Public-Route-Smoke/1.0' },
      redirect: 'manual',
      signal: controller.signal,
    })
    return { response, latencyMs: Date.now() - startedAt }
  } finally {
    clearTimeout(timer)
  }
}

async function fetchWithRetry(url) {
  let lastResult
  let lastError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      lastResult = await fetchBounded(url)
      if (lastResult.response.status < 500 && lastResult.response.status !== 404) return lastResult
    } catch (error) {
      lastError = error
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 350))
  }
  if (lastResult) return lastResult
  throw lastError
}

const failures = []
for (const route of routes) {
  const pageUrl = `${baseUrl}${route}`
  try {
    const { response, latencyMs } = await fetchWithRetry(pageUrl)
    if (!response.ok) {
      failures.push(`${route}: page HTTP ${response.status}`)
      continue
    }
    const html = await response.text()
    const chunkPaths = [...html.matchAll(/(?:src|href)="([^"?]+\.js)(?:\?[^\"]*)?"/g)]
      .map((match) => match[1])
      .filter((path) => path.startsWith('/_next/static/chunks/'))
    if (chunkPaths.length === 0) {
      failures.push(`${route}: no Next.js chunks found`)
      continue
    }
    const uniqueChunks = [...new Set(chunkPaths)]
    const chunkResults = await Promise.all(uniqueChunks.map(async (path) => {
      const result = await fetchWithRetry(`${baseUrl}${path}`)
      return { path, status: result.response.status }
    }))
    const brokenChunks = chunkResults.filter((result) => result.status !== 200)
    if (brokenChunks.length > 0) {
      failures.push(`${route}: ${brokenChunks.map((chunk) => `${chunk.path} HTTP ${chunk.status}`).join(', ')}`)
      continue
    }
    process.stdout.write(`PASS ${route} ${response.status} ${latencyMs}ms ${uniqueChunks.length} chunks\n`)
  } catch (error) {
    failures.push(`${route}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (failures.length > 0) {
  process.stderr.write(`Public route smoke failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}\n`)
  process.exit(1)
}

process.stdout.write(`All ${routes.length} public routes and emitted chunks passed.\n`)
