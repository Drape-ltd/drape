#!/usr/bin/env node
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const withSupabase = process.argv.includes('--with-supabase')
const evidenceRootArg = process.argv.find((arg) => arg.startsWith('--evidence-root='))
const promotionRun = /^(1|true)$/iu.test(process.env.RELEASE_PROMOTION ?? '')

if (promotionRun && !evidenceRootArg) {
  console.error('Promotion launch checks require --evidence-root with happy, negative, and visual results.')
  process.exit(1)
}

const evidenceCheckArgs = ['scripts/release-evidence-check.mjs']
if (evidenceRootArg) evidenceCheckArgs.push(evidenceRootArg)

function edgeFunctionEntrypoints() {
  const functionsDir = join(root, 'supabase', 'functions')
  return readdirSync(functionsDir)
    .map((name) => join(functionsDir, name))
    .filter((path) => statSync(path).isDirectory())
    .map((path) => join(path, 'index.ts'))
    .filter((path) => {
      try {
        return statSync(path).isFile()
      } catch {
        return false
      }
    })
    .sort()
}

const checks = [
  ['node', ['scripts/release-contract-check.mjs']],
  ['git', ['diff', '--check']],
  ['node', evidenceCheckArgs],
  ['node', ['scripts/mobile-release-target-guard.mjs']],
  ['node', ['apps/mobile/scripts/check-build-profile-parity.mjs']],
  ['node', ['apps/mobile/scripts/check-app-identity.mjs']],
  ['pnpm', ['--dir', 'apps/mobile', 'typecheck']],
  ['pnpm', ['--dir', 'apps/mobile', 'lint']],
  // Keep the contract checker hermetic: Next's default incremental typecheck
  // writes tsconfig.tsbuildinfo, which is unnecessary for a release gate and
  // can be blocked in read-only CI workspaces.
  ['pnpm', ['--dir', 'apps/web', 'exec', 'tsc', '--noEmit', '--incremental', 'false']],
  ['pnpm', ['--dir', 'apps/web', 'lint']],
  ['pnpm', ['--filter', '@drape/shared', 'test']],
  // Shared workspace packages use TypeScript's extensionless imports. Deno's
  // sloppy-import compatibility mode resolves those imports the same way the
  // package compiler and production bundler do.
  ['deno', ['check', '--sloppy-imports', ...edgeFunctionEntrypoints()]],
]

if (withSupabase) {
  checks.push([
    'supabase',
    ['db', 'lint', '--linked', '--schema', 'public,util', '--fail-on', 'error'],
  ])
}

for (const [command, args] of checks) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log('\nLaunch contract checks passed.')
