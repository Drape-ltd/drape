'use client'

const DATABASE_NAME = 'drapeon-signup-media'
const STORE_NAME = 'media'
const DATABASE_VERSION = 1

export type SignupMediaDraftDescriptor = {
  key: string
  name: string
  contentType: string
  byteLength: number
  durationSeconds: number
  createdAt: string
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Browser media storage could not open.'))
  })
}

export async function saveSignupMediaDraft(key: string, blob: Blob) {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(blob, key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Media draft could not save.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Media draft save was interrupted.'))
  })
  database.close()
}

export async function readSignupMediaDraft(key: string): Promise<Blob | null> {
  const database = await openDatabase()
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null)
    request.onerror = () => reject(request.error ?? new Error('Media draft could not be restored.'))
  })
  database.close()
  return blob
}

export async function deleteSignupMediaDraft(key: string) {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Media draft could not be removed.'))
  })
  database.close()
}

export function createSignupMediaDraftKey(kind: 'avatar' | 'portfolio' | 'trust') {
  return `${kind}:${crypto.randomUUID()}`
}

export type QuarantineMediaEntry = SignupMediaDraftDescriptor & {
  kind: 'avatar' | 'portfolio-image' | 'portfolio-video' | 'trust-video'
}

export async function stageSignupMedia(input: {
  userId: string
  claimToken: string
  entries: QuarantineMediaEntry[]
}) {
  if (!input.entries.length) return
  const response = await fetch('/api/auth/signup-media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'init', ...input }),
  })
  const payload = await response.json() as { uploads?: Array<QuarantineMediaEntry & { path: string; token: string }>; error?: string }
  if (!response.ok || !payload.uploads) throw new Error(payload.error ?? 'Private signup media could not be prepared.')
  const { createClient } = await import('./supabase')
  const client = createClient()
  for (const upload of payload.uploads) {
    const blob = await readSignupMediaDraft(upload.key)
    if (!blob) throw new Error(`The selected ${upload.kind.replace('-', ' ')} is missing from this browser.`)
    const result = await client.storage.from('signup-media-quarantine').uploadToSignedUrl(upload.path, upload.token, blob, {
      contentType: upload.contentType,
      cacheControl: '0',
    })
    if (result.error) throw result.error
  }
  const completed = await fetch('/api/auth/signup-media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'complete', userId: input.userId, claimToken: input.claimToken }),
  })
  if (!completed.ok) {
    const result = await completed.json().catch(() => null) as { error?: string } | null
    throw new Error(result?.error ?? 'Private signup media could not be finalized.')
  }
}

export async function restoreQuarantinedSignupMedia(input: {
  userId: string
  claimToken: string
  accessToken: string
}) {
  let response: Response | null = null
  for (let attempt = 0; attempt < 10; attempt += 1) {
    response = await fetch('/api/auth/signup-media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.accessToken}` },
      body: JSON.stringify({ action: 'claim', userId: input.userId, claimToken: input.claimToken }),
    })
    if (response.status !== 404 && response.status !== 409) break
    await new Promise((resolve) => window.setTimeout(resolve, 1_500))
  }
  if (!response) throw new Error('Private signup media could not be restored.')
  const payload = await response.json() as { downloads?: Array<QuarantineMediaEntry & { signedUrl: string }>; error?: string }
  if (!response.ok || !payload.downloads) throw new Error(payload.error ?? 'Private signup media could not be restored.')
  for (const entry of payload.downloads) {
    const media = await fetch(entry.signedUrl, { cache: 'no-store' })
    if (!media.ok) throw new Error('Private signup media could not be downloaded.')
    await saveSignupMediaDraft(entry.key, await media.blob())
  }
  return payload.downloads
}

export async function cleanupQuarantinedSignupMedia(input: { userId: string; claimToken: string; accessToken: string }) {
  await fetch('/api/auth/signup-media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.accessToken}` },
    body: JSON.stringify({ action: 'cleanup', userId: input.userId, claimToken: input.claimToken }),
  }).catch(() => undefined)
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('This saved image could not be restored.'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('This saved image could not be restored.'))
    reader.readAsDataURL(blob)
  })
}

export async function readVideoDurationSeconds(blob: Blob): Promise<number> {
  const objectUrl = URL.createObjectURL(blob)
  try {
    return await new Promise<number>((resolve, reject) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        const duration = video.duration
        if (!Number.isFinite(duration) || duration <= 0) reject(new Error('This video duration could not be read.'))
        else resolve(duration)
      }
      video.onerror = () => reject(new Error('This video could not be opened.'))
      video.src = objectUrl
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
