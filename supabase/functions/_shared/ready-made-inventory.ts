export const LOW_STOCK_THRESHOLD = 2

export const READY_MADE_INVENTORY_HELD_STAGES = [
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'SHIPPED',
  'READY_FOR_COLLECTION',
  'DELIVERED',
  'COLLECTED',
  'COMPLETE',
  'IN_DISPUTE',
  'REFUNDED',
] as const

export type ReadyMadeStockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'SOLD_OUT' | 'HIDDEN'

export type ReadyMadeSizeInventory = Record<string, number>

export function normalizeReadyMadeSizes(sizes: string[]) {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const rawSize of sizes) {
    const size = rawSize.trim()
    if (!size || seen.has(size)) continue
    seen.add(size)
    normalized.push(size)
  }

  return normalized
}

export function normalizeReadyMadeSizeInventory(input: {
  sizes: string[]
  sizeInventory: unknown
  fallbackInventoryQuantity?: number | null
}): ReadyMadeSizeInventory {
  const normalizedSizes = normalizeReadyMadeSizes(input.sizes)
  const fallbackInventoryQuantity = Math.max(input.fallbackInventoryQuantity ?? 0, 0)
  const rawInventory =
    input.sizeInventory && typeof input.sizeInventory === 'object' && !Array.isArray(input.sizeInventory)
      ? (input.sizeInventory as Record<string, unknown>)
      : {}

  const nextInventory: ReadyMadeSizeInventory = {}
  let assignedUnits = 0

  for (const size of normalizedSizes) {
    const rawValue = rawInventory[size]
    const parsedValue =
      typeof rawValue === 'number'
        ? Math.floor(rawValue)
        : Number.parseInt(typeof rawValue === 'string' ? rawValue : '', 10)
    const quantity = Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : 0
    nextInventory[size] = quantity
    assignedUnits += quantity
  }

  if (assignedUnits === 0 && fallbackInventoryQuantity > 0 && normalizedSizes.length > 0) {
    nextInventory[normalizedSizes[0]] = fallbackInventoryQuantity
  }

  return nextInventory
}

export function sumReadyMadeSizeInventory(sizeInventory: ReadyMadeSizeInventory) {
  return Object.values(sizeInventory).reduce((sum, value) => sum + Math.max(0, Math.floor(value || 0)), 0)
}

export function readyMadeSizeQuantity(input: {
  sizeInventory: ReadyMadeSizeInventory
  requestedSize?: string | null
  fallbackInventoryQuantity?: number
}) {
  const requestedSize = input.requestedSize?.trim()
  if (!requestedSize) return Math.max(0, Math.floor(input.fallbackInventoryQuantity ?? 0))
  return Math.max(0, Math.floor(input.sizeInventory[requestedSize] ?? 0))
}

export function zeroReadyMadeSizeInventory(sizes: string[]) {
  return Object.fromEntries(normalizeReadyMadeSizes(sizes).map((size) => [size, 0])) as ReadyMadeSizeInventory
}

export function deriveReadyMadeStockStatus(input: {
  isLive: boolean
  inventoryQuantity: number
}): ReadyMadeStockStatus {
  if (!input.isLive) return 'HIDDEN'
  if (input.inventoryQuantity <= 0) return 'SOLD_OUT'
  if (input.inventoryQuantity <= LOW_STOCK_THRESHOLD) return 'LOW_STOCK'
  return 'IN_STOCK'
}

export function resolveReadyMadeListingState(input: {
  requestedIsLive: boolean
  canPublishReadyMade: boolean
  inventoryQuantity: number
  onboarding?: boolean | null
}) {
  const inventoryQuantity = Number.isFinite(input.inventoryQuantity)
    ? Math.max(0, Math.floor(input.inventoryQuantity))
    : 0
  const isLive = input.onboarding === true
    ? false
    : input.requestedIsLive && input.canPublishReadyMade

  return {
    isLive,
    forcedDraft: input.requestedIsLive && !isLive,
    stockStatus: deriveReadyMadeStockStatus({ isLive, inventoryQuantity }),
    inventoryQuantity,
  }
}

export function readyMadeStockHint(inventoryQuantity: number) {
  if (inventoryQuantity <= 0) return 'Sold out'
  if (inventoryQuantity <= LOW_STOCK_THRESHOLD) {
    return `Only ${inventoryQuantity} left`
  }
  return `${inventoryQuantity} ready now`
}

export type ReadyMadeStockNotification = {
  title: string
  body: string
}

export function buildReadyMadeStockNotification(input: {
  itemTitle: string
  sizes: string[]
  sizeInventory: unknown
  inventoryQuantity: number
  requestedSize?: string | null
}): ReadyMadeStockNotification | null {
  const itemTitle = input.itemTitle.trim() || 'This ready-made item'
  const normalizedRequestedSize = input.requestedSize?.trim() ?? ''
  const normalizedSizeInventory = normalizeReadyMadeSizeInventory({
    sizes: input.sizes,
    sizeInventory: input.sizeInventory,
    fallbackInventoryQuantity: input.inventoryQuantity,
  })

  if (normalizedRequestedSize) {
    const sizeRemaining = readyMadeSizeQuantity({
      sizeInventory: normalizedSizeInventory,
      requestedSize: normalizedRequestedSize,
      fallbackInventoryQuantity: input.inventoryQuantity,
    })

    if (sizeRemaining <= 0) {
      if (input.inventoryQuantity <= 0) {
        return {
          title: `${itemTitle} just sold out`,
          body: `The last ${normalizedRequestedSize} sold, and the whole item is now out of stock.`,
        }
      }

      return {
        title: `${normalizedRequestedSize} just sold out`,
        body: `${itemTitle} is now out of ${normalizedRequestedSize}. ${input.inventoryQuantity} unit${input.inventoryQuantity === 1 ? '' : 's'} left across other sizes.`,
      }
    }

    if (sizeRemaining <= LOW_STOCK_THRESHOLD) {
      return {
        title: `${normalizedRequestedSize} is running low`,
        body: `${itemTitle} has only ${sizeRemaining} unit${sizeRemaining === 1 ? '' : 's'} left in ${normalizedRequestedSize}.`,
      }
    }
  }

  if (input.inventoryQuantity <= 0) {
    return {
      title: `${itemTitle} is sold out`,
      body: 'Buyers can no longer order this piece until you restock it.',
    }
  }

  if (input.inventoryQuantity <= LOW_STOCK_THRESHOLD) {
    return {
      title: `${itemTitle} is running low`,
      body: `Only ${input.inventoryQuantity} unit${input.inventoryQuantity === 1 ? '' : 's'} left. Make more ahead if you still want to sell this piece.`,
    }
  }

  return null
}
