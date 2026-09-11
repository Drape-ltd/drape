const LEGACY_SCHEMA_ERROR_CODES = new Set(['42703', 'PGRST204'])

/**
 * The legacy reader exists only to let development render before the canonical
 * case migration is present. It must never turn an authorization, outage, or
 * production schema failure into a silently partial operational view.
 *
 * @param {{ environment: string | undefined; error: { code?: unknown } | null | undefined }} input
 */
export function canUseLegacyOpsReadBridge(input) {
  if (input.environment?.trim().toUpperCase() !== 'DEVELOPMENT') return false
  const code = typeof input.error?.code === 'string' ? input.error.code.trim().toUpperCase() : ''
  return LEGACY_SCHEMA_ERROR_CODES.has(code)
}
