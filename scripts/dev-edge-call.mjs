#!/usr/bin/env node
import { readFileSync } from 'node:fs'

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function loadEnv(path) {
  const text = readFileSync(path, 'utf8')
  const env = {}
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^([^#=\s]+)=(.*)$/u)
    if (!match) continue
    env[match[1]] = match[2].replace(/^"|"$/gu, '')
  }
  return env
}

function extractAccessToken(path) {
  const text = readFileSync(path, 'utf8')
  const match = text.match(/access_token[^A-Za-z0-9._-]+([A-Za-z0-9._-]{100,})/u)
  if (!match?.[1]) {
    throw new Error(`No access token found in ${path}`)
  }
  return match[1]
}

const functionName = argValue('--function')
const tokenFile = argValue('--token-file')
const bodyText = argValue('--body')
const envFile = argValue('--env') ?? 'apps/mobile/.env.local'

if (!functionName || !tokenFile || !bodyText) {
  console.error('Usage: node scripts/dev-edge-call.mjs --function <name> --token-file <path> --body <json>')
  process.exit(2)
}

const env = loadEnv(envFile)
const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL
const publishableKey = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !publishableKey) {
  throw new Error(`Missing Supabase env in ${envFile}`)
}

let body
try {
  body = JSON.parse(bodyText)
} catch (error) {
  throw new Error(`Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`)
}

const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
  method: 'POST',
  headers: {
    apikey: publishableKey,
    authorization: `Bearer ${extractAccessToken(tokenFile)}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify(body),
})

const text = await response.text()
let parsed = text
try {
  parsed = JSON.parse(text)
} catch {
  // Keep non-JSON bodies intact.
}

console.log(JSON.stringify({
  function: functionName,
  status: response.status,
  body: parsed,
}, null, 2))
