#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, '..')

const PACKAGE_NAME = process.env.DRAPE_ANDROID_PACKAGE ?? 'com.drape.app'
const CUSTOMER_DEVICE_ID = process.env.DRAPE_QA_PIXEL_DEVICE ?? '38271FDJH0030C'
const TAILOR_DEVICE_ID = process.env.DRAPE_QA_A17_DEVICE ?? 'R5GL40FWHQR'

const args = process.argv.slice(2)
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const artifactRoot = resolve(appDir, 'qa-artifacts', 'android', timestamp)
const reportPath = resolve(artifactRoot, 'report.md')
const summaryPath = resolve(artifactRoot, 'summary.json')

const options = {
  baselineOnly: args.includes('--baseline-only'),
  noLaunch: args.includes('--no-launch'),
  noClearLogs: args.includes('--no-clear-logs'),
  warmLaunch: args.includes('--warm-launch'),
  launchWaitMs: numberAfter('--launch-wait-ms', 5000),
  help: args.includes('--help') || args.includes('-h'),
  captureOnly: valueAfter('--capture-only'),
}

const devices = [
  { role: 'customer', label: 'Pixel customer', id: CUSTOMER_DEVICE_ID },
  { role: 'tailor', label: 'Samsung A17 tailor', id: TAILOR_DEVICE_ID },
]

const checkpoints = [
  {
    id: '01_customer_explore_profile',
    title: 'Customer baseline: Explore and tailor profile',
    devices: ['customer'],
    instructions: [
      'On Pixel, open Explore.',
      'Confirm real tailor photos are visible.',
      'Open John or the current live tailor.',
      'Verify profile photo, portfolio media, rating/reviews, wishlist, shop entry, and custom order CTA.',
      'Navigate back to Explore and confirm state is preserved.',
    ],
  },
  {
    id: '02_custom_order_created',
    title: 'Create a new custom pickup order',
    devices: ['customer', 'tailor'],
    instructions: [
      'On Pixel, start a custom order from the live tailor.',
      'Fill garment type, fit category, brief, measurements/manual path, deadline, pickup fulfillment, and cancellation acknowledgement.',
      'Submit the request/quote.',
      'On A17, confirm the order appears and the brief, measurements, pickup details, and quote/payment state make sense.',
      'Stop before any unsafe ops-only action.',
    ],
  },
  {
    id: '03_ready_made_preflight_and_checkout',
    title: 'Ready-made publish and customer checkout',
    devices: ['customer', 'tailor'],
    instructions: [
      'On A17, open Shop and verify incomplete publish is blocked with a human message.',
      'If safe, create or use a reversible ready-made item with title, category, price, photo, size, stock, pickup, and fit guide.',
      'On Pixel, find the item, open detail, verify image, price, stock, low-stock copy, wishlist, pickup checkout, and test payment path if safe.',
      'Verify the resulting order appears on both devices.',
    ],
  },
  {
    id: '04_order_production_pickup',
    title: 'Order production and pickup checks',
    devices: ['customer', 'tailor'],
    instructions: [
      'On A17, open an active paid/test order if available.',
      'Verify designing, sourcing, cutting gate, sewing, finishing, and ready-for-collection progression.',
      'Verify fresh photo/video support for stage media and customer timeline visibility.',
      'On Pixel, confirm stage updates refresh and pickup instructions are clear.',
      'Complete pickup only if it is test-safe and does not trigger payout/ops intervention.',
    ],
  },
  {
    id: '05_messages',
    title: 'Messages, read receipts, and contact-sharing block',
    devices: ['customer', 'tailor'],
    instructions: [
      'Open the customer-to-tailor thread from an active order.',
      'Send a normal message and verify it appears on both devices.',
      'Open the thread on the other device and verify read state if visible.',
      'Try blocked contact-sharing text and verify a human error message with no raw server text.',
      'Verify closed order threads are read-only and not clipped.',
    ],
  },
  {
    id: '06_account_settings_profile',
    title: 'Account settings and profile mapping',
    devices: ['customer', 'tailor'],
    instructions: [
      'On both devices, open Profile and Account settings.',
      'Verify personal info, login/security, notifications, currency, payment history/earnings, privacy, delete-account guard, and sign out rows map correctly.',
      'Do not delete accounts or sign out unless intentionally testing sign-in recovery.',
      'Verify currency display consistency across dashboard, order detail, payment history, and checkout/payment screens.',
    ],
  },
  {
    id: '07_failure_cases',
    title: 'Failure and edge-case sweep',
    devices: ['customer', 'tailor'],
    instructions: [
      'Submit a required form empty and verify field-level copy.',
      'Test Android Vision unavailable path and confirm retake/manual alternatives.',
      'Test incomplete ready-made publish.',
      'Test review submission with selected tags but short text.',
      'Check back navigation from modals/screens.',
      'Verify no raw errors, blank screens, or stuck flows.',
    ],
  },
]

const summary = {
  packageName: PACKAGE_NAME,
  startedAt: new Date().toISOString(),
  artifactRoot,
  launchMode: options.warmLaunch ? 'warm' : 'cold-force-stop',
  launchWaitMs: options.launchWaitMs,
  devices,
  checkpoints: [],
  blockers: [],
}

if (options.help) {
  printHelp()
  process.exit(0)
}

mkdirSync(artifactRoot, { recursive: true })
writeReportHeader()

main().catch((error) => {
  console.error('[qa] Fatal runner error:', error)
  summary.blockers.push({
    type: 'RUNNER_ERROR',
    message: error instanceof Error ? error.message : String(error),
  })
  finishSummary()
  process.exit(1)
})

async function main() {
  console.log(`[qa] Writing Android QA artifacts to ${artifactRoot}`)
  verifyDevices()

  if (!options.noClearLogs) clearCrashLogs()
  if (!options.noLaunch && !options.captureOnly) launchApps()

  if (options.captureOnly) {
    captureCheckpoint({
      id: slug(options.captureOnly),
      title: options.captureOnly,
      devices: ['customer', 'tailor'],
      instructions: ['Manual capture-only checkpoint.'],
    })
    finishSummary()
    return
  }

  captureCheckpoint({
    id: '00_cold_launch',
    title: 'Cold launch baseline',
    devices: ['customer', 'tailor'],
    instructions: ['App was launched cold on both devices.'],
  })

  if (options.baselineOnly) {
    finishSummary()
    return
  }

  await runGuidedCheckpoints()
  finishSummary()
}

async function runGuidedCheckpoints() {
  const rl = createInterface({ input, output })

  console.log('\n[qa] Guided mode keeps risky actions human-controlled.')
  console.log('[qa] Complete each checkpoint on the real devices, then press Enter to capture evidence.')
  console.log('[qa] Type "s" then Enter to skip a checkpoint, or "q" then Enter to finish early.\n')

  for (const checkpoint of checkpoints) {
    printCheckpoint(checkpoint)
    const answer = (await rl.question('Capture this checkpoint now? [Enter=yes, s=skip, q=quit] ')).trim().toLowerCase()

    if (answer === 'q') {
      appendReport(`\n## Stopped Early\n\nStopped before checkpoint: ${checkpoint.title}\n`)
      break
    }

    if (answer === 's') {
      summary.checkpoints.push({
        id: checkpoint.id,
        title: checkpoint.title,
        status: 'skipped',
        capturedAt: new Date().toISOString(),
      })
      appendReport(`\n## ${checkpoint.title}\n\nStatus: skipped by runner operator.\n`)
      continue
    }

    captureCheckpoint(checkpoint)
  }

  rl.close()
}

function verifyDevices() {
  const connected = runHost('adb', ['devices']).stdout
  writeFileSync(resolve(artifactRoot, 'adb-devices.txt'), connected)

  for (const device of devices) {
    try {
      const state = adb(device, ['get-state']).trim()
      const model = adb(device, ['shell', 'getprop', 'ro.product.model']).trim()
      const manufacturer = adb(device, ['shell', 'getprop', 'ro.product.manufacturer']).trim()
      const nightMode = safeAdb(device, ['shell', 'cmd', 'uimode', 'night']).trim()
      device.state = state
      device.model = model
      device.manufacturer = manufacturer
      device.nightMode = nightMode
      console.log(`[qa] ${device.label}: ${manufacturer} ${model}, ${state}, ${nightMode || 'night mode unknown'}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      summary.blockers.push({
        type: 'DEVICE_NOT_READY',
        device: device.label,
        id: device.id,
        message,
      })
      throw new Error(`${device.label} (${device.id}) is not available. ${message}`)
    }
  }
}

function clearCrashLogs() {
  for (const device of devices) {
    safeAdb(device, ['logcat', '-c'])
  }
}

function launchApps() {
  for (const device of devices) {
    if (!options.warmLaunch) {
      safeAdb(device, ['shell', 'am', 'force-stop', PACKAGE_NAME])
    }
    safeAdb(device, ['shell', 'monkey', '-p', PACKAGE_NAME, '-c', 'android.intent.category.LAUNCHER', '1'])
  }
  sleep(options.launchWaitMs)
}

function captureCheckpoint(checkpoint) {
  const capturedAt = new Date().toISOString()
  const checkpointDir = resolve(artifactRoot, checkpoint.id)
  mkdirSync(checkpointDir, { recursive: true })

  const captureRecord = {
    id: checkpoint.id,
    title: checkpoint.title,
    status: 'captured',
    capturedAt,
    devices: [],
  }

  appendReport(`\n## ${checkpoint.title}\n\nCaptured: ${capturedAt}\n\n`)
  appendReport('Instructions verified manually before capture:\n')
  for (const instruction of checkpoint.instructions) {
    appendReport(`- ${instruction}\n`)
  }

  for (const role of checkpoint.devices) {
    const device = devices.find((item) => item.role === role)
    if (!device) continue

    const deviceRecord = captureDevice(device, checkpointDir, checkpoint.id)
    captureRecord.devices.push(deviceRecord)

    appendReport(`\n### ${device.label}\n\n`)
    appendReport(`- Screenshot: ${deviceRecord.screenshot}\n`)
    appendReport(`- UI dump: ${deviceRecord.uiDump}\n`)
    appendReport(`- Visible text: ${deviceRecord.visibleText}\n`)
    appendReport(`- Crash log: ${deviceRecord.crashLog}\n`)
    if (deviceRecord.appLog) appendReport(`- App log: ${deviceRecord.appLog}\n`)
  }

  appendReport('\n')
  summary.checkpoints.push(captureRecord)
  finishSummary()
  console.log(`[qa] Captured ${checkpoint.title}`)
}

function captureDevice(device, checkpointDir, checkpointId) {
  const prefix = `${checkpointId}-${device.role}`
  const remotePng = `/sdcard/${prefix}.png`
  const remoteXml = `/sdcard/${prefix}.xml`

  const localPng = resolve(checkpointDir, `${prefix}.png`)
  const localXml = resolve(checkpointDir, `${prefix}.xml`)
  const localText = resolve(checkpointDir, `${prefix}.visible-text.txt`)
  const crashLog = resolve(checkpointDir, `${prefix}.crash.log`)
  const appLog = resolve(checkpointDir, `${prefix}.app.log`)

  adb(device, ['shell', 'uiautomator', 'dump', remoteXml])
  adb(device, ['pull', remoteXml, localXml])
  safeAdb(device, ['shell', 'rm', remoteXml])

  const xml = existsSync(localXml) ? readFileSync(localXml, 'utf8') : ''
  writeFileSync(localText, extractVisibleText(xml))

  adb(device, ['shell', 'screencap', '-p', remotePng])
  adb(device, ['pull', remotePng, localPng])
  safeAdb(device, ['shell', 'rm', remotePng])

  writeFileSync(crashLog, safeAdb(device, ['logcat', '-b', 'crash', '-d', '-v', 'time', '-t', '300']))

  const pid = safeAdb(device, ['shell', 'pidof', PACKAGE_NAME]).trim()
  if (pid) {
    writeFileSync(appLog, safeAdb(device, ['logcat', '-d', '-v', 'time', '--pid', pid, '-t', '500']))
  }

  return {
    device: device.label,
    id: device.id,
    screenshot: rel(localPng),
    uiDump: rel(localXml),
    visibleText: rel(localText),
    crashLog: rel(crashLog),
    appLog: existsSync(appLog) ? rel(appLog) : null,
  }
}

function adb(device, adbArgs) {
  return runHost('adb', ['-s', device.id, ...adbArgs]).stdout
}

function safeAdb(device, adbArgs) {
  try {
    return adb(device, adbArgs)
  } catch {
    return ''
  }
}

function runHost(command, commandArgs) {
  const stdout = execFileSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return { stdout }
}

function sleep(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    // Keep this dependency-free and synchronous; the wait is short and only used for app launch.
  }
}

function extractVisibleText(xml) {
  const values = []
  const patterns = [
    /\btext="([^"]+)"/gu,
    /\bcontent-desc="([^"]+)"/gu,
    /\bhint="([^"]+)"/gu,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(xml)) !== null) {
      const value = decodeXml(match[1]).trim()
      if (!value) continue
      if (value.length === 1 && value.charCodeAt(0) >= 0xe000) continue
      values.push(value)
    }
  }

  return Array.from(new Set(values)).join('\n') + '\n'
}

function decodeXml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function valueAfter(flag) {
  const index = args.indexOf(flag)
  if (index === -1) return null
  return args[index + 1] ?? 'manual-capture'
}

function numberAfter(flag, fallback) {
  const raw = valueAfter(flag)
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'manual-capture'
}

function rel(filePath) {
  return relative(appDir, filePath)
}

function writeReportHeader() {
  writeFileSync(
    reportPath,
    `# Android QA Run\n\nStarted: ${summary.startedAt}\nPackage: ${PACKAGE_NAME}\nArtifacts: ${artifactRoot}\n\n` +
      '## Devices\n\n' +
      devices.map((device) => `- ${device.label}: ${device.id}`).join('\n') +
      '\n',
  )
}

function appendReport(value) {
  writeFileSync(reportPath, readFileSync(reportPath, 'utf8') + value)
}

function finishSummary() {
  summary.finishedAt = new Date().toISOString()
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
}

function printCheckpoint(checkpoint) {
  console.log(`\n=== ${checkpoint.title} ===`)
  console.log(`Devices: ${checkpoint.devices.join(', ')}`)
  for (const instruction of checkpoint.instructions) {
    console.log(`- ${instruction}`)
  }
  console.log('')
}

function printHelp() {
  console.log(`Drapeon Android QA runner

Usage:
  pnpm qa:android
  pnpm qa:android -- --baseline-only
  pnpm qa:android -- --capture-only "current screen"

Environment overrides:
  DRAPE_QA_PIXEL_DEVICE     Pixel customer device id. Default: ${CUSTOMER_DEVICE_ID}
  DRAPE_QA_A17_DEVICE       Samsung A17 tailor device id. Default: ${TAILOR_DEVICE_ID}
  DRAPE_ANDROID_PACKAGE     App package. Default: ${PACKAGE_NAME}

Options:
  --baseline-only           Launch both devices, capture cold state, then exit.
  --capture-only <name>     Capture current state on both devices without guided checkpoints.
  --no-launch               Do not launch the app before the run.
  --no-clear-logs           Keep existing logcat buffers.
  --warm-launch             Resume the app instead of force-stopping before launch.
  --launch-wait-ms <ms>     Wait after launch before baseline capture. Default: ${options.launchWaitMs}.

Artifacts:
  apps/mobile/qa-artifacts/android/<timestamp>/
`)
}
