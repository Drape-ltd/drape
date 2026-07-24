#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const baseUrl = (process.env.OPS_SMOKE_BASE_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/u, '')

function loadEnv(filePath) {
  try {
    const entries = readFileSync(filePath, 'utf8')
      .split(/\r?\n/u)
      .map((line) => line.match(/^([^#=\s]+)=(.*)$/u))
      .filter(Boolean)
      .map((match) => [match[1], match[2].replace(/^"|"$/gu, '').trim()])
    return Object.fromEntries(entries)
  } catch {
    return {}
  }
}

const env = {
  ...loadEnv(new URL('../apps/web/.env.local', import.meta.url)),
  ...process.env,
}
const opsToken = env.OPS_DASHBOARD_TOKEN?.trim()

if (!opsToken) {
  throw new Error('OPS_DASHBOARD_TOKEN is required for the ops interaction smoke.')
}

const browser = await chromium.launch({ headless: true })

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addCookies([
    {
      name: 'drape_ops_session',
      value: createHash('sha256').update(opsToken).digest('hex'),
      url: baseUrl,
    },
  ])

  const page = await context.newPage()
  const consoleErrors = []
  let actionPayload = ''

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.route('**/ops/action', async (route) => {
    actionPayload = route.request().postData() ?? ''
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        redirectTo: '/ops?view=incidents&notice=bridge-smoke',
      }),
    })
  })

  const response = await page.goto(`${baseUrl}/ops?view=incidents`, {
    waitUntil: 'networkidle',
    timeout: 20_000,
  })
  await page.evaluate(() => {
    window.__drapeOpsBridgeMarker = 'preserved'
  })

  const statusButton = page
    .locator('form[action="/ops/action"] button[name="status"][value="IN_REVIEW"]')
    .first()
  const statusDetails = statusButton.locator('xpath=ancestor::details')
  if (!(await statusDetails.evaluate((element) => element.open))) {
    await statusDetails.locator('summary').click()
  }
  await statusButton.click()
  await page.waitForURL(/notice=bridge-smoke/u, { timeout: 10_000 })
  await page.waitForTimeout(500)

  const marker = await page.evaluate(() => window.__drapeOpsBridgeMarker)
  const result = {
    pageStatus: response?.status() ?? null,
    hydrationErrors: consoleErrors.filter((entry) => entry.includes('Hydration failed')),
    consoleErrors,
    actionKindPreserved: actionPayload.includes('ops-issue-status'),
    submitterValuePreserved: actionPayload.includes('IN_REVIEW'),
    documentPreserved: marker === 'preserved',
  }

  console.log(JSON.stringify(result, null, 2))

  if (
    result.pageStatus !== 200 ||
    result.hydrationErrors.length > 0 ||
    result.consoleErrors.length > 0 ||
    !result.actionKindPreserved ||
    !result.submitterValuePreserved ||
    !result.documentPreserved
  ) {
    process.exitCode = 1
  }
} finally {
  await browser.close()
}
