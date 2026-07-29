import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '../../..')

const args = [
  '-n',
  String.raw`\bDrape\b`,
  'apps',
  'packages',
  'supabase/functions',
  'supabase/templates',
  'supabase/config.toml',
  '--glob',
  '*.{ts,tsx,js,jsx,html,toml}',
  '--glob',
  '!**/node_modules/**',
  '--glob',
  '!**/generated/**',
  '--glob',
  '!**/*.test.*',
  '--glob',
  '!**/__tests__/**',
]

let output = ''
try {
  output = execFileSync('rg', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
} catch (error) {
  if (error?.status !== 1) throw error
}

if (output) {
  console.error(
    [
      'Forbidden customer-facing brand name found.',
      'Use "Drapeon" for visible copy. Technical identifiers such as @drape/* and drape:// are allowed.',
      '',
      output,
    ].join('\n')
  )
  process.exit(1)
}

console.log('User-facing brand scan passed: no standalone "Drape" copy remains.')
