#!/usr/bin/env node
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const withSupabase = process.argv.includes('--with-supabase')

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
  ['pnpm', ['--dir', 'apps/mobile', 'typecheck']],
  ['pnpm', ['--dir', 'apps/mobile', 'lint']],
  ['pnpm', ['--dir', 'apps/web', 'typecheck']],
  ['pnpm', ['--dir', 'apps/web', 'lint']],
  ['pnpm', ['--filter', '@drape/shared', 'test']],
  ['deno', ['check', ...edgeFunctionEntrypoints()]],
]

if (withSupabase) {
  checks.push(['supabase', ['db', 'lint', '--linked', '--fail-on', 'error']])
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
