import AsyncStorage from '@react-native-async-storage/async-storage'

export type VisionNavigationContext = {
  mode?: string
  returnTo?: string
  historyChain?: string
  diaryId?: string
  orderId?: string
  itemId?: string
}

type StoredVisionNavigationContext = VisionNavigationContext & {
  updatedAtMs: number
}

const VISION_NAVIGATION_CONTEXT_KEY = 'drape:vision-navigation-context:v1'
const VISION_NAVIGATION_CONTEXT_TTL_MS = 20 * 60 * 1000

let memoryContext: StoredVisionNavigationContext | null = null

function cleanParam(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function normalizeContext(context: VisionNavigationContext): VisionNavigationContext {
  return {
    mode: cleanParam(context.mode),
    returnTo: cleanParam(context.returnTo),
    historyChain: cleanParam(context.historyChain),
    diaryId: cleanParam(context.diaryId),
    orderId: cleanParam(context.orderId),
    itemId: cleanParam(context.itemId),
  }
}

function hasReturnContext(context: VisionNavigationContext) {
  return Boolean(
    context.returnTo ||
    context.historyChain ||
    context.diaryId ||
    context.orderId ||
    context.itemId
  )
}

function isFreshContext(context: StoredVisionNavigationContext | null | undefined) {
  return Boolean(
    context &&
    Number.isFinite(context.updatedAtMs) &&
    Date.now() - context.updatedAtMs <= VISION_NAVIGATION_CONTEXT_TTL_MS
  )
}

function freshMemoryContext() {
  if (!isFreshContext(memoryContext)) {
    memoryContext = null
    return null
  }
  return memoryContext
}

export function readPreservedVisionNavigationContextSync(): VisionNavigationContext | null {
  const context = freshMemoryContext()
  return context ? normalizeContext(context) : null
}

export async function loadPreservedVisionNavigationContext(): Promise<VisionNavigationContext | null> {
  const memory = freshMemoryContext()
  if (memory) return normalizeContext(memory)

  try {
    const raw = await AsyncStorage.getItem(VISION_NAVIGATION_CONTEXT_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<StoredVisionNavigationContext>
    const stored: StoredVisionNavigationContext = {
      ...normalizeContext(parsed),
      updatedAtMs: typeof parsed.updatedAtMs === 'number' ? parsed.updatedAtMs : 0,
    }

    if (!isFreshContext(stored)) return null
    memoryContext = stored
    return normalizeContext(stored)
  } catch {
    return null
  }
}

export function preserveVisionNavigationContext(context: VisionNavigationContext) {
  const normalized = normalizeContext(context)
  if (!hasReturnContext(normalized)) return freshMemoryContext()

  const next: StoredVisionNavigationContext = {
    ...normalized,
    updatedAtMs: Date.now(),
  }

  memoryContext = next
  void AsyncStorage.setItem(VISION_NAVIGATION_CONTEXT_KEY, JSON.stringify(next)).catch(() => {})
  return next
}

export function clearPreservedVisionNavigationContext() {
  memoryContext = null
  void AsyncStorage.removeItem(VISION_NAVIGATION_CONTEXT_KEY).catch(() => {})
}

export function mergeVisionNavigationContext(
  current: VisionNavigationContext,
  preserved: VisionNavigationContext | null | undefined,
): VisionNavigationContext {
  const normalizedCurrent = normalizeContext(current)
  const normalizedPreserved = preserved ? normalizeContext(preserved) : null
  if (!normalizedPreserved) return normalizedCurrent

  const sameMode =
    !normalizedCurrent.mode ||
    !normalizedPreserved.mode ||
    normalizedCurrent.mode === normalizedPreserved.mode

  if (!sameMode) return normalizedCurrent

  return {
    mode: normalizedCurrent.mode ?? normalizedPreserved.mode,
    returnTo: normalizedCurrent.returnTo ?? normalizedPreserved.returnTo,
    historyChain: normalizedCurrent.historyChain ?? normalizedPreserved.historyChain,
    diaryId: normalizedCurrent.diaryId ?? normalizedPreserved.diaryId,
    orderId: normalizedCurrent.orderId ?? normalizedPreserved.orderId,
    itemId: normalizedCurrent.itemId ?? normalizedPreserved.itemId,
  }
}
