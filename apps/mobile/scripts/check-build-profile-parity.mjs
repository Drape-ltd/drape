import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const mobileRoot = fileURLToPath(new URL('..', import.meta.url))
const easConfig = JSON.parse(await readFile(new URL('../eas.json', import.meta.url), 'utf8'))
const featureFlagSource = await readFile(new URL('../lib/feature-flags.ts', import.meta.url), 'utf8')

const shippedUiFlags = [
  'EXPO_PUBLIC_DRAPE_INTERACTION_SYSTEM_V1',
  'EXPO_PUBLIC_QUOTE_NEGOTIATION_V1',
  'EXPO_PUBLIC_CHAT_ORDER_ACTIONS_V1',
  'EXPO_PUBLIC_DRAPE_VISION_UI_V2',
]
const betaProfiles = ['development', 'development-device', 'preview', 'testflight']
const allProfiles = [...betaProfiles, 'production']
const defaultOffFlags = ['EXPO_PUBLIC_DARK_THEME_V1', 'EXPO_PUBLIC_GROUP_ORDERS_V1']
const errors = []

for (const profileName of betaProfiles) {
  const profile = easConfig.build?.[profileName]
  for (const flag of shippedUiFlags) {
    if (profile?.env?.[flag] !== 'true') {
      errors.push(`${profileName} must set ${flag}="true"`)
    }
  }
}

for (const profileName of allProfiles) {
  const profile = easConfig.build?.[profileName]
  for (const flag of defaultOffFlags) {
    if (profile?.env?.[flag] !== 'false') {
      errors.push(`${profileName} must set ${flag}="false" until the feature is enabled`)
    }
  }
}

for (const flag of shippedUiFlags) {
  if (typeof easConfig.build?.production?.env?.[flag] !== 'string') {
    errors.push(`production must explicitly set ${flag}`)
  }
}

if (/drapeVisionUiV2:\s*__DEV__/.test(featureFlagSource)) {
  errors.push('drapeVisionUiV2 must not use __DEV__; EAS profiles own shipped UI behavior')
}

if (errors.length > 0) {
  console.error(`Mobile build-profile parity failed in ${mobileRoot}:`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Mobile build-profile parity is explicit across development, preview, TestFlight, and production.')
