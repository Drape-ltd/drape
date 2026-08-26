export const CUSTOM_ORDER_DRAFT_VERSION = 'custom-order-brief-draft-2026-08-14-v1' as const
export const CUSTOM_ORDER_DRAFT_MAX_BYTES = 64 * 1024

export type CustomOrderBriefDraftEnvelope = {
  version: typeof CUSTOM_ORDER_DRAFT_VERSION
  currentStep: number
  fields: Record<string, unknown>
  hasDeviceOnlyAttachments: boolean
  updatedAt?: string | null
}

export function isMeaningfulCustomOrderDraft(fields: Record<string, unknown>) {
  return Object.values(fields).some((value) => {
    if (typeof value === 'string') return value.trim().length > 0
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0
    if (Array.isArray(value)) return value.length > 0
    return value != null && typeof value === 'object' && Object.keys(value).length > 0
  })
}
