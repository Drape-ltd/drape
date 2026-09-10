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
