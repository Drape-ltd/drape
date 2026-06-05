import { FlatCompat } from '@eslint/eslintrc'
import js from '@eslint/js'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
})

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      '.open-next/**',
      'node_modules/**',
      'next-env.d.ts',
      'opennextjs-cloudflare.d.ts',
      'react-jsx.d.ts',
      'wrangler.jsonc',
    ],
  },
  ...compat.extends('next/core-web-vitals'),
]

export default eslintConfig
