export type ExpoPushReceiptOutcome =
  | { kind: 'pending' }
  | { kind: 'provider-accepted' }
  | { kind: 'delivery-error'; errorCode: string; message: string }

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function classifyExpoPushReceipt(value: unknown): ExpoPushReceiptOutcome {
  const receipt = asRecord(value)
  const status = typeof receipt.status === 'string' ? receipt.status.trim() : ''

  if (!status) return { kind: 'pending' }
  if (status === 'ok') return { kind: 'provider-accepted' }

  const details = asRecord(receipt.details)
  const errorCode = typeof details.error === 'string' && details.error.trim().length > 0
    ? details.error.trim()
    : 'EXPO_RECEIPT_ERROR'
  const message = typeof receipt.message === 'string' && receipt.message.trim().length > 0
    ? receipt.message.trim()
    : errorCode

  return {
    kind: 'delivery-error',
    errorCode,
    message,
  }
}
