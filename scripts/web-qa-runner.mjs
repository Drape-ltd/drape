#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const baseUrl = process.env.WEB_QA_BASE_URL ?? 'http://127.0.0.1:3000'
const outDir = process.env.WEB_QA_OUT_DIR ?? '/private/tmp/drape-web-qa'
const chromeExecutablePath = process.env.WEB_QA_CHROME_EXECUTABLE || undefined
const desktop = { width: 1440, height: 1200 }
const mobile = { width: 390, height: 844 }

const publicPaths = [
  '/',
  '/customers',
  '/tailors',
  '/vision',
  '/how-it-works',
  '/about',
  '/help',
  '/privacy',
  '/terms',
  '/contact',
  '/sign-in',
  '/sign-up',
]

const accountPaths = [
  '/account/dashboard',
  '/account/explore',
  '/account/saved',
  '/account/orders',
  '/account/messages',
  '/account/measurements',
  '/account/shop',
  '/account/work',
  '/account/settings',
  '/account/support',
]

function slug(value) {
  return value.replace(/^\//u, 'home').replace(/[^\w-]+/gu, '-').replace(/^-|-$/gu, '') || 'home'
}

async function run() {
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({ headless: true, executablePath: chromeExecutablePath })
  const findings = []

  async function checkPage(context, pagePath, viewportName) {
    console.log(`CHECK ${viewportName} ${pagePath}`)
    const page = await context.newPage()
    const consoleErrors = []
    const failedRequests = []
    page.setDefaultTimeout(4_000)

    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) {
        consoleErrors.push(`${message.type()}: ${message.text()}`)
      }
    })
    page.on('requestfailed', (request) => {
      failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? 'failed'}`)
    })
    page.on('pageerror', (error) => {
      consoleErrors.push(`pageerror: ${error.message}`)
    })

    const url = new URL(pagePath, baseUrl).toString()
    let status = null
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 })
      status = response?.status() ?? null
      await page.waitForLoadState('load', { timeout: 2_500 }).catch(() => {})
      await page.waitForTimeout(350)
      await page.screenshot({
        path: path.join(outDir, `${viewportName}-${slug(pagePath)}.png`),
        fullPage: false,
        timeout: 5_000,
      })
      const bodyText = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '')
      const badCopy = [
        'this page should contain',
        'coming soon',
        'not implemented',
        'web card entry is added',
        'complete card authorization in the app while web',
      ].filter((needle) => bodyText.toLowerCase().includes(needle))

      findings.push({
        path: pagePath,
        viewport: viewportName,
        status,
        title: await page.title().catch(() => ''),
        h1: await page.locator('h1').first().innerText({ timeout: 2_000 }).catch(() => null),
        consoleErrors,
        failedRequests,
        badCopy,
        url: page.url(),
      })
      console.log(`OK ${viewportName} ${pagePath} ${status ?? 'no-status'}`)
    } catch (error) {
      findings.push({
        path: pagePath,
        viewport: viewportName,
        status,
        title: '',
        h1: null,
        consoleErrors: [`navigation: ${error instanceof Error ? error.message : String(error)}`],
        failedRequests,
        badCopy: [],
        url,
      })
      console.log(`FAIL ${viewportName} ${pagePath} ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      await page.close()
    }
  }

  for (const [viewportName, viewport] of Object.entries({ desktop, mobile })) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: viewportName === 'mobile' ? 2 : 1,
      isMobile: viewportName === 'mobile',
      hasTouch: viewportName === 'mobile',
    })
    for (const pagePath of publicPaths) {
      await checkPage(context, pagePath, viewportName)
    }
    await context.close()
  }

  const authContext = await browser.newContext({ viewport: desktop })
  for (const pagePath of accountPaths) {
    await checkPage(authContext, pagePath, 'account-unauth')
  }
  await authContext.close()

  await browser.close()
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(findings, null, 2))

  const interesting = findings.filter((entry) =>
    entry.status === null ||
    (typeof entry.status === 'number' && entry.status >= 400) ||
    entry.consoleErrors.length > 0 ||
    entry.failedRequests.length > 0 ||
    entry.badCopy.length > 0
  )

  console.log(JSON.stringify({
    baseUrl,
    outDir,
    checked: findings.length,
    interesting,
  }, null, 2))
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
