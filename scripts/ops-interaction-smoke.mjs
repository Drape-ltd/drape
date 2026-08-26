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
  let elevationActionPayload = ''
  let simulateElevationError = false

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.route('**/ops/action', async (route) => {
    if (simulateElevationError) {
      elevationActionPayload = route.request().postData() ?? ''
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          redirectTo: '/ops?view=incidents&error=money-desk-elevation-required',
        }),
      })
      return
    }
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
  await page.getByRole('status').filter({ hasText: 'Ops action saved.' }).waitFor({ timeout: 10_000 })
  await page.waitForTimeout(250)

  const marker = await page.evaluate(() => window.__drapeOpsBridgeMarker)
  const feedbackRendered = await page.getByRole('status').filter({ hasText: 'Ops action saved.' }).isVisible()
  simulateElevationError = true
  await page.evaluate(() => {
    const form = document.createElement('form')
    form.method = 'post'
    form.action = '/ops/action'
    const kind = document.createElement('input')
    kind.name = 'kind'
    kind.value = 'money-desk-request'
    form.append(kind)
    document.body.append(form)
    form.requestSubmit()
  })
  const elevationAlert = page.getByRole('alert').filter({ hasText: 'Start a fresh 15-minute Money Desk elevation' })
  await elevationAlert.waitFor({ timeout: 10_000 })
  const elevationLink = elevationAlert.getByRole('link', { name: 'Open Money Desk' })
  const elevationErrorExplained = await elevationAlert.isVisible()
  const elevationRecoveryLinked = (await elevationLink.getAttribute('href')) === '/ops?view=money-desk#money-desk'
  await page.goto(`${baseUrl}/ops?view=money-desk#money-desk`, {
    waitUntil: 'networkidle',
    timeout: 20_000,
  })
  const payoutChangeHeading = page.getByRole('heading', { name: 'Approve payout destination change' }).first()
  await payoutChangeHeading.waitFor({ timeout: 10_000 })
  const payoutChangeCard = payoutChangeHeading.locator('xpath=ancestor::article')
  const reviewOriginLink = payoutChangeCard.getByRole('link', { name: 'Review originating issue' })
  const currentDestinationVisible = await payoutChangeCard.getByText('Current active destination', { exact: true }).isVisible()
  const requestedDestinationVisible = await payoutChangeCard.getByText('Requested replacement', { exact: true }).isVisible()
  const technicalDetailsVisible = await payoutChangeCard.getByText('Technical audit identifiers', { exact: true }).isVisible()
  await reviewOriginLink.click()
  await page.waitForLoadState('networkidle')
  const focusedIssue = page.locator('article[id^="workflow-issue-"]').filter({ has: page.getByRole('link', { name: 'Back to Money Desk review' }) }).first()
  await focusedIssue.waitFor({ state: 'visible', timeout: 10_000 })
  const focusedIssueOpen = await focusedIssue.locator('details').evaluate((element) => element.open)
  const backToMoneyDeskHref = await focusedIssue.getByRole('link', { name: 'Back to Money Desk review' }).getAttribute('href')
  const result = {
    pageStatus: response?.status() ?? null,
    hydrationErrors: consoleErrors.filter((entry) => entry.includes('Hydration failed')),
    consoleErrors,
    actionKindPreserved: actionPayload.includes('ops-issue-status'),
    submitterValuePreserved: actionPayload.includes('IN_REVIEW'),
    documentPreserved: marker === 'preserved',
    feedbackRendered,
    elevationErrorExplained,
    elevationRecoveryLinked,
    elevationActionPreserved: elevationActionPayload.includes('money-desk-request'),
    payoutReviewContextVisible: currentDestinationVisible && requestedDestinationVisible && technicalDetailsVisible,
    originIssueLinked: page.url().includes('view=workflow-issues') && page.url().includes('focusIssue='),
    originIssueOpened: focusedIssueOpen,
    moneyDeskReturnLinked: backToMoneyDeskHref?.includes('/ops?view=money-desk#money-desk-request-') === true,
  }

  console.log(JSON.stringify(result, null, 2))

  if (
    result.pageStatus !== 200 ||
    result.hydrationErrors.length > 0 ||
    result.consoleErrors.length > 0 ||
    !result.actionKindPreserved ||
    !result.submitterValuePreserved ||
    !result.documentPreserved ||
    !result.feedbackRendered ||
    !result.elevationErrorExplained ||
    !result.elevationRecoveryLinked ||
    !result.elevationActionPreserved ||
    !result.payoutReviewContextVisible ||
    !result.originIssueLinked ||
    !result.originIssueOpened ||
    !result.moneyDeskReturnLinked
  ) {
    process.exitCode = 1
  }
} finally {
  await browser.close()
}
