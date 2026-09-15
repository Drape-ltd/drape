import path from 'node:path'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '../../..')

const sourceRoots = ['apps', 'packages', 'supabase/functions', 'supabase/templates']
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.html', '.toml'])
const forbiddenBrand = /\bDrape\b/

function shouldSkipDirectory(name) {
  return (
    name === '.expo' ||
    name === '.git' ||
    name.startsWith('.next') ||
    name.startsWith('.open-next') ||
    name === 'build' ||
    name === 'coverage' ||
    name === 'dist' ||
    name === 'generated' ||
    name === 'node_modules' ||
    name === 'qa-artifacts' ||
    name === '__tests__'
  )
}

function scanFile(filePath) {
  let contents
  try {
    contents = readFileSync(filePath, 'utf8')
  } catch {
    return []
  }

  const relativePath = path.relative(repoRoot, filePath)
  return contents
    .split('\n')
    .flatMap((line, index) => (forbiddenBrand.test(line) ? [`${relativePath}:${index + 1}:${line}`] : []))
}

function scanDirectory(directoryPath) {
  return readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) return []
      return scanDirectory(path.join(directoryPath, entry.name))
    }

    const filePath = path.join(directoryPath, entry.name)
    if (!sourceExtensions.has(path.extname(entry.name))) return []
    if (/\.test\.[^.]+$/.test(entry.name)) return []
    return scanFile(filePath)
  })
}

const findings = sourceRoots.flatMap((sourceRoot) => scanDirectory(path.join(repoRoot, sourceRoot)))
const configPath = path.join(repoRoot, 'supabase/config.toml')
if (statSync(configPath).isFile()) findings.push(...scanFile(configPath))

// `Drape` is also an intentional protocol/vendor prefix in internal
// diagnostic headers (for example `X-Drape-Correlation-Id`). Those headers
// are not customer-facing copy and should not make the brand gate fail.
const customerFacingFindings = findings
  .filter((line) => !/['"]X-Drape-[A-Za-z0-9-]+['"]/.test(line))

if (customerFacingFindings.length > 0) {
  console.error(
    [
      'Forbidden customer-facing brand name found.',
      'Use "Drapeon" for visible copy. Technical identifiers such as @drape/* and drape:// are allowed.',
      '',
      customerFacingFindings.join('\n'),
    ].join('\n')
  )
  process.exit(1)
}

console.log('User-facing brand scan passed: no standalone "Drape" copy remains.')
