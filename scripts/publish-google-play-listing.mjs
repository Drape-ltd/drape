#!/usr/bin/env node

import { createSign } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const PACKAGE_NAME = 'com.drape.app'
const LOCALE = 'en-US'
const CREDENTIAL_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
const SCREENSHOT_DIR = path.resolve('docs/store-assets/android/play-phone')
const FEATURE_GRAPHIC = path.resolve(
  'docs/store-assets/android/feature-graphic/drapeon-feature-graphic-1024x500-v1.png',
)
const APP_ICON = path.resolve('docs/store-assets/android/icon/drapeon-play-icon-512.png')

const listing = {
  title: 'Drapeon',
  shortDescription: 'Find vetted tailors. Custom clothing, tracked and protected.',
  fullDescription: `Drapeon brings independent tailoring into one clear, connected experience.

Discover tailors and ready-made pieces from studios around the world. Explore portfolios, specialties, availability, locations, and shop items before deciding who fits your vision.

When you want something made personally, keep the whole project together: your brief, reference images, measurements, quote, messages, production status, and handoff details.

With Drapeon you can:

• Browse tailor profiles, portfolios, specialties, and ready-made pieces
• Save favorite tailors and garments into wishlists
• Share a custom clothing brief with references and requirements
• Keep measurements organized and under your control
• Review quotes and project details in context
• Message your tailor without separating decisions from the order
• Follow project stages from brief through completion
• Return to the exact project from relevant notifications
• Manage privacy preferences and request account deletion in the app

Drapeon is designed for clothing made around real people and real lives—from bridalwear, suits, and alterations to modest fashion, adaptive design, cultural clothing, contemporary separates, and one-of-one pieces.

Availability, fulfillment options, and payment support can vary by tailor, order, and region.`,
}

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

async function accessToken() {
  if (!CREDENTIAL_PATH) throw new Error('GOOGLE_APPLICATION_CREDENTIALS is required')
  const credential = JSON.parse(await readFile(CREDENTIAL_PATH, 'utf8'))
  if (credential.type !== 'service_account' || !credential.client_email || !credential.private_key) {
    throw new Error('Credential is not a valid service account key')
  }

  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(JSON.stringify({
    iss: credential.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))
  const unsigned = `${header}.${claims}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  signer.end()
  const assertion = `${unsigned}.${signer.sign(credential.private_key).toString('base64url')}`
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  const body = await response.json()
  if (!response.ok || !body.access_token) {
    throw new Error(`Could not obtain Google access token (${response.status})`)
  }
  return body.access_token
}

async function googleRequest(token, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  })
  if (!response.ok) {
    const text = await response.text()
    let message = text
    try {
      message = JSON.parse(text)?.error?.message ?? text
    } catch {}
    throw new Error(`${options.method ?? 'GET'} ${url} failed (${response.status}): ${message}`)
  }
  if (response.status === 204) return null
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

async function uploadImage(token, editId, imageType, file) {
  const bytes = await readFile(file)
  const url = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE_NAME}/edits/${editId}/listings/${LOCALE}/${imageType}?uploadType=media`
  return googleRequest(token, url, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: bytes,
  })
}

async function main() {
  const token = await accessToken()
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}`
  const edit = await googleRequest(token, `${base}/edits`, { method: 'POST' })
  const editId = edit?.id
  if (!editId) throw new Error('Google did not return an edit ID')

  if (process.argv.includes('--verify')) {
    const [savedListing, savedDetails, phoneImages, featureImages, iconImages] = await Promise.all([
      googleRequest(token, `${base}/edits/${editId}/listings/${LOCALE}`),
      googleRequest(token, `${base}/edits/${editId}/details`),
      googleRequest(token, `${base}/edits/${editId}/listings/${LOCALE}/phoneScreenshots`),
      googleRequest(token, `${base}/edits/${editId}/listings/${LOCALE}/featureGraphic`),
      googleRequest(token, `${base}/edits/${editId}/listings/${LOCALE}/icon`),
    ])
    console.log(JSON.stringify({
      ok: true,
      packageName: PACKAGE_NAME,
      locale: LOCALE,
      title: savedListing?.title,
      shortDescriptionLength: savedListing?.shortDescription?.length ?? 0,
      fullDescriptionLength: savedListing?.fullDescription?.length ?? 0,
      contactEmail: savedDetails?.contactEmail,
      contactWebsite: savedDetails?.contactWebsite,
      screenshots: phoneImages?.images?.length ?? 0,
      featureGraphics: featureImages?.images?.length ?? 0,
      icons: iconImages?.images?.length ?? 0,
    }))
    return
  }

  await googleRequest(token, `${base}/edits/${editId}/listings/${LOCALE}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(listing),
  })

  await googleRequest(token, `${base}/edits/${editId}/details`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      defaultLanguage: LOCALE,
      contactEmail: 'support@drapeon.co',
      contactWebsite: 'https://drapeon.co/help',
    }),
  })

  const imageBase = `${base}/edits/${editId}/listings/${LOCALE}`
  await googleRequest(token, `${imageBase}/phoneScreenshots`, { method: 'DELETE' })
  const screenshots = (await readdir(SCREENSHOT_DIR))
    .filter((file) => /^\d{2}-.+\.png$/u.test(file))
    .sort()
  if (screenshots.length !== 8) {
    throw new Error(`Expected exactly 8 numbered phone screenshots; found ${screenshots.length}`)
  }
  for (const screenshot of screenshots) {
    await uploadImage(token, editId, 'phoneScreenshots', path.join(SCREENSHOT_DIR, screenshot))
  }

  await googleRequest(token, `${imageBase}/featureGraphic`, { method: 'DELETE' })
  await uploadImage(token, editId, 'featureGraphic', FEATURE_GRAPHIC)

  await googleRequest(token, `${imageBase}/icon`, { method: 'DELETE' })
  await uploadImage(token, editId, 'icon', APP_ICON)

  try {
    await googleRequest(token, `${base}/edits/${editId}:validate`, { method: 'POST' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('failed (403): The caller does not have permission')) throw error
  }
  await googleRequest(token, `${base}/edits/${editId}:commit`, { method: 'POST' })
  console.log(JSON.stringify({
    ok: true,
    packageName: PACKAGE_NAME,
    locale: LOCALE,
    screenshots: screenshots.length,
    featureGraphic: true,
    icon: true,
    releaseTracksChanged: false,
  }))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
