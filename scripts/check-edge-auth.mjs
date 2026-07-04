#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const functionsDir = join(root, 'supabase', 'functions')
const configPath = join(root, 'supabase', 'config.toml')

const controls = {
  user: ['getAuthUser('],
  cron: ['authorizeCronRequest('],
  serviceRole: ['isTrustedServiceRoleToken('],
  serviceRoleOrSignedLink: ['isServiceRoleRequest(', 'verifyPayload('],
  authSmsHook: ['AUTH_SMS_HOOK_SECRET', 'SUPABASE_AUTH_HOOK_SECRET'],
  supabaseWebhook: ['WEBHOOK_SECRET'],
  stripeWebhook: ['verifyStripeWebhookSignature('],
  paystackWebhook: ['verifyPaystackWebhookSignature('],
  deliveryWebhook: ['SHIPPO_WEBHOOK_SECRET', 'TOPSHIP_WEBHOOK_SECRET', 'SHIPBUBBLE_WEBHOOK_SECRET'],
  publicRateLimited: ['rateLimit('],
  publicReadGateway: ['resolveAuthenticatedUserId(', 'filterBlockedMediaUrls('],
  serviceHealth: ['DRAPE_HEALTHCHECK_SECRET', 'HEALTHCHECK_SECRET'],
  mixedUserOrServiceRole: ['serviceRoleRequest(', 'getAuthUser('],
}

const manifest = {
  'account-profile-action': ['user'],
  'account-security-action': ['user'],
  'account-security-notification': ['user'],
  'account-support-action': ['user'],
  'auth-sms-hook': ['authSmsHook'],
  'auto-release': ['cron'],
  'claim-passport': ['user'],
  'conversation-access': ['user'],
  'conversation-safety-report': ['user'],
  'create-consultation-room': ['user'],
  'create-order-call-room': ['user'],
  'currency-context': ['publicRateLimited'],
  'custom-order-action': ['user'],
  'customer-order-action': ['user'],
  'delivery-webhook': ['deliveryWebhook'],
  'diary-entry-action': ['user'],
  'escalate-handoff-issues': ['cron'],
  'escalate-production-stalls': ['cron'],
  'expire-pending-payments': ['serviceRole'],
  'expire-quotes': ['cron'],
  'finalize-account-deletions': ['cron'],
  'group-member-action': ['user'],
  'handle-verification-decision': ['serviceRoleOrSignedLink'],
  'handoff-support-action': ['user'],
  'material-advance-action': ['mixedUserOrServiceRole'],
  'message-action': ['user'],
  'notify-ops-verification': ['user'],
  'on-message-created': ['supabaseWebhook'],
  'order-call-action': ['user'],
  'payment-action': ['user'],
  'payout-account-action': ['user'],
  'payout-setup-request': ['user'],
  'paystack-webhook': ['paystackWebhook'],
  'portfolio-item-action': ['user'],
  'process-job-queue': ['cron'],
  'read-gateway': ['publicReadGateway'],
  'ready-made-order-action': ['user'],
  'reauth-proof-action': ['user'],
  'referral-action': ['user'],
  'refund-order-payments': ['serviceRole'],
  'release-order-payouts': ['cron'],
  'request-account-deletion': ['user'],
  'request-data-access': ['user'],
  'review-action': ['user'],
  'saved-tailor-action': ['user'],
  'seller-access-review-request': ['user'],
  'seller-item-action': ['user'],
  'send-consultation-reminders': ['cron'],
  'service-health': ['serviceHealth'],
  'stripe-webhook': ['stripeWebhook'],
  'tailor-order-action': ['user'],
  'tailor-profile-action': ['user'],
}

function fail(message) {
  console.error(`[edge-auth] ${message}`)
  process.exitCode = 1
}

const functionNames = readdirSync(functionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== '_shared')
  .map((entry) => entry.name)
  .sort()

const config = readFileSync(configPath, 'utf8')
const configuredFunctions = [...config.matchAll(/^\[functions\.([^\]]+)\]$/gm)]
  .map((match) => match[1])
  .sort()

for (const name of functionNames) {
  const indexPath = join(functionsDir, name, 'index.ts')
  if (!existsSync(indexPath)) {
    fail(`${name} is missing index.ts`)
    continue
  }

  if (!configuredFunctions.includes(name)) {
    fail(`${name} is missing an explicit [functions.${name}] config block`)
  }

  const expectedControls = manifest[name]
  if (!expectedControls) {
    fail(`${name} is missing from scripts/check-edge-auth.mjs manifest`)
    continue
  }

  const source = readFileSync(indexPath, 'utf8')
  for (const controlName of expectedControls) {
    const required = controls[controlName]
    if (!required) {
      fail(`${name} references unknown auth control "${controlName}"`)
      continue
    }

    const missing = required.filter((needle) => !source.includes(needle))
    if (missing.length > 0) {
      fail(`${name} is classified as ${controlName}, but index.ts is missing: ${missing.join(', ')}`)
    }
  }
}

for (const name of configuredFunctions) {
  if (!functionNames.includes(name)) {
    fail(`supabase/config.toml has [functions.${name}] but no matching function directory`)
  }
}

if (process.exitCode) {
  process.exit(process.exitCode)
}

console.log(`[edge-auth] ${functionNames.length} Edge Functions have explicit config and auth-control coverage.`)
