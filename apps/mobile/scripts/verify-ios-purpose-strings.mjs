#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mobileRoot = resolve(scriptDir, '..')
const appConfigPath = resolve(mobileRoot, 'app.json')
const iosRoot = resolve(mobileRoot, 'ios')
const configOnly = process.argv.includes('--config-only')
const requireNative = process.argv.includes('--require-native')
const appConfig = JSON.parse(readFileSync(appConfigPath, 'utf8'))
const configured = appConfig.expo?.ios?.infoPlist ?? {}
const plugins = Array.isArray(appConfig.expo?.plugins) ? appConfig.expo.plugins : []

const requirements = {
  NSCameraUsageDescription: ['camera', 'for example', 'custom order'],
  NSPhotoLibraryUsageDescription: ['choose', 'for example'],
  NSMicrophoneUsageDescription: ['microphone', 'for example', 'consultation call'],
  NSMotionUsageDescription: ['motion', 'drapeon vision'],
  NSFaceIDUsageDescription: ['face id', 'verify your identity'],
}

function findNativePlist() {
  if (!existsSync(iosRoot)) return null

  const candidates = readdirSync(iosRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'Pods' && entry.name !== 'build')
    .map((entry) => resolve(iosRoot, entry.name, 'Info.plist'))
    .filter(existsSync)

  return candidates.length === 1 ? candidates[0] : null
}

const nativePlistPath = findNativePlist()

const errors = []
for (const [key, phrases] of Object.entries(requirements)) {
  const value = typeof configured[key] === 'string' ? configured[key].trim() : ''
  if (value.length < 40) errors.push(`${key} must clearly explain the protected-resource use.`)
  const normalized = value.toLowerCase()
  for (const phrase of phrases) {
    if (!normalized.includes(phrase)) errors.push(`${key} must include "${phrase}".`)
  }
}

function pluginOptions(name) {
  const entry = plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === name)
  return entry?.[1] ?? null
}

const pluginPurposeStrings = [
  ['expo-camera', 'cameraPermission', 'NSCameraUsageDescription'],
  ['expo-image-picker', 'cameraPermission', 'NSCameraUsageDescription'],
  ['expo-image-picker', 'photosPermission', 'NSPhotoLibraryUsageDescription'],
  ['expo-av', 'microphonePermission', 'NSMicrophoneUsageDescription'],
]

for (const [pluginName, optionName, plistKey] of pluginPurposeStrings) {
  const value = pluginOptions(pluginName)?.[optionName]
  if (value !== configured[plistKey]) {
    errors.push(
      `${pluginName}.${optionName} must exactly match ios.infoPlist.${plistKey} so Expo prebuild cannot overwrite the approved copy.`,
    )
  }
}

function readPlistValue(key) {
  if (!nativePlistPath) return null
  const result = spawnSync(
    '/usr/bin/plutil',
    ['-extract', key, 'raw', '-o', '-', nativePlistPath],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) return null
  return result.stdout.trim()
}

if (!configOnly) {
  if (!nativePlistPath) {
    if (requireNative) errors.push('Generated app Info.plist is missing or ambiguous. Run Expo prebuild first.')
  } else {
    for (const key of Object.keys(requirements)) {
      const nativeValue = readPlistValue(key)
      if (nativeValue !== configured[key]) {
        errors.push(
          `${key} in generated Info.plist does not match app.json. Run "pnpm prebuild:ios:release" before archiving locally.`,
        )
      }
    }
  }
}

if (errors.length > 0) {
  console.error('iOS purpose-string verification failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('iOS purpose-string verification passed.')
console.log('- Camera, photo library, microphone, motion, and Face ID explain the user action and purpose.')
console.log('- Expo plugin overrides match the canonical iOS purpose strings.')
console.log(configOnly ? '- Checked canonical Expo configuration.' : '- Generated Info.plist matches canonical Expo configuration.')
