#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'

const root = resolve('assets/store-showcase')
const output = resolve('docs/store-showcase-media-ledger.json')

function files(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(path, entry.name)
    return entry.isDirectory() ? files(child) : [child]
  })
}

const assets = files(root)
  .filter((path) => ['.png', '.jpg', '.jpeg', '.webp'].includes(extname(path).toLowerCase()))
  .sort()
  .map((path) => {
    const bytes = readFileSync(path)
    return {
      path: relative(process.cwd(), path),
      bytes: statSync(path).size,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      provenance: 'Generated for Drapeon with OpenAI image generation; no third-party stock asset was supplied.',
      intendedUse: 'Drapeon app surfaces, store listing screenshots, reviewer fixtures, and Drapeon marketing.',
    }
  })

writeFileSync(output, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  rightsNote: 'Project-generated synthetic imagery. Retain this ledger with the store-submission archive and re-review before licensing imagery outside Drapeon-owned channels.',
  assetCount: assets.length,
  assets,
}, null, 2)}\n`)

console.log(JSON.stringify({ output, assetCount: assets.length }))
