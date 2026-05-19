export type SizeInventory = Record<string, number>
export type SizeInventoryDraft = Record<string, string>
export type TailorStockAlert = {
  itemId: string
  severity: 'low_stock' | 'sold_out'
  headline: string
  detail: string
}

export type CustomerStockSignal = {
  label: string
  tone: 'available' | 'warning' | 'urgent' | 'muted'
}

const LOW_STOCK_THRESHOLD = 2
const CUSTOMER_LOW_STOCK_THRESHOLD = 3

export function isReadyMadeBuyableForCustomer(input: {
  stockStatus: string | null | undefined
  inventoryQuantity: number
  isLive?: boolean | null
}) {
  const normalizedStatus = (input.stockStatus ?? 'IN_STOCK').toUpperCase()
  if (input.isLive === false) return false
  if (normalizedStatus === 'SOLD_OUT' || normalizedStatus === 'HIDDEN') return false
  return input.inventoryQuantity > 0
}

export function buildCustomerStockSignal(input: {
  stockStatus: string | null | undefined
  inventoryQuantity: number
  isLive?: boolean | null
  showAvailableCount?: boolean
}): CustomerStockSignal {
  const normalizedStatus = (input.stockStatus ?? 'IN_STOCK').toUpperCase()

  if (input.isLive === false || normalizedStatus === 'HIDDEN') {
    return { label: 'No longer available', tone: 'muted' }
  }

  if (normalizedStatus === 'SOLD_OUT' || input.inventoryQuantity <= 0) {
    return { label: 'Sold out', tone: 'muted' }
  }

  if (input.inventoryQuantity === 1) {
    return { label: 'Only 1 left', tone: 'urgent' }
  }

  if (input.inventoryQuantity <= CUSTOMER_LOW_STOCK_THRESHOLD) {
    return { label: `Only ${input.inventoryQuantity} left`, tone: 'warning' }
  }

  if (normalizedStatus === 'LOW_STOCK') {
    return { label: 'Low stock', tone: 'warning' }
  }

  return {
    label: input.showAvailableCount ? `${input.inventoryQuantity} ready now` : 'In stock',
    tone: 'available',
  }
}

export function normalizeSizeLabels(sizes: string[]) {
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

export function normalizeSizeInventory(sizes: string[], rawSizeInventory: unknown, fallbackInventoryQuantity = 0): SizeInventory {
  const normalizedSizes = normalizeSizeLabels(sizes)
  const rawInventory =
    rawSizeInventory && typeof rawSizeInventory === 'object' && !Array.isArray(rawSizeInventory)
      ? (rawSizeInventory as Record<string, unknown>)
      : {}

  const nextInventory: SizeInventory = {}
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

export function inventoryDraftFromSizeInventory(sizes: string[], sizeInventory: SizeInventory): SizeInventoryDraft {
  return Object.fromEntries(normalizeSizeLabels(sizes).map((size) => [size, String(sizeInventory[size] ?? 0)]))
}

export function draftToSizeInventory(sizes: string[], sizeInventoryDraft: SizeInventoryDraft): SizeInventory {
  const nextInventory: SizeInventory = {}

  for (const size of normalizeSizeLabels(sizes)) {
    const parsedValue = Number.parseInt((sizeInventoryDraft[size] ?? '').trim(), 10)
    nextInventory[size] = Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : 0
  }

  return nextInventory
}

export function sumSizeInventory(sizeInventory: SizeInventory) {
  return Object.values(sizeInventory).reduce((sum, value) => sum + Math.max(0, Math.floor(value || 0)), 0)
}

export function quantityForSize(sizeInventory: SizeInventory, size: string | null | undefined, fallbackInventoryQuantity = 0) {
  const requestedSize = size?.trim()
  if (!requestedSize) return Math.max(0, fallbackInventoryQuantity)
  return Math.max(0, sizeInventory[requestedSize] ?? 0)
}

export function sizeInventoryEntries(sizes: string[], sizeInventory: SizeInventory) {
  return normalizeSizeLabels(sizes).map((size) => ({
    size,
    quantity: Math.max(0, sizeInventory[size] ?? 0),
  }))
}

export function formatSizeInventorySummary(sizes: string[], sizeInventory: SizeInventory, fallbackInventoryQuantity = 0) {
  const entries = sizeInventoryEntries(sizes, sizeInventory)
  const total = sumSizeInventory(sizeInventory) || Math.max(0, fallbackInventoryQuantity)

  if (entries.length === 0) {
    return total <= 0 ? '0 ready' : `${total} ready`
  }

  return `${total} ready · ${entries.map((entry) => `${entry.size} ${entry.quantity}`).join(', ')}`
}

export function buildTailorStockAlert(input: {
  itemId: string
  title: string
  sizes: string[]
  sizeInventory: SizeInventory
  inventoryQuantity: number
  isLive: boolean
  stockStatus: string
}): TailorStockAlert | null {
  const title = input.title.trim() || 'This item'
  const entries = sizeInventoryEntries(input.sizes, input.sizeInventory)
  const soldOutSizes = entries.filter((entry) => entry.quantity <= 0).map((entry) => entry.size)
  const lowSizes = entries.filter((entry) => entry.quantity > 0 && entry.quantity <= LOW_STOCK_THRESHOLD)

  if (input.stockStatus === 'SOLD_OUT' || input.inventoryQuantity <= 0) {
    return {
      itemId: input.itemId,
      severity: 'sold_out',
      headline: `${title} is sold out`,
      detail: 'Buyers cannot order it again until you restock and relist the item.',
    }
  }

  if (soldOutSizes.length > 0) {
    const primarySize = soldOutSizes[0]
    return {
      itemId: input.itemId,
      severity: 'sold_out',
      headline: `${primarySize} sold out on ${title}`,
      detail:
        input.inventoryQuantity > 0
          ? `${input.inventoryQuantity} unit${input.inventoryQuantity === 1 ? '' : 's'} left across other sizes.`
          : 'The whole item is now out of stock.',
    }
  }

  if (input.inventoryQuantity <= LOW_STOCK_THRESHOLD) {
    return {
      itemId: input.itemId,
      severity: 'low_stock',
      headline: `${title} is running low`,
      detail: `Only ${input.inventoryQuantity} unit${input.inventoryQuantity === 1 ? '' : 's'} left. Make more ahead if you want to keep selling it.`,
    }
  }

  if (lowSizes.length > 0) {
    const primarySize = lowSizes[0]
    return {
      itemId: input.itemId,
      severity: 'low_stock',
      headline: `${primarySize.size} is running low on ${title}`,
      detail: `Only ${primarySize.quantity} left in that size. Top up stock before buyers hit sold out.`,
    }
  }

  return null
}
