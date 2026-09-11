'use client'

import { useRef } from 'react'

type CommandAttempt<T> = {
  fingerprint: string
  key: string
  metadata: T | undefined
}

export function idempotencyFingerprint(parts: readonly unknown[]) {
  return JSON.stringify(parts)
}

/**
 * Keeps one key for an ambiguous retry of identical inputs, creates a new key
 * when any command input changes, and rotates only after confirmed success.
 */
export function useIdempotentCommand<T = undefined>(namespace: string) {
  const attempt = useRef<CommandAttempt<T> | null>(null)

  function begin(fingerprint: string, createMetadata?: () => T): CommandAttempt<T> {
    if (attempt.current?.fingerprint === fingerprint) return attempt.current
    const next: CommandAttempt<T> = {
      fingerprint,
      key: `${namespace}:${crypto.randomUUID()}`,
      metadata: createMetadata?.(),
    }
    attempt.current = next
    return next
  }

  function complete(fingerprint: string) {
    if (attempt.current?.fingerprint === fingerprint) attempt.current = null
  }

  return { begin, complete }
}
