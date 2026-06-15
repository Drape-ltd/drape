#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const baseUrl = process.env.WEB_QA_BASE_URL ?? 'http://127.0.0.1:3000'
const outDir = process.env.WEB_QA_OUT_DIR ?? '/private/tmp/drape-web-qa'
const chromeExecutablePath = process.env.WEB_QA_CHROME_EXECUTABLE || undefined

async function main() {
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({ headless: true, executablePath: chromeExecutablePath })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } })
  const page = await context.newPage()
  const events = []

  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) events.push({ type: message.type(), text: message.text() })
  })
  page.on('requestfailed', (request) => {
    events.push({ type: 'requestfailed', text: `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}` })
  })
  page.on('pageerror', (error) => events.push({ type: 'pageerror', text: error.message }))

  async function screenshot(name) {
    await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: false })
  }

  await page.goto(`${baseUrl}/sign-up`, { waitUntil: 'domcontentloaded', timeout: 10_000 })
  await page.waitForTimeout(500)
  await screenshot('auth-sign-up-initial')

  await page.getByRole('button', { name: 'Tailor', exact: true }).click()
  await page.waitForTimeout(250)
  await screenshot('auth-sign-up-tailor')

  await page.getByRole('button', { name: 'Customer', exact: true }).click()
  await page.getByRole('button', { name: /Create account/i }).click()
  await page.waitForTimeout(250)
  const emptyValidation = await page.locator('body').innerText()
  await screenshot('auth-sign-up-empty-validation')

  await page.locator('input[autocomplete="name"]').fill('QA Web Tester')
  await page.locator('input[autocomplete="tel"]').fill('+15555550123')
  await page.locator('input[type="email"]').fill('not-an-email')
  await page.locator('input[autocomplete="new-password"]').first().fill('weak')
  await page.locator('input[autocomplete="new-password"]').nth(1).fill('weak')
  await page.getByRole('button', { name: /Create account/i }).click()
  await page.waitForTimeout(250)
  const invalidEmailValidation = await page.locator('body').innerText()
  await screenshot('auth-sign-up-invalid-email')

  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 10_000 })
  await page.waitForTimeout(500)
  await screenshot('auth-sign-in-initial')
  await page.getByRole('button', { name: /^Sign in$/i }).click()
  await page.waitForTimeout(250)
  const signInValidation = await page.locator('body').innerText()
  await screenshot('auth-sign-in-empty-validation')

  const report = {
    events,
    emptyValidation: emptyValidation.includes('Enter a valid email address.'),
    invalidEmailValidation: invalidEmailValidation.includes('Enter a valid email address.'),
    signInValidation: signInValidation.includes('Enter a valid email address.'),
  }
  await writeFile(path.join(outDir, 'auth-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
